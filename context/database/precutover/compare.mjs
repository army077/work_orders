import { VERSION, TABLES, REQUIRED, MASTERS, RELATIONSHIPS, DATABASES, LIMITATIONS, SEED_SHA256 } from './scope.mjs';
import { sameBusinessShape, referenceColumnAvailable } from './sql.mjs';

export function statusOf(checks) {
    return checks.some(c => c.status === 'NO-GO') ? 'NO-GO' : checks.some(c => c.status === 'WARNING') ? 'WARNING' : 'PASS';
}
const sorted = ids => [...ids].sort((a,b) => BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
const sample = (ids, limit) => { const values=sorted(ids); return {count:String(values.length),ids:values.slice(0,limit),truncated:values.length>limit}; };
const rowIds = table => new Set((table?.rows ?? []).filter(r => r.id !== null).map(r => r.id));
const relationKey = r => JSON.stringify([r.child,r.columns,r.parent,r.parentColumns]);

function tableSummary(capture,name) {
    const table = capture.tables[name];
    if (!table) return {exists:null,status:'NO-GO',checks:[{check:'capture',status:'NO-GO',code:'NOT_INSPECTED'}],count:null,
        primaryKey:null,minId:null,maxId:null,sequences:[],structure:null,foreignKeys:[]};
    const checks=[...table.checks];
    const sequences=table.sequences.map(s => ({...s}));
    checks.push(...sequences.map(s=>({check:'sequence:' + s.name,status:s.status,code:s.code})));
    if (table.exists && (table.counts === null || table.rows === null)) checks.push({check:'coverage',status:'NO-GO',code:'INCOMPLETE_TABLE_INSPECTION'});
    return {exists:table.exists,status:statusOf(checks),checks,count:table.counts?.count??null,
        primaryKey:table.primaryKey,minId:table.counts?.minId??null,maxId:table.counts?.maxId??null,
        duplicateKeys:table.counts?.duplicateKeys??null,nullKeys:table.counts?.nullKeys??null,publishedCount:table.counts?.publishedCount??null,sequences,
        structure:table.exists?{kind:table.kind,rls:table.rls,inheritance:table.inheritance,columns:table.columns,
            constraints:table.constraints,indexes:table.indexes,triggers:table.triggers}:null,
        foreignKeys:capture.relations.filter(r=>r.kind==='FK'&&r.child===name).map(r=>({...r}))};
}

function comparison(name,left,right,sampleLimit) {
    if (!left?.exists || !right?.exists) return {table:name,status:(!left||!right)?'NO-GO':'WARNING',code:'TABLE_ABSENT_OR_UNAVAILABLE',
        structure:null,rowsComparable:false,potentialIdConflicts:null,sourceOnly:null,destinationOnly:null};
    const sequenceDefinition = t => t.sequences.map(s => ({name:s.name,schema:s.schema,column:s.column,increment:s.increment,
        minimum:s.minimum,maximum:s.maximum,cache:s.cache,cycle:s.cycle}));
    const project = t => ({columns:t.columns,primaryKey:t.primaryKey,constraints:t.constraints,indexes:t.indexes,triggers:t.triggers,sequences:sequenceDefinition(t)});
    const shape=JSON.stringify(project(left))===JSON.stringify(project(right));
    const businessShape=sameBusinessShape(left,right);
    const structure={equal:shape,businessComparable:businessShape,
        sourceOnlyColumns:left.columns.filter(c=>!right.columns.some(d=>d.name===c.name)).map(c=>c.name),
        destinationOnlyColumns:right.columns.filter(c=>!left.columns.some(d=>d.name===c.name)).map(c=>c.name),
        changedColumns:left.columns.filter(c=>right.columns.some(d=>d.name===c.name&&JSON.stringify(c)!==JSON.stringify(d))).map(c=>c.name),
        primaryKeyEqual:JSON.stringify(left.primaryKey)===JSON.stringify(right.primaryKey),
        constraintsEqual:JSON.stringify(left.constraints)===JSON.stringify(right.constraints),
        indexesEqual:JSON.stringify(left.indexes)===JSON.stringify(right.indexes),triggersEqual:JSON.stringify(left.triggers)===JSON.stringify(right.triggers),
        sequenceDefinitionsEqual:JSON.stringify(sequenceDefinition(left))===JSON.stringify(sequenceDefinition(right))};
    if (!businessShape || !left.rows || !right.rows) return {table:name,status:'NO-GO',code:!businessShape?'BUSINESS_STRUCTURE_DIFFERENT':'ROWS_NOT_AVAILABLE',
        structure,rowsComparable:false,potentialIdConflicts:null,sourceOnly:null,destinationOnly:null};
    const a=new Map(left.rows.map(r=>[r.keyHash,r])),b=new Map(right.rows.map(r=>[r.keyHash,r]));
    const sourceOnly=[],destinationOnly=[],conflicts=[],metadataOnly=[];
    let sourceCount=0,destinationCount=0,conflictCount=0,metadataCount=0,shared=0;
    for (const [key,row] of a) {
        const peer=b.get(key);
        if (!peer) {sourceCount++;if(row.id!==null)sourceOnly.push(row.id);continue;}
        shared++;
        if(row.businessHash!==peer.businessHash){conflictCount++;if(row.id!==null)conflicts.push(row.id);}
        else if(row.fullHash!==peer.fullHash){metadataCount++;if(row.id!==null)metadataOnly.push(row.id);}
    }
    for (const [key,row] of b) if(!a.has(key)){destinationCount++;if(row.id!==null)destinationOnly.push(row.id);}
    const observed=(count,ids)=>({...sample(new Set(ids),sampleLimit),count:String(count),technicalIdsAvailable:count===ids.length});
    return {table:name,status:conflictCount?'NO-GO':(!shape||sourceCount||destinationCount||metadataCount)?'WARNING':'PASS',
        code:conflictCount?'SAME_KEY_DIFFERENT_BUSINESS_CONTENT':(!shape||sourceCount||destinationCount||metadataCount)?'DIFFERENCES_REQUIRE_REVIEW':'NO_OBSERVED_DIFFERENCES',
        structure,rowsComparable:true,sharedKeys:String(shared),sourceOnly:observed(sourceCount,sourceOnly),destinationOnly:observed(destinationCount,destinationOnly),
        potentialIdConflicts:observed(conflictCount,conflicts),recreatedMetadataOnly:observed(metadataCount,metadataOnly),
        interpretation:'Coincidencia de PK no prueba identidad de negocio; ausencia no prueba baja ni alta posterior al snapshot.'};
}

function referenceCoverage(source,destination,seedIds,sampleLimit) {
    return RELATIONSHIPS.map(relation=>{
        const child=source.tables[relation.child],parent=destination.tables[relation.parent];
        const base={child:relation.child,columns:relation.columns,parent:relation.parent,parentColumns:relation.parentColumns,
            kind:'CROSS_DATABASE_APPLICATION_COVERAGE',actualForeignKeyInSource:source.relations.some(r=>r.kind==='FK'&&relationKey(r)===relationKey(relation))};
        if (child?.exists===false) return {...base,status:REQUIRED.source.includes(relation.child)?'NO-GO':'WARNING',code:'SOURCE_CHILD_ABSENT',missingReferences:null};
        if (!child?.rows || !referenceColumnAvailable(child,relation.columns[0])) return {...base,status:'NO-GO',code:'SOURCE_REFERENCES_UNAVAILABLE',missingReferences:null};
        const refs=child.rows.map(r=>r.refs[relation.columns[0]]).filter(v=>v!==null);
        if (!parent?.rows || !referenceColumnAvailable(parent,'id')) return {...base,status:refs.length?'NO-GO':'WARNING',
            code:'DESTINATION_PARENT_UNAVAILABLE',missingReferences:null,sourceReferencingRows:String(refs.length)};
        const ids=rowIds(parent),missing=refs.filter(id=>!ids.has(id));
        const outsideSeed=seedIds[relation.parent]?refs.filter(id=>!seedIds[relation.parent].has(id)):null;
        return {...base,status:missing.length?'NO-GO':'PASS',code:missing.length?'SOURCE_REFERENCES_MISSING_IN_DESTINATION':'COVERED',
            sourceReferencingRows:String(refs.length),missingRowReferences:String(missing.length),missingReferences:sample(new Set(missing),sampleLimit),
            referencesOutsideSeed:outsideSeed?{rows:String(outsideSeed.length),...sample(new Set(outsideSeed),sampleLimit)}:null};
    });
}

function seedCoverage(capture,seedIds,sampleLimit) {
    return MASTERS.map(name=>{
        const table=capture.tables[name];
        if (!table?.rows || !referenceColumnAvailable(table,'id')) return {table:name,status:'NO-GO',code:'SEED_COVERAGE_UNAVAILABLE',missingSeedIds:null,outsideSeedIds:null};
        const ids=rowIds(table),baseline=seedIds[name];
        const missing=new Set([...baseline].filter(id=>!ids.has(id))),outside=new Set([...ids].filter(id=>!baseline.has(id)));
        return {table:name,status:missing.size||outside.size?'WARNING':'PASS',code:missing.size||outside.size?'SEED_SCOPE_DIFFERENT':'SEED_IDS_PRESENT',
            baselineCount:String(baseline.size),missingSeedIds:sample(missing,sampleLimit),outsideSeedIds:sample(outside,sampleLimit)};
    });
}

export function buildReport(source,destination,seedIds,{sampleLimit=20,startedAt=new Date().toISOString(),durationMs=0}={}) {
    const captures={source,destination};
    const tables=TABLES.map(name=>({table:name,source:tableSummary(source,name),destination:tableSummary(destination,name)}));
    const comparisons=TABLES.map(name=>comparison(name,source.tables[name],destination.tables[name],sampleLimit));
    const configurationComparisons=comparisons.filter(c=>MASTERS.includes(c.table));
    const dependencies={source:source.relations,destination:destination.relations,crossDatabase:referenceCoverage(source,destination,seedIds,sampleLimit)};
    const seed={sha256:SEED_SHA256,capturedAt:'2026-10-23T22:02:20.831481+00:00',originalPublishedTemplates:54,selectedTemplates:51,
        excludedTemplateIdsKnown:false,comparisonMode:'ID_MEMBERSHIP_ONLY',source:seedCoverage(source,seedIds,sampleLimit),destination:seedCoverage(destination,seedIds,sampleLimit)};
    const checks=[...source.checks,...destination.checks,...tables.flatMap(t=>[...t.source.checks,...t.destination.checks]),
        ...comparisons,...dependencies.source,...dependencies.destination,...dependencies.crossDatabase,...seed.source,...seed.destination];
    for(const side of ['source','destination']) if(!captures[side].complete) checks.push({check:side+'_capture',status:'NO-GO',code:'INCOMPLETE_CAPTURE'});
    const counts={PASS:0,WARNING:0,'NO-GO':0};for(const c of checks)counts[c.status]++;
    const totalRows=side=>{
        const available=tables.map(t=>t[side].count).filter(n=>n!==null);
        return {observedRows:available.reduce((n,c)=>n+BigInt(c),0n).toString(),tablesCounted:available.length,
            unavailableTables:tables.filter(t=>t[side].exists!==false&&t[side].count===null).map(t=>t.table)};
    };
    return {inventoryVersion:VERSION,mode:'READ_ONLY_INVENTORY',startedAt,completedAt:new Date().toISOString(),durationMs,
        status:statusOf(checks),migrationAuthorized:false,atomicAcrossDatabases:false,
        environments:Object.fromEntries(Object.entries(captures).map(([side,c])=>[side,{database:DATABASES[side],identity:c.identity,
            startedAt:c.startedAt,completedAt:c.completedAt,durationMs:c.durationMs,complete:c.complete,checks:c.checks}])),
        totals:{tables:TABLES.length,checks:counts,source:totalRows('source'),destination:totalRows('destination')},
        tables,comparisons,configurationComparisons,dependencies,seed,limits:{sampleLimit},limitations:LIMITATIONS};
}

export function readableSummary(report) {
    const lines=[`Inventario pre-cutover v${report.inventoryVersion}`,`Estado: ${report.status}; migracion autorizada: NO`,
        `Inicio: ${report.startedAt}; duracion: ${report.durationMs} ms`,
        `Comprobaciones PASS=${report.totals.checks.PASS} WARNING=${report.totals.checks.WARNING} NO-GO=${report.totals.checks['NO-GO']}`,
        '', 'Tabla | Origen existe/filas | Destino existe/filas | Comparacion'];
    for(const t of report.tables) {
        const cell=s=>`${s.exists===null?'NO VERIFICADO':s.exists?'SI':'NO'}/${s.count??'NO VERIFICADO'}`;
        lines.push(`${t.table} | ${cell(t.source)} | ${cell(t.destination)} | ${report.comparisons.find(c=>c.table===t.table).status}`);
    }
    lines.push('','Pendientes y diferencias:');
    for(const side of ['source','destination'])for(const c of report.environments[side].checks)if(c.status!=='PASS')lines.push(`${side}: ${c.status} ${c.code}`);
    for(const t of report.tables)for(const side of ['source','destination'])for(const c of t[side].checks)if(c.status!=='PASS')lines.push(`${side}.${t.table}: ${c.status} ${c.check} ${c.code}`);
    for(const c of report.comparisons)if(c.status!=='PASS')lines.push(`${c.table}: ${c.status} ${c.code}; solo_origen=${c.sourceOnly?.count??'NO VERIFICADO'}; solo_destino=${c.destinationOnly?.count??'NO VERIFICADO'}; conflictos=${c.potentialIdConflicts?.count??'NO VERIFICADO'}`);
    for(const [side,relations]of Object.entries(report.dependencies))for(const r of relations)if(r.status!=='PASS')lines.push(`${side} ${r.child??'fuera_de_alcance'} -> ${r.parent??'fuera_de_alcance'}: ${r.status} ${r.code}`);
    for(const side of ['source','destination'])for(const c of report.seed[side])if(c.status!=='PASS')lines.push(`${side}.${c.table}: ${c.status} ${c.code}; IDs_seed_ausentes=${c.missingSeedIds?.count??'NO VERIFICADO'}; IDs_fuera_seed=${c.outsideSeedIds?.count??'NO VERIFICADO'}`);
    const templates=report.tables.find(t=>t.table==='maintenance_template');
    lines.push(`Plantillas publicadas actuales: origen=${templates.source.publishedCount??'NO VERIFICADO'}; destino=${templates.destination.publishedCount??'NO VERIFICADO'}; referencia historica=54 publicadas/51 seleccionadas.`);
    lines.push('','Limitaciones:',...report.limitations.map(s=>'- '+s));
    return lines.join('\n')+'\n';
}
