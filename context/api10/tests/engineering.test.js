const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestApi } = require("./support");

const actor = "Ingenieria de prueba";
const pdf_url = "https://example.org/manual-revision-1.pdf";
const change_summary = "Primera revision";

test("Control documental con PostgreSQL aislado en memoria", async (t) => {
  const api = await createTestApi();
  t.after(() => api.close());
  const { request, pool } = api;
  let machine;
  let doc;
  let first;
  let second;
  let oldDraft;

  await t.test("crea catalogo independiente y audita responsable declarado", async () => {
    const result = await request("/machines", "POST", { name: "SHOP PRO", description: "Equipo CNC", actor });
    assert.equal(result.status, 201);
    machine = result.data;
    const history = await request(`/machines/${machine.id}/events`);
    assert.equal(history.data[0].action, "MAQUINA_CREADA");
    assert.equal(history.data[0].actor, actor);
    assert.equal(history.data[0].after_data.name, "SHOP PRO");
    assert.equal((await request("/machines")).data.length, 1);
  });

  await t.test("valida IDs, JSON, nombre, responsable y duplicados", async () => {
    assert.equal((await request("/machines", "POST", { name: " " })).status, 400);
    assert.equal((await request("/machines", "POST", { name: "Otra" })).status, 400);
    assert.equal((await request("/machines", "POST", [])).status, 400);
    assert.equal((await request("/machines", "POST", { name: " shop pro ", actor })).status, 409);
    assert.equal((await request("/documents/1.5")).status, 400);
    assert.equal((await request("/documents/9007199254740992")).status, 400);
    assert.equal((await request("/documents/999")).status, 404);
    assert.equal((await request("/versions/999/publish", "POST", { actor })).status, 404);
  });

  await t.test("crea un solo manual por maquina y codigo unico", async () => {
    const result = await request("/documents", "POST", { maquina_id: machine.id, code: "MIE-SHOP", title: "Instalacion exitosa", actor });
    assert.equal(result.status, 201);
    doc = result.data;
    assert.equal((await request("/documents", "POST", { maquina_id: machine.id, code: "MIE-OTRO", title: "Otro", actor })).status, 409);
    assert.equal((await request("/documents", "POST", { maquina_id: 999, code: "X", title: "Otro", actor })).status, 404);
    const other = (await request("/machines", "POST", { name: "WORKS", actor })).data;
    assert.equal((await request("/documents", "POST", { maquina_id: other.id, code: "mie-shop", title: "Otro", actor })).status, 409);
  });

  await t.test("rechaza enlaces inseguros y datos incompletos, admite links sin extension", async () => {
    for (const url of ["javascript:alert(1)", "file:///manual.pdf", "https://user:password@example.org/a.pdf", "no-es-url", ""]) {
      assert.equal((await request(`/documents/${doc.id}/versions`, "POST", { pdf_url: url, change_summary, actor })).status, 400);
    }
    assert.equal((await request(`/documents/${doc.id}/versions`, "POST", { pdf_url, change_summary: " ", actor })).status, 400);
    const result = await request(`/documents/${doc.id}/versions`, "POST", {
      pdf_url: "https://drive.google.com/file/d/archivo/view", change_summary, actor,
    });
    assert.equal(result.status, 201);
    first = result.data;
    assert.equal(first.status, "BORRADOR");
    assert.equal(first.revision, 1);
  });

  await t.test("edita borradores con control de concurrencia", async () => {
    const stale = first.updated_at;
    const result = await request(`/versions/${first.id}`, "PUT", {
      pdf_url, change_summary: "Enlace corregido", actor, updated_at: stale,
    });
    assert.equal(result.status, 200);
    first = result.data;
    assert.equal(first.pdf_url, pdf_url);
    assert.equal((await request(`/versions/${first.id}`, "PUT", { pdf_url, change_summary, actor, updated_at: stale })).status, 409);
    assert.equal((await request(`/versions/${first.id}/publish`, "POST", { actor, updated_at: stale })).status, 409);
  });

  await t.test("publica, conserva PDF y bloquea edicion de una revision publicada", async () => {
    const result = await request(`/versions/${first.id}/publish`, "POST", { actor, updated_at: first.updated_at });
    assert.equal(result.status, 200);
    first = result.data;
    assert.equal(first.status, "VIGENTE");
    assert.equal(first.published_by, actor);
    assert.ok(first.published_at);
    assert.equal((await request(`/versions/${first.id}`, "PUT", { actor, pdf_url, change_summary, updated_at: first.updated_at })).status, 409);
    assert.equal((await request(`/versions/${first.id}/publish`, "POST", { actor, updated_at: first.updated_at })).status, 409);
    assert.equal((await request(`/machines/${machine.id}`, "PUT", { ...machine, actor, is_active: false })).status, 409);
  });

  await t.test("numera multiples borradores y sustituye la vigente atomicamente", async () => {
    const results = await Promise.all([
      request(`/documents/${doc.id}/versions`, "POST", { actor, pdf_url, change_summary }),
      request(`/documents/${doc.id}/versions`, "POST", { actor, pdf_url: "https://example.org/revision-3.pdf", change_summary: "Mejora" }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [201, 201]);
    [oldDraft, second] = results.map((r) => r.data).sort((a, b) => a.revision - b.revision);
    assert.deepEqual([oldDraft.revision, second.revision], [2, 3]);
    const published = await request(`/versions/${second.id}/publish`, "POST", { actor, updated_at: second.updated_at });
    assert.equal(published.status, 200);
    second = published.data;
    const detail = (await request(`/documents/${doc.id}`)).data;
    first = detail.versions.find((v) => v.id === first.id);
    assert.equal(first.status, "OBSOLETO");
    assert.equal(first.pdf_url, pdf_url);
    assert.equal(detail.versions.filter((v) => v.status === "VIGENTE").length, 1);
    assert.ok(detail.events.some((e) => e.action === "VERSION_OBSOLETA" && e.version_id === first.id));
    assert.ok(detail.events.some((e) => e.action === "VERSION_PUBLICADA" && e.version_id === second.id));
    const list = (await request("/documents")).data;
    assert.equal(list[0].versions.length, 3);
  });

  await t.test("restricciones SQL impiden doble vigente y bajas sin motivo", async () => {
    await assert.rejects(pool.query(
      "UPDATE engineering_document_version SET status='VIGENTE', published_by=$1, published_at=now() WHERE id=$2",
      [actor, oldDraft.id]
    ), (error) => error.code === "23505");
    await assert.rejects(pool.query(
      "UPDATE engineering_document_version SET status='RETIRADO', retired_by=$1, retired_at=now() WHERE id=$2",
      [actor, oldDraft.id]
    ), (error) => error.code === "23514");
  });

  await t.test("rollback conserva vigente y eventos si falla la bitacora", async () => {
    const draft = (await request(`/documents/${doc.id}/versions`, "POST", { actor, pdf_url, change_summary })).data;
    const before = (await request(`/documents/${doc.id}`)).data;
    await pool.query(`CREATE FUNCTION reject_publish_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='VERSION_PUBLICADA' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER fail_event BEFORE INSERT ON engineering_document_event FOR EACH ROW EXECUTE FUNCTION reject_publish_event()");
    const loggedError = t.mock.method(console, "error", () => {});
    try {
      assert.equal((await request(`/versions/${draft.id}/publish`, "POST", { actor, updated_at: draft.updated_at })).status, 500);
      assert.equal(loggedError.mock.calls.length, 1);
    } finally {
      loggedError.mock.restore();
    }
    await pool.query("DROP TRIGGER fail_event ON engineering_document_event");
    await pool.query("DROP FUNCTION reject_publish_event()");
    const after = (await request(`/documents/${doc.id}`)).data;
    assert.deepEqual(after.versions, before.versions);
    assert.deepEqual(after.events, before.events);
  });

  await t.test("baja requiere motivo y no reactiva obsoletos ni borradores antiguos", async () => {
    assert.equal((await request(`/versions/${second.id}/retire`, "POST", { actor, reason: " ", updated_at: second.updated_at })).status, 400);
    const result = await request(`/versions/${second.id}/retire`, "POST", { actor, reason: "Correccion requerida", updated_at: second.updated_at });
    assert.equal(result.status, 200);
    second = result.data;
    assert.equal(second.status, "RETIRADO");
    assert.equal(second.retirement_reason, "Correccion requerida");
    const detail = (await request(`/documents/${doc.id}`)).data;
    assert.equal(detail.versions.filter((v) => v.status === "VIGENTE").length, 0);
    assert.equal((await request(`/versions/${oldDraft.id}/publish`, "POST", { actor, updated_at: oldDraft.updated_at })).status, 409);
    assert.equal((await request(`/versions/${second.id}/retire`, "POST", { actor, reason: "Otra", updated_at: second.updated_at })).status, 409);
    assert.ok(detail.events.some((e) => e.reason === "Correccion requerida"));
  });

  await t.test("edita ficha, desactiva catalogo, preserva historial y no elimina registros", async () => {
    const detail = (await request(`/documents/${doc.id}`)).data;
    const updated = await request(`/documents/${doc.id}`, "PUT", { title: "Manual revisado", code: doc.code, actor, updated_at: detail.updated_at });
    assert.equal(updated.status, 200);
    assert.equal((await request(`/documents/${doc.id}`, "PUT", { title: "Cambio perdido", code: doc.code, actor, updated_at: detail.updated_at })).status, 409);
    const inactive = await request(`/machines/${machine.id}`, "PUT", { ...machine, actor, is_active: false });
    assert.equal(inactive.status, 200);
    assert.equal((await request(`/documents/${doc.id}/versions`, "POST", { actor, pdf_url, change_summary })).status, 409);
    assert.equal((await request(`/documents/${doc.id}`)).data.machine_active, false);
    await assert.rejects(pool.query("DELETE FROM maquinas_normalizado WHERE id=$1", [machine.id]), (error) => ["23503", "23001"].includes(error.code));
    await assert.rejects(pool.query("DELETE FROM engineering_document WHERE id=$1", [doc.id]), (error) => ["23503", "23001"].includes(error.code));
  });
});
