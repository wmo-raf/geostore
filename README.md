# Geostore API

This repository is the microservice that implements the Geostore
functionality, which is exposed on the /geostore endpoint.

The Geostore is a simple GeoJSON storage service that receives GeoJSON
and returns an ID that can be used later to retrieve the given object.
It is used primarily by the HW map to handle large GeoJSON objects that
could not normally be stored in the URL.

## Dependencies

The Geostore microservice is built using [Node.js](https://nodejs.org/en/), and can be executed either natively or using Docker, each of which has its own set of requirements.

Native execution requires:
- [Node.js](https://nodejs.org/en/)
- [MongoDB](https://www.mongodb.com/)

Execution using Docker requires:
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

## Getting started

Start by cloning the repository from github to your execution environment

```
git clone https://github.com/wmo-raf/geostore.git && cd geostore
```

After that, follow one of the instructions below:

### Using native execution

1 - Set up your environment variables. See `env.sample` for a list of variables you should set, which are described in detail in [this section](#configuration-environment-variables) of the documentation. Native execution will NOT load the `dev.env` file content, so you need to use another way to define those values

2 - Install node dependencies using yarn:
```
yarn
```

3 - Start the application server:
```
yarn start
```

### Using Docker

1 - Create and complete your `.env` file with your configuration. The meaning of the variables is available in this [section](#configuration-environment-variables). You can find an example `.env.sample` file in the project root.

```
docker compose build geostore

docker compose up
```


### Using native execution

Follow the instruction above for setting up the runtime environment for native execution, then run:
```
yarn start
```

## Configuration

### Environment variables

- PORT => TCP port in which the service will run
- MONGO_DB_USER => Geostore db username
- MONGODB_DBNAME => Geostore db name
- MONGO_DB_PASSWORD => Geostore db password

- RESTART_POLICY => Docker container restart policy. Can be `always` to restart the container automatically or `no` to disable restarts
- PG_FEATURE_SERV_URL => Url to pgFeatureServ service
- PG_FEATURE_SERV_BOUNDARIES_TABLE => table name for the boundaries table in pgFeatureServ

You can optionally set other variables, see [this file](config/custom-environment-variables.json) for an extended list.
