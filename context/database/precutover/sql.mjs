// Only fixed transaction controls and SELECT statements are constructed here.
// Expressions from defaults/indexes/triggers are hashed as text, never executed.
import { TABLES, MASTERS, RECREATED_METADATA, RELATIONSHIPS } from './scope.mjs';

export const INTEGER_TYPES = new Set(['int2', 'int4', 'int8']);
export const TYPES = new Set(['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'bool', 'text', 'varchar', 'bpchar',
    'uuid', 'bytea', 'date', 'timestamp', 'timestamptz', 'time', 'timetz', 'interval', 'json', 'jsonb']);
export const ident = value => {
    if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('UNSUPPORTED_IDENTIFIER');
    return '"' + value + '"';
};
export const tableSql = name => {
    if (!TABLES.includes(name)) throw new Error('TABLE_OUTSIDE_SCOPE');
    return '"public".' + ident(name);
};
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const digest = expr => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${expr}, 'UTF8')), 'hex')`;

export const IDENTITY_SQL = `SELECT current_database() AS database, current_user = session_user AS same_role,
 current_user = $1 AS expected_role, current_setting('server_version_num')::integer AS version_num,
 current_setting('transaction_read_only') = 'on' AS read_only,
 current_setting('transaction_isolation') = 'repeatable read' AS repeatable_read,
 pg_catalog.pg_current_snapshot()::text AS snapshot,
 EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
 AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)) AS dangerous_role,
 EXISTS (SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN pg_catalog.pg_roles r
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND
 pg_catalog.pg_has_role(current_user,r.oid,'MEMBER') AND
 CASE WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(r.oid,c.oid,'USAGE,UPDATE') ELSE false END) AS write_privileges,
 EXISTS (SELECT FROM pg_catalog.pg_namespace n CROSS JOIN pg_catalog.pg_roles r
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND pg_catalog.pg_has_role(current_user,r.oid,'MEMBER') AND pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE'))
 OR EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user,r.oid,'MEMBER')
 AND pg_catalog.has_database_privilege(r.oid,current_database(),'CREATE')) AS create_privileges`;

export const CATALOG_SQL = `SELECT c.oid::text AS oid, c.relname AS name, c.relkind AS kind,
 c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
 EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inheritance,
 pg_catalog.has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',t.typname,
 'typeSchema',tn.nspname,'typeModifier',a.atttypmod,'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
 'collation',a.attcollation::pg_catalog.regcollation::text,
 'defaultHash',${digest("coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid), '')")}) ORDER BY a.attnum)
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
 JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
 coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',k.contype,'validated',k.convalidated,
 'deferrable',k.condeferrable,'deferred',k.condeferred,
 'columns',(SELECT pg_catalog.jsonb_agg(a.attname ORDER BY u.n) FROM unnest(k.conkey) WITH ORDINALITY u(attnum,n)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.attnum),
 'definitionHash',${digest('pg_catalog.pg_get_constraintdef(k.oid,true)')}) ORDER BY k.contype,pg_catalog.pg_get_constraintdef(k.oid,true))
 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),'[]'::jsonb) AS constraints,
 coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('valid',x.indisvalid,'ready',x.indisready,
 'unique',x.indisunique,'primary',x.indisprimary,'definitionHash',${digest('pg_catalog.pg_get_indexdef(x.indexrelid)')})
 ORDER BY pg_catalog.pg_get_indexdef(x.indexrelid)) FROM pg_catalog.pg_index x WHERE x.indrelid=c.oid),'[]'::jsonb) AS indexes,
 coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('enabled',t.tgenabled,
 'definitionHash',${digest('pg_catalog.pg_get_triggerdef(t.oid,true)')}) ORDER BY pg_catalog.pg_get_triggerdef(t.oid,true))
 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb) AS triggers
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`;

export const FK_SQL = `SELECT cn.nspname AS child_schema,c.relname AS child,pn.nspname AS parent_schema,p.relname AS parent,
 k.convalidated AS validated,k.confmatchtype AS match,
 pg_catalog.jsonb_agg(ca.attname ORDER BY u.n) AS columns,
 pg_catalog.jsonb_agg(pa.attname ORDER BY u.n) AS parent_columns,
 pg_catalog.bool_and(onsp.nspname='pg_catalog' AND o.oprname='=') AS builtin_equality
 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace cn ON cn.oid=c.relnamespace JOIN pg_catalog.pg_class p ON p.oid=k.confrelid
 JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace
 CROSS JOIN LATERAL unnest(k.conkey,k.confkey,k.conpfeqop) WITH ORDINALITY u(ck,pk,op,n)
 JOIN pg_catalog.pg_attribute ca ON ca.attrelid=c.oid AND ca.attnum=u.ck
 JOIN pg_catalog.pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=u.pk
 JOIN pg_catalog.pg_operator o ON o.oid=u.op JOIN pg_catalog.pg_namespace onsp ON onsp.oid=o.oprnamespace
 WHERE k.contype='f' AND cn.nspname='public' AND c.relname=ANY($1::text[])
 GROUP BY k.oid,cn.nspname,c.relname,pn.nspname,p.relname,k.convalidated,k.confmatchtype ORDER BY c.relname,p.relname,k.oid`;

export const SEQUENCES_SQL = `WITH consumers AS (
 SELECT a.adrelid AS table_oid,d.refobjid AS sequence_oid,a.adnum AS attnum FROM pg_catalog.pg_attrdef a
 JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid=a.oid
 AND d.refclassid='pg_catalog.pg_class'::regclass
 UNION SELECT d.refobjid,d.objid,d.refobjsubid FROM pg_catalog.pg_depend d
 WHERE d.classid='pg_catalog.pg_class'::regclass AND d.refclassid='pg_catalog.pg_class'::regclass AND d.deptype IN ('a','i')
 ) SELECT DISTINCT t.relname AS table_name,a.attname AS column_name,n.nspname AS sequence_schema,s.relname AS sequence_name,
 q.seqincrement::text AS increment,q.seqmin::text AS minimum,q.seqmax::text AS maximum,q.seqcache::text AS cache,q.seqcycle AS cycle,
 pg_catalog.has_sequence_privilege(current_user,s.oid,'SELECT') AS can_select
 FROM consumers x JOIN pg_catalog.pg_class t ON t.oid=x.table_oid
 JOIN pg_catalog.pg_namespace tn ON tn.oid=t.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=x.attnum
 JOIN pg_catalog.pg_class s ON s.oid=x.sequence_oid AND s.relkind='S'
 JOIN pg_catalog.pg_namespace n ON n.oid=s.relnamespace JOIN pg_catalog.pg_sequence q ON q.seqrelid=s.oid
 WHERE tn.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,a.attname,s.relname`;

export function countSql(table) {
    const id = table.columns.find(c => c.name === 'id' && INTEGER_TYPES.has(c.type));
    const pk = table.primaryKey;
    const published = table.name === 'maintenance_template' && table.columns.some(c => c.name === 'is_published' && c.type === 'bool');
    return `SELECT count(*)::text AS count, ${id ? 'min("id")::text' : 'NULL::text'} AS min_id,
 ${id ? 'max("id")::text' : 'NULL::text'} AS max_id,
 ${pk.length ? `((count(*) - count(DISTINCT ROW(${pk.map(ident).join(',')})))::text)` : 'NULL::text'} AS duplicate_keys,
 ${pk.length ? `count(*) FILTER (WHERE ${pk.map(k => ident(k) + ' IS NULL').join(' OR ')})::text` : 'NULL::text'} AS null_keys,
 ${published ? 'count(*) FILTER (WHERE "is_published" IS TRUE)::text' : 'NULL::text'} AS published_count
 FROM ONLY ${tableSql(table.name)}`;
}

function canonicalValue(column, prefix) {
    const value = `${prefix}.${ident(column.name)}`;
    // NUMERIC scale is not a business difference. Floats retain PG16 canonical text.
    return column.type === 'numeric' ? `pg_catalog.to_jsonb(pg_catalog.trim_scale(${value}))` : `pg_catalog.to_jsonb(${value})`;
}
export function fingerprintsSql(table) {
    const columns = table.columns;
    const business = columns.filter(c => table.name !== 'maintenance_template' || !RECREATED_METADATA.includes(c.name));
    const row = list => `pg_catalog.jsonb_build_object(${list.map(c => `${literal(c.name)},${canonicalValue(c, 'r')}`).join(',')})::text`;
    const pk = columns.filter(c => table.primaryKey.includes(c.name)).sort((a,b) => table.primaryKey.indexOf(a.name)-table.primaryKey.indexOf(b.name));
    const refs = RELATIONSHIPS.filter(r => r.child === table.name && columns.some(c => c.name === r.columns[0] && INTEGER_TYPES.has(c.type)));
    const technicalId = table.primaryKey.length === 1 && table.primaryKey[0] === 'id' && pk[0] && INTEGER_TYPES.has(pk[0].type);
    return `SELECT ${digest(row(pk))} AS key_hash, ${technicalId ? 'r."id"::text' : 'NULL::text'} AS id,
 ${digest(row(business))} AS business_hash, ${digest(row(columns))} AS full_hash,
 ${refs.length ? `pg_catalog.jsonb_build_object(${refs.map(r => `${literal(r.columns[0])},r.${ident(r.columns[0])}::text`).join(',')})` : "'{}'::jsonb"} AS refs
 FROM ONLY ${tableSql(table.name)} r ORDER BY key_hash LIMIT $1`;
}

export function orphanSql(relation) {
    const allPresent = relation.columns.map(c => `c.${ident(c)} IS NOT NULL`).join(' AND ');
    const allNull = relation.columns.map(c => `c.${ident(c)} IS NULL`).join(' AND ');
    const equal = relation.columns.map((c,i) => `p.${ident(relation.parentColumns[i])} = c.${ident(c)}`).join(' AND ');
    const partial = relation.match === 'f' ? `(NOT (${allPresent}) AND NOT (${allNull})) OR ` : '';
    return `SELECT count(*)::text AS missing FROM ONLY ${tableSql(relation.child)} c
 WHERE ${partial}((${allPresent}) AND NOT EXISTS (SELECT FROM ONLY ${tableSql(relation.parent)} p WHERE ${equal}))`;
}

export function sequenceStateSql(sequence) {
    if (sequence.schema !== 'public') throw new Error('UNSUPPORTED_SEQUENCE_SCHEMA');
    return `SELECT last_value::text AS last_value,is_called FROM "public".${ident(sequence.name)}`;
}

export function sameBusinessShape(a,b) {
    const project = table => table.columns.filter(c => table.name !== 'maintenance_template' || !RECREATED_METADATA.includes(c.name))
        .map(c => [c.name,c.type,c.typeModifier,c.notNull,c.identity,c.generated,c.collation]).sort((x,y) => x[0].localeCompare(y[0]));
    return JSON.stringify(project(a)) === JSON.stringify(project(b)) && JSON.stringify(a.primaryKey) === JSON.stringify(b.primaryKey);
}

export function referenceColumnAvailable(table,column) {
    return !!table?.inspectable && table.columns.some(c => c.name === column && c.typeSchema === 'pg_catalog' && INTEGER_TYPES.has(c.type));
}

export const isMaster = name => MASTERS.includes(name);
