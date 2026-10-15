const { PGlite } = require("@electric-sql/pglite");
const express = require("express");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createEngineeringRouter } = require("../routes/engineering");

async function createTestApi() {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(__dirname, "..", "..", "database", "engineering_documents.sql"), "utf8"));
  // PGlite has one connection; serialize complete transactions, not individual statements.
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }
  const pool = {
    async query(sql, params) {
      const release = await acquire();
      try { return await db.query(sql, params); } finally { release(); }
    },
    async connect() {
      const release = await acquire();
      return { query: (sql, params) => db.query(sql, params), release };
    },
  };
  const app = express();
  app.use(require("cors")());
  app.use(express.json());
  app.use("/api10/engineering", createEngineeringRouter(pool));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api10/engineering`;
  async function request(route, method = "GET", body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  return {
    db, pool, baseUrl, request,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await db.close();
    },
  };
}

module.exports = { createTestApi };
