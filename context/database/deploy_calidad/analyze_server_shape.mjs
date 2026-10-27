// Local evidence analysis only. Never connects to a DB or executes SQL.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { baselineModel } from './build_clean_baseline.mjs';
import { canonicalExpression } from './semantic_expressions.mjs';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
export function parseEvidence(input) {
 const raw=input.replace(/^\uFEFF/,'').replace(/^SHAPE::/,'').trim();
 const shape=JSON.parse(raw,(_key,value,context)=>{
  if(typeof value==='number'&&!Number.isSafeInteger(value)) {
   if(!context?.source||!/^\d+$/.test(context.source))throw Error('LOSSLESS_JSON_PARSE_REQUIRES_NODE_22_OR_NEWER');
   return BigInt(context.source);
  }
  return value;
 });
 return {raw,shape};
}
// jsonb orders keys by UTF8 byte length, then binary order. Decimal int64 values
// are preserved exactly; JSON.parse/stringify alone would round sequence maxima.
export function postgresJsonbText(v) {
 if(v===null)return 'null';
 if(typeof v==='bigint')return String(v);
 if(Array.isArray(v))return '['+v.map(postgresJsonbText).join(', ')+']';
 if(typeof v==='object')return '{'+Object.keys(v).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b)))
  .map(k=>JSON.stringify(k)+': '+postgresJsonbText(v[k])).join(', ')+'}';
 return JSON.stringify(v);
}
const columnNames=s=>s.split(',').map(c=>c.trim().replaceAll('"',''));
const action=s=>({'NO ACTION':'a',RESTRICT:'r',CASCADE:'c','SET NULL':'n','SET DEFAULT':'d'})[s??'NO ACTION'];
export function shapeIssues(shape,model=baselineModel()) {
 const issues=[];
 const equal=(actual,expected,label)=>{if(!isDeepStrictEqual(actual,expected))issues.push(label);};
 const expr=(actual,expected,label)=>{
  try {equal(canonicalExpression(actual),canonicalExpression(expected),label);}
  catch {issues.push(label+':UNSUPPORTED');}
 };
 const names=model.tables.filter(t=>t.name.startsWith('logistica_')||t.name==='entregas_logistica_legacy').map(t=>t.name);
 equal(Object.keys(shape.tables).sort(),[...names].sort(),'TABLE_INVENTORY');
 for(const name of names) {
  const table=shape.tables[name],expected=model.tables.find(t=>t.name===name);
  if(!table){issues.push('MISSING_TABLE:'+name);continue;}
  for(const [k,v] of Object.entries({kind:'r',persistence:'p',rls:false,force_rls:false,rules:[],policies:[],inheritance:[]}))equal(table[k],v,name+':'+k);
  equal(table.columns.length,expected.columns.length,name+':COLUMN_COUNT');
  expected.columns.forEach((c,i)=>{
   const actual=table.columns[i];
   if(!actual){issues.push(name+':MISSING_COLUMN:'+c.name);return;}
   equal(actual.slice(0,3),[c.name,c.type,c.not_null],name+':COLUMN:'+c.name);
   equal(actual.slice(4),['','',c.collation?'"'+c.collation+'"':c.type==='text'?'"default"':'-'],name+':COLUMN_ATTRIBUTES:'+c.name);
   expr(actual[3],c.serial?`nextval('public.${name}_${c.name}_seq'::regclass)`:c.default,name+':DEFAULT:'+c.name);
  });
  equal(table.constraints.map(c=>c[0]).sort(),expected.constraints.map(c=>c.name).sort(),name+':CONSTRAINT_INVENTORY');
  for(const c of expected.constraints) {
   const a=table.constraints.find(a=>a[0]===c.name);
   if(!a){issues.push(name+':MISSING_CONSTRAINT:'+c.name);continue;}
   equal(a.slice(1,5),[c.type,true,false,false],name+':CONSTRAINT_FLAGS:'+c.name);
   if(c.type==='c')expr(a[5],c.definition,name+':CHECK:'+c.name);
   else if(c.type==='f') {
    const f=a[5].match(/^FOREIGN KEY \(([^)]+)\) REFERENCES (?:(?:public|pg_temp)\.)?(\w+)\(([^)]+)\)(?: ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT))?(?: ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT))?$/);
    equal(f?[columnNames(f[1]),f[2],columnNames(f[3]),action(f[4]),action(f[5])]:null,[c.columns,c.reference,c.reference_columns,c.update,c.delete],name+':FK:'+c.name);
   } else {
    const p=a[5].match(/^(PRIMARY KEY|UNIQUE) \(([^)]+)\)$/);
    equal(p?[p[1],columnNames(p[2])]:null,[c.type==='p'?'PRIMARY KEY':'UNIQUE',c.columns],name+':KEY:'+c.name);
   }
  }
  const indexes=model.semanticIndexes.filter(i=>i.table===name);
  equal(table.indexes.map(i=>i[0]).sort(),indexes.map(i=>i.name).sort(),name+':INDEX_INVENTORY');
  for(const i of indexes) {
   const a=table.indexes.find(a=>a[0]===i.name);
   if(!a){issues.push(name+':MISSING_INDEX:'+i.name);continue;}
   equal(a.slice(1,3),[true,true],name+':INDEX_FLAGS:'+i.name);
   const p=a[3].match(/^CREATE (UNIQUE )?INDEX (\w+) ON (?:public\.)?(\w+) USING btree \(([^)]+)\)(?: WHERE ([\s\S]+))?$/);
   equal(p?[!!p[1],p[2],p[3],columnNames(p[4])]:null,[i.unique,i.name,i.table,i.columns],name+':INDEX:'+i.name);
   if(p)expr(p[5]??null,i.predicate,name+':PREDICATE:'+i.name);
  }
  const triggers=name==='logistica_legacy_owner_mapping'?model.aux.filter(a=>a.startsWith('CREATE TRIGGER')):[];
  equal(table.triggers.length,triggers.length,name+':TRIGGER_COUNT');
  const trigger=s=>{
   const m=s.replace(/\s+/g,' ').match(/^CREATE TRIGGER (\w+) BEFORE ([A-Z ]+) ON (?:public\.)?(\w+) FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION public\.(\w+)\(\)$/);
   return m?[m[1],m[2].split(' OR ').sort(),m[3],m[4],m[5]]:null;
  };
  for(const ddl of triggers) {
   const expected=trigger(ddl),a=table.triggers.find(a=>a[0]===expected?.[0]);
   equal(a?.[1],'O',name+':TRIGGER_ENABLED:'+expected?.[0]);
   equal(a?trigger(a[2]):null,expected,name+':TRIGGER:'+expected?.[0]);
  }
 }
 const seq=model.sequences.filter(s=>names.includes(s.table));
 equal(Object.keys(shape.sequences).sort(),seq.map(s=>s.name).sort(),'SEQUENCE_INVENTORY');
 for(const s of seq) {
  const position=model.tables.find(t=>t.name===s.table).columns.findIndex(c=>c.name===s.column)+1;
  equal(shape.sequences[s.name],['S',s.type,1,1,1,9223372036854775807n,1,false,[[s.table,position,'a']]],'SEQUENCE:'+s.name);
 }
 const funcs=shape.mapping_functions;
 equal(funcs.length,1,'FUNCTION_COUNT');
 if(funcs.length===1) {
  equal(funcs[0].filter((_,i)=>i!==3),['protect_logistica_legacy_owner_mapping','','trigger',false,'v',['search_path=pg_catalog'],'plpgsql'],'FUNCTION_ATTRIBUTES');
  equal(hash(funcs[0][3].replaceAll('\r','')),model.mappingFunctionHash,'FUNCTION_BODY_HASH');
 }
 return issues;
}
export function analyzeEvidence(input,model=baselineModel()) {
 const {raw,shape}=parseEvidence(input);
 if(postgresJsonbText(shape)!==raw)throw Error('EVIDENCE_IS_NOT_EXACT_JSONB_TEXT');
 const reference=structuredClone(shape),changes=[];
 for(const [table,t] of Object.entries(reference.tables)) {
  for(const [i,index] of t.indexes.entries()) {
   const before=index[3];index[3]=before.replace(` ON public.${table} USING `,` ON pg_temp.${table} USING `);
   if(before!==index[3])changes.push({path:`/tables/${table}/indexes/${i}/3`,object:index[0],kind:'index'});
  }
  for(const [i,trigger] of t.triggers.entries()) {
   const before=trigger[2];trigger[2]=before.replace('EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping()','EXECUTE FUNCTION pg_temp.protect_logistica_legacy_owner_mapping()');
   if(before!==trigger[2])changes.push({path:`/tables/${table}/triggers/${i}/2`,object:trigger[0],kind:'trigger'});
  }
 }
 const issues=shapeIssues(shape,model),fingerprint=hash(raw),referenceFingerprint=hash(postgresJsonbText(reference));
 return {shapeBytes:Buffer.byteLength(raw),fingerprint,expectedPrevious:model.logisticsFingerprint,referenceFingerprint,
  exactPreviousHashRecovered:referenceFingerprint===model.logisticsFingerprint,changes,issues,
  falsePositive:referenceFingerprint===model.logisticsFingerprint&&issues.length===0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(process.argv.length!==4||process.argv[2]!=='--shape')throw Error('USAGE: node analyze_server_shape.mjs --shape PATH');
 console.log(JSON.stringify(analyzeEvidence(readFileSync(process.argv[3],'utf8')),null,2));
}
