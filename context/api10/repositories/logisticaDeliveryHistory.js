const { bigintString } = require("../services/logisticaDeliveryListPolicy");
const { createDeliveryListRepository } = require("./logisticaDeliveryList");

function createDeliveryHistoryRepository(pool) {
  const currentRepository = createDeliveryListRepository(pool);
  async function list(input, owner) {
    const [current, legacy] = await Promise.all([
      currentRepository.list({
        limit: input.limit, pedido: input.pedido, cursor: input.currentCursor,
      }, owner),
      pool.query(
        `SELECT l.legacy_key, l.pedido, l.usuario, l.correo, l.legacy_image_count,
           to_char(l.local_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS recorded_local_at
         FROM public.entregas_logistica_legacy l
         WHERE EXISTS (
           SELECT 1 FROM public.logistica_legacy_owner_mapping m
           WHERE m.is_active = true AND m.authorized_user_id = $1::bigint
             AND m.source_snapshot_sha256 = l.source_snapshot_sha256 COLLATE "C"
             AND m.source_sheet = l.source_sheet COLLATE "C"
             AND m.legacy_usuario = l.usuario COLLATE "C"
             AND m.legacy_correo = l.correo COLLATE "C"
         )
           AND ($2::text IS NULL OR strpos(l.pedido, $2::text) > 0)
           AND (NOT $3::boolean
             OR ($4::timestamp IS NULL AND (
               (l.local_datetime IS NULL AND l.legacy_key COLLATE "C" < $5::text COLLATE "C")
               OR l.local_datetime IS NOT NULL))
             OR ($4::timestamp IS NOT NULL AND
               (l.local_datetime, l.legacy_key COLLATE "C") < ($4::timestamp, $5::text COLLATE "C")))
         ORDER BY l.local_datetime DESC, l.legacy_key COLLATE "C" DESC
         LIMIT $6::integer`,
        [bigintString(owner.authorizedUserId), input.pedido, input.legacyCursor !== null,
          input.legacyCursor?.localDatetime ?? null, input.legacyCursor?.id ?? null, input.limit + 1]
      ),
    ]);
    return { current, legacy: legacy.rows };
  }
  return { list };
}

module.exports = { createDeliveryHistoryRepository };
