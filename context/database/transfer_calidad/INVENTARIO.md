# Inventario respaldado por el repositorio

Fecha: 2026-10-22. Rama `migracion-datos-historicos`, HEAD inspeccionado
`866fb772e4d4e7f48b7c7d95f0b1bc8cf6128956`. Sin conexion a PostgreSQL.

**15 tablas del proyecto anterior a Logistica**. El runtime de API10 en este
checkout referencia **20**: esas 15 y cinco futuras de Logistica. Existe ademas
un ledger usado por herramientas PROD y cuatro historicos LOCAL: **25 nombres
de tabla documentados**, no 25 tablas productivas confirmadas. Tres historicos
tienen aplicadores en `api10/scripts/importers`; `preembarque_legacy` tiene el
suyo en `database/importers`. No se cuentan CTEs como tablas.

Base de evidencia: `context/api10/server.js`, `routes/`, `repositories/`,
`auth/`, `services/`, `scripts/importers/`, `context/database/create tables.sql`,
`functions/functions.sql`, `migrations/local/`, `migrations/prod/` e importadores.
Las politicas/services no agregan tablas: delegan a los repositories.

En la matriz: `R/I/U/D` = lectura/insert/update/delete directo. `D cascada` es
dependencia, no una sentencia DELETE adicional. Las FK son las que aparecen en
el DDL versionado, **no certificacion del catalogo real**. `L:` indica relacion
logica sin FK declarada en ese DDL. Se conserva esa distincion: no se agregan
constraints para convertir relaciones logicas en FK. Nombres bajo `public`
segun DDL calificado y consultas explicitas; las consultas sin schema de API10
exigen comprobar tambien el search_path efectivo del rol/servicio.

`S(t)` significa secuencia candidata `public.<tabla>_id_seq`. El DDL usa SERIAL
en las 15 tablas; el nombre real/ownership/default se descubre por catalogos,
no concatenando nombres en la copia. `T?` = sin trigger declarado en el DDL
base disponible; debe inventariarse en origen, no significa que no exista.
`M_*` son funciones llamadas directamente por API10; ejecutan UPDATE aunque
se invoquen con SELECT. Todas las tablas copiadas requieren conservar **todas
sus filas**, incluidos nulos/anomalias y tablas actualmente vacias.

| Tabla public | Clasificacion | Modulo/ruta API10 (archivos relativos a context/api10) | Acceso | Dependencias FK / relaciones logicas | Secuencias | Triggers/funciones | Requiere datos |
|---|---|---|---|---|---|---|---|
| machine_family | OTRO: catalogo | routes/machineFamilies.js `/machine-families`; machineModels.js; workOrders.js; productionBonds.js | R/I/U/D | Sin FK saliente; padre de machine_model | S(t) | T? | SI |
| machine_model | OTRO: catalogo | routes/machineModels.js `/machine-models`; templates.js; workOrders.js; quality.js; productionBonds.js | R/I/U/D | family_id -> machine_family.id, ON DELETE SET NULL | S(t) | T? | SI |
| machine_customs | PRODUCCION | routes/customs.js `/customs/template_custom` | R/I/U/D | Sin FK declarada; catalogo de personalizaciones | S(t) | T? | SI |
| maintenance_template | PLANTILLAS/TAREAS | routes/templates.js `/templates`; workOrders.js; quality.js; productionBonds.js | R/I/U/D | model_id -> machine_model.id, SET NULL | S(t) | T? | SI |
| template_section | PLANTILLAS/TAREAS | routes/sections.js `/sections`; workOrders.js; quality.js | R/I/U/D | L: template_id -> maintenance_template.id; no FK en DDL disponible | S(t) | move_section; T? | SI |
| template_task | PLANTILLAS/TAREAS | routes/tasks.js `/tasks`; workOrders.js | R/I/U/D | section_id -> template_section.id, CASCADE | S(t) | move_task; T? | SI |
| template_task_inspection | PLANTILLAS/TAREAS; CALIDAD | routes/quality.js `/quality/template_task_inspection`, `/quality/reorder`, tareas de inspeccion | R/I/U/D | L: section_id -> template_section.id; sin FK declarada | S(t) | move_task_inspection; T? | SI |
| work_order | ORDENES | routes/workOrders.js `/work-orders`; quality.js; productionBonds.js | R/I/U/D | template_id -> maintenance_template.id RESTRICT; model_id -> machine_model.id NO ACTION | S(t) | T? | SI |
| work_order_task | ORDENES; PRODUCCION; LIBERACIONES | routes/workOrders.js `/work-orders/...tasks`, avance/cierre; quality.js `/quality/liberar_orden/:id`, reinicio/cierre; productionBonds.js | R/I/U; D cascada | work_order_id -> work_order.id CASCADE; LIB001/LIB002 son filas/codigos de esta tabla | S(t) | T? | SI |
| work_order_customs | PRODUCCION | routes/customs.js `/customs/custom_wo`, `/customs/workorder/:work_order_id`; productionBonds.js | R/I/U/D | work_order_id -> work_order.id CASCADE | S(t) | T? | SI |
| inspection_order | CALIDAD; LIBERACIONES | routes/quality.js `/quality/inspection/...`, asignacion, cierre/reinicio | R/I/U | inspection_template_id -> maintenance_template.id y model_id -> machine_model.id NO ACTION; L: work_order_id -> work_order.id sin FK declarada | S(t) | T? | SI |
| inspection_order_task | CALIDAD; LIBERACIONES | routes/quality.js tareas/avance/desviaciones/reinicio/cierre | R/I/U | L: inspection_order_id -> inspection_order.id; template_task_inspection_id -> template_task_inspection.id; ambas sin FK declarada | S(t) | T? | SI |
| desviaciones_calidad | CALIDAD | routes/quality.js `/quality/desviaciones` | R/I | L: id_actividad -> inspection_order_task.id; sin FK declarada | S(t) | T? | SI |
| prod_delayments | PRODUCCION | routes/customs.js `/customs/retrasos`; productionBonds.js `/bonds` | R/I; D cascada | id_actividad -> work_order_task.id CASCADE | S(t) | T? | SI |
| plantilla_tecnicos | OTRO: catalogo compartido; PRODUCCION/CALIDAD | routes/quality.js `/quality/inspectors`; productionBonds.js `/bonds` | R | Sin FK declarada. Join logico correo_tecnico con correos WO | S(t) | T? | SI; incluso si otro sistema tambien la usa |

