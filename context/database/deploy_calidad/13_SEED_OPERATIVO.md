# Configuración operativa de calidad

**EXPORT_CONFIG_PROD_RECIBIDO = SI.** El usuario entregó el JSON real autorizado
y el query adaptado realmente ejecutado. La etiqueta heredada
status=PENDIENTE_EXPORT_CONFIG_PROD no implica que falte otro export.
No pedir acceso, otra consulta ni nuevas credenciales.

El seed definitivo contiene 1.139 filas exclusivamente maestras: 8 familias,
37 modelos, 51 plantillas, 155 secciones, 869 tareas, 2 puntos de inspección y
17 técnicos activos. Conserva IDs y relaciones originales; no inserta personas
ajenas al export. La fuente sin alterar, hashes, recibo y revisión detallada
están en [16_SEED_PROD_VALIDADO_OFFLINE.md](16_SEED_PROD_VALIDADO_OFFLINE.md).

Las tres plantillas excluidas por la selección original permanecen excluidas.
El JSON no contiene sus IDs/nombres/motivos individuales: no se deducen de huecos
ni se solicita otra consulta para recuperarlas. La auditoría local anterior se
conserva en 14_AUDITORIA_FUENTES_SEED_LOCAL.md como antecedente, ya superado por
esta fuente productiva aprobada.

`seed_calidad_operativo.sql` verifica calidad/PG16 y el baseline completo vacío,
bloquea tablas, inserta los siete maestros, reinicia sus siete secuencias y valida
conteos, filas completas y relaciones antes de COMMIT. Un error revierte también
los reinicios: se usa ALTER SEQUENCE RESTART transaccional. No hay limpieza,
upsert ni reparación de una instalación parcial. No toca artecnologia.
No carga eventos, históricos, entregas, evidencias, legacy, mappings, ledger ni
usuarios Logística. Se preservan los valores reales, incluidos NULL y vacíos.

`validate_seed_calidad.sql` es READ ONLY con guard calidad y ROLLBACK. Compara el
snapshot aprobado completo, no solo los conteos. El resultado distingue:

- CALIDAD_SCHEMA_VALIDO: arquitectura/constraints/funciones/índices/ledger/extensiones.
- CALIDAD_SEED_DATOS_VALIDOS: fidelidad, conteos/FK/relaciones lógicas/secuencias,
  ausencia de TEST y tablas de eventos/legacy/mappings vacías.
- CALIDAD_SEED_OPERATIVO_VALIDO / BASELINE_APTO_PARA_DEPLOY: ausencia de errores
  bloqueantes del baseline; no certifican todos los flujos de cada plantilla.
- LOGISTICA_AUTH_PENDIENTE: alta manual independiente de corrupción del schema.

**La configuración recibida tiene advertencias heredadas.** Ninguna de las
39 plantillas ENSAMBLE tiene INSPECCION publicada del mismo modelo; cinco secciones
están vacías y nueve plantillas carecen de algún código LIB001/LIB002. Hay además
observaciones WARNING sobre un correo de técnicos repetido y nueve nombre_bonos
vacíos. No se fabrican datos ni se eliminan los controles de integridad.
Con la carga exacta se esperan schema/datos SI, autorización pendiente SI y
operativo SI / BASELINE_APTO_PARA_DEPLOY=SI. Los warnings 39/5/9 no bloquean el
deploy: se crean órdenes y se registran actividades existentes; la inspección y
liberación afectadas siguen limitadas. Las plantillas 61/69 crean órdenes sin
actividades. Evidencia y clasificación en
[17_AUDITORIA_RUNTIME_BASELINE.md](17_AUDITORIA_RUNTIME_BASELINE.md).

El único usuario pendiente por decisión explícita es el de Logística. El middleware
responde 403 mientras no exista un usuario activo aprobado, incluso con Firebase
válido. No se copia ni inventa ningún UID.

Alta manual posterior: INSERT parametrizado para el cliente PostgreSQL del
administrador; no ejecutar placeholders literales en HeidiSQL.

```sql
BEGIN;
DO $$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN
  RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD';
 END IF;
END; $$;
INSERT INTO public.logistica_authorized_users
 (firebase_project,firebase_uid,email,display_name,is_active)
VALUES ('logistica-ar',$1,$2,$3,true);
COMMIT;
```

$1: UID real aprobado de la identidad Firebase verificada. $2/$3: email/nombre
aprobados o NULL. Sin contraseñas, tokens o personas de fixtures. La unicidad
rechaza duplicados; no sobreescribir automáticamente. Exigir COMMIT exitoso y
repetir validación: LOGISTICA_AUTH_PENDIENTE debe pasar a NO.

Flujo: create → seed → validar → alta Logística si pendiente → deploy API10,
condicionado a validación funcional SI; ver [runbook](10_RUNBOOK_CUTOVER_FINAL.md).
No dump/restore, delta, históricos ni siete migraciones posteriores.

Generación offline: `node context/database/deploy_calidad/build_seed_support.mjs`.
Comprueba el SHA del original autorizado y reproduce SQL/recibo sin ejecutar SQL
ni conectarse a servicios. SQL autónomos para HeidiSQL; el servidor no necesita
el generador ni los archivos fuente. No publicar herramientas administrativas,
SQL, JSON con personas o pruebas por FileZilla como parte de API10.
