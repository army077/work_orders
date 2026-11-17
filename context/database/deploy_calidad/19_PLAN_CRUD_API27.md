# API27: plan CRUD controlado, sin ejecutar todavía

Este documento prepara requests y SQL para revisión. Codex no ejecutó requests,
SQL, cleanup ni deploy. La API anterior /api10, Flutter y Firebase no se modifican
en el servidor. El hotfix de tres GET se prepara en las fuentes locales compartidas.

## Git y evidencia del administrador

El 27/10/2026 origin/migracion-datos-historicos apunta a
**34fb2494a56ee3b47a6ebb9f950c499a4c8320e9**. Mensaje del commit:
«Corrige sintaxis PL/pgSQL en validadores de calidad». Consultado mediante Git,
sin acceso al servidor productivo. Sus diez archivos son:

- semantic_expressions.mjs y semantic_catalog.mjs;
- create_calidad.sql y fase_a/01_create_calidad.sql;
- seed_calidad_test.sql y fase_a/02_seed_calidad_test.sql;
- validate_create_calidad.sql y validate_seed_calidad_test.sql;
- cleanup_seed_calidad_test.sql y validate_seed_calidad.sql.

Todos están bajo context/database/deploy_calidad. El commit encierra el CASE del
ELSIF entre paréntesis y cambia el alias reservado collation por colloid. No cambia
server.js ni otros archivos API. Al preparar el plan, la copia local estaba en
1f9dcc2 y solo se había actualizado origin. Sus cambios SQL previos
usan collation_oid en lugar de colloid: ambos eliminan la palabra reservada,
pero los bytes locales no son idénticos al commit remoto. No se sobreescribieron
esos cambios al preparar el plan. La publicación posterior se basa en 34fb249 y
mantiene los cambios SQL locales ajenos fuera del commit.

Evidencia operativa proporcionada por el administrador: PG16.15, CREATE/COMMIT,
21 tablas, seed TEST/COMMIT con 14 filas, SEED_TEST_VALIDO=SI, API27 health y 16 GET
READ ONLY correctos. Se registra como evidencia recibida; no se verificó mediante
conexiones al servidor ni llamadas HTTP.

## Reglas y registro de IDs

Base de las requests futuras: `https://desarrollotecnologicoar.com/api27`.
Todos los paths de las tablas siguientes son relativos a /api27. No ejecutar
estos ejemplos como un lote automático. Un error o resultado incompleto detiene
la secuencia; no reintentar POST sin comprobar si creó un registro.

Los 14 registros originales son solo referencias. Nunca usar PUT, PATCH o DELETE
sobre sus IDs. Evitar especialmente publish/reorder, que pueden modificar varios
registros. Sus IDs protegidos, por tabla, son:

| Tabla | IDs originales protegidos |
| --- | --- |
| machine_family, machine_model | 910001 en cada tabla |
| maintenance_template | 910001, 910002 |
| template_section | 910001, 910002, 910003 |
| template_task | 910001, 910002, 910003 |
| template_task_inspection | 910001, 910002 |
| plantilla_tecnicos | 910001, 910002 |

Usar el prefijo exacto **TEST_LOCAL_CRUD_20261027_** en los registros nuevos.
`F`, `M`, `T`, `S`, `A`, `W`, `W910001`, `I` y los IDs auxiliares son variables
del registro de pruebas, nunca valores inventados. Sustituirlos por enteros reales
devueltos por API. No copiar IDs de ejemplos ni los IDs 910001 como IDs nuevos.

Copiar internamente runtime_crud_journal.example.json a un registro local de la
sesión. Anotar allí **todos** los IDs creados, incluidos snapshots y registros que
luego se borren mediante API. No versionar el registro completado ni respuestas
del servidor. El ejemplo se entrega con arrays vacíos y reviewed=false. Usar un
sufijo de sesión distinto si se repite la ronda. Tras completar la limpieza y
reiniciar secuencias, archivar el registro: no reutilizar IDs ni ejecutar ese
registro antiguo contra otra sesión. reviewed=true exige cotejar el registro con
los resultados de la sesión actual, no una autorización permanente de esos IDs.

## Camino mínimo de creación y lectura

Cada payload JSON de esta tabla es un ejemplo parametrizado: reemplazar `F`, etc.
por el número anotado, sin comillas. Los sufijos UPDATED conservan el prefijo.

