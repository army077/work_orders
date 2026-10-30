// Explicit CLI only. Importing or --plan never loads pg or opens a connection.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DATABASES, plan } from './scope.mjs';
import { captureDatabase, loadSeedIds } from './inventory.mjs';
import { buildReport, readableSummary } from './compare.mjs';

const fail = () => { throw new Error('INVALID_EXPLICIT_CONFIGURATION'); };
export function parseOptions(args) {
    if (args.length === 1 && args[0] === '--plan') return { mode:'plan' };
    if (args[0] !== '--execute-readonly') fail();
    const allowed=new Set(['--out','--timeout-ms','--max-rows','--max-total-rows','--sample-limit']);
    const values={};
    for(let i=1;i<args.length;i+=2) {
        if(!allowed.has(args[i])||!args[i+1]||Object.hasOwn(values,args[i]))fail();
        values[args[i]]=args[i+1];
    }
    if(!values['--out']||!isAbsolute(values['--out']))fail();
    const integer=(name,defaultValue,min,max)=>{
        const raw=values[name]??String(defaultValue);
        if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)fail();
        return Number(raw);
    };
    return {mode:'execute',out:values['--out'],timeoutMs:integer('--timeout-ms',20000,1000,120000),
        maxRows:integer('--max-rows',100000,1,1000000),maxTotalRows:integer('--max-total-rows',500000,1,2000000),
        sampleLimit:integer('--sample-limit',20,1,100)};
}

export function connectionConfigs(env) {
    if(env.PRECUTOVER_READ_ONLY_ACK!=='SI')fail();
    return Object.fromEntries(Object.entries(DATABASES).map(([side,database])=>{
        const prefix=side==='source'?'PRECUTOVER_SOURCE_':'PRECUTOVER_DESTINATION_';
        const get=name=>{
            const value=env[prefix+name];
            if(typeof value!=='string'||!value.trim()||/[\u0000\r\n]/.test(value))fail();
            return value;
        };
        const host=get('PGHOST'),port=get('PGPORT'),user=get('PGUSER'),password=get('PGPASSWORD');
        if(get('PGDATABASE')!==database||!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535||!Number.isSafeInteger(Number(port)))fail();
        if(host.startsWith('/')||host.startsWith('\\')||host.includes('://')||host.includes('@'))fail();
        const mode=get('SSL_MODE');
        if(!['verify-full','disable'].includes(mode))fail();
        const ca=env[prefix+'SSL_CA_FILE'];
        if(ca&&!isAbsolute(ca))fail();
        return [side,{host,port:Number(port),user,password,database,sslMode:mode,caFile:ca??null}];
    }));
}

export function postgresClientFactory(timeoutMs) {
    const require=createRequire(new URL('../../api10/package.json',import.meta.url));
    const {Client}=require('pg');
    return config=>new Client({host:config.host,port:config.port,user:config.user,password:config.password,database:config.database,
        ssl:config.sslMode==='disable'?false:{rejectUnauthorized:true,...(config.caFile?{ca:readFileSync(config.caFile,'utf8')}:{})},
        application_name:'precutover_readonly_inventory',connectionTimeoutMillis:Math.min(timeoutMs,10000),
        query_timeout:timeoutMs+2000,
        options:`-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c lock_timeout=3000 -c idle_in_transaction_session_timeout=60000`});
}

export async function runInventory(configs,{clientFactory,seedIds,maxRows=100000,maxTotalRows=500000,timeoutMs=20000,sampleLimit=20,signal}={}) {
    // Validate both sides before constructing either client.
    for(const side of ['source','destination'])if(configs?.[side]?.database!==DATABASES[side])fail();
    for(const [value,min,max]of [[maxRows,1,1000000],[maxTotalRows,1,2000000],[timeoutMs,1000,120000],[sampleLimit,1,100]])
        if(!Number.isSafeInteger(value)||value<min||value>max)fail();
    const baseline=seedIds??loadSeedIds();
    const started=Date.now(),startedAt=new Date(started).toISOString();
    const captures=await Promise.all(['source','destination'].map(side=>captureDatabase(side,configs[side],{
        clientFactory,maxRows,maxTotalRows,timeoutMs,signal,
    })));
    const report=buildReport(captures[0],captures[1],baseline,{sampleLimit,startedAt,durationMs:Date.now()-started});
    report.limits={sampleLimit,maxRowsPerTable:maxRows,maxRowsPerDatabase:maxTotalRows,statementTimeoutMs:timeoutMs};
    return report;
}

export function writeReports(directory,report) {
    if(!isAbsolute(directory))fail();
    // An existing directory, including a symlink, is rejected; never overwrite reports.
    mkdirSync(directory,{mode:0o700});
    writeFileSync(join(directory,'inventory.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    writeFileSync(join(directory,'summary.txt'),readableSummary(report),{flag:'wx',mode:0o600});
}

export async function main(args=process.argv.slice(2),env=process.env) {
    const options=parseOptions(args);
    if(options.mode==='plan'){console.log(JSON.stringify(plan(),null,2));return;}
    const configs=connectionConfigs(env);
    const seedIds=loadSeedIds(); // Verify the approved file before opening any connection.
    const clientFactory=postgresClientFactory(options.timeoutMs);
    const controller=new AbortController();
    const stop=()=>controller.abort();
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
        const report=await runInventory(configs,{...options,clientFactory,seedIds,signal:controller.signal});
        writeReports(options.out,report);
        console.log(JSON.stringify({status:report.status,reportsWritten:true,realExecution:true,migrationAuthorized:false}));
        process.exitCode=report.status==='PASS'?0:report.status==='WARNING'?2:3;
    }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
    console.error(JSON.stringify({status:'NO-GO',code:'INVENTORY_NOT_COMPLETED',reportsConfirmed:false}));
    process.exitCode=1;
});
