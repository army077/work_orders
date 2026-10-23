// Offline test adapter: evaluates the generated SELECT against catalog VALUES
// in an in-memory SQLite engine. No connections, filesystem DB, DDL or writes.
// Production SQL and runtime remain PostgreSQL 16 / Node 18. This optional test
// engine was verified on development Node 24; Node 18 runs SQL safety contracts.
import { readFileSync } from 'node:fs';
import { statements } from './build_package.mjs';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (error) { if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error; }
export const fixtureOptions = { skip: !DatabaseSync && 'Behavior fixtures require built-in node:sqlite (verified on development Node 24); server stays on Node 18' };
export const catalogs = { pg_class:1259, pg_proc:1255, pg_trigger:2620, pg_type:1247, pg_extension:3079 };
const definitions = {
  pg_namespace:['oid','nspname'], pg_extension:['oid','extname','extnamespace','extversion'],
  pg_depend:['classid','objid','objsubid','refclassid','refobjid','refobjsubid','deptype'],
  pg_class:['oid','relname','relnamespace','relkind'], pg_proc:['oid','proname','pronamespace'],
  pg_trigger:['oid','tgname','tgrelid','tgisinternal'], pg_type:['oid','typname','typnamespace'],
};
export function dependency(catalog,oid,refCatalog,refOid,deptype,refSubId=0) {
  return [catalogs[catalog],oid,0,catalogs[refCatalog],refOid,refSubId,deptype];
}
export function citextFixture() {
  return {
    pg_namespace:[[11,'public'],[12,'pg_catalog'],[13,'information_schema']],
    pg_extension:[[900,'citext',11,'1.6'],[901,'plpgsql',12,'1.0']],
    pg_type:[[100,'citext',11],[101,'_citext',11]],
    pg_proc:[[110,'citext_eq',11],[111,'texticlt',11],[112,'regexp_replace',11],[113,'min',11]],
    pg_depend:[
      dependency('pg_type',100,'pg_extension',900,'e'),
      // PostgreSQL creates array types as internal implementation objects.
      dependency('pg_type',101,'pg_type',100,'i'),
      ...[110,111,112,113].map(oid=>dependency('pg_proc',oid,'pg_extension',900,'e')),
    ],
    pg_class:[],pg_trigger:[],
  };
}
const literal=value=>typeof value==='number'?String(value):"'"+value.replaceAll("'","''")+"'";
export function evaluateDestination(fixture) {
  const db=new DatabaseSync(':memory:');
  try {
    // Only PostgreSQL dialect/built-ins are adapted. Membership joins, recursive
    // traversal, inventory, classification, counters and GO/NO-GO are unchanged.
    let query=statements(readFileSync(new URL('02_preflight_calidad.sql',import.meta.url),'utf8'))
      .find(sql=>sql.startsWith('WITH RECURSIVE'));
    const ctes=Object.entries(definitions).map(([name,columns])=>{
      const rows=fixture[name];
      return `${name}(${columns.join(',')}) AS (${rows.length
        ?'VALUES '+rows.map(row=>'('+row.map(literal).join(',')+')').join(',')
        :'SELECT '+columns.map(()=>'NULL').join(',')+' WHERE false'})`;
    });
    query=query.replace(/^WITH RECURSIVE /,`WITH RECURSIVE ${ctes.join(',')}, `)
      .replace(/'(pg_\w+)'::regclass(?:::oid)?/g,(_,catalog)=>String(catalogs[catalog]))
      .replace(/p\.oid::regprocedure::text/g,'regprocedure(p.oid)')
      .replace(/::(?:text|jsonb)\b/g,'')
      .replace(/n\.nspname !~ '([^']+)'/g,"NOT regexp('$1',n.nspname)")
      .replace(/SELECT FROM /g,'SELECT 1 FROM ')
      .replace(/,current_user,/g,',current_user(),')
      .replace(/to_jsonb\((classified_objects|application_objects)\)/g,(_,alias)=>{
        const columns=['classid','objid','kind','schema','name','extension_oid','extension','extension_schema','extension_version'];
        return 'jsonb_build_object('+columns.flatMap(column=>[literal(column),`${alias}.${column}`]).join(',')+')';
      });
    db.function('jsonb_build_object',{varargs:true},(...args)=>JSON.stringify(Object.fromEntries(
      Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]))));
    db.function('regexp',(pattern,value)=>Number(new RegExp(pattern).test(value)));
    db.function('regprocedure',oid=>'public.'+fixture.pg_proc.find(p=>p[0]===oid)[1]+'()');
    db.function('to_regclass',name=>fixture.pg_class.find(c=>
      fixture.pg_namespace.find(n=>n[0]===c[2])[1]+'.'+c[1]===name)?.[0]??null);
    db.function('current_database',()=> 'calidad');
    db.function('current_setting',name=>name==='server_version'?'16.15':'UTC');
    db.function('current_user',()=> 'fixture_user');
    db.function('host',value=>value);
    db.function('inet_server_addr',()=>null);
    db.function('inet_server_port',()=>null);
    return db.prepare(query).all().map(row=>({check:row.CHECK,status:row.ESTADO,detail:JSON.parse(row.DETALLE)}));
  } finally { db.close(); }
}
