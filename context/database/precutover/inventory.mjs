import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DATABASES, TABLES, REQUIRED, MASTERS, RELATIONSHIPS, SEED_SHA256, SEED_URL } from './scope.mjs';
import { IDENTITY_SQL, CATALOG_SQL, FK_SQL, SEQUENCES_SQL, TYPES, ident, countSql, fingerprintsSql,
    orphanSql, sequenceStateSql, referenceColumnAvailable } from './sql.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const numeric = value => typeof value === 'string' && /^-?\d+$/.test(value);
const nonnegative = value => numeric(value) && BigInt(value) >= 0n;
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ensure = (value, code) => { if (!value) throw Object.assign(new Error(code), { inventoryCode: code }); };
const safeName = value => { ident(value); return value; };
export const errorCode = error => {
    const codes = new Set(['IDENTITY_MISMATCH', 'ROLE_NOT_READ_ONLY', 'PG16_REQUIRED', 'READ_ONLY_NOT_CONFIRMED',
        'INVALID_CATALOG', 'INVALID_ROWS', 'DUPLICATE_KEYS', 'ROW_LIMIT', 'ABORTED', 'CONNECTION_CLOSED', 'INVALID_SEED']);
    if (codes.has(error?.inventoryCode)) return error.inventoryCode;
    if (error?.code === '42501') return 'INSUFFICIENT_PRIVILEGES';
    if (error?.code === '57014' || /timeout/i.test(String(error?.code ?? '') + ' ' + String(error?.name ?? '') + ' ' + String(error?.message ?? ''))) return 'TIMEOUT';
    if (['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','08006','08003','57P01'].includes(error?.code)) return 'CONNECTION_FAILED';
    return 'CHECK_UNAVAILABLE'; // Never return database messages, SQL, paths or credentials.
};

export function loadSeedIds(bytes = readFileSync(SEED_URL)) {
    ensure(sha(bytes) === SEED_SHA256, 'INVALID_SEED');
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); } catch { ensure(false,'INVALID_SEED'); }
    const ids = {};
    for (const name of MASTERS) {
        ensure(Array.isArray(data?.tables?.[name]),'INVALID_SEED');
        ids[name] = new Set(data.tables[name].map(row => {
            ensure(Number.isSafeInteger(row.id) && row.id > 0,'INVALID_SEED');
            return String(row.id);
        }));
        ensure(ids[name].size === data.tables[name].length,'INVALID_SEED');
    }
    // Discard all personal/business values: callers receive only technical IDs.
    return ids;
}

