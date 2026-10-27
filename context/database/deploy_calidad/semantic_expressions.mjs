// Offline authoring. Conservative expression ASTs, never SQL execution.
// Only the expression grammar used by this baseline is accepted. Unknown syntax
// fails closed. Literals, operator precedence and Boolean grouping are retained.
export const tokenPattern = String.raw`'(?:''|[^'])*'|"(?:""|[^"])*"|::|!~\*|!~|~\*|<>|!=|<=|>=|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|[^[:space:]]`;
const jsPattern = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|::|!~\*|!~|~\*|<>|!=|<=|>=|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|\S/g;
const builtins=['btrim','now','jsonb_typeof','isfinite','nextval'];
export function tokens(sql) {
 return (sql??'NULL').match(jsPattern).filter(t=>!t.startsWith('--')).map(t=>t.startsWith("'")?t:t.startsWith('"')?t.slice(1,-1).replaceAll('""','"'):t.toLowerCase());
}
export function castNode(node,type) {
 if(type==='regclass'&&node[0]==='string')return ['regclass',node[1].includes('.')?node[1]:'public.'+node[1]];
 const baseType=type.replace(/ \( \d+(?: , \d+)? \)$/,'');
 if(node[0]==='null'&&['text','character varying','jsonb','boolean','integer','bigint','numeric','double precision','timestamp with time zone','timestamp without time zone'].includes(baseType))return node;
 const varchar=type.match(/^character varying \( (\d+) \)$/);
 if(node[0]==='string'&&varchar&&[...node[1]].length<=Number(varchar[1]))return node;
 if(node[0]==='string'&&['text','character varying','jsonb'].includes(type))return node;
 if(type==='boolean') {
  if(node[0]==='boolean')return node;
  if(node[0]==='string'&&['true','false'].includes(node[1]))return ['boolean',node[1]];
 }
 if(['string','number'].includes(node[0])&&/^-?\d+(?:\.\d+)?$/.test(node[1])) {
  if(type==='numeric')return ['number',node[1]];
  if(/^-?\d+$/.test(node[1])) {
   const n=BigInt(node[1]),limit={integer:2147483647n,bigint:9223372036854775807n,'double precision':9007199254740991n}[type];
   if(limit!==undefined&&n>=-limit&&n<=limit)return ['number',node[1]];
  }
 }
 return ['cast',type,node];
}
export function combine(op,children) {
 if(['and','or'].includes(op))return [op,...children.flatMap(c=>c[0]===op?c.slice(1):[c])];
 if(op==='='&&children[1]?.[0]==='any')return ['in',children[0],children[1][1]];
 return [op,...children];
}
export function canonicalExpression(sql) {
 const t=tokens(sql); if(t[0]==='check')t.shift();
 function parse(lo,hi) {
  if(lo>hi)throw Error('EMPTY_EXPRESSION');
  let depth=0,top=[],wrap=false;
  for(let i=lo;i<=hi;i++) {
   if(depth===0)top.push(i);
   if(['(','['].includes(t[i]))depth++;
   if([')',']'].includes(t[i]))depth--;
   if(depth===0&&i===hi&&t[lo]==='(')wrap=true;
   if(depth===0&&i<hi&&t[lo]==='(')wrap=false;
   if(depth<0)throw Error('UNBALANCED_EXPRESSION');
  }
  if(depth!==0)throw Error('UNBALANCED_EXPRESSION');
  if(t[lo]==='('&&top.length===1&&wrap)return parse(lo+1,hi-1);
  if(top.some(i=>t[i]===','))return args('list',lo,hi);
  const between=top.find(i=>t[i]==='between');
  const betweenAnd=between===undefined?undefined:top.find(i=>i>between&&t[i]==='and');
  for(const ops of [['or'],['and'],['=','<>','!=','<','>','<=','>=','~','!~','~*','!~*','in','between','is']]) {
   const p=top.filter(i=>ops.includes(t[i])&&i!==betweenAnd).at(-1);
   if(p===undefined)continue;
   const op=t[p];
   if(op==='between')return combine('and',[['>=',parse(lo,p-1),parse(p+1,betweenAnd-1)],['<=',parse(lo,p-1),parse(betweenAnd+1,hi)]]);
   if(op==='is'&&t[hi]==='null'&&(hi===p+1||(hi===p+2&&t[p+1]==='not')))return [hi===p+1?'is_null':'is_not_null',parse(lo,p-1)];
   if(op==='is')throw Error('UNSUPPORTED_IS');
   return combine(op==='!='?'<>':op,[parse(lo,p-1),parse(p+1,hi)]);
  }
  if(t[lo]==='not')return ['not',parse(lo+1,hi)];
  const cast=top.filter(i=>t[i]==='::').at(-1);
  if(cast!==undefined)return castNode(parse(lo,cast-1),t.slice(cast+1,hi+1).join(' ').replace(/^pg_catalog \. /,''));
  if(t[lo]==='-'&&lo+1===hi&&/^\d/.test(t[hi]))return ['number','-'+t[hi]];
  if(t[lo]==='array'&&t[lo+1]==='['&&t[hi]===']')return args('list',lo+2,hi-1);
  if(t[lo]==='('&&t[hi]===')')return args('list',lo+1,hi-1);
  let start=lo,fn=t[lo];
  if(t[lo+1]==='.'&&t[lo]==='pg_catalog'&&builtins.includes(t[lo+2])){start+=2;fn=t[start];}
  if(t[start+1]==='('&&t[hi]===')'&&/^[a-z_][a-z_0-9]*$/.test(fn))return args(fn,start+2,hi-1);
  if(lo!==hi)throw Error('UNSUPPORTED_EXPRESSION:'+t.slice(lo,hi+1).join(' '));
  if(t[lo].startsWith("'"))return ['string',t[lo].slice(1,-1).replaceAll("''", "'")];
  if(/^\d+(?:\.\d+)?$/.test(t[lo]))return ['number',t[lo]];
  if(t[lo]==='null')return ['null'];
  if(['true','false'].includes(t[lo]))return ['boolean',t[lo]];
  if(/^[a-z_][a-z_0-9]*$/.test(t[lo]))return ['name',t[lo]];
  throw Error('UNSUPPORTED_ATOM');
 }
 function args(op,lo,hi) {
  if(lo>hi)return [op];
  let depth=0,start=lo,children=[];
  for(let i=lo;i<=hi;i++) {
   if(t[i]===','&&depth===0){children.push(parse(start,i-1));start=i+1;}
   if(['(','['].includes(t[i]))depth++;if([')',']'].includes(t[i]))depth--;
  }
  children.push(parse(start,hi));return [op,...children];
 }
 return parse(0,t.length-1);
}

