# Comandos Linux para la ventana autorizada

**Preparados, no ejecutados.** Ejecutar en Bash desde la raíz de este checkout
revisado, conservando su estructura `context/database/` y `context/api10/`.
FileZilla permite llevar el checkout al servidor; el código administrativo no se
copia al directorio público de API10. `pg_dump`, `pg_restore` y `psql` deben ser
clientes PostgreSQL 16. Usar un endpoint fijo del cluster autorizado.
En FileZilla usar transferencia **binaria**, sin conversión de saltos de línea:
los checksums dependen de los bytes exactos de las siete migraciones.

## A — Captura/preflight

Configurar parámetros del servidor. La autenticación debe existir mediante un
passfile privado ya aprovisionado; nunca poner contraseñas en los comandos o en
el chat. Conservar la política SSL del entorno. No imprimir variables de entorno.
El runner también admite la variable PGPASSWORD provista por el gestor seguro.

```bash
set -euo pipefail
umask 077
export PGHOST='<PG_HOST>'
export PGPORT='<PG_PORT>'
export PGUSER='<PG_ADMIN_USER>'
export BACKUP_DIR='<BACKUP_DIR>'
export PGPASSFILE='<RUTA_PASSFILE_PRIVADO_EXISTENTE>'
export APP_ENV=production
export PGDATABASE=calidad
node --version
node context/database/deploy_calidad/08_operar.mjs preflight
```

BACKUP_DIR debe ser un directorio **nuevo por ventana**, privado, fuera del
checkout y con espacio para el respaldo completo y export SQL. No reutilizar una
carpeta de una ventana anterior. Ningún comando sobrescribe evidencias existentes.
No activar flags de tests de integración ni cargar configuraciones LOCAL.

Resultados: `preflight_origen.tsv` con ORIGEN_APTO=SI y `preflight_destino.tsv`
con DESTINO_VACIO_Y_APTO=SI. Antes del freeze sirven como diagnóstico; todavía
no son la captura definitiva. El runner fija origen/destino y rechaza otros
nombres. HeidiSQL puede ejecutar los mismos archivos 01/02 íntegros.

## B — Freeze

El responsable aplica el mecanismo de negocio confirmado en el punto 5 del
LEEME. Debe detener **todos** los escritores: API10, otras APIs, jobs, integraciones,
sesiones manuales, cambios DDL y consumidores de secuencias. No basta detener
solo PM2. No inventar un comando para ese mecanismo.

Después de comprobarlo, y manteniéndolo hasta el corte o rollback:

```bash
export ESCRITORES_DETENIDOS=SI
```

El flag documenta una confirmación humana; no detiene escritores por sí mismo.
El respaldo utiliza el snapshot consistente de pg_dump; el freeze cubre también
secuencias, que no quedan congeladas por MVCC. La captura definitiva, backup,
export, comparación y corte pertenecen a esta misma ventana sin escrituras.

## C — BACKUP DE SEGURIDAD completo de artecnologia

```bash
node context/database/deploy_calidad/08_operar.mjs backup
```

El runner ejecuta exactamente, sin escribir en origen:

```bash
pg_dump --no-password --format=custom --dbname=artecnologia \
  --file="$BACKUP_DIR/artecnologia_seguridad.dump"
pg_restore --no-password --list "$BACKUP_DIR/artecnologia_seguridad.dump"
```

No hay selectores de tablas en el backup completo. Se guardan
`origen_definitivo.tsv`, `artecnologia_seguridad.dump`, `seguridad.toc` y
`backup_ok.json` (SHA-256). `pg_dump` incluye los objetos de la DB, datos y estado
de secuencias; no respalda roles globales del cluster. No se restaurará este
archivo completo en `calidad`. El éxito del comando no equivale a un ensayo de
recuperación del backup. Confirmación 4 = SI después de su creación correcta.

## D — EXPORT SELECTIVO PARA calidad

```bash
node context/database/deploy_calidad/08_operar.mjs export
```

Se reutiliza el archivo completo del mismo snapshot: se genera automáticamente
`selectivo.toc` con OIDs capturados de tablas/PK/FK/índices/defaults/triggers,
secuencias y firmas de funciones aprobadas. El selector reutiliza
`prepare_dump_args.mjs` y `manifest.psql`; no toma listas del administrador.
Excluye históricos pendientes y Logística. La relación de dependencias reutiliza
`dependencies.sql`; dependencias no admitidas impiden ORIGEN_APTO=SI.

La selección conserva el orden topológico del archivo original, incluidas las
funciones antes de defaults/triggers que las referencian. Produce el export
selectivo reproducible mediante:

```bash
pg_restore --no-password --use-list="$BACKUP_DIR/selectivo.toc" \
  --file="$BACKUP_DIR/calidad_selectivo.sql" "$BACKUP_DIR/artecnologia_seguridad.dump"
```

