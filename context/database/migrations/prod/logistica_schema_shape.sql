WITH settings AS (SELECT $1::text AS ns),
names(name) AS (VALUES
  ('logistica_authorized_users'), ('logistica_deliveries'),
  ('logistica_delivery_evidence'), ('entregas_logistica_legacy'),
  ('logistica_legacy_owner_mapping'), ('logistica_schema_migrations')),
relations AS (
  SELECT n.name, c.*, s.ns FROM names n CROSS JOIN settings s
  LEFT JOIN pg_class c ON c.oid = to_regclass(format('%I.%I', s.ns, n.name))
),
tables AS (
  SELECT r.name, CASE WHEN r.oid IS NULL THEN NULL ELSE jsonb_build_object(
    'kind', r.relkind, 'persistence', CASE
      WHEN r.relpersistence='t' AND r.ns ~ '^pg_temp_[0-9]+$' THEN 'p'
      ELSE r.relpersistence::text END,
    'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
    'columns', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
      replace(pg_get_expr(d.adbin,d.adrelid),quote_ident(r.ns)||'.','public.'),
      a.attidentity,a.attgenerated,a.attcollation::regcollation::text
    ) ORDER BY a.attnum) FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
    'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,
      replace(pg_get_constraintdef(c.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY c.conname COLLATE "C") FROM pg_constraint c WHERE c.conrelid=r.oid),'[]'::jsonb),
    'indexes', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      x.relname,i.indisvalid,i.indisready,
      replace(pg_get_indexdef(i.indexrelid),quote_ident(r.ns)||'.','public.')
    ) ORDER BY x.relname COLLATE "C") FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
      WHERE i.indrelid=r.oid),'[]'::jsonb),
    'triggers', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      t.tgname,t.tgenabled,
      replace(pg_get_triggerdef(t.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
      WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),'[]'::jsonb),
    'rules', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      w.rulename,replace(pg_get_ruledef(w.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY w.rulename COLLATE "C") FROM pg_rewrite w WHERE w.ev_class=r.oid),'[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      p.polname,p.polcmd,p.polpermissive,p.polroles::text,
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    ) ORDER BY p.polname COLLATE "C") FROM pg_policy p WHERE p.polrelid=r.oid),'[]'::jsonb),
    'inheritance', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      replace(i.inhparent::regclass::text,quote_ident(r.ns)||'.','public.'),
      replace(i.inhrelid::regclass::text,quote_ident(r.ns)||'.','public.')
    ) ORDER BY i.inhseqno) FROM pg_inherits i
      WHERE i.inhparent=r.oid OR i.inhrelid=r.oid),'[]'::jsonb)
  ) END AS detail FROM relations r
),
sequences AS (
  SELECT n.name||'_id_seq' AS name, CASE WHEN c.oid IS NULL THEN NULL ELSE
    jsonb_build_array(c.relkind,q.seqtypid::regtype::text,q.seqstart,q.seqincrement,
      q.seqmin,q.seqmax,q.seqcache,q.seqcycle,
      (SELECT jsonb_agg(jsonb_build_array(p.relname,d.refobjsubid,d.deptype)
       ORDER BY p.relname COLLATE "C") FROM pg_depend d
       JOIN pg_class p ON p.oid=d.refobjid
       WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')))
    END AS detail
  FROM names n CROSS JOIN settings s
  LEFT JOIN pg_class c ON c.oid=to_regclass(format('%I.%I',s.ns,n.name||'_id_seq'))
  LEFT JOIN pg_sequence q ON q.seqrelid=c.oid WHERE n.name<>'logistica_schema_migrations'
),
signature AS (SELECT jsonb_build_object(
  'tables',(SELECT jsonb_object_agg(name,detail) FROM tables),
  'sequences',(SELECT jsonb_object_agg(name,detail) FROM sequences),
  'mapping_functions',COALESCE((SELECT jsonb_agg(jsonb_build_array(
    p.proname,pg_get_function_identity_arguments(p.oid),p.prorettype::regtype::text,
    p.prosrc,p.prosecdef,p.provolatile,p.proconfig,l.lanname
  ) ORDER BY pg_get_function_identity_arguments(p.oid) COLLATE "C")
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang CROSS JOIN settings s
    WHERE n.nspname=s.ns AND p.proname='protect_logistica_legacy_owner_mapping'),'[]'::jsonb)
) AS shape)
SELECT encode(sha256(convert_to(shape::text,'UTF8')),'hex') AS fingerprint, shape FROM signature;
