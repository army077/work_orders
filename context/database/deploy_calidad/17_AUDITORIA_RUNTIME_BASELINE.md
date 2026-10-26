# Aptitud del baseline según el runtime

Revisión local del 2026-10-26, rama `migracion-datos-historicos`.
BASELINE_APTO_PARA_DEPLOY = SI. Arquitectura completa = SI. Seed íntegro = SI.
Conclusión sobre los artefactos y el código disponibles; no es una validación
ejecutada en PostgreSQL ni una certificación del entorno desplegado.

`create_calidad.sql` contiene los contratos finales de API10: 21 tablas,
20 secuencias, 48 índices incluyendo PK/UNIQUE, 13 FK, cuatro funciones y dos
triggers. `seed_calidad_operativo.sql` reproduce las 1.139 filas autorizadas de
siete maestros, con sus IDs y relaciones; no necesita eventos históricos para
crear órdenes/actividades/inspecciones/entregas nuevas. Los contratos SQL de
work_order y work_order_task no exigen inspección asociada ni LIB001/LIB002.
No existe un control global de estas tres condiciones al arrancar el servidor.

## Clasificación y alcance

| Condición | Clasificación runtime | Tratamiento del baseline | Impacto exacto |
| --- | --- | --- | --- |
| 39 ENSAMBLE sin INSPECCION publicada del mismo modelo | BLOQUEADOR_FLUJO_ESPECIFICO | WARNING | La orden se crea. Sus actividades existentes pueden avanzar. Solicitar inspección para cualquiera de esos modelos devuelve 404 y hace ROLLBACK de la solicitud; no revierte la orden previamente creada. |
| 5 secciones vacías | ADVERTENCIA_HEREDADA | WARNING | No abortan crear/materializar. No producen filas work_order_task ni grupo visible. La sección 155 omite solo sus actividades; las plantillas 61/69 no tienen ninguna actividad: checklist vacío, sin actividades que actualizar, reinicio del checklist 404. |
| 9 ENSAMBLE sin algún LIB001/LIB002 | BLOQUEADOR_FLUJO_ESPECIFICO | WARNING | No impiden crear orden ni avanzar otras tareas. Si se llega a una inspección, liberar sin la tarea correspondiente devuelve 404; finalizar la inspección devuelve 409. El cierre directo de producción no exige esos códigos. |
| logistica_authorized_users sin identidad activa aprobada | BLOQUEADOR_FLUJO_ESPECIFICO | Alta manual separada | Firebase válido no basta: el middleware devuelve 403 para la identidad no autorizada. Bloquea Logística, no el arranque ni las órdenes de trabajo. |

Las 39 afectadas son **todas las ENSAMBLE incluidas en el export**. La única
INSPECCION es la 104, modelo 41, sin ENSAMBLE del mismo modelo en el seed.
Por tanto, solicitar inspección de una nueva orden ENSAMBLE no funcionará con
esta configuración. No se afirma que ese flujo esté disponible ni que fuera
utilizado exitosamente en producción: se conserva la configuración recibida.
Esta limitación no convierte el baseline entero en inoperante.

Secciones vacías: 155 → plantilla 50; 249/250 → 61; 263/264 → 69.
Sin LIB001 y LIB002: 30,31,32,55,61,69. Sin LIB002: 34,38,49.
Las nueve también están entre las 39 sin inspección: hoy la solicitud falla
antes; el efecto de liberación/cierre es una segunda condición demostrada por
el código, que persistiría aunque se dispusiera de una inspección.
Los IDs completos de las 39 se mantienen en el
[recibo aprobado](15_RECEPCION_EXPORT_CONFIG_PROD.json), sin alterarlo.

## Evidencia del backend y del consumidor

- [server.js](../../api10/server.js): monta los routers y health; no inspecciona
  las plantillas al arrancar. [db.js](../../api10/db.js) admite production/calidad
  y exige las variables PG. La conclusión presupone dependencias, configuración,
  permisos y servicios externos habituales; no se probaron credenciales reales.
- [workOrders.js](../../api10/routes/workOrders.js), POST
  `/api10/work-orders/from-template`: obtiene la plantilla por ID, inserta la
  cabecera, recorre secciones/tareas e inserta snapshots. No consulta INSPECCION,
  no requiere LIB y no exige mínimo de tareas. Un arreglo vacío hace cero
  iteraciones y continúa al COMMIT/201. No hay tabla de secciones materializadas:
  el título de sección se copia en cada tarea que sí existe.
- El mismo router permite listar checklist (`GET /:id/tasks` → 200 con `[]`),
  registrar avances (`PUT /:id/stavance`) y cerrar producción (`PUT /:id/prod_end`).
  No condiciona estos últimos a una inspección o código LIB. El reinicio
  `PUT /:id/restart_stavance` devuelve 404 si no actualizó ninguna actividad.
  Que el cierre directo exista no equivale a liberar calidad ni propone saltarla.
- [quality.js](../../api10/routes/quality.js), POST
  `/api10/quality/inspection/request`: exige plantilla INSPECCION publicada del
  mismo modelo y sección con título exactamente igual a inspection_type. Cero
  coincidencias → 404; varias → 409; cero puntos materializados → 422 y ROLLBACK.
  Ninguna de las cinco secciones vacías pertenece a INSPECCION: ese 422 es una
  condición distinta, que no se ha reclasificado como warning.
