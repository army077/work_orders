// Lee estado y limites reales; no llama nextval/setval ni prueba INSERT.
export async function sequenceSafety(client, tables) {
  const consumers = (await client.query(`WITH selected AS (
    SELECT to_regclass(t) oid FROM unnest($1::text[]) t
  ), uses AS (
    SELECT d.objid seq, d.refobjid tbl, d.refobjsubid col FROM pg_depend d
      JOIN pg_class s ON s.oid=d.objid AND s.relkind='S'
      WHERE d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass
        AND d.deptype IN ('a','i') AND d.refobjid IN (SELECT oid FROM selected)
    UNION
    SELECT d.refobjid, a.adrelid, a.adnum FROM pg_attrdef a JOIN pg_depend d
      ON d.classid='pg_attrdef'::regclass AND d.objid=a.oid
      JOIN pg_class s ON s.oid=d.refobjid AND s.relkind='S'
      WHERE d.refclassid='pg_class'::regclass AND a.adrelid IN (SELECT oid FROM selected)
  ) SELECT u.seq::regclass::text sequence,u.tbl::regclass::text table_name,a.attname column_name,
    q.seqincrement::text increment,q.seqmin::text min,q.seqmax::text max,q.seqcache::text cache,q.seqcycle cycle,
    a.atttypid IN ('int2'::regtype,'int4'::regtype,'int8'::regtype,'numeric'::regtype) numeric_column
    FROM uses u JOIN pg_attribute a ON a.attrelid=u.tbl AND a.attnum=u.col
    JOIN pg_sequence q ON q.seqrelid=u.seq ORDER BY 1,2,3`, [tables])).rows;
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  const qualify = name => name.split('.').map(quote).join('.');
  const output = [];
  for (const row of consumers) {
    const state = (await client.query('SELECT last_value::text,is_called FROM ' + qualify(row.sequence))).rows[0];
    const bounds = (await client.query('SELECT min(' + quote(row.column_name) + ')::text min,max('
      + quote(row.column_name) + ')::text max FROM ' + qualify(row.table_name))).rows[0];
    const next = BigInt(state.last_value) + (state.is_called ? BigInt(row.increment) : 0n);
    const safe = row.numeric_column && !row.cycle && row.cache === '1'
      && next >= BigInt(row.min) && next <= BigInt(row.max)
      && (BigInt(row.increment) > 0n ? bounds.max === null || next > BigInt(bounds.max)
        : bounds.min === null || next < BigInt(bounds.min));
    output.push({ ...row, ...state, bounds, next_candidate: String(next), safe,
      reason: safe ? null : 'REVIEW_SEQUENCE_NO_REPAIR_PERFORMED' });
  }
  return { safe: output.every(r => r.safe), checked_consumers: output.length, sequences: output };
}