| Paso / endpoint | Método | Payload mínimo | Esperado | ID a anotar | Dependencia / limpieza |
| --- | --- | --- | --- | --- | --- |
| /machine-families | POST | `{"name":"TEST_LOCAL_CRUD_20261027_FAMILY"}` | 201, objeto | F = id | Raíz propia; borrar al final |
| /machine-families/F | GET | Sin body | 200, mismo nombre/ID | Ningún ID nuevo | Lectura propia |
| /machine-families/F | PUT | `{"name":"TEST_LOCAL_CRUD_20261027_FAMILY_UPDATED"}` | 200, mismo ID | Conservar F | Solo familia nueva |
| /machine-models | POST | `{"name":"TEST_LOCAL_CRUD_20261027_MODEL","family_id":F,"manufacturer":"TEST_LOCAL_CRUD_20261027_MAKER","bond_value":0,"standard_days":1}` | 201 | M = id | M → F; borrar antes de F |
| /machine-models?family_id=F | GET | Sin body | Incluye M | Ninguno | Lectura filtrada |
| /machine-models/M | PUT | Mismo payload, name terminado en MODEL_UPDATED | 200, conserva family_id=F | Conservar M | PUT reemplaza varios campos: enviarlos completos |
| /templates | POST | `{"name":"TEST_LOCAL_CRUD_20261027_TEMPLATE","template_type":"ENSAMBLE","model_id":M}` | 201, version=1 | T = id | T → M |
| /templates/T | PUT | `{"name":"TEST_LOCAL_CRUD_20261027_TEMPLATE_UPDATED"}` | 200, template.id=T | Ninguno | Solo plantilla nueva |
| /sections | POST | `{"template_id":T,"title":"TEST_LOCAL_CRUD_20261027_SECTION","position":1}` | 201 | S = id | S → T, relación lógica sin FK |
| /sections?template_id=T | GET | Sin body | 200, contiene S | Ninguno | Parámetro obligatorio |
| /sections/S | PUT | `{"title":"TEST_LOCAL_CRUD_20261027_SECTION_UPDATED","position":1}` | 200 | Ninguno | Solo S nueva |
| /tasks | POST | `{"section_id":S,"title":"TEST_LOCAL_CRUD_20261027_TASK","code":"TEST_LOCAL_CRUD_20261027_CODE","expected_minutes":1,"position":1,"category":"Ensamble"}` | 201 | A = id | A → S |
| /tasks?section_id=S | GET | Sin body | 200, contiene A | Ninguno | Parámetro obligatorio |
| /tasks/A | PUT | `{"title":"TEST_LOCAL_CRUD_20261027_TASK_UPDATED","code":"TEST_LOCAL_CRUD_20261027_CODE","expected_minutes":2,"category":"Ensamble"}` | 200 | Ninguno | No omitir category; no modifica tareas 910001–3 |
| /templates/T/publish | POST | `{}` | 200, version=2 e is_published=true | Ninguno | SOLO T nueva; nunca publicar 910001/2 |
| /work-orders/from-template | POST | `{"template_id":T,"machine_serial":"TEST_LOCAL_CRUD_20261027_W_SERIAL","customer_name":"TEST_LOCAL_CRUD_20261027_W_CUSTOMER","comments":"TEST_LOCAL_CRUD_20261027_W_COMMENT"}` | 201; con este grafo propio, una tarea | W = id | W → T; anotar snapshot mediante GET siguiente |
| /work-orders/W/tasks | GET | Sin body | 200, una tarea con code propio | Todos los id de work_order_task | Hijos antes que W |
| /work-orders/from-template | POST | `{"template_id":910001,"machine_serial":"TEST_LOCAL_CRUD_20261027_SEED_SERIAL","customer_name":"TEST_LOCAL_CRUD_20261027_SEED_CUSTOMER","comments":"TEST_LOCAL_CRUD_20261027_SEED_COMMENT"}` | 201, template_version=1, model_id=910001 | W910001 = id | Lee seed; crea evento nuevo con marcador propio |
| /work-orders/W910001/tasks | GET | Sin body | 200, exactamente tres snapshots | Los tres id de work_order_task | No son las filas template_task del seed |
| /quality/template_task_inspection?section_id=910002 | GET | Sin body | 200, un punto de ensamble | Ningún ID nuevo | Lee seed, no lo cambia |
| /quality/inspection/request | POST | `{"work_order_id":W910001,"estacion":1,"inspection_type":"Inspección de ensamble"}` | 201 | I = inspection_order.id | I → W910001; usa plantilla de inspección 910002 |
| /quality/I/inspection_tasks | GET | Sin body | 200, un snapshot de inspección | Todos los id de inspection_order_task | IOT → I y punto original 910001 |
| /quality/I/insp_cancel | PUT | `{}` | 200, inspección cancelada | Ninguno | Opcional: UPDATE del evento propio; no cambia definición del seed |

No enviar un supuesto campo comments al POST de inspección como prueba de
propiedad: el handler no lo guarda. I y sus tareas se identifican por el ID
registrado y la cadena hacia W910001, cuyo serial/cliente/comments llevan marcador.
Los títulos/códigos de snapshots heredados del seed no llevan el prefijo CRUD;
su propiedad depende del padre propio y del registro explícito de IDs.

