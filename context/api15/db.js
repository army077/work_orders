// db.js
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  user: "army",
  password: "hola",
  database: "boms",
  port: 5432,
});

module.exports = pool;
