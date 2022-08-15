class PgFeatureNotFound extends Error {

    constructor(message) {
        super(message);
        this.name = 'PgFeatureNotFound';
        this.message = message;
        this.status = 404;
    }

}

module.exports = PgFeatureNotFound;