function normalizedCatalog(row) {
    ensure(TABLES.includes(row.name) && Array.isArray(row.columns) && Array.isArray(row.constraints), 'INVALID_CATALOG');
    const columns = row.columns.map(c => ({ name: safeName(c.name),
        type: c.typeSchema === 'pg_catalog' && TYPES.has(c.type) ? c.type : 'unsupported', typeSchema: c.typeSchema === 'pg_catalog' ? 'pg_catalog' : 'unsupported',
        typeModifier: Number.isInteger(c.typeModifier) ? c.typeModifier : null, notNull: c.notNull === true,
        identity: ['','a','d'].includes(c.identity) ? c.identity : 'unsupported', generated: ['','s'].includes(c.generated) ? c.generated : 'unsupported',
        collation: sha(String(c.collation)), defaultHash: hashValid(c.defaultHash) ? c.defaultHash : null }));
    ensure(new Set(columns.map(c => c.name)).size === columns.length && columns.length > 0,'INVALID_CATALOG');
    const constraints = row.constraints.map(c => {
        ensure(['p','u','f','c','x'].includes(c.kind) && hashValid(c.definitionHash),'INVALID_CATALOG');
        return { kind: c.kind, columns: (c.columns ?? []).map(safeName), validated: c.validated === true,
            deferrable: c.deferrable === true, deferred: c.deferred === true, definitionHash: c.definitionHash };
    });
    const pks = constraints.filter(c => c.kind === 'p');
    const primaryKey = pks.length === 1 ? pks[0].columns : [];
    ensure(primaryKey.every(k => columns.some(c => c.name === k)), 'INVALID_CATALOG');
    const indexes = (row.indexes ?? []).map(i => {
        ensure(hashValid(i.definitionHash),'INVALID_CATALOG');
        return { valid: i.valid === true, ready: i.ready === true, unique: i.unique === true, primary: i.primary === true, definitionHash: i.definitionHash };
    });
    const triggers = (row.triggers ?? []).map(t => {
        ensure(hashValid(t.definitionHash),'INVALID_CATALOG');
        return { enabled: ['O','D','R','A'].includes(t.enabled) ? t.enabled : 'unknown', definitionHash: t.definitionHash };
    });
    const structural = row.kind === 'r' && row.rls === false && row.force_rls === false && row.inheritance === false;
    const pkValid = pks.length === 1 && pks[0].validated && primaryKey.length > 0;
    const inspectable = structural && row.can_select === true && columns.every(c => c.type !== 'unsupported' && c.defaultHash);
    return { name: row.name, exists: true, kind: ['r','p','v','m','f'].includes(row.kind) ? row.kind : 'unsupported',
        rls: row.rls !== false || row.force_rls !== false, inheritance: row.inheritance !== false,
        canSelect: row.can_select === true, columns, constraints, indexes, triggers, primaryKey,
        inspectable, pkValid, counts: null, rows: null, sequences: [], checks: [
            { check: 'structure', status: structural ? 'PASS' : 'NO-GO', code: structural ? 'ORDINARY_TABLE' : 'UNSUPPORTED_TABLE_STRUCTURE' },
            { check: 'select_privilege', status: row.can_select === true ? 'PASS' : 'NO-GO', code: row.can_select === true ? 'READABLE' : 'INSUFFICIENT_PRIVILEGES' },
            { check: 'column_types', status: columns.every(c => c.type !== 'unsupported' && c.defaultHash) ? 'PASS' : 'NO-GO', code: 'SUPPORTED_BUILTIN_TYPES_REQUIRED' },
            { check: 'primary_key', status: pkValid ? 'PASS' : 'NO-GO', code: pkValid ? 'VALIDATED_PRIMARY_KEY' : 'PRIMARY_KEY_UNAVAILABLE' },
            { check: 'constraints_indexes', status: constraints.every(c => c.validated) && indexes.every(i => i.valid && i.ready) ? 'PASS' : 'NO-GO', code: 'CATALOG_VALIDITY' },
        ] };
}

function validateRows(rows, table, maxRows) {
    ensure(Array.isArray(rows),'INVALID_ROWS');
    ensure(rows.length <= maxRows,'ROW_LIMIT');
    const keys = new Set();
    const references = RELATIONSHIPS.filter(r => r.child === table.name && referenceColumnAvailable(table,r.columns[0])).map(r => r.columns[0]);
    const expectedId = table.primaryKey.length === 1 && table.primaryKey[0] === 'id' && referenceColumnAvailable(table,'id');
    const clean = rows.map(row => {
        ensure(hashValid(row.key_hash) && hashValid(row.business_hash) && hashValid(row.full_hash),'INVALID_ROWS');
        ensure(!keys.has(row.key_hash),'DUPLICATE_KEYS'); keys.add(row.key_hash);
        ensure(expectedId ? numeric(row.id) : row.id === null,'INVALID_ROWS');
        const refs = {};
        for (const column of references) {
            const value = row.refs?.[column];
            ensure(value === null || numeric(value),'INVALID_ROWS');
            refs[column] = value;
        }
        return { keyHash: row.key_hash, id: row.id, businessHash: row.business_hash, fullHash: row.full_hash, refs };
    });
    ensure(table.counts && BigInt(clean.length) === BigInt(table.counts.count),'INVALID_ROWS');
    return clean;
}

function relationKey(r) { return JSON.stringify([r.child,r.columns,r.parent,r.parentColumns]); }

