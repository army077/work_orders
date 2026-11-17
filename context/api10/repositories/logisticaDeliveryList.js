const { bigintString } = require("../services/logisticaDeliveryListPolicy");

function createDeliveryListRepository(pool) {
  async function list(input, owner) {
    // Page the parent records first; the correlated aggregate cannot multiply rows.
    // Format UTC in PostgreSQL so cursors retain all six fractional digits.
    const { rows } = await pool.query(
      `WITH page AS (
         SELECT d.id, d.pedido, d.auth_display_name, d.auth_email, d.created_at, d.status
         FROM public.logistica_deliveries d
         WHERE d.authorized_user_id = $1::bigint
           AND d.status = 'COMPLETED'
           AND ($2::text IS NULL OR strpos(d.pedido, $2::text) > 0)
           AND ($3::timestamptz IS NULL
             OR (d.created_at, d.id) < ($3::timestamptz, $4::bigint))
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT $5::integer
       )
       SELECT p.id::text AS id, p.pedido, p.auth_display_name, p.auth_email,
         to_char(p.created_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
         p.status,
         (SELECT count(*) FROM public.logistica_delivery_evidence e
          WHERE e.delivery_id = p.id
            AND e.evidence_type = 'PHOTO' AND e.status = 'UPLOADED') AS photo_count
       FROM page p
       ORDER BY p.created_at DESC, p.id DESC`,
      [bigintString(owner.authorizedUserId), input.pedido,
        input.cursor?.createdAt ?? null, input.cursor?.id ?? null, input.limit + 1]
    );
    return rows;
  }
  return { list };
}

module.exports = { createDeliveryListRepository };
