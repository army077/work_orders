# Cleanup final de Fase A — preparado, sin ejecutar (2026-10-28)

> Actualización vigente (29/10/2026): el administrador confirmó FASE A cerrada,
> aplicación=0, TEST=0, ledger=7 y siete secuencias restauradas. API27 detenida.
> El hotfix productivo ya está preparado: SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO.
> El contenido inferior conserva la preparación histórica del cleanup, sin ordenar
> repetirlo. El orden vigente está en [10_RUNBOOK_CUTOVER_FINAL.md](10_RUNBOOK_CUTOVER_FINAL.md).


Rama `migracion-datos-historicos`; HEAD publicado
`51a743fbfc5823afb075f8268522bbfcc17cb1eb`. Este documento sustituye las
instrucciones anteriores de reset dentro del cleanup runtime. No autoriza ejecutar
SQL. El administrador debe revisar estos artefactos y ejecutarlos únicamente en
el entorno TEST autorizado de API27/calidad, nunca en producción.

La aceptación comunicada por el usuario es API27, CRUD web de familias, modelos,
plantillas, secciones y tareas, HTTP 400 y orden desde 910001: PASS, con tres tareas
materializadas. Seed original y producción intactos; cleanup todavía pendiente.

## Journal consolidado

Fuentes revisadas localmente: journal frontend y sus bajas confirmadas, su copia
del registro backend en `reserved_backend`, y la lista persistente confirmada
por el usuario. No se encontró un journal backend independiente en el workspace;
no se inventaron IDs ni dependencias adicionales. Los journals, respuestas API,
rutas locales y hashes de esas evidencias no forman parte de esta publicación.

[runtime_cleanup_manifest.json](runtime_cleanup_manifest.json) es el manifiesto
publicable: contiene únicamente IDs pendientes, marcadores por ID y referencia
de la aprobación. `reviewed=true` significa revisión offline de esta lista, sin permiso
de ejecución (`sql_execution_authorized=false`). El journal frontend conserva el
historial de altas/bajas y `reviewed=false`; no se modifica ni se versiona.

`RUNTIME_ROWS_TO_DELETE = 20`

| Tabla | IDs pendientes | Cantidad |
| --- | --- | --- |
| work_order_task | 1, 2, 3, 4, 5, 6, 7 | 7 |
| work_order | 1, 2, 3 | 3 |
| template_task | 1, 2 | 2 |
| template_section | 1, 2 | 2 |
| maintenance_template | 1, 2 | 2 |
| machine_model | 1, 2 | 2 |
| machine_family | 1, 2 | 2 |

`inspection_order`, `inspection_order_task` y `template_task_inspection` runtime:
ninguno. Tampoco se registraron customs, desviaciones, demoras ni Logística runtime.
Cualquier fila allí provoca aborto; no se agrega al manifiesto automáticamente.
Los ID 3 de familias, modelos, plantillas, secciones y tareas fueron eliminados
durante CRUD frontend y quedan excluidos. Si reaparecen, se aborta.

Los dos marcadores se comprueban por tabla e ID: backend
`TEST_LOCAL_CRUD_20261027_` y frontend `TEST_LOCAL_CRUD_FRONT_20261027_`.
Las tareas materializadas se acreditan por ID y orden propia aunque hereden
contenido del seed. Los marcadores solos nunca autorizan un borrado.

## Runtime y seed

El generador offline se reproduce con:

```text
node context/database/deploy_calidad/build_runtime_cleanup.mjs --manifest context/database/deploy_calidad/runtime_cleanup_manifest.json
```

Solo escribe SQL; no lo ejecuta. Sin manifiesto genera un cleanup deshabilitado.
El SQL final exige cada ID pendiente presente; un ID faltante obliga a revisar
el journal. No debe reintentarse a ciegas después de un COMMIT exitoso.

`cleanup_runtime_test_calidad.sql` bloquea las 21 tablas, comprueba PG16/calidad,
esquema, dependencias y ledger, contenido completo de las 14 semillas y todos
los datos runtime antes de borrar. Orden: inspection_order_task → inspection_order
→ work_order_task → work_order → template_task_inspection → template_task →
template_section → maintenance_template → machine_model → machine_family.
Las listas de inspecciones están vacías; no autorizan borrados allí. Se comprueba
otra vez que solo quedan las 14 semillas y las siete filas del ledger.
Sin TRUNCATE, sin borrados por prefijo y sin cambios de secuencias.

