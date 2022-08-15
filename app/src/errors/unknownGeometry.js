class UnknownGeometry extends Error {

    constructor(message) {
        super(message);
        this.name = 'UnknownGeometry';
        this.message = message;
    }

}

module.exports = UnknownGeometry;