export async function captureDatabase(side, config, { clientFactory, maxRows = 100000, maxTotalRows = 500000, timeoutMs = 20000, signal } = {}) {
    ensure(Object.hasOwn(DATABASES,side) && config?.database === DATABASES[side], 'IDENTITY_MISMATCH');
    ensure(Number.isSafeInteger(timeoutMs) && timeoutMs>=1000 && timeoutMs<=120000
        && Number.isSafeInteger(maxRows) && maxRows>=1 && maxRows<=1000000
        && Number.isSafeInteger(maxTotalRows) && maxTotalRows>=1 && maxTotalRows<=2000000,'INVALID_OPTIONS');
    const started = Date.now();
    const capture = { side, database: DATABASES[side], startedAt: new Date(started).toISOString(), completedAt: null,
        durationMs: 0, identity: null, checks: [], tables: {}, relations: [], complete: false };
    let client, transaction = false, fatal = false, aborted = false, closePromise, capturedRows = 0;
    const close = () => closePromise ??= Promise.resolve().then(() => client.end());
    const abort = () => { aborted = true; if (client) void close().catch(() => {}); };
    const query = async (tag, text, values = []) => {
        ensure(!signal?.aborted && !aborted,'ABORTED');
        return client.query({ text, values, query_timeout: timeoutMs + 2000, inventoryTag: tag });
    };
    // Server errors abort a transaction; savepoints let later independent checks
    // continue without leaving READ ONLY. Broken connections stop this capture.
    const step = async (tag, text, values) => {
        await query('savepoint', 'SAVEPOINT inventory_check');
        try {
            const result = await query(tag,text,values);
            await query('release','RELEASE SAVEPOINT inventory_check');
            return { ok: true, rows: result.rows };
        } catch (error) {
            try {
                await query('recover','ROLLBACK TO SAVEPOINT inventory_check');
                await query('release','RELEASE SAVEPOINT inventory_check');
            } catch { fatal = true; throw error; }
            return { ok: false, code: errorCode(error) };
        }
    };
    try {
        ensure(!signal?.aborted,'ABORTED');
        client = await clientFactory(config,side);
        signal?.addEventListener('abort',abort,{once:true});
        client.on?.('error', () => {}); // No raw pg/socket error is logged.
        ensure(!signal?.aborted,'ABORTED');
        await client.connect();
        ensure(!signal?.aborted,'ABORTED');
        await query('begin','BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
        for (const text of [`SET LOCAL statement_timeout = '${timeoutMs}ms'`, "SET LOCAL lock_timeout = '3000ms'",
            "SET LOCAL idle_in_transaction_session_timeout = '60000ms'", 'SET LOCAL search_path = pg_catalog',
            'SET LOCAL row_security = off', "SET LOCAL timezone = 'UTC'", "SET LOCAL datestyle = 'ISO, YMD'",
            "SET LOCAL intervalstyle = 'iso_8601'", 'SET LOCAL extra_float_digits = 3', "SET LOCAL bytea_output = 'hex'"]) await query('settings',text);
        const identity = (await query('identity',IDENTITY_SQL,[config.user])).rows[0];
        ensure(identity?.database === DATABASES[side] && identity.same_role === true && identity.expected_role === true,'IDENTITY_MISMATCH');
        ensure(Number.isInteger(identity.version_num) && Math.floor(identity.version_num / 10000) === 16,'PG16_REQUIRED');
        ensure(identity.read_only === true && identity.repeatable_read === true,'READ_ONLY_NOT_CONFIRMED');
        ensure(identity.dangerous_role === false && identity.write_privileges === false && identity.create_privileges === false,'ROLE_NOT_READ_ONLY');
        capture.identity = { database: DATABASES[side], postgresVersionNumber: identity.version_num, roleVerified: true,
            readOnly: true, effectiveReadOnlyPrivilegesVerified: true, repeatableRead: true };
        capture.checks.push({check:'identity_read_only',status:'PASS',code:'VERIFIED'});
        const catalog = await query('catalog',CATALOG_SQL,[TABLES]);
        for (const row of catalog.rows) {
            ensure(!Object.hasOwn(capture.tables,row.name),'INVALID_CATALOG');
            capture.tables[row.name] = normalizedCatalog(row);
        }
        for (const name of TABLES) if (!Object.hasOwn(capture.tables,name)) {
            const required = REQUIRED[side].includes(name);
            capture.tables[name] = { name, exists: false, columns: [], primaryKey: [], counts: null, rows: null,
                inspectable: false, sequences: [], checks: [{check:'existence',status:required?'NO-GO':'WARNING',code:required?'REQUIRED_TABLE_ABSENT':'OPTIONAL_TABLE_ABSENT'}] };
        }
        for (const name of TABLES) {
            const table = capture.tables[name];
            if (!table.inspectable) continue;
            const counted = await step('count:' + name,countSql(table));
            if (!counted.ok) { table.checks.push({check:'counts',status:'NO-GO',code:counted.code}); continue; }
            const count = counted.rows[0];
            ensure(count && nonnegative(count.count) && [count.min_id,count.max_id,count.duplicate_keys,count.null_keys,count.published_count??null].every(v => v === null || numeric(v)),'INVALID_ROWS');
            if (referenceColumnAvailable(table,'id') && count.count !== '0') ensure(numeric(count.min_id) && numeric(count.max_id),'INVALID_ROWS');
            table.counts = { count: count.count, minId: count.min_id, maxId: count.max_id,
                duplicateKeys: count.duplicate_keys, nullKeys: count.null_keys, publishedCount: count.published_count??null };
            table.checks.push({check:'counts',status:'PASS',code:'EXACT_COUNT'});
            const validKeys = table.pkValid && count.duplicate_keys === '0' && count.null_keys === '0';
            table.checks.push({check:'key_integrity',status:validKeys?'PASS':'NO-GO',code:validKeys?'UNIQUE_NON_NULL_KEYS':'DUPLICATE_OR_UNAVAILABLE_KEYS'});
            if (!validKeys) continue;
            if (BigInt(count.count) > BigInt(maxRows) || BigInt(count.count) + BigInt(capturedRows) > BigInt(maxTotalRows)) {
                table.checks.push({check:'fingerprints',status:'NO-GO',code:'ROW_LIMIT'}); continue;
            }
            const result = await step('fingerprints:' + name,fingerprintsSql(table),[maxRows + 1]);
            if (!result.ok) { table.checks.push({check:'fingerprints',status:'NO-GO',code:result.code}); continue; }
            try { table.rows = validateRows(result.rows,table,maxRows); capturedRows += table.rows.length; table.checks.push({check:'fingerprints',status:'PASS',code:'COMPLETE'}); }
            catch(error) { table.rows = null; table.checks.push({check:'fingerprints',status:'NO-GO',code:errorCode(error)}); }
        }
        const foreignKeys = await query('foreign_keys',FK_SQL,[TABLES]);
        const actual = [];
        for (const fk of foreignKeys.rows) {
            const supported = TABLES.includes(fk.child) && TABLES.includes(fk.parent) && fk.child_schema === 'public' && fk.parent_schema === 'public'
                && Array.isArray(fk.columns) && Array.isArray(fk.parent_columns) && fk.columns.length > 0 && fk.columns.length === fk.parent_columns.length
                && fk.builtin_equality === true && ['s','f'].includes(fk.match);
            if (!supported) {
                capture.relations.push({child:TABLES.includes(fk.child)?fk.child:null,parent:TABLES.includes(fk.parent)?fk.parent:null,
                    kind:'FK',status:'NO-GO',code:'FK_OUTSIDE_SCOPE_OR_UNSUPPORTED',missing:null}); continue;
            }
            const r = {child:fk.child,columns:fk.columns.map(safeName),parent:fk.parent,parentColumns:fk.parent_columns.map(safeName),match:fk.match,validated:fk.validated===true,kind:'FK'};
            actual.push(r);
        }
        const actualKeys = new Set(actual.map(relationKey));
        const relations = [...actual,...RELATIONSHIPS.filter(r => !actualKeys.has(relationKey(r))).map(r => ({...r,match:'s',kind:'LOGICAL_APPLICATION',validated:null}))];
        for (const relation of relations) {
            const child = capture.tables[relation.child], parent = capture.tables[relation.parent];
            const applicable = child?.exists;
            const check = {...relation,missing:null,status:'WARNING',code:'CHILD_TABLE_ABSENT'};
            if (applicable) {
                const supported = relation.columns.every(c => referenceColumnAvailable(child,c)) && relation.parentColumns.every(c => referenceColumnAvailable(parent,c));
                if (!supported) { check.status='NO-GO'; check.code='RELATION_NOT_INSPECTABLE'; }
                else {
                    const result = await step('orphans:' + relationKey(relation),orphanSql(relation));
                    if (!result.ok) { check.status='NO-GO'; check.code=result.code; }
                    else {
                        ensure(nonnegative(result.rows[0]?.missing),'INVALID_ROWS'); check.missing=result.rows[0].missing;
                        check.status = check.missing !== '0' || relation.validated === false ? 'NO-GO' : 'PASS';
                        check.code = check.missing !== '0' ? 'MISSING_PARENTS' : relation.validated === false ? 'FK_NOT_VALIDATED' : 'NO_MISSING_PARENTS';
                    }
                }
            }
            capture.relations.push(check);
        }
        const sequences = await query('sequences',SEQUENCES_SQL,[TABLES]);
        for (const s of sequences.rows) {
            ensure(TABLES.includes(s.table_name),'INVALID_CATALOG');
            const sequence = {name:safeName(s.sequence_name),schema:s.sequence_schema==='public'?'public':'unsupported',column:safeName(s.column_name),
                increment:numeric(s.increment)?s.increment:null,minimum:numeric(s.minimum)?s.minimum:null,maximum:numeric(s.maximum)?s.maximum:null,
                cache:nonnegative(s.cache)&&BigInt(s.cache)>0n?s.cache:null,cycle:s.cycle===true,lastValue:null,isCalled:null,status:'NO-GO',
                code:s.can_select===false?'INSUFFICIENT_PRIVILEGES':'SEQUENCE_NOT_INSPECTABLE'};
            if (s.can_select === true && sequence.schema === 'public' && sequence.increment && sequence.minimum && sequence.maximum && sequence.cache) {
                const result = await step('sequence:' + s.table_name + ':' + sequence.name,sequenceStateSql(sequence));
                if (!result.ok) sequence.code=result.code;
                else {
                    ensure(numeric(result.rows[0]?.last_value) && typeof result.rows[0]?.is_called === 'boolean','INVALID_ROWS');
                    sequence.lastValue=result.rows[0].last_value; sequence.isCalled=result.rows[0].is_called;
                    const bounds=capture.tables[s.table_name].counts;
                    if (bounds && sequence.column === 'id' && !sequence.cycle && BigInt(sequence.increment)!==0n) {
                        const next=BigInt(sequence.lastValue)+(sequence.isCalled?BigInt(sequence.increment):0n);
                        const positive=BigInt(sequence.increment)>0n;
                        const safe=next>=BigInt(sequence.minimum)&&next<=BigInt(sequence.maximum)
                            && (bounds.count==='0'||(positive?next>BigInt(bounds.maxId):next<BigInt(bounds.minId)));
                        sequence.status=safe?(BigInt(sequence.cache)>1n?'WARNING':'PASS'):'NO-GO';
                        sequence.code=safe?(BigInt(sequence.cache)>1n?'SEQUENCE_CACHE_REQUIRES_REVIEW':'OBSERVED_NEXT_SAFE'):'UNSAFE_SEQUENCE';
                    }
                }
            }
            capture.tables[s.table_name].sequences.push(sequence);
        }
        for (const table of Object.values(capture.tables)) {
            if (table.exists && table.columns.some(c => c.name === 'id' && (c.identity || c.defaultHash !== sha(''))) && referenceColumnAvailable(table,'id') && table.sequences.length === 0)
                table.checks.push({check:'sequence_discovery',status:'WARNING',code:'NO_ASSOCIATED_SEQUENCE_DISCOVERED'});
        }
        capture.complete = true;
    } catch(error) {
        fatal = true;
        capture.checks.push({check:'capture',status:'NO-GO',code:aborted||signal?.aborted?'ABORTED':errorCode(error)});
    } finally {
        if (client) {
            if (transaction && !aborted) {
                try { await client.query({text:'ROLLBACK',values:[],query_timeout:timeoutMs+2000,inventoryTag:'rollback'}); }
                catch { capture.checks.push({check:'rollback',status:'NO-GO',code:'CHECK_UNAVAILABLE'}); fatal=true; }
            }
            try { await close(); }
            catch { capture.checks.push({check:'connection_close',status:'NO-GO',code:'CONNECTION_CLOSED'}); fatal=true; }
            signal?.removeEventListener('abort',abort);
        }
        if (fatal) capture.complete=false;
        capture.completedAt=new Date().toISOString(); capture.durationMs=Date.now()-started;
    }
    return capture;
}