`cleanup_seed_calidad_test.sql` exige primero runtime=0 y exactamente las 14
filas originales sin cambios. Aborta ante datos ajenos o referencias inesperadas.
Borra por ID y contenido completo, en orden FK:

| Tabla seed TEST | IDs | Filas |
| --- | --- | --- |
| plantilla_tecnicos | 910001, 910002 | 2 |
| template_task_inspection | 910001, 910002 | 2 |
| template_task | 910001, 910002, 910003 | 3 |
| template_section | 910001, 910002, 910003 | 3 |
| maintenance_template | 910001, 910002 | 2 |
| machine_model | 910001 | 1 |
| machine_family | 910001 | 1 |

Después comprueba los IDs TEST restantes y que las 20 tablas de aplicación
estén vacías. No reinicia secuencias ni elimina el ledger.

## Decisión de secuencias

`reset sequences necesario = SI`, exclusivamente para recuperar el baseline
exacto requerido aquí. DELETE no recupera números consumidos, incluso al borrar
las filas auxiliares de CRUD. `validate_create_calidad.sql` exige en las **20**
secuencias `last_value=1` e `is_called=false`; no se relaja ese validador.

Estas siete secuencias avanzaron según las altas registradas:

| Secuencia | ID consumido mínimo demostrado |
| --- | --- |
| machine_family_id_seq | 3 |
| machine_model_id_seq | 3 |
| maintenance_template_id_seq | 3 |
| template_section_id_seq | 3 |
| template_task_id_seq | 3 |
| work_order_id_seq | 3 |
| work_order_task_id_seq | 7 |

Los cinco ID 3 de maestros/secciones/tareas ya borrados siguen contando como
consumo. No se consultó DB: esos valores son mínimos demostrados, no una lectura
actual de `last_value`; intentos fallidos también pueden consumir números.
No hay evidencia de consumo de las otras 13 secuencias: deben seguir frescas o
los guards abortan, sin resetearlas automáticamente.

`reset_sequences_after_test_calidad.sql` es separado y transaccional, usa
`ALTER SEQUENCE ... RESTART WITH 1` solo en esas siete secuencias. Antes del primer
RESTART bloquea todas las tablas y exige ausencia de **cualquier** fila de
aplicación: runtime, seed TEST y datos ajenos; valida esquema, propiedad y
dependencias de secuencias y las siete filas exactas del ledger. Las otras 13
secuencias deben estar frescas. Después exige las 20 frescas. Un error aborta
todo el reset. No usa setval, TRUNCATE ni altera valores con filas presentes.
Mantener detenidos todos los escritores hasta la validación final, incluidas
sesiones que puedan llamar nextval directamente.

El seed operativo existente comprueba baseline vacío y secuencias frescas antes
de insertar; posteriormente ajusta siete secuencias maestras a 9, 52, 131, 406,
1251, 223 y 131, respectivamente. No ajusta work_order ni work_order_task. Por
eso su ajuste futuro no sustituye este reset ni evita el requisito de entrada.
Se revisó como texto y se dejó intacto. Su hotfix semántico sigue pendiente:
`SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B = SI`.

## Orden exacto del administrador

1. Bloquear nuevas escrituras API27 y cualquier otro escritor de calidad; esperar
   solicitudes/transacciones en vuelo. Verificar que se trabaja en el entorno
   TEST aprobado, no en producción. Mantener el bloqueo hasta terminar.
2. Revisar el journal final de 20 filas y ejecutar
   `cleanup_runtime_test_calidad.sql`. Exigir `RUNTIME_CRUD_RESTANTES=0`,
   `SEMILLAS_ORIGINALES_14_CONSERVADAS` y COMMIT exitoso.
3. Ejecutar `validate_runtime_cleanup_calidad.sql` (READ ONLY). Exigir
   `RUNTIME_CRUD_RESTANTES=0`, `SEMILLAS_ORIGINALES=14` y fin sin error. Verifica
   contenido completo del seed y ausencia de cualquier otro dato de aplicación;
   admite que las siete secuencias TEST sigan avanzadas.
