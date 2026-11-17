# Inventario del baseline limpio

Decisión vigente: **no transferir eventos/históricos de artecnologia**. Solo se
admite configuración vigente aprobada mediante el seed separado descrito en
[13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md). El export productivo ya fue recibido;
conteos, limitaciones y aceptación en [16_SEED_PROD_VALIDADO_OFFLINE.md](16_SEED_PROD_VALIDADO_OFFLINE.md).
Este inventario describe el baseline vacío, antes de ese seed. Fuentes: las rutas registradas
por `context/api10/server.js`, sus repositories/auth/services, manifest.psql,
`context/database/create tables.sql`, `functions/functions.sql` y las siete
migraciones PROD. Auditoría exclusivamente de archivos, sin conexión a PostgreSQL.

`create_calidad.sql` crea 21 tablas: las 15 base del manifest, las cinco de negocio
Logística y su ledger. Las cuatro legacy del manifest (`desviaciones_calidad_legacy`,
`liberaciones_empaque_legacy`, `procesos_liberacion_legacy`, `preembarque_legacy`)
solo tienen importadores locales, sin router registrado: no se crean en este
baseline. `entregas_logistica_legacy` y mappings sí se consultan desde Mis registros
y deben existir vacías. No hay otra tabla de bonos/estados/liberaciones que crear.

| Tabla public | Clasificación | Estado inicial / SEED_REQUERIDO | Funcionalidad afectada si queda vacía |
| --- | --- | --- | --- |
| machine_family | CATALOGO | SEED_REQUERIDO para catálogo de máquinas | Listado/selección de familias sin opciones; se pueden crear nuevas por CRUD. |
| machine_model | CATALOGO | SEED_REQUERIDO para flujos por modelo | Selectores sin modelos; inspecciones por modelo y cálculos de bonos carecen de su configuración de modelo. No bloquea Logística. |
| machine_customs | CATALOGO | Vacía; carga opcional | Catálogo de personalizaciones sin opciones. El CRUD admite configuraciones nuevas; no bloquea el resto. |
| maintenance_template | CONFIGURACION | SEED_REQUERIDO | `/work-orders/from-template` devuelve 404 `template not found`; crear inspecciones devuelve 404 sin plantilla INSPECCION publicada para modelo/tipo. |
| template_section | CONFIGURACION | SEED_REQUERIDO con las plantillas | No se materializan secciones/tareas de órdenes. Inspección exige una sección cuyo título coincida con inspection_type; sin ella devuelve 404. |
| template_task | CONFIGURACION | SEED_REQUERIDO para órdenes con actividades | Las nuevas órdenes no reciben tareas. Liberación depende de tareas/códigos LIB001/LIB002; no se insertan esos códigos como eventos iniciales. |
| template_task_inspection | CONFIGURACION | SEED_REQUERIDO para inspecciones con puntos | Las inspecciones nuevas no reciben puntos de revisión. |
| plantilla_tecnicos | CATALOGO | SEED_REQUERIDO para asignación y bonos | `/quality/inspectors` devuelve lista vacía; bonos por técnico parte de este catálogo y no presenta técnicos. Deben aprobarse los datos y puestos; no hay fixture inicial. |
| work_order | EVENTO | Vacía, sin seed | Las consultas empiezan sin órdenes; las nuevas se crean desde configuración aprobada. |
| work_order_task | EVENTO | Vacía, sin seed | Se materializan al crear órdenes, no mediante datos históricos. |
| work_order_customs | EVENTO | Vacía, sin seed | Sin personalizaciones de órdenes anteriores. |
| inspection_order | EVENTO | Vacía, sin seed | Sin inspecciones anteriores. |
| inspection_order_task | EVENTO | Vacía, sin seed | Los nuevos puntos se materializan desde configuración. |
| desviaciones_calidad | EVENTO | Vacía, sin seed | Sin desviaciones anteriores. |
| prod_delayments | EVENTO | Vacía, sin seed | Sin retrasos anteriores. |
| logistica_authorized_users | SEGURIDAD | SEED_REQUERIDO, alta aprobada separada | Incluso con Firebase válido, todas las rutas protegidas Logística responden 403 `Usuario no autorizado` mientras no exista el UID/proyecto activo. La prueba Samsung no puede completar el flujo con esta tabla vacía. |
| logistica_deliveries | EVENTO | Vacía, sin seed | Se crean entregas nuevas después de autorizar al usuario. |
| logistica_delivery_evidence | EVENTO | Vacía, sin seed | Las nuevas fotos/firmas se registran durante el flujo moderno. |
| entregas_logistica_legacy | HISTORICO | Vacía, sin seed | El componente histórico de Mis registros devuelve vacío; el flujo moderno no requiere importar el Sheet. |
| logistica_legacy_owner_mapping | SEGURIDAD | Vacía, sin seed | Sin asociaciones históricas; no impide consultar entregas modernas. |
| logistica_schema_migrations | SISTEMA | Siete metadatos de versión incluidos por el baseline | Necesarios para inspectSchema/validadores/importador PROD existentes. No son entregas, usuarios, mappings ni historial de negocio. |

