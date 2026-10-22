// Parse native dump metadata only. Never execute setval or connect to PostgreSQL.
export function parseArchiveSequences(sql,names) {
  const allowed=new Set(names),result=[];
  if(allowed.size!==names.length) throw new Error('SEQUENCE_SCOPE_DUPLICATE');
  const pattern=/\bSELECT\s+pg_catalog\.setval\(\s*'([^']+)'\s*,\s*(-?\d+)\s*,\s*(true|false)\s*\)\s*;/gi;
  for(const match of sql.matchAll(pattern)) {
    if(!allowed.has(match[1]) || result.some(r=>r.name===match[1])) throw new Error('ARCHIVE_SEQUENCE_SCOPE');
    result.push({name:match[1],last_value:match[2],is_called:match[3].toLowerCase()==='true'});
  }
  if(result.length!==allowed.size || (sql.match(/\bsetval\s*\(/gi)||[]).length!==result.length) throw new Error('ARCHIVE_SEQUENCE_STATES_INCOMPLETE');
  return result.sort((a,b)=>a.name.localeCompare(b.name));
}
export function archiveSequenceDifferences(actual,receipt,snapshot,expectedNames) {
  if(receipt?.snapshot_id!==snapshot.snapshot_id || receipt.backup_sha256!==snapshot.backup_sha256
    || !Array.isArray(receipt.sequences)) throw new Error('ARCHIVE_SEQUENCE_RECEIPT_REQUIRED');
  const expected=new Map();
  for(const row of receipt.sequences) {
    if(!expectedNames.includes(row.name)||expected.has(row.name)||!/^\-?\d+$/.test(row.last_value)
      ||typeof row.is_called!=='boolean') throw new Error('ARCHIVE_SEQUENCE_RECEIPT_INVALID');
    expected.set(row.name,row);
  }
  if(expected.size!==expectedNames.length) throw new Error('ARCHIVE_SEQUENCE_RECEIPT_INCOMPLETE');
  return [...new Set([...expected.keys(),...actual.map(r=>r.name)])].filter(name=>{
    const left=expected.get(name),right=actual.find(r=>r.name===name);
    return !left||!right||left.last_value!==right.last_value||left.is_called!==right.is_called;
  });
}