4. Ejecutar `cleanup_seed_calidad_test.sql`, solo tras el paso anterior.
   Exigir `TEST_LOCAL_RESTANTES=0` y COMMIT exitoso.
5. Ejecutar `validate_test_cleanup_calidad.sql` (READ ONLY). Exigir
   `TEST_LOCAL_RESTANTES=0`, `APPLICATION_ROWS=0` y fin sin error. Verifica todas
   las tablas vacías y ledger válido; solo admite diferencias de estado en las
   siete secuencias TEST conocidas mientras se prepara el reset.
6. Ejecutar `reset_sequences_after_test_calidad.sql`: en esta revisión se
   determinó necesario. Exigir `SEQUENCES_BASELINE_RESTAURADAS=SI` y COMMIT exitoso.
   Si el preflight encuentra una fila TEST/runtime/ajena, aborta sin RESTART.
7. Ejecutar `validate_create_calidad.sql` (READ ONLY). Exigir
   `CALIDAD_SCHEMA_VALIDO=SI`, `application_rows=0`, 21 tablas,
   `ledger_rows=7`, secuencias frescas y ausencia de incidencias. Conservar salidas.

Resultado final esperado: `CALIDAD_SCHEMA_VALIDO = SI`, tablas de aplicación
vacías y ledger conservado. Este resultado es una expectativa para la futura
ejecución, no una certificación de la DB actual. Ante error, salida incompleta o
COMMIT fallido: STOP; no quitar guards ni ampliar IDs. Los scripts verifican el
nombre calidad y PG16, pero esos datos no distinguen hosts: verificar el destino
TEST forma parte del paso 1.

Fase B sigue bloqueada. No modificar ni ejecutar `seed_calidad_operativo.sql`,
no conectar a producción y no tocar Flutter como parte de este cierre.

## Evidencia de esta preparación

Verificación offline con fixtures JavaScript, reproducción de artefactos y
contratos de seguridad del SQL. Sin motor SQL ni prueba contra PostgreSQL en
esta tarea. El árbol ya contenía cambios locales de auditoría/semántica y archivos
sin seguimiento; se conservaron. El reporte de entrega indica solo los archivos
tocados por esta preparación. La publicación Git del cierre no ejecuta SQL,
cleanup ni despliegues.

`tests = 237/237 PASS`, cero fallos y cero omitidos. Suites: runtime_cleanup,
final_cleanup, test_seed, clean_baseline, semantic_baseline, phase_a_delivery y
runtime_baseline (`node --test` sobre sus siete archivos `.test.mjs`). Los handlers
se prueban con respuestas simuladas; no ejecutan las cadenas SQL. No se ejecutaron
las suites SQLite ni PostgreSQL. `git diff --check = PASS`.

El hash Git de seed_calidad_operativo.sql coincide con HEAD:
`886a3e1f8d1171962c5c69c1fe3bafda32f9d6df`.

Archivos modificados/creados por esta tarea, todos en esta carpeta:

```text
00_LEEME_ADMIN.md
10_RUNBOOK_CUTOVER_FINAL.md
19_PLAN_CRUD_API27.md
20_CLEANUP_FINAL_FASE_A.md                         (nuevo)
build_clean_baseline.mjs
build_runtime_cleanup.mjs
build_test_seed.mjs
phase_a_cleanup_support.mjs                      (nuevo)
cleanup_runtime_test_calidad.sql
cleanup_seed_calidad_test.sql
reset_sequences_after_test_calidad.sql           (nuevo)
validate_runtime_cleanup_calidad.sql             (nuevo)
validate_test_cleanup_calidad.sql                (nuevo)
runtime_cleanup_manifest.json                   (nuevo; sin journals locales)
runtime_cleanup.test.mjs
test_seed.test.mjs
final_cleanup.test.mjs                           (nuevo)
```

`SQL ejecutado = NO`; `DB modificada = NO`; `producción modificada = NO`;
`Fase B ejecutada = NO`. Flutter y seed productivo intactos.
