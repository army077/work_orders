// No SQL execution. The original evidence stays outside Git and is opt-in.
// Set LOGISTICA_SHAPE_EVIDENCE to the local shape_servidor.txt path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyzeEvidence,parseEvidence,postgresJsonbText,shapeIssues } from './analyze_server_shape.mjs';
const path=process.env.LOGISTICA_SHAPE_EVIDENCE;
const input=path?readFileSync(path,'utf8'):null;
const options={skip:!path&&'Set LOGISTICA_SHAPE_EVIDENCE to the unversioned server evidence'};
const hash=s=>createHash('sha256').update(s).digest('hex');
test('int64 sequence maxima are never rounded during diagnostic serialization',()=>{
 const {shape}=parseEvidence('{"seqmax": 9223372036854775807}');
 assert.equal(shape.seqmax,9223372036854775807n);
 assert.equal(postgresJsonbText(shape),'{"seqmax": 9223372036854775807}');
});
test('real evidence recovers both exact fingerprints with only 26 index and 2 trigger qualifiers',options,()=>{
 const report=analyzeEvidence(input);
 assert.equal(report.fingerprint,'c0ec5fd20ab1caec10fd2651155a8cacd42928124b9b6fa12fa612c11eb7cc22');
 assert.equal(report.referenceFingerprint,'c7e7d4d23745580b151b7b8876b35023ecc0cd8e908f0f79cb46f2417582bead');
 assert.equal(report.changes.length,28);
 assert.equal(report.changes.filter(c=>c.kind==='index').length,26);
 assert.equal(report.changes.filter(c=>c.kind==='trigger').length,2);
 assert.deepEqual(report.issues,[]);assert.equal(report.falsePositive,true);
 const {raw}=parseEvidence(input);
 assert.equal(hash(raw.replaceAll(' ON public.',' ON pg_temp.')),'e931b287bf3376015b8bbbc12ea19347a94364e5c5f048cc5b7178207a8d64a1');
 assert.notEqual(hash(raw.replaceAll('EXECUTE FUNCTION public.','EXECUTE FUNCTION pg_temp.')),report.expectedPrevious);
});
const table=s=>s.tables.logistica_deliveries;
const mapping=s=>s.tables.logistica_legacy_owner_mapping;
for(const [name,mutate] of [
 ['missing table',s=>delete s.tables.logistica_deliveries],
 ['extra table',s=>s.tables.other=structuredClone(table(s))],
 ['relation kind',s=>table(s).kind='v'],
 ['persistence',s=>table(s).persistence='u'],
 ['column name',s=>table(s).columns[0][0]='other'],
 ['column type',s=>table(s).columns[0][1]='integer'],
 ['column nullability',s=>table(s).columns[0][2]=false],
 ['serial default',s=>table(s).columns[0][3]="nextval('other_seq'::regclass)"],
 ['scalar default',s=>table(s).columns[15][3]="'FAILED'::text"],
 ['identity',s=>table(s).columns[0][4]='a'],
 ['generated column',s=>table(s).columns[0][5]='s'],
 ['collation',s=>mapping(s).columns[1][6]='"default"'],
 ['column order',s=>table(s).columns.reverse()],
 ['extra column',s=>table(s).columns.push(['other','text',false,null,'','','"default"'])],
 ['missing constraint',s=>table(s).constraints.pop()],
 ['unvalidated constraint',s=>table(s).constraints[0][2]=false],
 ['deferrable constraint',s=>table(s).constraints[0][3]=true],
 ['deferred constraint',s=>table(s).constraints[0][4]=true],
 ['constraint class',s=>table(s).constraints[0][1]='c'],
 ['FK target',s=>table(s).constraints[0][5]=table(s).constraints[0][5].replace('REFERENCES logistica_authorized_users','REFERENCES other')],
 ['FK action',s=>table(s).constraints[0][5]=table(s).constraints[0][5].replace('RESTRICT','CASCADE')],
 ['CHECK predicate',s=>table(s).constraints.find(c=>c[0]==='logistica_deliveries_chofer_chk')[5]="CHECK (btrim(chofer) = ''::text)"],
 ['unique keys',s=>table(s).constraints.find(c=>c[1]==='u')[5]='UNIQUE (pedido)'],
 ['missing index',s=>table(s).indexes.pop()],
 ['invalid index',s=>table(s).indexes[0][1]=false],
 ['unready index',s=>table(s).indexes[0][2]=false],
 ['index uniqueness',s=>table(s).indexes[1][3]=table(s).indexes[1][3].replace('UNIQUE ','')],
 ['index key',s=>table(s).indexes[0][3]=table(s).indexes[0][3].replace('(authorized_user_id)','(pedido)')],
 ['partial predicate',s=>table(s).indexes[3][3]=table(s).indexes[3][3].replace('IS NOT NULL','IS NULL')],
 ['sequence owner dependency',s=>s.sequences.logistica_deliveries_id_seq[8][0][0]='other'],
 ['sequence increment',s=>s.sequences.logistica_deliveries_id_seq[3]=2],
 ['sequence maximum',s=>s.sequences.logistica_deliveries_id_seq[5]=9223372036854775806n],
 ['sequence cycle',s=>s.sequences.logistica_deliveries_id_seq[7]=true],
 ['function code',s=>s.mapping_functions[0][3]+='\n'],
 ['function return',s=>s.mapping_functions[0][2]='void'],
 ['function security',s=>s.mapping_functions[0][4]=true],
 ['function volatility',s=>s.mapping_functions[0][5]='s'],
 ['function config',s=>s.mapping_functions[0][6]=null],
 ['function language',s=>s.mapping_functions[0][7]='sql'],
 ['trigger disabled',s=>mapping(s).triggers[0][1]='D'],
 ['trigger event',s=>mapping(s).triggers[0][2]=mapping(s).triggers[0][2].replace(' OR DELETE','')],
 ['trigger function',s=>mapping(s).triggers[0][2]=mapping(s).triggers[0][2].replace('protect_logistica_legacy_owner_mapping()','other()')],
 ['RLS',s=>table(s).rls=true],
 ['force RLS',s=>table(s).force_rls=true],
 ['policy',s=>table(s).policies.push(['other'])],
 ['rule',s=>table(s).rules.push(['other'])],
 ['inheritance',s=>table(s).inheritance.push(['other'])],
])test('real shape mutation is rejected: '+name,options,()=>{
 const {shape}=parseEvidence(input);mutate(shape);assert.ok(shapeIssues(shape).length>0);
});