const lit=s=>"'"+s.replaceAll("'","''")+"'";
export function expressionInputs(model) {
 const result=[];
 for(const t of model.tables) {
  for(const c of t.columns)result.push({key:'DEFAULT:'+t.name+'.'+c.name,kind:'default',table:t.name,name:c.name,expected:canonicalExpression(c.serial?`nextval('public.${t.name}_${c.name}_seq'::regclass)`:c.default)});
  for(const c of t.constraints.filter(c=>c.type==='c'))result.push({key:'CHECK:'+t.name+'.'+c.name,kind:'check',table:t.name,name:c.name,expected:canonicalExpression(c.definition)});
 }
 for(const i of model.semanticIndexes)result.push({key:'PREDICATE:'+i.name,kind:'predicate',name:i.name,expected:canonicalExpression(i.predicate)});
 return result;
}

// Anonymous PL/pgSQL only: no helper functions, temp tables, DDL or writes.
// The stack parser below implements the same fail-closed grammar as the authoring
// parser. Both sides compare JSONB ASTs, not the textual rendering of pg_get_*.
export function expressionGuard(model) {
 const inputs=expressionInputs(model);
 return `DO $semantic_expressions$
DECLARE
 rec record; t text[]; work jsonb; frame jsonb; vals jsonb; node jsonb; children jsonb; child jsonb;
 lo int; hi int; dep int; j int; p int; bp int; ba int; cp int; start_at int; fn_at int;
 tops int[]; spans jsonb; op text; type_name text; raw text; argc int;
BEGIN
 FOR rec IN
  WITH expected AS (SELECT value AS e FROM jsonb_array_elements(${lit(JSON.stringify(inputs))}::jsonb))
  SELECT e,CASE e->>'kind'
   WHEN 'default' THEN (SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass('public.'||(e->>'table')) AND a.attname=e->>'name' AND NOT a.attisdropped)
   WHEN 'check' THEN (SELECT pg_get_expr(c.conbin,c.conrelid,true) FROM pg_constraint c WHERE c.conrelid=to_regclass('public.'||(e->>'table')) AND c.conname=e->>'name')
   WHEN 'predicate' THEN (SELECT pg_get_expr(i.indpred,i.indrelid,true) FROM pg_index i WHERE i.indexrelid=to_regclass('public.'||(e->>'name')))
  END AS actual FROM expected
 LOOP
  SELECT array_agg(CASE WHEN left(m[1],1)='''' THEN m[1]
    WHEN left(m[1],1)='"' THEN replace(substr(m[1],2,length(m[1])-2),'""','"') ELSE lower(m[1]) END ORDER BY n)
   INTO t FROM regexp_matches(coalesce(rec.actual,'NULL'),${lit(tokenPattern)},'g') WITH ORDINALITY x(m,n);
  work:=jsonb_build_array(jsonb_build_object('lo',1,'hi',cardinality(t))); vals:='[]'::jsonb;
  WHILE jsonb_array_length(work)>0 LOOP
   frame:=work->-1; work:=work-(-1);
   IF frame ? 'op' THEN
    op:=frame->>'op'; argc:=(frame->>'argc')::int; children:='[]'::jsonb;
    IF argc>0 THEN
     FOR j IN REVERSE argc..1 LOOP children:=jsonb_build_array(vals->-1)||children; vals:=vals-(-1); END LOOP;
    END IF;
    IF op IN ('and','or') THEN
     node:=jsonb_build_array(op);
     FOR child IN SELECT value FROM jsonb_array_elements(children) LOOP
      IF child->>0=op THEN node:=node||(child-0); ELSE node:=node||jsonb_build_array(child); END IF;
     END LOOP;
    ELSIF op='=' AND children->1->>0='any' THEN node:=jsonb_build_array('in',children->0,children->1->1);
    ELSIF op='cast' THEN
     node:=children->0; type_name:=frame->>'type';
     IF type_name='regclass' AND node->>0='string' THEN
      SELECT jsonb_build_array('regclass','public.'||c.relname) INTO node FROM pg_class c WHERE c.oid=to_regclass(node->>1) AND c.relnamespace='public'::regnamespace;
      IF node IS NULL THEN RAISE EXCEPTION 'SEMANTIC_SEQUENCE_REFERENCE_DRIFT'; END IF;
     ELSIF node->>0='null' AND regexp_replace(type_name,' [(] [0-9]+( , [0-9]+)? [)]$','') IN ('text','character varying','jsonb','boolean','integer','bigint','numeric','double precision','timestamp with time zone','timestamp without time zone') THEN NULL;
     ELSIF node->>0='string' AND type_name ~ '^character varying [(] [0-9]+ [)]$' AND char_length(node->>1)<=substring(type_name FROM '[0-9]+')::numeric THEN NULL;
     ELSIF node->>0='string' AND type_name IN ('text','character varying','jsonb') THEN NULL;
     ELSIF type_name='boolean' AND node->>0='boolean' THEN NULL;
     ELSIF type_name='boolean' AND node->>0='string' AND node->>1 IN ('true','false') THEN node:=jsonb_build_array('boolean',node->>1);
     ELSIF node->>0 IN ('string','number') AND node->>1 ~ '^-?[0-9]+([.][0-9]+)?$' AND type_name='numeric' THEN node:=jsonb_build_array('number',node->>1);
     ELSIF node->>0 IN ('string','number') AND node->>1 ~ '^-?[0-9]+$' AND type_name IN ('integer','bigint','double precision')
      AND abs((node->>1)::numeric)<=CASE type_name WHEN 'integer' THEN 2147483647::numeric WHEN 'bigint' THEN 9223372036854775807::numeric ELSE 9007199254740991::numeric END THEN node:=jsonb_build_array('number',node->>1);
     ELSE node:=jsonb_build_array('cast',type_name,node); END IF;
    ELSE node:=jsonb_build_array(op)||children;
    END IF;
    vals:=vals||jsonb_build_array(node); CONTINUE;
   END IF;
   lo:=(frame->>'lo')::int; hi:=(frame->>'hi')::int;
   IF lo>hi THEN RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNSUPPORTED: %',rec.e->>'key'; END IF;
   dep:=0; tops:=ARRAY[]::int[];
   FOR j IN lo..hi LOOP
    IF dep=0 THEN tops:=array_append(tops,j); END IF;
    IF t[j] IN ('(','[') THEN dep:=dep+1; ELSIF t[j] IN (')',']') THEN dep:=dep-1; END IF;
    IF dep<0 THEN RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNBALANCED'; END IF;
   END LOOP;
   IF dep<>0 THEN RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNBALANCED'; END IF;
   IF t[lo]='(' AND cardinality(tops)=1 THEN work:=work||jsonb_build_array(jsonb_build_object('lo',lo+1,'hi',hi-1)); CONTINUE; END IF;
   bp:=NULL; ba:=NULL; cp:=NULL;
   FOREACH j IN ARRAY tops LOOP
    IF t[j]='between' THEN bp:=j; ELSIF bp IS NOT NULL AND ba IS NULL AND t[j]='and' THEN ba:=j; END IF;
    IF t[j]='::' THEN cp:=j; END IF;
   END LOOP;
   p:=NULL;
   FOREACH op IN ARRAY ARRAY['or','and','comparison'] LOOP
    FOREACH j IN ARRAY tops LOOP
     IF (op IN ('or','and') AND t[j]=op AND j IS DISTINCT FROM ba)
      OR (op='comparison' AND t[j] IN ('=','<>','!=','<','>','<=','>=','~','!~','~*','!~*','in','between','is')) THEN p:=j; END IF;
    END LOOP;
    EXIT WHEN p IS NOT NULL;
   END LOOP;
   IF p IS NOT NULL THEN
    op:=t[p]; spans:='[]'::jsonb;
    IF op='between' THEN
     IF ba IS NULL THEN RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNSUPPORTED'; END IF;
     -- Expand BETWEEN to the same ordered AND AST emitted by PostgreSQL.
     work:=work||jsonb_build_array(jsonb_build_object('op','and','argc',2),jsonb_build_object('op','<=','argc',2),jsonb_build_object('lo',ba+1,'hi',hi),jsonb_build_object('lo',lo,'hi',p-1),jsonb_build_object('op','>=','argc',2),jsonb_build_object('lo',p+1,'hi',ba-1),jsonb_build_object('lo',lo,'hi',p-1));
     CONTINUE;
    ELSIF op='is' THEN
     IF t[hi]<>'null' OR NOT (hi=p+1 OR (hi=p+2 AND t[p+1]='not')) THEN RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNSUPPORTED'; END IF;
     work:=work||jsonb_build_array(jsonb_build_object('op',CASE WHEN hi=p+1 THEN 'is_null' ELSE 'is_not_null' END,'argc',1),jsonb_build_object('lo',lo,'hi',p-1)); CONTINUE;
    END IF;
    work:=work||jsonb_build_array(jsonb_build_object('op',CASE WHEN op='!=' THEN '<>' ELSE op END,'argc',2),jsonb_build_object('lo',p+1,'hi',hi),jsonb_build_object('lo',lo,'hi',p-1)); CONTINUE;
   END IF;
   IF t[lo]='not' THEN work:=work||jsonb_build_array(jsonb_build_object('op','not','argc',1),jsonb_build_object('lo',lo+1,'hi',hi)); CONTINUE; END IF;
   IF cp IS NOT NULL THEN
    type_name:=array_to_string(t[cp+1:hi],' '); type_name:=regexp_replace(type_name,'^pg_catalog [.] ','');
    work:=work||jsonb_build_array(jsonb_build_object('op','cast','argc',1,'type',type_name),jsonb_build_object('lo',lo,'hi',cp-1)); CONTINUE;
   END IF;
   IF t[lo]='-' AND lo+1=hi AND t[hi] ~ '^[0-9]' THEN vals:=vals||jsonb_build_array(jsonb_build_array('number','-'||t[hi])); CONTINUE; END IF;
   fn_at:=lo; op:=NULL;
   IF t[lo]='pg_catalog' AND t[lo+1]='.' AND t[lo+2] IN ('btrim','now','jsonb_typeof','isfinite','nextval') THEN fn_at:=lo+2; END IF;
   IF EXISTS(SELECT 1 FROM unnest(tops) n WHERE t[n]=',') THEN op:='list'; start_at:=lo; hi:=hi+1;
   ELSIF t[lo]='array' AND t[lo+1]='[' AND t[hi]=']' THEN op:='list'; start_at:=lo+2;
   ELSIF t[lo]='(' AND t[hi]=')' THEN op:='list'; start_at:=lo+1;
   ELSIF t[fn_at+1]='(' AND t[hi]=')' AND t[fn_at] ~ '^[a-z_][a-z_0-9]*$' THEN op:=t[fn_at]; start_at:=fn_at+2;
   END IF;
   IF op IS NOT NULL THEN
    spans:='[]'::jsonb; dep:=0; p:=start_at;
    IF start_at<=hi-1 THEN
     FOR j IN start_at..hi-1 LOOP
      IF t[j]=',' AND dep=0 THEN spans:=spans||jsonb_build_array(jsonb_build_object('lo',p,'hi',j-1)); p:=j+1; END IF;
      IF t[j] IN ('(','[') THEN dep:=dep+1; ELSIF t[j] IN (')',']') THEN dep:=dep-1; END IF;
     END LOOP;
     spans:=spans||jsonb_build_array(jsonb_build_object('lo',p,'hi',hi-1));
    END IF;
    work:=work||jsonb_build_array(jsonb_build_object('op',op,'argc',jsonb_array_length(spans)));
    IF jsonb_array_length(spans)>0 THEN FOR j IN REVERSE jsonb_array_length(spans)-1..0 LOOP work:=work||jsonb_build_array(spans->j); END LOOP; END IF;
    CONTINUE;
   END IF;
   IF lo<>hi THEN RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNSUPPORTED: %',rec.e->>'key'; END IF;
   raw:=t[lo];
   IF left(raw,1)='''' THEN node:=jsonb_build_array('string',replace(substr(raw,2,length(raw)-2),'''''''',''''));
   ELSIF raw ~ '^[0-9]+([.][0-9]+)?$' THEN node:=jsonb_build_array('number',raw);
   ELSIF raw='null' THEN node:=jsonb_build_array('null');
   ELSIF raw IN ('true','false') THEN node:=jsonb_build_array('boolean',raw);
   ELSIF raw ~ '^[a-z_][a-z_0-9]*$' THEN node:=jsonb_build_array('name',raw);
   ELSE RAISE EXCEPTION 'SEMANTIC_EXPRESSION_UNSUPPORTED: %',rec.e->>'key'; END IF;
   vals:=vals||jsonb_build_array(node);
  END LOOP;
  IF jsonb_array_length(vals)<>1 OR vals->0 IS DISTINCT FROM rec.e->'expected' THEN
   RAISE EXCEPTION 'SEMANTIC_EXPRESSION_DRIFT: %',rec.e->>'key';
  END IF;
 END LOOP;
END; $semantic_expressions$;`;
}