## DELETE controlado mediante API

Para completar D sin destruir el grafo que se usa en las pruebas, crear hojas
auxiliares y borrarlas inmediatamente. Sus IDs también quedan en el registro.
El cleanup admite IDs ya ausentes, pero rechaza IDs ocupados por filas ajenas.

| Endpoint | Método / payload de CREATE auxiliar | DELETE posterior | Esperado / anotación |
| --- | --- | --- | --- |
| /tasks | POST como A, title/code terminados en DELETE, section_id=S, position=2 | DELETE /tasks/A_DELETE | 201 → 204; anotar A_DELETE |
| /sections | POST title=TEST_LOCAL_CRUD_20261027_SECTION_DELETE, template_id=T, position=2 | DELETE /sections/S_DELETE | 201 → 200; sin hijos; anotar S_DELETE |
| /templates | POST name=TEST_LOCAL_CRUD_20261027_TEMPLATE_DELETE, template_type=ENSAMBLE, model_id=M | DELETE /templates/T_DELETE | 201 → 200; sin secciones; anotar T_DELETE |
| /machine-models | POST como M, name terminado en MODEL_DELETE, family_id=F | DELETE /machine-models/M_DELETE | 201 → 204; sin plantillas; anotar M_DELETE |
| /machine-families | POST name=TEST_LOCAL_CRUD_20261027_FAMILY_DELETE | DELETE /machine-families/F_DELETE | 201 → 204; sin modelos; anotar F_DELETE |
| /work-orders/from-template | POST como W desde T, con los tres marcadores terminados en DELETE | DELETE /work-orders/delete/W_DELETE | 201 → 200; registrar W_DELETE y sus tareas antes; nunca crear inspección para este evento |

Después de cada DELETE, GET por ID debe indicar 404 cuando exista esa ruta.
Para tareas/secciones usar el GET filtrado y comprobar ausencia de ese ID.
No usar DELETE de orden con inspecciones activas: inspection_order.work_order_id
es una relación lógica sin FK y ese DELETE no elimina las inspecciones.

## Materialización exacta de la plantilla 910001

**TAREAS_ESPERADAS_AL_CREAR_ORDEN_910001=3.**
build_test_seed.mjs define maintenance_template 910001 (ENSAMBLE, version=1),
con una sola template_section de id 910001. Hay tres template_task en esa sección:

| Definición original | Código | Posición del snapshot |
| --- | --- | --- |
| template_task 910001 | TEST_LOCAL_TAREA | 1 |
| template_task 910002 | LIB001 | 2 |
| template_task 910003 | LIB002 | 3 |

routes/workOrders.js, POST /from-template, selecciona las secciones por template_id,
recorre sus template_task por section_id y crea una work_order_task por cada una,
con posiciones consecutivas. Copia section_title, task_title, code,
expected_minutes y category. No modifica las definiciones. No copia aquí los dos
template_task_inspection de la plantilla 910002 ni crea una inspección automática.
La request de inspección de ensamble posterior usa la sección original 910002 y
materializa un único punto de inspección, en otra tabla y otro momento.

## Requests colgadas y hotfix preparado

GET sections, tasks y quality/template_task_inspection convertían undefined en
NaN y enviaban ese valor como parámetro integer a PostgreSQL. La consulta rechaza
con 22P02; los handlers async no tenían try/catch. Express 4 llama al handler sin
recoger su Promise rechazada (layer.js: handle_request). No queda una respuesta
JSON completada; el efecto observable depende también de la política de rechazo
del proceso. Un parámetro vacío se convertía en 0 y tampoco daba el 400 correcto.

Los tres handlers locales ahora exigen un string decimal entero positivo seguro
antes de acceder al pool. Falta/valor inválido → 400 con el nombre del parámetro.
Un rechazo de DB → 500 JSON sin detalle interno. requiredParentQuery.test.js
invoca los handlers con un pool falso: no ejecuta HTTP ni SQL.
El hotfix no está desplegado. Probar los casos 400 en API27 solo después de que
el administrador revise y aplique el cambio por su proceso autorizado.

## Limpieza posterior, todavía sin ejecutar

**Procedimiento vigente de cierre (2026-10-28):**
[20_CLEANUP_FINAL_FASE_A.md](20_CLEANUP_FINAL_FASE_A.md). El journal final
consolidado contiene 20 filas pendientes; excluye las bajas de CRUD y conserva
marcadores backend/frontend por tabla e ID. La siguiente secuencia sustituye la
estrategia anterior de reiniciar secuencias mientras aún existía el seed.

1. Completar el registro de IDs, cotejar cada respuesta y detener los escritores
   de prueba. Mantener las 14 semillas intactas. No tocar Logística.
