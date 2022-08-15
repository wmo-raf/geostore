const axios = require("axios");
const logger = require("logger");
const GeoStoreService = require("services/geoStoreService");
const PgFeatureNotFound = require("errors/pgFeatureNotFound");
const config = require("config");

const parseSimplifyGeom = (iso, id1, id2) => {
    const bigCountries = ["USA", "RUS", "CAN", "CHN", "BRA", "IDN"];
    const baseThresh = bigCountries.includes(iso) ? 0.1 : 0.005;
    if (iso && !id1 && !id2) {
        return baseThresh;
    }
    return id1 && !id2 ? baseThresh / 10 : baseThresh / 100;
};

class PgFeatureService {
    constructor(options) {
        if (options) {
            if (options.pgFeatureServUrl) {
                this.pgFeatureServUrl = options.pgFeatureServUrl;
            }

            if (options.boundariesTable) {
                this.boundariesTable = options.boundariesTable;
            }

            if (this.pgFeatureServUrl && this.boundariesTable) {
                this.boundariesUrl = `${this.pgFeatureServUrl}/collections/${this.boundariesTable}/items.json`;
            }
        }
    }

    async getFeature(tableName, featureId, thresh) {
        let url = `${this.pgFeatureServUrl}/collections/${tableName}/items/${featureId}.json`;

        logger.debug("Doing request to ", url);

        const params = {};

        if (thresh) {
            params.transform = `simplify,${thresh}`;
        }

        return axios
            .get(url, { params })
            .then((response) => response.data)
            .catch((err) => {
                if (err.response.status === 404) {
                    const message = err.response.data || "Feature Not Found";

                    throw new PgFeatureNotFound(message);
                }
            });
    }

    async getNational(iso, thresh) {
        logger.info(
            `[PGFeatureService - getNational] Requesting ISO ${iso} from pgFeatureServ`
        );

        const params = {
            level: 0,
            gid_0: iso.toUpperCase(),
        };

        if (!thresh) {
            // eslint-disable-next-line no-param-reassign
            thresh = parseSimplifyGeom(iso);
        }

        params.transform = `simplify,${thresh}`;

        logger.debug(
            "[PGFeatureService - getNational] Checking for existing national geo"
        );
        const query = {
            "info.iso": iso.toUpperCase(),
            "info.simplifyThresh": thresh,
            "info.id1": null,
            "info.id2": null,
        };

        let existingGeo = await GeoStoreService.getGeostoreByInfoProps(query);

        if (existingGeo) {
            logger.debug(
                "[PGFeatureService - getNational] Found geometry with id:",
                existingGeo._id
            );
            logger.debug(
                "[PGFeatureService - getNational] Return national geojson stored"
            );
            return existingGeo;
        }

        logger.debug(
            "[PGFeatureService - getNational] No matching geometry found."
        );

        logger.debug("Request admin1 shape from PgFeatureserv");

        return axios
            .get(this.boundariesUrl, { params })
            .then((response) => {
                const data = response.data;

                if (!!data.features.length) {
                    const result = data.features[0];

                    const geoData = {
                        info: {
                            iso: iso.toUpperCase(),
                            name: result.properties.name_0,
                            gadm: "3.6",
                            simplifyThresh: thresh,
                        },
                    };

                    const geojson = {
                        ...result,
                        properties: null,
                    };

                    return GeoStoreService.saveGeostore(geojson, geoData);
                }

                return null;
            })
            .catch((err) => {
                if (err.response && err.response.status === 404) {
                    const message = err.response.data || "Feature Not Found";

                    throw new PgFeatureNotFound(message);
                }

                throw err;
            });
    }