- `CODIGO_LIBERACION` en quality.js mapea exclusivamente
  `Inspección de ensamble` → `LIB001`, `Inspección de pintura` → `LIB002`.
  No se encontraron otros códigos de liberación requeridos por API10.
  `PUT /api10/quality/liberar_orden/:id` exige puntos DONE y actualiza la tarea
  por ese código: si no hay coincidencia, 404 y ROLLBACK.
  `PUT /api10/quality/:id/insp_end` exige también esa tarea existente y DONE:
  si falta, 409 y ROLLBACK. No son condiciones de creación de work_order.
- [CreateWorkOrderFromTemplate.tsx](../../../src/pages/CreateWorkOrderFromTemplate.tsx)
  selecciona plantillas publicadas y envía fromTemplate/payload a
  [dataProvider.ts](../../../src/dataProvider.ts), que llama from-template.
  No introduce comprobación de inspección ni códigos LIB.
  [WorkOrderRun.tsx](../../../src/pages/WorkOrderRun.tsx) agrupa las tareas
  recibidas por section_title; una sección sin filas no aparece como grupo.
  Plantel Producción consume las órdenes/checklists y Plantel Inspeccion lista
  inspecciones/asigna inspector. No se hallaron llamadas a inspection/request,
  liberar_orden o insp_end en este frontend; su ausencia no demuestra que otros
  clientes no consuman esos endpoints.
- [requireLogisticaAuthorizedUser.js](../../api10/auth/requireLogisticaAuthorizedUser.js)
  busca firebase_project, UID verificado e is_active=true. Sin fila → 403.
  [logisticaDeliveries.js](../../api10/routes/logisticaDeliveries.js) aplica ese
  middleware a altas/listados/evidencias/cierre/historial. El alta debe corresponder
  al usuario real que usará Logística; una fila de otro usuario no lo autoriza.

## Validador y criterio de aceptación

Se cambió únicamente la política de salida del validador en
[render_seed.mjs](render_seed.mjs) y se regeneró **solo**
[validate_seed_calidad.sql](validate_seed_calidad.sql).
Los checks conservan los hallazgos. Los tres motivos auditados se reportan con
ESTADO=WARNING, clasificación, cantidad, IDs e impacto. Las observaciones de
correo repetido/nombre_bonos vacío, que ya eran informativas, se muestran como
WARNING. Los otros fallos funcionales no se han rebajado.

`blocking_issues` incluye todos los seed_issues (schema, filas distintas/faltantes/
ajenas, conteos, huérfanos, posiciones, secuencias, TEST/FIXTURE, eventos/legacy/
mappings no vacíos) y los demás functional_issues. Las filas bloqueantes dicen
ERROR; `CALIDAD_SEED_OPERATIVO_VALIDO` y `BASELINE_APTO_PARA_DEPLOY` dependen de
ese conjunto, no de los warnings. Estos dos SI no prometen que cada plantilla
tenga checklist completo o pueda pasar por calidad.

Resultado **esperado**, sin ejecutar SQL, para create + seed íntegros:

```ini
CALIDAD_SCHEMA_VALIDO = SI
CALIDAD_SEED_DATOS_VALIDOS = SI
CALIDAD_SEED_OPERATIVO_VALIDO = SI
BASELINE_APTO_PARA_DEPLOY = SI
LOGISTICA_AUTH_PENDIENTE = SI
```

Logística requiere alta manual = SI. Logística después de alta manual = SI,
para esa identidad verificada, con la configuración Firebase/Drive habitual.
No se creó usuario ni se probaron servicios externos. API10 puede arrancar = SI;
crear nuevas órdenes = SI, con las limitaciones por plantilla indicadas.
Bloqueadores generales demostrados por las incidencias 39/5/9 = NINGUNO.
No se modificaron API10/frontend, create, seed, export ni recibo.

## Verificación sin SQL

Las pruebas de [runtime_baseline.test.mjs](runtime_baseline.test.mjs) ejecutan
los handlers JavaScript reales con respuestas de query simuladas. No cargan
driver, motor SQL ni conexiones. Cubren las 50 plantillas no INSPECCION para
creación/snapshot, los 39 rechazos de solicitud, las cinco secciones, las nueve
plantillas/códigos faltantes en liberación y cierre, avance/cierre de producción,
autorización Logística, política ERROR/WARNING e inmutabilidad de los artefactos.
Las inspecciones completadas simuladas solo aíslan el requisito de liberación;
no se agregan como datos al seed ni se presentan como flujo posible del export.

Comandos de pruebas sin SQL:

```text
node --no-experimental-sqlite --test --test-isolation=none context/database/deploy_calidad/*.test.mjs
node --test --test-isolation=none context/api10/tests/dbGuard.test.js
```

Resultado: 194/194 PASS (190 deploy_calidad + 4 dbGuard), incluyendo 131/131
pruebas nuevas. Se omiten explícitamente 38 fixtures existentes que requieren
ejecutar SELECT en SQLite, para respetar NO DB / NO SQL ejecutado. No hubo
validación PostgreSQL, despliegue ni prueba de credenciales reales.
`git diff --check`: PASS. Commit = NO. Push = NO.

SHA256 sin cambios, comprobados por las pruebas:

- create_calidad.sql: `efd14fd52b4b16b58fd0b5aa993de83e9c0a714e7f8e366181eb6f1a0b16265e`.
- seed_calidad_operativo.sql: `e2e8ff8c05ba485ad56ab889c095485efac15df612b32e862f4c1d18d6b04da8`.
- export JSON: `47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0`.
