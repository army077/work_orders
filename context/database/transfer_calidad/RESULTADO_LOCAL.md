# Resultado real de la revision y ensayo LOCAL

Fecha: 2026-10-22. Rama migracion-datos-historicos. Sin stage, commit, push o deploy.

**Actualizacion de alcance:** el bloqueo LOCAL fue aceptado y este ensayo queda
archivado; no se creara calidad_test_local ni otra base de ensayo. No hace falta
resolver autenticacion administrativa LOCAL para cerrar la preparacion. El
destino definitivo confirmado por el usuario es calidad. Las referencias de
abajo a tareas pendientes y credenciales describen el estado historico del
intento LOCAL y no autorizan nuevos intentos ni solicitan credenciales.
Consultar [README.md](./README.md) para el procedimiento final de cutover y los
resultados de la revision exclusivamente offline. No hubo conexiones ni cambios
DB en ese cierre y no se implemento un runner PREPROD.

## Estado

`db.js` admite production/calidad y rechaza production/artecnologia y las bases
LOCAL. LOCAL/TEST conservan sus reglas. Siete SQL PROD, soporte, template y
checksums adaptados; los guards no se eliminaron ni generalizaron.

La auditoria nativa del origen LOCAL paso: psql, pg_dump y pg_restore 16.15,
19 tablas exportadas selectivamente, tres funciones raiz, 19 secuencias y sus
consumidores revisados sin colision. Se verificaron TABLE DATA del TOC,
archivo custom/schema-only y hashes. El origen (incluidas tablas Logistica,
mapping y secuencias) coincide antes/despues. La vista work_order_totals queda
fuera del inventario API10. No se exporta ningun dato de las cinco tablas de
Logistica del origen.

**Bloqueo administrativo:** calidad_test_local no existe; workorders_test no
tiene CREATEDB. El intento autorizado de createdb como administrador LOCAL,
sin prompt ni password inventada, devolvio `fe_sendauth: no password supplied`.
La creacion no ocurrio. El comando administrativo se conserva en ENSAYO_LOCAL.md.
No compartir ni guardar la contraseña del administrador en el chat/repositorio.

Tras la instruccion de intentar resolverlo sin intervencion, tambien se
revisaron las fuentes seguras disponibles: las dos configuraciones .env.local
del workspace, variables de cliente PostgreSQL y ubicaciones convencionales
pgpass.conf/.pg_service.conf. No hay perfil administrativo LOCAL ni archivos
de contraseñas/servicios configurados. El unico rol LOCAL con CREATEDB es
postgres; workorders_test no es miembro suyo y no puede asumirlo. No se
intentaron passwords de otros servicios, no se cambiaron permisos/pg_hba y no
se debilito autenticacion. Falta una credencial administrativa LOCAL disponible
de forma no interactiva (fuera del chat y del repositorio), o la base ya creada
por un mecanismo administrativo autorizado. La detencion es solo en ese punto.

Por ese motivo **restauracion, comparacion origen/destino, siete etapas sobre
calidad_test_local y suite API10 contra ese destino siguen PENDIENTES**. No
son FAIL de estructura ni PASS de transferencia. No se han modificado datos
para hacer pasar pruebas. Al crear la DB, ejecutar el harness documentado y
actualizar este reporte con sus resultados reales.

## Conteos del origen exportado

| Tabla | artecnologia_test_local | calidad_test_local |
|---|---|---|
| public.desviaciones_calidad | 0 | PENDIENTE |
| public.desviaciones_calidad_legacy | 3934 | PENDIENTE |
| public.inspection_order | 6 | PENDIENTE |
| public.inspection_order_task | 12 | PENDIENTE |
| public.liberaciones_empaque_legacy | 28 | PENDIENTE |
| public.machine_customs | 0 | PENDIENTE |
| public.machine_family | 1 | PENDIENTE |
| public.machine_model | 1 | PENDIENTE |
| public.maintenance_template | 3 | PENDIENTE |
| public.plantilla_tecnicos | 0 | PENDIENTE |
| public.preembarque_legacy | 1205 | PENDIENTE |
| public.procesos_liberacion_legacy | 1014 | PENDIENTE |
| public.prod_delayments | 0 | PENDIENTE |
| public.template_section | 3 | PENDIENTE |
| public.template_task | 2 | PENDIENTE |
| public.template_task_inspection | 4 | PENDIENTE |
| public.work_order | 10 | PENDIENTE |
| public.work_order_customs | 0 | PENDIENTE |
| public.work_order_task | 14 | PENDIENTE |