    async getSubnational(iso, id1, thresh) {
        logger.debug("Obtaining subnational of iso %s and id1", iso, id1);
        const params = {
            level: 1,
            gid_1: `${iso.toUpperCase()}.${parseInt(id1, 10)}_1`,
        };

        if (!thresh) {
            // eslint-disable-next-line no-param-reassign
            thresh = parseSimplifyGeom(iso, id1);
        }

        params.transform = `simplify,${thresh}`;

        const query = {
            "info.iso": iso.toUpperCase(),
            "info.id1": id1,
            "info.id2": null,
            "info.simplifyThresh": thresh,
        };

        logger.debug("Checking existing subnational geo");
        let existingGeo = await GeoStoreService.getGeostoreByInfoProps(query);
        logger.debug("Existed geo", existingGeo);
        if (existingGeo) {
            logger.debug("Return subnational geojson stored");
            return existingGeo;
        }

        return axios
            .get(this.boundariesUrl, { params })
            .then((response) => {
                logger.debug("Return subnational geojson from pgfeatureserv");
                const data = response.data;

                if (!!data.features.length) {
                    const result = data.features[0];

                    const geoData = {
                        info: {
                            iso: iso.toUpperCase(),
                            name: result.properties.name_1,
                            id1: parseInt(id1, 10),
                            gadm: "3.6",
                            simplifyThresh: thresh,
                        },
                    };

                    const geojson = {
                        ...result,
                        properties: null,
                    };

                    logger.debug("Saving subnational geostore");
                    return GeoStoreService.saveGeostore(geojson, geoData);
                }

                return null;
            })
            .catch((err) => {
                if (err.response && err.response.status === 404) {
                    const message = err.response.data || "Feature Not Found";

                    throw new PgFeatureNotFound(message);
                }

                throw err;
            });

        return null;
    }

    async getAdmin2(iso, id1, id2, thresh) {
        logger.debug("Obtaining admin2 of iso %s, id1 and id2", iso, id1, id2);

        const params = {
            gid_2: `${iso.toUpperCase()}.${parseInt(id1, 10)}.${parseInt(
                id2,
                10
            )}_1`,
            level: 2,
        };

        if (!thresh) {
            // eslint-disable-next-line no-param-reassign
            thresh = parseSimplifyGeom(iso, id1, id2);
        }

        params.transform = `simplify,${thresh}`;

        const query = {
            "info.iso": iso.toUpperCase(),
            "info.id1": id1,
            "info.id2": id2,
            "info.simplifyThresh": thresh,
        };

        logger.debug("Checking existing admin2 geo");
        let existingGeo = await GeoStoreService.getGeostoreByInfoProps(query);
        logger.debug("Existed geo", existingGeo);
        if (existingGeo) {
            logger.debug("Return admin2 geojson stored");
            return existingGeo;
        }

        logger.debug("Request admin2 shape from PgFeatureserv");
        return axios
            .get(this.boundariesUrl, { params })
            .then((response) => {
                logger.debug("Return admin2 geojson from pgfeatureserv");
                const data = response.data;

                if (!!data.features.length) {
                    const result = data.features[0];

                    const geoData = {
                        info: {
                            iso: iso.toUpperCase(),
                            name: result.properties.name_2,
                            id1: parseInt(id1, 10),
                            id2: parseInt(id2, 10),
                            gadm: "3.6",
                            simplifyThresh: thresh,
                        },
                    };

                    const geojson = {
                        ...result,
                        properties: null,
                    };

                    logger.debug("Saving admin2 geostore");
                    return GeoStoreService.saveGeostore(geojson, geoData);
                }

                return null;
            })
            .catch((err) => {
                if (err.response && err.response.status === 404) {
                    const message = err.response.data || "Feature Not Found";

                    throw new PgFeatureNotFound(message);
                }

                throw err;
            });
    }

    async getUse(tableName, featureId, thresh) {
        logger.debug("Obtaining use with id %s", featureId);

        const params = {
            use: tableName,
            id: parseInt(featureId, 10),
        };

        const info = {
            use: params,
            simplify: !!thresh,
            simplifyThresh: !!thresh && thresh,
        };

        const query = {
            "info.use.use": params.use,
            "info.use.id": params.id,
            "info.simplify": info.simplify,
            "info.simplifyThresh": info.simplifyThresh,
        };

        logger.debug("Checking existing use geo", query);

        let existingGeo = await GeoStoreService.getGeostoreByInfoProps(query);

        logger.debug("Existed geo");

        if (existingGeo) {
            logger.debug("Return use geojson stored");
            return existingGeo;
        }

        logger.debug("Request use to pg_feature");

        let data;

        data = await this.getFeature(params.use, params.id, thresh);

        if (data) {
            logger.debug("Saving use geostore");

            const geoData = {
                info,
            };

            existingGeo = await GeoStoreService.saveGeostore(data, geoData);

            logger.debug("Return use geojson from pg featureserv");

            return existingGeo;
        }

        return null;
    }
}

const pgFeatureServ = new PgFeatureService({
    pgFeatureServUrl: config.get("pgFeatureServ.url"),
    boundariesTable: config.get("pgFeatureServ.boundariesTable"),
});

module.exports = pgFeatureServ;
