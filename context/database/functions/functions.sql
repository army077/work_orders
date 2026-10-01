--move_section
$$ 
DECLARE
  v_count   int;   -- total de filas del template
  v_newpos  int;   -- posición objetivo acotada 1..N
BEGIN
  -- 0) Si no hay filas, nada que hacer
  SELECT COUNT(*) INTO v_count
  FROM template_section
  WHERE template_id = p_template_id;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  -- 1) Acota la posición objetivo al rango [1..N]
  v_newpos := GREATEST(1, LEAST(p_newpos, v_count));

  -- 2) BUMP: libera el rango 1..N para evitar colisiones del índice único
  UPDATE template_section
  SET position = position + 100000
  WHERE template_id = p_template_id;

  -- 3) Reasignación: coloca todas las filas en 1..N con el elemento movido en v_newpos
  WITH cur AS (
    SELECT id, position - 100000 AS oldpos
    FROM template_section
    WHERE template_id = p_template_id
  ),
  ordered AS (
    -- reasignamos a 1..(N-1) todos menos el movido, preservando su orden relativo
    SELECT id, ROW_NUMBER() OVER (ORDER BY oldpos) AS rn
    FROM cur
    WHERE id <> p_id
  ),
  final AS (
    -- quienes van después o igual a v_newpos se recorren +1
    SELECT id,
           CASE WHEN rn >= v_newpos THEN rn + 1 ELSE rn END AS final_pos
    FROM ordered
    UNION ALL
    -- el movido va exactamente a v_newpos
    SELECT p_id AS id, v_newpos AS final_pos
  )
  UPDATE template_section s
  SET position = f.final_pos
  FROM final f
  WHERE s.id = f.id AND s.template_id = p_template_id;

  -- 4) Normalización por si acaso (deja 1..N garantizado)
  WITH ord AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn
    FROM template_section
    WHERE template_id = p_template_id
  )
  UPDATE template_section s
  SET position = ord.rn
  FROM ord
  WHERE s.id = ord.id AND s.template_id = p_template_id;

END
 $$

--move_task
$$ 
DECLARE
  v_count  int;
  v_newpos int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM template_task
  WHERE section_id = p_section_id;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  v_newpos := GREATEST(1, LEAST(p_newpos, v_count));

  -- 1) Bump para evitar colisiones de UNIQUE(section_id, position)
  UPDATE template_task
  SET position = position + 100000
  WHERE section_id = p_section_id;

  -- 2) Reasignar todas en 1..N con la tarea movida en v_newpos
  WITH cur AS (
    SELECT id, position - 100000 AS oldpos
    FROM template_task
    WHERE section_id = p_section_id
  ),
  ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY oldpos) AS rn
    FROM cur
    WHERE id <> p_id
  ),
  final AS (
    SELECT id,
           CASE WHEN rn >= v_newpos THEN rn + 1 ELSE rn END AS final_pos
    FROM ordered
    UNION ALL
    SELECT p_id AS id, v_newpos AS final_pos
  )
  UPDATE template_task t
  SET position = f.final_pos
  FROM final f
  WHERE t.id = f.id AND t.section_id = p_section_id;

  -- 3) Normaliza por si acaso
  WITH ord AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) rn
    FROM template_task
    WHERE section_id = p_section_id
  )
  UPDATE template_task t
  SET position = ord.rn
  FROM ord
  WHERE t.id = ord.id AND t.section_id = p_section_id;

END
 $$

--move_task_inspection
$$ 
DECLARE
  v_count  int;
  v_newpos int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.template_task_inspection
  WHERE section_id = p_section_id;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  v_newpos := GREATEST(1, LEAST(p_newpos, v_count));

  -- 1) Bump temporal
  UPDATE public.template_task_inspection
  SET position = position + 100000
  WHERE section_id = p_section_id;

  -- 2) Reasignar todas en 1..N con la tarea movida en v_newpos
  WITH cur AS (
    SELECT id, position - 100000 AS oldpos
    FROM public.template_task_inspection
    WHERE section_id = p_section_id
  ),
  ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY oldpos) AS rn
    FROM cur
    WHERE id <> p_id
  ),
  final AS (
    SELECT id,
           CASE WHEN rn >= v_newpos THEN rn + 1 ELSE rn END AS final_pos
    FROM ordered
    UNION ALL
    SELECT p_id AS id, v_newpos AS final_pos
  )
  UPDATE public.template_task_inspection t
  SET position = f.final_pos
  FROM final f
  WHERE t.id = f.id
    AND t.section_id = p_section_id;

  -- 3) Normaliza el orden final
  WITH ord AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) rn
    FROM public.template_task_inspection
    WHERE section_id = p_section_id
  )
  UPDATE public.template_task_inspection t
  SET position = ord.rn
  FROM ord
  WHERE t.id = ord.id
    AND t.section_id = p_section_id;
END;
 $$