Estos son conteos LOCAL, no prueba de presencia/conteos productivos. Los cuatro
historicos conservan estado **PENDIENTE VERIFICACIÓN PROD**. El generador de dump
productivo rechaza historicos presentes que no esten explicitamente aprobados.
El mapping original tiene 1 fila(s) y queda intacto/excluido de la copia.

## Pruebas verificadas

| Verificacion | Resultado real |
|---|---|
| Transferencia offline | 10/10 PASS |
| Auditoria/exportacion nativa de origen LOCAL | PASS, sin restauracion |
| Secuencias de origen | 19 consumidores, candidato futuro seguro; sin nextval/setval |
| Migraciones PROD offline | 14/14 PASS |
| Migraciones PROD en PostgreSQL LOCAL, fixtures temporales | 14/14 PASS |
| API10 aislada | 174 PASS, 0 FAIL, 2 SKIP por flags explicitos |
| API10 sobre calidad_test_local | PENDIENTE de DB administrativa |
| node --check | PASS, 15 archivos JS/MJS nuevos/modificados |
| git diff --check | PASS |
| Copia/PK/FK/indices/secuencias/funciones/triggers entre DBs | PENDIENTE, no se ha restaurado |
| Siete migraciones y schema final sobre destino LOCAL | PENDIENTE |

Los 14 tests PostgreSQL existentes incluyen siete rechazos de SQL PROD completo
en LOCAL, ocho huellas, orden/checksums/ledger, drift, evidencia vacia,
importador con fixture conocido y verificacion de tablas/secuencias public
intactas tras ROLLBACK. No equivalen a ejecutar un corte productivo ni a haber
restaurado calidad_test_local.

Los checksums productivos vigentes estan en README_LOGISTICA_PROD.md. La
prueba del runner demuestra que el SHA se calcula sobre exactamente los bytes
UTF-8 que ejecuta. Schema shape/states permanecen intactos: no contienen DB
identity y sus ocho huellas estructurales se probaron en PG16 LOCAL.

## Archivos

Los 10 archivos originales auditados pertenecen solo al nuevo procedimiento:
manifest.psql, identity.psql, preflight_empty.sql, dependencies.sql, snapshot.sql,
compare_snapshots.mjs, compare_snapshots.test.mjs, prepare_dump_args.mjs,
INVENTARIO.md y README.md. Se agregan local_support.mjs, sequence_safety.mjs,
apply_local_logistica.mjs, run_local_rehearsal.mjs, local_safety.test.mjs,
ENSAYO_LOCAL.md y este RESULTADO_LOCAL.md: 17 archivos entregables en la carpeta.

Otros archivos modificados/agregados: context/api10/db.js;
context/api10/tests/dbGuard.test.js y calidadLocal.test.js;
las siete migraciones PROD; logistica_prod_support.js;
README_LOGISTICA_PROD.md; tests/prod/artifact_blueprint.js,
logistica_prod.test.js y regenerate_artifacts.mjs.
No se cambia apply_logistica_migration_prod.js ni preflight_logistica_prod.js:
heredan el soporte actualizado. No se cambian schema_shape/schema_states ni
migraciones/fixtures LOCAL. Los untracked ajenos conocidos se preservan intactos.

## Riesgos y limites

Critico operativo pendiente: la creacion administrativa LOCAL. Para PROD siguen
pendientes catalogo/dependencias reales, permisos y plan de corte; no se ha
conectado ni autorizado un despliegue. Ningun hallazgo critico del codigo
impidio las pruebas realizadas.

Medios: el ensayo LOCAL requiere remapear propietarios postgres a workorders_test
con --no-owner/--no-acl y registra esas diferencias; la comparacion PROD conserva
exigencia exacta. La suite de destino y restauracion faltan hasta crear la DB.
Las pruebas usan Firebase/Drive simulados y no certifican servicios reales.
Nunca usar el mapping TEST_LOCAL revocado como dato productivo. Ningun snapshot
operativo final ni mapping real se importa en los nuevos tests.

Produccion modificada = NO. artecnologia PROD modificada = NO.
calidad PROD modificada = NO. Commit = NO. Push = NO.

Evidencias locales ignoradas por Git:
`evidence.local/2026-10-22T17-06-08-857Z/`.
