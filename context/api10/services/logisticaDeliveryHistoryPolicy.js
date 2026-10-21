const {
  bigintString, deliveryListPage, decodeDeliveryListCursor,
} = require("./logisticaDeliveryListPolicy");

class DeliveryHistoryHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function legacyKey(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("INVALID_LEGACY_KEY");
  }
  return value;
}

// Calendar validation only. Never pass a historical wall clock through Date,
// a host timezone or AT TIME ZONE. NULL remains an unknown historical date.
function localTimestamp(value) {
  if (value === null) return null;
  const m = typeof value === "string"
    && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!m) throw new Error("INVALID_LEGACY_TIMESTAMP");
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) throw new Error("INVALID_LEGACY_TIMESTAMP");
  const fraction = (m[7] || "").replace(/0+$/, "");
  return value.slice(0, 19) + (fraction ? "." + fraction : "");
}

function encodeHistoryCursor(source, item, pedido) {
  const key = source === "CURRENT"
    ? { created_at: item.created_at, id: bigintString(item.id) }
    : { local_datetime: localTimestamp(item.recorded_local_at), id: legacyKey(item.id) };
  return Buffer.from(JSON.stringify({ v: 1, source, pedido, key })).toString("base64url");
}

function decodeHistoryCursor(value, source, pedido) {
  try {
    if (typeof value !== "string" || !value.length || value.length > 2048
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_CURSOR");
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error("INVALID_CURSOR");
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || Array.isArray(parsed) || Object.keys(parsed).length !== 4
      || parsed.v !== 1 || parsed.source !== source || parsed.pedido !== pedido
      || !parsed.key || Array.isArray(parsed.key) || Object.keys(parsed.key).length !== 2
      || typeof parsed.key.id !== "string") throw new Error("INVALID_CURSOR");
    if (source === "CURRENT") {
      // Reuse the existing UTC/microsecond and BIGINT checks without changing them.
      return decodeDeliveryListCursor(Buffer.from(JSON.stringify(parsed.key)).toString("base64url"));
    }
    return { localDatetime: localTimestamp(parsed.key.local_datetime), id: legacyKey(parsed.key.id) };
  } catch (_) {
    throw new DeliveryHistoryHttpError(400, "Cursor de historial inválido");
  }
}

function normalizeDeliveryHistoryQuery(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)
    || Object.keys(query).some(key => !["limit", "pedido", "current_cursor", "legacy_cursor"].includes(key))) {
    throw new DeliveryHistoryHttpError(400, "Solo se admiten limit, pedido, current_cursor y legacy_cursor");
  }
  let limit = 25;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^(?:[1-9][0-9]?|100)$/.test(query.limit)) {
      throw new DeliveryHistoryHttpError(400, "limit debe ser un entero entre 1 y 100");
    }
    limit = Number(query.limit);
  }
  if (query.pedido !== undefined && (typeof query.pedido !== "string"
    || query.pedido.length > 200 || query.pedido.includes("\u0000"))) {
    throw new DeliveryHistoryHttpError(400, "pedido debe ser texto de hasta 200 caracteres");
  }
  const pedido = query.pedido || null;
  return {
    limit, pedido,
    currentCursor: query.current_cursor === undefined ? null
      : decodeHistoryCursor(query.current_cursor, "CURRENT", pedido),
    legacyCursor: query.legacy_cursor === undefined ? null
      : decodeHistoryCursor(query.legacy_cursor, "LEGACY", pedido),
  };
}

function currentItem(row) {
  const item = deliveryListPage([row], 1).items[0];
  return {
    source: "CURRENT", id: item.id, pedido: item.pedido,
    display_name: item.auth_display_name, email: item.auth_email,
    status: item.status, legacy_record_state: null, created_at: item.created_at,
    recorded_local_at: null, time_zone: "UTC", photo_count: item.photo_count,
    legacy_image_count: null,
  };
}

function legacyItem(row) {
  if ((row.pedido !== null && typeof row.pedido !== "string")
    || (row.usuario !== null && typeof row.usuario !== "string")
    || (row.correo !== null && typeof row.correo !== "string")
    || (row.legacy_image_count !== null && (!Number.isInteger(row.legacy_image_count)
      || row.legacy_image_count < -2147483648 || row.legacy_image_count > 2147483647))) {
    throw new Error("INVALID_HISTORY_ROW");
  }
  return {
    source: "LEGACY", id: legacyKey(row.legacy_key), pedido: row.pedido,
    display_name: row.usuario, email: row.correo, status: null,
    legacy_record_state: "RECORDED", created_at: null,
    recorded_local_at: localTimestamp(row.recorded_local_at), time_zone: null,
    photo_count: null, legacy_image_count: row.legacy_image_count,
  };
}

function deliveryHistoryPage(rows, input) {
  function section(source, records, project) {
    const items = records.slice(0, input.limit).map(project);
    return {
      items,
      next_cursor: records.length > input.limit
        ? encodeHistoryCursor(source, items.at(-1), input.pedido) : null,
    };
  }
  return {
    ok: true,
    current: section("CURRENT", rows.current, currentItem),
    legacy: section("LEGACY", rows.legacy, legacyItem),
  };
}

module.exports = {
  DeliveryHistoryHttpError, normalizeDeliveryHistoryQuery, deliveryHistoryPage,
};