Las diez FK salientes declaradas en el DDL base quedan dentro de estas 15.
No hay evidencia estatica de una tabla externa obligatoria adicional. Las FK
faltantes arriba no se inventan a partir de los joins. El archivo
`create tables.sql` tiene indices inline y dependencias fuera de orden; no es
un baseline ejecutable fiable. Las definiciones reales se obtendran con pg_dump.

## Historicos existentes en el repositorio, presencia productiva pendiente

Estado de los cuatro nombres siguientes: **PENDIENTE VERIFICACIÓN PROD**.
Su existencia confirmada en `artecnologia_test_local` no demuestra presencia en
`artecnologia`. El generador de dump productivo exige ahora aprobacion explicita
de cada historico presente; el ensayo LOCAL los incluye solo como simulacion.

| Tabla public | Clasificacion | Consumidor/evidencia | Acceso | FK | Secuencias | Triggers/funciones | Requiere datos |
|---|---|---|---|---|---|---|---|
| desviaciones_calidad_legacy | HISTORICO EXISTENTE; CALIDAD | api10/scripts/importers/apply_desviaciones_legacy_local.js; migrations/local/20261009_create_desviaciones_calidad_legacy.sql | R/I solo aplicador LOCAL; sin router registrado | Ninguna | IDENTITY de id, descubrir secuencia | Ninguno en migracion | SI si existe en artecnologia; si no, NO en esta transferencia |
| liberaciones_empaque_legacy | HISTORICO EXISTENTE; LIBERACIONES | api10/scripts/importers/apply_liberaciones_empaque_legacy_local.js; migrations/local/20261009_create_liberaciones_empaque_legacy.sql | R/I solo LOCAL; sin router | Ninguna | IDENTITY de id | Ninguno en migracion | SI si existe en origen; si no, NO |
| procesos_liberacion_legacy | HISTORICO EXISTENTE; LIBERACIONES | api10/scripts/importers/apply_procesos_liberacion_legacy_local.js; migrations/local/20261012_create_procesos_liberacion_legacy.sql | R/I solo LOCAL; sin router | Ninguna | IDENTITY de id | Ninguno en migracion | SI si existe en origen; si no, NO |
| preembarque_legacy | HISTORICO EXISTENTE | database/importers/apply_preembarque_legacy_local.js; migrations/local/20261015_create_preembarque_legacy.sql | R/I solo LOCAL; sin router API10 | Ninguna | BIGSERIAL de id | Ninguno en migracion | SI si existe en origen; si no, NO |

Sus cuatro migraciones rechazan `calidad` porque exigen
`artecnologia_test_local`. **No se ejecutan ni adaptan como parte de esta copia**.
No se traen datos desde LOCAL, Sheets o XLSX. Si un historico ya existe en
artecnologia, su estructura/datos se exportan AS-IS; si no existe se conserva
ausente. La presencia futura requiere una decision aparte.

## Logistica nueva: excluir del respaldo inicial, crear despues

