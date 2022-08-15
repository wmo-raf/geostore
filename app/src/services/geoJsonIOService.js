const logger = require("logger");
const GeometryTooLarge = require("errors/geometryTooLarge");

const MAX_URL_LEN = 150e3;

class GeoJsonIOService {
    static async view(geojson) {
        // if this is a multipolygon, grab the first feature in the collection
        // and ditch the rest-- only need type and coordinates properties
        if (geojson.features[0].geometry.type === "MultiPolygon") {
            logger.debug("found multipolygon");
            // eslint-disable-next-line no-param-reassign
            geojson = {
                type: "MultiPolygon",
                coordinates: geojson.features[0].geometry.coordinates,
            };
        } else {
            for (let i = 0; i < geojson.features.length; i++) {
                // doesn't register when set to {} for some reason
                geojson.features[i].properties = null;
            }
        }

        if (JSON.stringify(geojson).length <= MAX_URL_LEN) {
            return `http://geojson.io/#data=data:application/json,${encodeURIComponent(
                JSON.stringify(geojson)
            )}`;
        }

        throw new GeometryTooLarge(
            "Geometry too large, please try again with a smaller geometry."
        );
    }
}

module.exports = GeoJsonIOService;
