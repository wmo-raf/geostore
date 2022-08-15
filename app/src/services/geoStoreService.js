const logger = require("logger");
const GeoStore = require("models/geoStore");
const GeoJSONConverter = require("converters/geoJSONConverter");
const md5 = require("md5");
const IdConnection = require("models/idConnection");
const turf = require("@turf/turf");
const ProviderNotFound = require("errors/providerNotFound");
const GeoJSONNotFound = require("errors/geoJSONNotFound");
const UnknownGeometry = require("errors/unknownGeometry");
const config = require("config");

const repairGeometry = (geojsonStr, geomType) => {
    const pgFeatureServUrl = config.get("pgFeatureServUrl");
    let url = `${pgFeatureServUrl}/functions/postgisftw.repair_geojson_geometry/items.json`;
    logger.debug("Doing request to ", url);

    const params = {
        geojson_str: geojsonStr,
        geometry_type: geomType,
    };

    return axios.get(url, { params }).then((response) => {
        response.data;
    });
};

const executeThunk = (client, sql, params) =>
    new Promise((resolve, reject) => {
        client
            .execute(sql, params)
            .done((data) => {
                resolve(data);
            })
            .error((err) => {
                reject(err[0]);
            });
    });

class GeoStoreServiceV2 {
    static getGeometryType(geojson) {
        logger.debug("Get geometry type");
        logger.debug("Geometry type: %s", geojson.type);

        if (geojson.type === "Point" || geojson.type === "MultiPoint") {
            return 1;
        }
        if (
            geojson.type === "LineString" ||
            geojson.type === "MultiLineString"
        ) {
            return 2;
        }
        if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") {
            return 3;
        }
        throw new UnknownGeometry(`Unknown geometry type: ${geojson.type}`);
    }

    static async repairGeometry(geojson) {
        if (process.env.NODE_ENV !== "test" || geojson.length < 2000) {
            logger.debug("GeoJSON: %s", JSON.stringify(geojson));
        }
        const geometryType = GeoStoreServiceV2.getGeometryType(geojson);
        logger.debug("Geometry type: %s", JSON.stringify(geometryType));

        logger.debug("Repair geoJSON geometry");
        logger.debug("Generating query");

        const geometryStr = JSON.stringify(geojson);

        try {
            const data = await repairGeometry(geometryStr, geometryType);

            if (data && data.length === 1) {
                data[0].geojson = JSON.parse(data[0].geojson);
                if (
                    process.env.NODE_ENV !== "test" ||
                    data[0].geojson.length < 2000
                ) {
                    logger.debug(data[0].geojson);
                }
                return data[0];
            }
            throw new GeoJSONNotFound("No Geojson returned");
        } catch (e) {
            logger.error(e);
            throw e;
        }
    }

    static async getNewHash(hash) {
        const idCon = await IdConnection.findOne({ oldId: hash }).exec();
        if (!idCon) {
            return hash;
        }
        return idCon.hash;
    }

    static async getGeostoreById(id) {
        logger.info(
            `[GeoStoreServiceV2 - getGeostoreById] Getting geostore by id ${id}`
        );
        const hash = await GeoStoreServiceV2.getNewHash(id);
        logger.debug(
            "[GeoStoreServiceV2 - getGeostoreByInfoProps]  hash",
            hash
        );
        const geoStore = await GeoStore.findOne(
            { hash },
            { "geojson._id": 0, "geojson.features._id": 0 }
        ).exec();
        if (geoStore) {
            logger.debug(
                "[GeoStoreServiceV2 - getGeostoreByInfoProps] geostore",
                JSON.stringify(geoStore.geojson)
            );
            return geoStore;
        }
        return null;
    }

    static async getMultipleGeostores(ids) {
        logger.debug(
            `[GeoStoreServiceV2 - getGeostoreByInfoProps] Getting geostores with ids: ${ids}`
        );
        const hashes = await Promise.all(ids.map(GeoStoreServiceV2.getNewHash));
        const query = { hash: { $in: hashes } };
        const geoStores = await GeoStore.find(query);

        if (geoStores && geoStores.length > 0) {
            return geoStores;
        }
        return null;
    }

    static async getNationalList() {
        logger.debug(
            "[GeoStoreServiceV2 - getGeostoreByInfoProps] Obtaining national list from database"
        );
        const query = {
            "info.iso": { $gt: "" },
            "info.id1": null,
        };
        const select = "hash info.iso";
        return GeoStore.find(query, select).exec();
    }

    static async getGeostoreByInfoProps(infoQuery) {
        logger.debug(
            `[GeoStoreServiceV2 - getGeostoreByInfoProps] Getting geostore with query:`,
            infoQuery
        );
        return GeoStore.findOne(infoQuery).exec();
    }

    static async getGeostoreByInfo(info) {
        return GeoStore.findOne({ info });
    }

    // @TODO: Extract bbox handling to its own class
    /**
     * @name overflowsAntimeridian
     * @description check if the geometry overflows the [-180, -90, 180, 90] box
     * @param {Array} bbox
     * @returns boolean
     */
    static overflowsAntimeridian(bbox) {
        return bbox[0] > 180 || bbox[2] > 180;
    }

    /**
     * @name bboxToPolygon
     * @description converts a bbox to a polygon
     * @param {Array} bbox
     * @returns {Polygon}
     */
    static bboxToPolygon(bbox) {
        return turf.polygon([
            [
                [bbox[2], bbox[3]],
                [bbox[2], bbox[1]],
                [bbox[0], bbox[1]],
                [bbox[0], bbox[3]],
                [bbox[2], bbox[3]],
            ],
        ]);
    }

    /**
     * @name: crossAntiMeridian
     * @description: checks if a bbox crosses the antimeridian
     * this is a mirror of https://github.com/mapbox/carmen/blob/03fac2d7397ecdfcb4f0828fcfd9d8a54c845f21/lib/util/bbox.js#L59
     * @param {Array} bbox A bounding box array in the format [minX, minY, maxX, maxY]
     * @returns {Array}
     *
     */
    static crossAntimeridian(feature, bbox) {
        logger.info("Checking antimeridian");

        const geomTypes = ["Point", "MultiPoint"];
        const bboxTotal = bbox || turf.bbox(feature);
        const westHemiBBox = [-180, -90, 0, 90];
        const eastHemiBBox = [0, -90, 180, 90];
        const overflowsAntimeridian = this.overflowsAntimeridian(bbox);

        if (geomTypes.includes(turf.getType(feature))) {
            /**
             * if the geometry is a triangle geometry length is 4 and
             * the points are spread among hemispheres bbox calc over each
             * hemisphere will be wrong
             * This will need its own development
             */
            logger.debug("Multipoint or point geometry");
            return bboxTotal;
        }

        if (overflowsAntimeridian) {
            logger.debug("BBOX crosses antimeridian but is in [0, 360º]");
            return bboxTotal;
        }

        if (
            turf.booleanIntersects(feature, this.bboxToPolygon(eastHemiBBox)) &&
            turf.booleanIntersects(feature, this.bboxToPolygon(westHemiBBox))
        ) {
            logger.debug("Geometry that is contained in both hemispheres");

            const clippedEastGeom = turf.bboxClip(feature, eastHemiBBox);
            const clippedWestGeom = turf.bboxClip(feature, westHemiBBox);
            const bboxEast = turf.bbox(clippedEastGeom);
            const bboxWest = turf.bbox(clippedWestGeom);

            const amBBox = [
                bboxEast[0],
                bboxTotal[1],
                bboxWest[2],
                bboxTotal[3],
            ];
            const pmBBox = [
                bboxWest[0],
                bboxTotal[1],
                bboxEast[2],
                bboxTotal[3],
            ];

            const pmBBoxWidth = bboxEast[2] + Math.abs(bboxWest[0]);
            const amBBoxWidth =
                180 - bboxEast[0] + (180 - Math.abs(bboxWest[2]));

            return pmBBoxWidth > amBBoxWidth ? amBBox : pmBBox;
        }

        return bboxTotal;
    }

    /**
     * @name: translateBBox
     * @description: This function translates a bbox that crosses the antimeridian
     * @param {Array} bbox
     * @returns {Array} bbox with the antimeridian corrected
     */
    static translateBBox(bbox) {
        logger.debug(
            "Converting bbox from [-180,180] to [0,360] for representation"
        );
        return [bbox[0], bbox[1], 360 - Math.abs(bbox[2]), bbox[3]];
    }

    /**
     * @name: swapBBox
     * @description: swap a bbox. If a bbox crosses
     * the antimeridian will be transformed its
     * latitudes from [-180, 180] to [0, 360]
     * @param {GeoStore} geoStore
     * @returns {Array}
     *
     * */
    static swapBBox(geoStore) {
        const orgBbox = turf.bbox(geoStore.geojson);
        const bbox = turf.featureReduce(
            geoStore.geojson,
            (previousValue, currentFeature) =>
                GeoStoreServiceV2.crossAntimeridian(
                    currentFeature,
                    previousValue
                ),
            orgBbox
        );

        return bbox[0] > bbox[2] ? GeoStoreServiceV2.translateBBox(bbox) : bbox;
    }

    /**
     * @name: calculateBBox
     * @description: Calculates a bbox.
     * If a bbox that crosses the antimeridian will be transformed its
     * latitudes from [-180, 180] to [0, 360]
     * @param {GeoStore} geoStore
     * @returns {geoStore}
     *
     * */
    static async calculateBBox(geoStore) {
        logger.debug("Calculating bbox");
        geoStore.bbox = GeoStoreServiceV2.swapBBox(geoStore);
        await geoStore.save();
        return geoStore;
    }

    static async saveGeostore(geojson, data) {
        const geoStore = {
            geojson,
        };

        let props = null;
        const geomType = geoStore.geojson.type || null;
        if (geomType && geomType === "FeatureCollection") {
            logger.info("Preserving FeatureCollection properties.");
            props = geoStore.geojson.features[0].properties || null;
        } else if (geomType && geomType === "Feature") {
            logger.info("Preserving Feature properties.");
            props = geoStore.geojson.properties || null;
        } else {
            logger.info("Preserving Geometry properties.");
            props = geoStore.geojson.properties || null;
        }
        logger.debug("Props", JSON.stringify(props));
        if (data && data.info) {
            geoStore.info = data.info;
        }
        geoStore.lock = data.lock || false;

        logger.debug("Fix and convert geojson");
        if (process.env.NODE_ENV !== "test" || geoStore.geojson.length < 2000) {
            logger.debug("Converting", JSON.stringify(geoStore.geojson));
        }

        if (
            geoStore.geojson.type &&
            geoStore.geojson.type === "GeometryCollection"
        ) {
            [geoStore.geojson] = geoStore.geojson.geometries;
            // maybe we should check type
            // let geometry_type = GeoStoreServiceV2.getGeometryType(geoStore.geojson);
            // logger.debug('Geometry type: %s', JSON.stringify(geometry_type));
        } else if (
            geoStore.geojson.type &&
            geoStore.geojson.type === "FeatureCollection"
        ) {
            const geoJsonObtained = await GeoStoreServiceV2.repairGeometry(
                GeoJSONConverter.getGeometry(geoStore.geojson)
            );
            geoStore.geojson = geoJsonObtained.geojson;
        }

        if (process.env.NODE_ENV !== "test" || geoStore.geojson.length < 2000) {
            logger.debug("Repaired geometry", JSON.stringify(geoStore.geojson));
        }
        logger.debug("Make Feature Collection");
        geoStore.geojson = GeoJSONConverter.makeFeatureCollection(
            geoStore.geojson,
            props
        );
        if (process.env.NODE_ENV !== "test" || geoStore.geojson.length < 2000) {
            logger.debug("Result", JSON.stringify(geoStore.geojson));
        }
        logger.debug("Creating hash from geojson md5");
        geoStore.hash = md5(JSON.stringify(geoStore.geojson));
        if (geoStore.areaHa === undefined) {
            geoStore.areaHa = turf.area(geoStore.geojson) / 10000; // convert to ha2
        }
        await GeoStore.findOne({
            hash: geoStore.hash,
        });
        if (!geoStore.bbox) {
            geoStore.bbox = GeoStoreServiceV2.swapBBox(geoStore);
        }

        await GeoStore.findOneAndUpdate({ hash: geoStore.hash }, geoStore, {
            upsert: true,
            new: true,
            runValidators: true,
        });

        return GeoStore.findOne(
            {
                hash: geoStore.hash,
            },
            {
                "geojson._id": 0,
                "geojson.features._id": 0,
            }
        );
    }

    static async calculateArea(geojson, data) {
        const geoStore = {
            geojson,
        };

        logger.debug("Converting geojson", JSON.stringify(geoStore.geojson));
        geoStore.geojson = GeoJSONConverter.makeFeatureCollection(
            geoStore.geojson
        );
        logger.debug("Result", JSON.stringify(geoStore.geojson));
        geoStore.areaHa = turf.area(geoStore.geojson) / 10000; // convert to ha2
        geoStore.bbox = await GeoStoreServiceV2.swapBBox(geoStore);

        return geoStore;
    }
}

module.exports = GeoStoreServiceV2;