El baseline no copia seeds desde artecnologia, Sheets, fixtures o TEST.
El seed separado ya deriva del export READ ONLY aprobado de artecnologia:
1.139 filas maestras, sin datos inventados. No copia usuarios de
Logística: el alta es manual y está parametrizada/documentada por separado.
El baseline no contiene usuarios reales ni correos.
HTTP health puede responder 200 con todas las tablas vacías; eso no certifica
operación funcional completa. **API10 no puede cubrir todos sus flujos sin seeds.**

## Normalización del DDL versionado

La fuente base contiene `INDEX`/`UNIQUE INDEX` dentro de CREATE TABLE, sintaxis que
no es directamente ejecutable en PostgreSQL. Se convierten a CREATE INDEX y
constraints UNIQUE con los nombres y columnas existentes. Las FK se conservan
tal como están declaradas; relaciones lógicas sin FK no se transforman en nuevas
restricciones. Las tablas se ordenan por dependencias FK.

Los cuerpos `move_*` no incluyen firmas completas. Para este baseline nuevo se
define el contrato que consume el runtime: tres argumentos integer (propietario,
id, nueva posición), retorno void, PL/pgSQL SECURITY INVOKER, search_path pg_catalog
y tablas public calificadas. Se reutilizan los cuerpos versionados. No se afirma
reproducir atributos no capturados del servidor anterior ni triggers desconocidos.
No se importan objetos del catálogo real de artecnologia.

El cuerpo de protección de auditoría Logística, sus dos triggers, columnas,
constraints e índices se toman de los bloques DDL PROD. Los ADD COLUMN/CONSTRAINT
se incorporan al CREATE inicial. Se reutiliza el fingerprint final preparado,
normalizando CRLF en el texto de funciones para los checkouts Windows. Para comparar
con los fixtures temporales que originaron los states se hace visible public en
el search_path de inspección y se conserva el namespace explícito de la función
del trigger. La fuente PG16 confirma que el deparse de relaciones/funciones depende
de su visibilidad: [ruleutils.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/utils/adt/ruleutils.c).
Esto cambia la representación de metadatos, no los objetos ni sus restricciones.
Las extensiones instaladas plpgsql/citext se exigen y reportan, sin recrearlas ni
enumerar sus objetos por nombre; la exclusión de infraestructura usa pg_depend.

El ledger registra que el baseline **incluye** los siete estados/checksums.
Su comentario distingue esto de siete ejecuciones incrementales. Los timestamps
de registro tienen orden determinista dentro de la transacción. No ejecutar las
migraciones después: su estado final ya existe. No se añaden permisos o roles
inventados; el ejecutor es propietario. El administrador debe otorgar al rol API10
sus permisos habituales de tablas/secuencias/funciones antes de operar.

La validación es **inicial**, antes de cargar seeds o registrar eventos: exige las
20 tablas de negocio vacías, secuencias frescas y siete metadatos de sistema.
Comprueba estructura base, índices/PK/FK/CHECK/defaults, firmas/cuerpos move_*,
ownership de secuencias, ausencia de objetos inesperados y fingerprint Logística.
No sustituye autorización de usuarios ni la prueba funcional Firebase/Drive.

## Reproducibilidad y límites

`node context/database/deploy_calidad/build_clean_baseline.mjs` regenera únicamente
los dos SQL desde fuentes del repositorio; no conecta ni ejecuta SQL.
Los tests offline verifican inventario, normalización, dependencias y equivalencia
de declaraciones. No se ejecutó el baseline en PostgreSQL: su compilación/resultado
real aún no están certificados. Un error de la validación integrada aborta antes
del COMMIT. El indicador de creación está dentro de la transacción: requiere además
COMMIT exitoso, no ROLLBACK. No aceptar un resultado incompleto ni reintentar sobre
una instalación.
