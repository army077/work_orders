# Comandos Linux: snapshot y conciliación controlada

Preparados; NO ejecutados en DB. Desde la raíz del checkout revisado, con clientes
PostgreSQL 16 y Node **18.19.1**. En FileZilla usar transferencia binaria para
preservar los checksums. No subir herramientas administrativas al directorio público.

Flujo operativo: [runbook final de 11 pasos](10_RUNBOOK_CUTOVER_FINAL.md).
El administrador confirma `BACKUP_ARTECNOLOGIA = SI` por su procedimiento habitual;
este documento no define el mecanismo de respaldo.

## A — Entorno administrativo existente

```bash
set -euo pipefail
umask 077
export APP_ENV=production
export PGDATABASE=calidad
```

Usar PGHOST, PGPORT y PGUSER ya configurados para el servidor/administrador común,
y la autenticación segura existente mediante PGPASSFILE o PGPASSWORD.
BACKUP_DIR: nuevo por ventana, privado y fuera del checkout. No imprimir entornos
ni pasar passwords por CLI. Mantener SSL y el mecanismo seguro de autenticación
existente. También se admite PGPASSWORD suministrada por el gestor seguro.
Los parámetros de servidor son los autorizados, con endpoint estable del cluster.

`calidad` ya fue validada realmente (DESTINO_VACIO_Y_APTO=SI, objetos de aplicación=0).
No ejecutar preflight de origen ni destino como tarea previa independiente.
No pedir inventarios, seleccionar tablas ni revisar conteos/secuencias/funciones/
triggers a mano. Node 18.19.1 y PostgreSQL 16.15 ya están confirmados.

## B — Transferencia única con control de origen integrado

```bash
node context/database/deploy_calidad/08_operar.mjs transfer
```

Encadena las etapas existentes C → D → E, sin duplicar su lógica. Antes del dump
valida por conexión real que el origen es artecnologia y reutiliza íntegro
01_preflight_artecnologia.sql dentro del snapshot READ ONLY. ORIGEN_APTO distinto
de SI, identidad incorrecta o captura incompleta implica STOP antes del dump/export.
Si falla cualquier etapa, no envía la siguiente ni reintenta automáticamente.
Al terminar imprime `TRANSFERENCIA_COMPLETADA = SI` y existe restore_completed.json.
Las secciones C–E describen sus operaciones internas: no son comandos adicionales
para el administrador y no deben ejecutarse otra vez después de `transfer`.

No exigir ESCRITORES_DETENIDOS=SI. Los usuarios pueden continuar en artecnologia
durante la copia. El plan aceptado obliga a conservar el snapshot y conciliar el
delta posterior, sin pérdida silenciosa. Evitar DDL concurrente durante el dump;
un error o cambio estructural obliga a revisar, no a mezclar capturas.

El runner mantiene una transacción REPEATABLE READ READ ONLY abierta, exporta
pg_export_snapshot() y comparte ese identificador con pg_dump. La captura
estructural y delta_baseline.tsv se calculan dentro de esa misma transacción.
No usar una captura previa independiente como baseline definitivo.

## C — BACKUP DE SEGURIDAD completo

Etapa interna `backup` del comando `transfer`. Ejecuta pg_dump --format=custom --snapshot=<SNAPSHOT_ID> con
--dbname=artecnologia y --file=artecnologia_seguridad.dump en BACKUP_DIR.
El identificador solo es importable mientras vive la conexión exportadora:
no copiar el comando interno a otra sesión ni reusar un snapshot expirado.

Guardar snapshot_started.json, snapshot.json (COMPLETE), backup_ok.json,
origen_definitivo.tsv, delta_baseline.tsv, artecnologia_seguridad.dump y seguridad.toc.
snapshot.json registra SNAPSHOT_ID, fecha/hora de inicio/finalización, estrategia,
artefacto y hashes del backup y capturas. Un fallo deja el intento sin recibo COMPLETE;
no reusar la ventana ni promoverlo a éxito manualmente.

Es un respaldo completo de la DB, no de los roles globales del cluster. Su creación
no demuestra un restore de recuperación. Contiene datos privados fuera del alcance
selectivo y no se restaura entero en calidad.

Las secuencias no son MVCC. No se exige igualdad de last_value de dos instantes
vivos: el restore conserva el estado nativo del dump y verifica candidato siguiente
contra MIN/MAX de las filas restauradas, además de parámetros/ownership/defaults.
Una secuencia atrasada, compartida, CYCLE/cache no demostrable exige REVISAR;
no se llama nextval/setval para arreglarla. Snapshot largo puede retener vacuum:
vigilar la duración y cancelar ante incidencias; no es un CDC continuo.

## D — EXPORT SELECTIVO PARA calidad

Etapa interna `export`. Genera selectivo.toc automáticamente usando manifest.psql, prepare_dump_args.mjs
y OIDs del catálogo capturados bajo el snapshot. Conserva el orden nativo del
archive para funciones/defaults/PK/FK/índices/triggers y sus ACL. Excluye históricos
pendientes y Logística. No editar el TOC manualmente ni elegir tablas.

Comando interno de referencia, no ejecutarlo aparte:

```bash
pg_restore --no-password --use-list="$BACKUP_DIR/selectivo.toc" \
  --file="$BACKUP_DIR/calidad_selectivo.sql" "$BACKUP_DIR/artecnologia_seguridad.dump"
```

El runner guarda export_ok.json con SNAPSHOT_ID, hashes y finalización. Los
cambios nuevos en origen no invalidan el snapshot: se detectarán en el delta.
También extrae solo SEQUENCE SET a sequence_states.sql, sin ejecutarlo, y genera
sequence_states.json. El selector exige un estado por cada secuencia. Se conserva
el contador exacto del archive incluso si una tabla quedó vacía por deletes previos.

