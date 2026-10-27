# calidad limpia: procedimiento vigente

**EXPORT_CONFIG_PROD_RECIBIDO=SI.** El usuario aportó el JSON productivo real y
el query adaptado que ejecutó. La etiqueta heredada PENDIENTE_EXPORT_CONFIG_PROD
no solicita otro export. No repetir consultas ni pedir acceso/credenciales.

Seguir el [runbook por fases](10_RUNBOOK_CUTOVER_FINAL.md): **FASE A** arquitectura,
seed ficticio de 14 filas, validación, pruebas y limpieza; **FASE B posterior**
configuración real, alta Logística y despliegue definitivo. No usar el seed real
durante FASE A. No copiar históricos ni eventos,
no dump/restore/delta ni siete migraciones posteriores.

Entrega inicial al administrador: únicamente
[01_create_calidad.sql](fase_a/01_create_calidad.sql) y
[02_seed_calidad_test.sql](fase_a/02_seed_calidad_test.sql). Los validadores y
cleanup se conservan internamente. build_phase_a_delivery.mjs genera ambas copias
desde las fuentes; no se genera ZIP. La causa exacta del falso fingerprint ya está
demostrada: pg_temp. frente a public. en 26 índices y dos funciones de trigger.

[create_calidad.sql](create_calidad.sql) crea la arquitectura final: 21 tablas,
20 secuencias, 48 índices incluidos PK/UNIQUE, 13 FK, cuatro funciones y dos
triggers. Exige calidad/PG16, plpgsql/citext instaladas y ausencia de objetos de
aplicación previos. No crea extensiones, roles o grants inventados. Solo carga
el ledger con siete versiones incluidas, no ejecuta siete migraciones separadas.

[seed_calidad_operativo.sql](seed_calidad_operativo.sql) se conserva intacto para el
export aprobado: 1.139 filas de siete maestros, IDs preservados y siete secuencias
reiniciadas transaccionalmente. Exige el baseline íntegro vacío; rechaza cargas
parciales. No inserta eventos, históricos, legacy, mappings o usuarios Logística.
**No ejecutarlo todavía:** conserva el guard textual anterior. Antes de FASE B
debe actualizarse de forma controlada a la validación semántica, conservando sus
datos aprobados. Su fuente histórica reproducible es frozen_productive_seed_checks.mjs.
SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=SI; no bloquea FASE A.

[seed_calidad_test.sql](seed_calidad_test.sql) y
[validate_seed_calidad_test.sql](validate_seed_calidad_test.sql) son exclusivos de
FASE A. [cleanup_seed_calidad_test.sql](cleanup_seed_calidad_test.sql) elimina solo
las 14 filas originales identificadas por ID y contenido completo. Aborta ante
cambios o referencias externas, incluidas relaciones lógicas sin FK. No elimina
eventos creados por API ni reinicia secuencias. Ver límites y recuperación en el runbook.

CREATE y los validadores usan catálogos y expresiones canónicas; no comparan el
fingerprint textual global. La cobertura y el estado de la evidencia se describen
en [18_VALIDACION_SEMANTICA.md](18_VALIDACION_SEMANTICA.md).

[validate_seed_calidad.sql](validate_seed_calidad.sql) es READ ONLY. Comprueba
estructura, todas las filas/conteos/relaciones/secuencias y ausencia de eventos.
Distingue fidelidad de datos de suficiencia funcional y alta Logística pendiente.
[validate_create_calidad.sql](validate_create_calidad.sql) se conserva únicamente
como diagnóstico inicial antes del seed: exige negocio vacío y secuencias frescas.

**Hallazgo de la fuente aprobada:** 39 plantillas ENSAMBLE sin INSPECCION publicada
para el mismo modelo, cinco secciones vacías y nueve plantillas sin algún código
de liberación. La revisión del runtime las clasifica como WARNING: limitan
inspección/liberación de esas plantillas o dejan checklists vacíos, pero permiten
arrancar API10 y crear órdenes. Con el seed exacto se esperan
CALIDAD_SCHEMA_VALIDO=SI / CALIDAD_SEED_DATOS_VALIDOS=SI /
CALIDAD_SEED_OPERATIVO_VALIDO=SI / BASELINE_APTO_PARA_DEPLOY=SI.
Solo los ERROR bloquean el baseline; no reparar las 39/5/9 para desplegar.
Evidencia de endpoints y alcance en
[17_AUDITORIA_RUNTIME_BASELINE.md](17_AUDITORIA_RUNTIME_BASELINE.md). Detalle e IDs en
[16_SEED_PROD_VALIDADO_OFFLINE.md](16_SEED_PROD_VALIDADO_OFFLINE.md) y
[15_RECEPCION_EXPORT_CONFIG_PROD.json](15_RECEPCION_EXPORT_CONFIG_PROD.json).

Logística sigue ALTA_MANUAL_REQUERIDA. No hay UID automático. El INSERT
parametrizado está en [13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md). El validador
reporta LOGISTICA_AUTH_PENDIENTE por separado, sin confundir ausencia de usuario
con corrupción estructural. Health 200 no demuestra autorización ni operación.

Runtime **Node.js v18.19.1**, APP_ENV=production, PGDATABASE=calidad,
FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar. El administrador configura permisos
habituales del rol API10, acceso, backup y reinicio PM2. FileZilla usa
[07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt); después,
`npm ci --omit=dev` dentro de API10. Configuración y rollback:
[06_CHECKLIST_CUTOVER.md](06_CHECKLIST_CUTOVER.md). No imprimir secretos.

Herramientas anteriores de transferencia, 01–04, 05_COMANDOS_TRANSFERENCIA.md,
08_operar.mjs, 09_comparar_restore.mjs, transfer_calidad y migraciones incrementales
se conservan, NO utilizadas en este cutover. El query del export se archiva como
fuente ejecutada, no como otra actividad obligatoria.

Generadores offline: build_clean_baseline.mjs, build_seed_support.mjs y
build_test_seed.mjs en esta
carpeta. Nunca conectan ni ejecutan el SQL generado. El servidor ejecuta los SQL
autónomos, sin generadores/includes/psql obligatorios. Ante error/NO/resultado
incompleto: STOP. Un SI dentro de transacción exige COMMIT posterior exitoso.
No se ha ejecutado esta entrega contra PostgreSQL ni modificado ninguna DB.