2. Generar cleanup_runtime_test_calidad.sql con el registro local revisado:
   `node build_runtime_cleanup.mjs --manifest RUTA_LOCAL_AL_REGISTRO.json`.
   El generador solo escribe archivos; no los ejecuta. Sin manifiesto genera
   reviewed=false y aborta. El SQL final usa runtime_cleanup_manifest.json.
   Revisar el SQL generado antes de su
   futura ejecución por el administrador. Versionar el SQL no autoriza su ejecución:
   exige autorización explícita, journal revisado e IDs reales registrados durante
   las pruebas CRUD, incluso si el archivo ya está publicado en Git.
3. La limpieza comprueba la arquitectura, bloquea las tablas y exige que solo
   existan las 14 semillas originales exactas, el ledger y filas CRUD registradas.
   Cualquier dato ajeno, ID protegido, fila sin marcador/ascendencia propia o ID
   hijo no registrado ABORTA TODO antes de DELETE. No usa LIKE ni TRUNCATE.
4. Orden de borrado: inspection_order_task → inspection_order → work_order_task
   → work_order → template_task_inspection CRUD (si los hubiera) → template_task
   CRUD → template_section CRUD → maintenance_template CRUD → machine_model CRUD
   → machine_family CRUD. No elimina técnicos, el seed ni Logística.
5. El cleanup runtime NO reinicia secuencias. Exigir RUNTIME_CRUD_RESTANTES=0
   con COMMIT y ejecutar validate_runtime_cleanup_calidad.sql (READ ONLY), que
   exige las 14 semillas exactas y admite las siete secuencias TEST avanzadas.
6. Solo entonces ejecutar cleanup_seed_calidad_test.sql y exigir
   TEST_LOCAL_RESTANTES=0 con COMMIT. Ejecutar validate_test_cleanup_calidad.sql:
   TEST_LOCAL_RESTANTES=0 y APPLICATION_ROWS=0, sin errores.
7. Ejecutar el reset separado reset_sequences_after_test_calidad.sql únicamente
   con las 20 tablas de aplicación vacías. Reinicia las siete secuencias consumidas;
   las otras 13 deben seguir frescas. validate_create_calidad.sql debe terminar
   con CALIDAD_SCHEMA_VALIDO=SI. Detalle y orden exacto en el procedimiento vigente.

El SQL runtime nuevo solo fue revisado y probado offline con fixtures JavaScript;
no se ejecutó ni se certifica aquí por PostgreSQL. No inferir que pasa porque el
CREATE anterior pasó. Falta revisión operativa del registro y de ese SQL antes de
autorizar su ejecución futura.

## API27 frente al repositorio y promoción posterior

**API27 diverge del repo en código: NO CONFIRMADO.** El administrador todavía no
confirmó si modificó archivos o solo proxy/entorno. No se accedió al servidor.

| Diferencia declarada | Fuente local y del commit 34fb249 | Qué falta confirmar |
| --- | --- | --- |
| DB calidad | db.js ya admite APP_ENV=production con PGDATABASE=calidad | Valores no secretos y referencia del artefacto desplegado; no copiar credenciales |
| Prefijo /api27 | server.js fija /api10; no lee API_PREFIX | Diff sanitizado de server.js y/o regla de reescritura del proxy |
| Puerto 3027 | server.js fija const PORT=3010; no lee PORT | Si 3027 es el listener Node modificado o un listener/proxy externo |

Un prefijo público distinto puede provenir de un proxy que reescriba paths. Si
Node escucha realmente en 3027, el server.js local no obtiene eso por una variable
PORT: haría falta código distinto o un entrypoint diferente. Sin la copia/diff
sanitizada y la regla de proxy no se puede afirmar cuál ocurrió. Pedir solo esos
cambios no secretos. Antes de promoción, integrar las diferencias aprobadas en Git
y derivar el artefacto de un commit identificado; evitar parches exclusivos del
servidor. Este trabajo no cambia server.js, prefijos ni puerto ni hace deploy.

Logística queda fuera: faltan configuración Firebase Admin logistica-ar, Drive y
alta explícita del usuario autorizado. No se cambian Firebase ni Flutter y no se
prueban rutas /logistica/ en esta ronda.

Validación offline de esta preparación: 367/367 tests ejecutados PASS, 0 FAIL;
38 casos SQLite omitidos expresamente. Incluye nueve tests de los tres GET y
25 de la estrategia/artefactos de limpieza. No se ejecutó la suite descartable
PostgreSQL ni requests HTTP. Esta preparación se publicó posteriormente mediante
el commit «Prepara CRUD controlado y corrige parametros API», basado en 34fb249.
La publicación no ejecuta el cleanup ni autoriza un deploy o una modificación de DB.
