const { Pool } = require("pg");

const pool = new Pool({
    user: 'army',
    host: 'localhost',
    database: 'artecnologia',
    password: 'hola',
    port: 5432,
});

module.exports = pool;
