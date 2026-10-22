const { Pool } = require("pg");

const requiredEnv = [
    "APP_ENV",
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
];

for (const name of requiredEnv) {
    if (!process.env[name]) {
        throw new Error(`Falta la variable de entorno ${name}`);
    }
}

const allowedDatabases = {
    local: "artecnologia_test_local",
    test: "artecnologia_test",
    production: "calidad",
};

const appEnv = process.env.APP_ENV;

if (!allowedDatabases[appEnv]) {
    throw new Error(
        `APP_ENV no válido: ${appEnv}. Valores permitidos: local, test, production`
    );
}

const expectedDatabase = allowedDatabases[appEnv];

if (process.env.PGDATABASE !== expectedDatabase) {
    throw new Error(
        `Base de datos no permitida para APP_ENV=${appEnv}. ` +
        `Esperada: ${expectedDatabase}. Recibida: ${process.env.PGDATABASE}`
    );
}

if (
    appEnv === "local" &&
    !["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST)
) {
    throw new Error(
        `APP_ENV=local solo permite PostgreSQL local. Host recibido: ${process.env.PGHOST}`
    );
}

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT),
});

module.exports = pool;
