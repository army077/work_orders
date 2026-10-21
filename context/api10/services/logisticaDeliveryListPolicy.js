class DeliveryListHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function bigintString(value) {
  if (typeof value !== "string" && typeof value !== "bigint"
    && !(typeof value === "number" && Number.isSafeInteger(value))) {
    throw new Error("INVALID_LIST_ID");
  }
  const id = String(value);
  if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
    throw new Error("INVALID_LIST_ID");
  }
  return id;
}

function utcTimestamp(value) {
  const text = value instanceof Date ? value.toISOString() : value;
  if (typeof text !== "string") throw new Error("INVALID_LIST_TIMESTAMP");
  const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,6}))?Z$/.exec(text);
  if (!match || text.startsWith("0000")) throw new Error("INVALID_LIST_TIMESTAMP");
  const fraction = (match[2] || "").padEnd(6, "0");
  const millis = match[1] + "." + fraction.slice(0, 3) + "Z";
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== millis) {
    throw new Error("INVALID_LIST_TIMESTAMP");
  }
  return match[1] + "." + fraction + "Z";
}

function encodeDeliveryListCursor(row) {
  return Buffer.from(JSON.stringify({
    created_at: utcTimestamp(row.created_at),
    id: bigintString(row.id),
  })).toString("base64url");
}

function decodeDeliveryListCursor(value) {
  try {
    if (typeof value !== "string" || value.length === 0 || value.length > 512
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_CURSOR");
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error("INVALID_CURSOR");
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).length !== 2
      || !Object.hasOwn(parsed, "created_at") || !Object.hasOwn(parsed, "id")
      || typeof parsed.id !== "string") throw new Error("INVALID_CURSOR");
    return { createdAt: utcTimestamp(parsed.created_at), id: bigintString(parsed.id) };
  } catch (_) {
    throw new DeliveryListHttpError(400, "Cursor inválido");
  }
}

function normalizeDeliveryListQuery(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)
    || Object.keys(query).some(key => !["limit", "cursor", "pedido"].includes(key))) {
    throw new DeliveryListHttpError(400, "Solo se admiten limit, cursor y pedido");
  }
  let limit = 25;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^(?:[1-9][0-9]?|100)$/.test(query.limit)) {
      throw new DeliveryListHttpError(400, "limit debe ser un entero entre 1 y 100");
    }
    limit = Number(query.limit);
  }
  if (query.pedido !== undefined && (typeof query.pedido !== "string"
    || query.pedido.length > 200 || query.pedido.includes("\u0000"))) {
    throw new DeliveryListHttpError(400, "pedido debe ser texto de hasta 200 caracteres");
  }
  return {
    limit,
    pedido: query.pedido || null,
    cursor: query.cursor === undefined ? null : decodeDeliveryListCursor(query.cursor),
  };
}

function publicDeliveryListItem(row) {
  const count = typeof row.photo_count === "string" && /^[0-9]+$/.test(row.photo_count)
    ? Number(row.photo_count) : row.photo_count;
  if (row.status !== "COMPLETED" || typeof row.pedido !== "string"
    || !Number.isSafeInteger(count) || count < 0
    || (row.auth_display_name != null && typeof row.auth_display_name !== "string")
    || (row.auth_email != null && typeof row.auth_email !== "string")) {
    throw new Error("INVALID_LIST_ROW");
  }
  return {
    id: bigintString(row.id),
    pedido: row.pedido,
    auth_display_name: row.auth_display_name ?? null,
    auth_email: row.auth_email ?? null,
    created_at: utcTimestamp(row.created_at),
    status: row.status,
    photo_count: count,
  };
}

function deliveryListPage(rows, limit) {
  const items = rows.slice(0, limit).map(publicDeliveryListItem);
  return {
    ok: true,
    items,
    next_cursor: rows.length > limit ? encodeDeliveryListCursor(items.at(-1)) : null,
  };
}

module.exports = {
  DeliveryListHttpError, bigintString, encodeDeliveryListCursor,
  decodeDeliveryListCursor, normalizeDeliveryListQuery, deliveryListPage,
};