`calidad_selectivo.sql` es privado, contiene datos y **no** se comparte ni se
versiona. Es una representación revisable del export; el restore usa el mismo
archive y TOC para conservar las garantías nativas. El runner vuelve a capturar
origen (`origen_post_export.tsv`), compara estructura/conteos/MAX/secuencias y
guarda `export_ok.json`. Eso complementa el freeze; no demuestra igualdad de cada
celda ni sustituye detener escritores. No editar el TOC manualmente.

## E — Restore calidad

```bash
node context/database/deploy_calidad/08_operar.mjs restore
```

Antes de ejecutar, vuelve a exigir `calidad` vacía y que su servidor/rol coincidan
con la captura de origen. Verifica SHA del backup y TOC. Después usa:

```bash
pg_restore --no-password --exit-on-error --single-transaction --dbname=calidad \
  --use-list="$BACKUP_DIR/selectivo.toc" "$BACKUP_DIR/artecnologia_seguridad.dump"
```

Sin opciones de borrado/creación de DB ni omisiones de owners/ACL/triggers. Los
roles originales deben existir y el rol administrativo tener permisos para
restaurar ownership/ACL. Una dependencia o permiso faltante detiene la operación;
no se relajan permisos ni se cambian autenticación/owners automáticamente.
`restore_started.json` impide reintentos ciegos, incluso ante conexión perdida;
`restore_completed.json` se crea solo al recibir éxito. No tocar `artecnologia`.

## F — Validación post restore

```bash
node context/database/deploy_calidad/08_operar.mjs validate-restore
```

Ejecuta `03_validar_post_restore_calidad.sql`, guarda
`destino_post_restore.tsv` y compara automáticamente con `origen_definitivo.tsv`
usando **el comparador existente**. Resultado obligatorio en
`restore_validado.json`: RESTORE_VALIDADO=SI, cero diferencias y cero warnings.
Verifica también safety de cada secuencia contra MIN/MAX de su consumidor,
sin nextval/setval. Las definiciones se comparan por hash, owners/ACL de forma
estricta; no se usa el mapeo de permisos LOCAL.

Si se necesita revisión offline por Codex, compartir únicamente ambos TSV:

```bash
node context/database/deploy_calidad/09_comparar_restore.mjs \
  "$BACKUP_DIR/origen_definitivo.tsv" "$BACKUP_DIR/destino_post_restore.tsv"
```

No comparar conteos a mano. Una captura truncada, metadato faltante o secuencia
insegura da NO. HeidiSQL puede ejecutar 03, pero la comparación cruzada requiere
los dos archivos; un resultado local CAPTURA_RESTORE_APTA no reemplaza esa comparación.

## G — Siete migraciones Logística

```bash
node context/database/deploy_calidad/08_operar.mjs migrate
```

El runner exige restore validado y fija exclusivamente `calidad`. Importa el
aplicador PROD existente, conserva sus guards y calcula SHA de los bytes enviados.
Orden cerrado, **ejecutar y validar éxito antes de enviar la siguiente**:

1. `20261016_create_logistica_authorized_users.sql` → COMMIT + schema/ledger 1/7.
2. `20261016_create_logistica_deliveries.sql` → COMMIT + schema/ledger 2/7.
3. `20261019_extend_logistica_delivery_evidence.sql` → COMMIT + schema/ledger 3/7.
4. `20261019_add_logistica_delivery_drive_folder.sql` → COMMIT + schema/ledger 4/7.
5. `20261020_add_logistica_delivery_completion.sql` → COMMIT + schema/ledger 5/7.
6. `20261021_create_entregas_logistica_legacy.sql` → COMMIT + schema/ledger 6/7.
7. `20261021_create_logistica_legacy_owner_mapping.sql` → COMMIT + schema/ledger 7/7.

Ruta de todos: `context/database/migrations/prod/`. Cada éxito produce
`<nombre-migracion>.result.json`. Si una falla: **DETENERSE, NO continuar**.
El ledger/shape/checksum decide el estado; no repetir una migración tras una
pérdida de conexión. Codex debe evaluar el estado antes de autorizar recuperación.

## H — Validación final schema

```bash
node context/database/deploy_calidad/08_operar.mjs validate-final
```

Ejecuta `04_validar_post_logistica_calidad.sql` y guarda
`destino_post_logistica.tsv` y `logistica_validada.json`.
LOGISTICA_SCHEMA_VALIDO=SI certifica las seis tablas, columnas/constraints/índices,
triggers/guard de mapping, secuencias, fingerprint final, siete hashes del ledger
y orden temporal estricto. No consulta filas de usuarios, mappings ni entregas.
Con SI, continuar con el checklist de API10; mantener el freeze hasta resolver el
corte o rollback. No habilitar tráfico a `calidad` antes de completar validaciones.

Referencias de las herramientas: [pg_dump 16](https://www.postgresql.org/docs/16/app-pgdump.html),
[pg_restore 16](https://www.postgresql.org/docs/16/app-pgrestore.html).