## E — Restore calidad

Etapa interna `restore`. Conserva el guard automático de calidad vacía y
servidor/rol coincidentes con origen, sin pedir repetir el preflight al administrador.
Verifica el backup/TOC/recibos. Comando interno de referencia, no ejecutarlo aparte:

```bash
pg_restore --no-password --exit-on-error --single-transaction --dbname=calidad \
  --use-list="$BACKUP_DIR/selectivo.toc" "$BACKUP_DIR/artecnologia_seguridad.dump"
```

Sin --clean, --create, --disable-triggers, --no-owner ni --no-acl. Los roles/ACL
originales se conservan; errores de permisos/dependencias detienen todo. No modificar
autenticación ni origen. restore_started.json impide reintentos ciegos si se pierde
la conexión; restore_completed.json solo se crea tras éxito confirmado.

## F — Validación post restore

```bash
node context/database/deploy_calidad/08_operar.mjs validate-restore
```

Ejecuta 03_validar_post_restore_calidad.sql y capture_delta_calidad.sql. Guarda
destino_post_restore.tsv y delta_destino_post_restore.tsv. El comparador existente
valida estructura/conteos/PK/FK/índices/defaults/funciones/triggers/ACL frente al
origen del snapshot. Se permiten diferencias no MVCC de estado de secuencia
solamente con recibo de snapshot y safety del destino; las definiciones siguen
siendo estrictas. Además compara hashes de todas las filas con PK soportada.
last_value/is_called del destino deben coincidir exactamente con sequence_states.json
extraído del dump; no basta con que el siguiente candidato sea mayor que MAX(pk).

RESTORE_VALIDADO=SI en restore_validado.json exige también cero diferencias de
fila y cero tablas no comparables. No exige que el origen vivo siga igual al snapshot.
No compara a mano. Para revisión offline compartir estos seis archivos:

```bash
node context/database/deploy_calidad/09_comparar_restore.mjs \
  "$BACKUP_DIR/origen_definitivo.tsv" "$BACKUP_DIR/destino_post_restore.tsv" \
  "$BACKUP_DIR/snapshot.json" "$BACKUP_DIR/delta_baseline.tsv" \
  "$BACKUP_DIR/delta_destino_post_restore.tsv" "$BACKUP_DIR/sequence_states.json"
```

## G — Siete migraciones Logística

```bash
node context/database/deploy_calidad/08_operar.mjs migrate
```

Orden cerrado: ejecutar y validar COMMIT/fingerprint/ledger de cada una antes de
enviar la siguiente. Ruta de todos: context/database/migrations/prod/.

1. `20261016_create_logistica_authorized_users.sql` → validar éxito 1/7.
2. `20261016_create_logistica_deliveries.sql` → validar éxito 2/7.
3. `20261019_extend_logistica_delivery_evidence.sql` → validar éxito 3/7.
4. `20261019_add_logistica_delivery_drive_folder.sql` → validar éxito 4/7.
5. `20261020_add_logistica_delivery_completion.sql` → validar éxito 5/7.
6. `20261021_create_entregas_logistica_legacy.sql` → validar éxito 6/7.
7. `20261021_create_logistica_legacy_owner_mapping.sql` → validar éxito 7/7.

El runner usa el aplicador PROD existente y sus guards/checksums exactos para
calidad. Genera <nombre-migracion>.result.json por éxito. Si una falla:
DETENERSE, NO continuar, NO reintentar automáticamente. Mantener API10 anterior
en artecnologia hasta resolver. No insertar usuarios/mappings/entregas de prueba.

## H — Validación final schema

```bash
node context/database/deploy_calidad/08_operar.mjs validate-final
```

Ejecuta 04_validar_post_logistica_calidad.sql; guarda destino_post_logistica.tsv
y logistica_validada.json. Exige LOGISTICA_SCHEMA_VALIDO=SI, ledger 7/7 con
hashes/orden y fingerprint de las seis tablas, constraints/índices/triggers.
No requiere datos reales de usuarios, mappings ni histórico. Con SI seguir 06.

## I — CONCILIACION DELTA después del cutover

```bash
node context/database/deploy_calidad/08_operar.mjs delta
```

Solo SELECT/READ ONLY contra artecnologia y calidad; no corrige ninguna fila.
Guarda delta_origen_<captura>.tsv, delta_destino_<captura>.tsv y delta_<captura>.json
con SNAPSHOT_ID, inicio/final y diferencias SOLO_ORIGEN / SOLO_DESTINO /
CONTENIDO_DISTINTO. Usa también delta_baseline.tsv para separar cambios observados
en cada lado desde el snapshot. Código 0: sin diferencias observadas; 2: pendientes
o tablas no comparables; 1: captura/operación inválida. No tratar 2 como resuelto.

Revisión humana: altas solo en origen pueden trasladarse tras validar PK/FK;
updates divergentes y colisiones de IDs deben revisarse antes de sobrescribir.
No inferir deletes ni ejecutar INSERT/UPDATE/DELETE automáticos. Registrar cada
resolución aprobada y repetir las capturas hasta cerrar la conciliación. Evitar
nuevas rutas hacia el sistema anterior y considerar solicitudes/jobs en vuelo.
Si el origen sigue cambiando, el informe es puntual y debe repetirse; no declarar
cerrado el delta hasta acordar su última escritura relevante.

Detalles y limitaciones: [CONCILIACION_DELTA.md](../transfer_calidad/CONCILIACION_DELTA.md).
El histórico Entregas del Sheet tiene su propio snapshot final y conciliación:
no mezclarlo con este delta PostgreSQL.

Referencias: [snapshot exportado PG16](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION),
[pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html).