| Tabla public | Clasificacion | Modulo/ruta/evidencia | Acceso | FK | Secuencias | Triggers/funciones | Requiere datos iniciales |
|---|---|---|---|---|---|---|---|
| logistica_authorized_users | LOGISTICA NUEVA | auth/requireLogisticaAuthorizedUser.js, `/logistica/*`; primera PROD | R runtime; administracion posterior separada | Sin saliente | BIGSERIAL id | Ninguno declarado | NO; vacia al crear, altas aprobadas despues |
| logistica_deliveries | LOGISTICA NUEVA | routes/logisticaDeliveries.js; repositories/logisticaDeliveryList.js, logisticaEvidence.js, logisticaCompletion.js; `/logistica/entregas` | R/I/U | authorized_user_id -> logistica_authorized_users.id | BIGSERIAL id | Ninguno declarado | NO |
| logistica_delivery_evidence | LOGISTICA NUEVA | repositories/logisticaEvidence.js, logisticaDeliveryList.js, logisticaCompletion.js; `/logistica/entregas/:id/evidencias` | R/I/U | delivery_id -> logistica_deliveries.id | BIGSERIAL id | Ninguno declarado | NO; debe seguir vacia para la tercera PROD |
| entregas_logistica_legacy | LOGISTICA NUEVA (historico futuro) | repositories/logisticaDeliveryHistory.js `/logistica/entregas/historial`; importador PROD separado | R runtime; R/I importador | Ninguna, independiente de WO | BIGSERIAL id | Ninguno declarado | NO; importacion posterior fuera del alcance |
| logistica_legacy_owner_mapping | LOGISTICA NUEVA | repositories/logisticaDeliveryHistory.js; septima PROD | R runtime; administracion I/U posterior | authorized_user_id -> logistica_authorized_users.id RESTRICT | BIGSERIAL id | protect_logistica_legacy_owner_mapping(); row_guard I/U/D y truncate_guard | NO; no copiar mappings LOCAL |
| logistica_schema_migrations | LOGISTICA NUEVA; OTRO/versionado | migrations/prod/logistica_prod_support.js y siete SQL PROD | R/I herramientas; no runtime API10 | Sin FK | Ninguna; PK migration_name TEXT | Ninguno declarado | NO al inicio; luego SI los siete registros producidos por sus migraciones |

No existe una tabla adicional de bonos materializados, de liberaciones modernas
o de versiones historicas de plantilla en el alcance revisado. Los CTEs
`customs_sum`, `time_delay_sum`, `dias_laborales_calc`, `main_stats`,
`secondary_stats`, `page`, `clock`, `cur`, `ordered`, `final`, `ord` y
`generate_series` no son tablas de negocio que deban copiarse.

## Objetos auxiliares y dependencias externas

Se esperan 15 secuencias SERIAL base; hasta cuatro adicionales si existen los
historicos, y cinco nuevas despues de las siete PROD. Son expectativas del
codigo, no conteos certificados en PostgreSQL. Preservar tambien secuencias
usadas en defaults sin OWNED BY y cualquier dependencia indirecta revisada.
Las tres funciones `move_section`, `move_task`, `move_task_inspection` son
obligatorias; `functions/functions.sql` solo contiene cuerpos parciales, sin
firmas ni atributos completos. No reconstruirlas inventando su CREATE.

`snapshot.sql` captura PK, FK, UNIQUE, CHECK, exclusion constraints si existen,
defaults, identity, indices, triggers de usuario y sus funciones, reglas,
politicas RLS, ACL/owners y estado de secuencias. Los triggers internos de FK
son recreados por PostgreSQL al restaurar sus constraints, no se copian a mano.
`dependencies.sql` enumera dependencias de catalogo, tipos/dominios/collations,
funciones de defaults/indices/CHECK/policies y FK entrantes/salientes.

Pendientes externos: catalogo real, funciones llamadas desde cuerpos o SQL
dinamico, extensiones/versiones, lenguaje de funciones, esquemas adicionales,
roles/permisos, tablespaces, search_path de API10, posibles particiones,
large objects, foreign tables/servidores remotos y dependencias operacionales.
Revisar todos los cuerpos y rutinas transitivas; pg_depend no es cierre
funcional completo para PL/pgSQL. Una dependencia no registrada exige ampliar
explicitamente el manifiesto, las consultas y las listas TOC. Una FK entrante
desde una tabla ajena no obliga por si sola a migrar esa tabla.

`plantilla_tecnicos` es una dependencia directa aunque sea compartida. Firebase
y Google Drive son dependencias externas de Logistica, no tablas que deban
exportarse; se conservan URLs/JSON de evidencias como datos. No se contactaron
esos servicios. La configuracion y permisos del runtime no los transfiere pg_dump.
