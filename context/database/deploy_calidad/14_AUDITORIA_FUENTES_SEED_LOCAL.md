# Auditoría de fuentes locales para el seed operativo

**Antecedente previo a recibir el export productivo.** Posteriormente el usuario
aportó el JSON real y el query ejecutado; EXPORT_CONFIG_PROD_RECIBIDO=SI.
La entrega vigente está en [16_SEED_PROD_VALIDADO_OFFLINE.md](16_SEED_PROD_VALIDADO_OFFLINE.md).
No solicitar otro export por las conclusiones históricas de este documento.

Fecha: 2026-10-23. Workspace exclusivo: C:/Proyectos/work_orders/work_orders.
Rama migracion-datos-historicos; HEAD ad73580c0d7e6e3b9e886f8e8353c2a24056a83a.
No se ejecutó SQL contra PostgreSQL ni se restauraron dumps. No se abrió conexión
a ninguna DB de aplicación; los tests offline usan fixtures en memoria.

**Fuente local con filas maestras: SI. Fuente local utilizable como configuración
productiva vigente: NO.** Hay 14 filas en un dump de artecnologia_test_local;
son datos explícitos TEST y no incluyen técnicos. Ninguno de los siete maestros
productivos se puede reconstruir con filas vigentes demostrables. El seed conserva
su aborto PENDIENTE_EXPORT_CONFIG_PROD, sin INSERT ni filas inventadas.

## Alcance inspeccionado

Recorrido completo de los archivos actuales, incluyendo ocultos, ignorados y los
cuatro untracked ajenos, que solo se leyeron. Al iniciar: 1.232 archivos fuera de
.git y node_modules: 226 aplicación/repositorio, nueve dist, 23 evidencias locales,
nueve outputs de importación histórica y 965 runtime/caché Node18. Se buscaron
nombres SQL y variantes funcionales (familias/modelos/plantillas/técnicos), columnas
y referencias; se localizaron INSERT/COPY y se siguieron sus relaciones.
No se limitó la búsqueda a git ls-files ni al texto no ignorado por rg.

- 42 SQL: DDL, migraciones LOCAL/PROD, funciones, preflights, fixtures y consultas.
- Dos custom dumps PostgreSQL identificados también por magic PGDMP, no solo
  por extensión. Lectura con pg_restore **--file=-**, sin --dbname ni restauración;
  se decodificaron únicamente TABLE DATA de los siete maestros. El catálogo se
  inspeccionó con --list. No se ejecutó el SQL emitido ni se generó otro dump.
- 32 JSON y dos JSONL, incluidos outputs ignorados de importadores, snapshots,
  metadatos y archivos de dependencias. Se inspeccionaron formas/columnas/records,
  no se reconstruyeron personas/modelos desde eventos históricos.
- CSV/TSV/XLS/XLSX/ODS/SQLite/DB/Parquet: ninguno en el árbol de aplicación.
  La búsqueda por firma tampoco encontró una base SQLite o un XLSX oculto con
  otra extensión. El único ZIP es la distribución Node18: 2.678 entradas bajo
  node-v18.19.1-win-x64, ninguna SQL/dump/backup/SQLite/DB/XLS/XLSX/CSV.
- Los XLSX que importan TemplateTasksBuilder/importadores se reciben por selección
  del usuario o rutas externas; sus datos maestros no están incluidos aquí.
- dist contiene código frontend compilado, no un snapshot de respuestas API.
  src/public/docs/API10/API15/tests/importers se buscaron también por contenido.
- Búsqueda adicional de las siete entidades en los tres node_modules locales y
  la distribución Node18: sin coincidencias. En la caché npm se leyeron 944 archivos
  (97.185.339 bytes), descomprimiendo 285 gzip en memoria: sin coincidencias.
  Estos paquetes no aportan configuración de la aplicación.
- .git no es una copia de DB actual: no se reconstruyó un supuesto seed productivo
  desde objetos de commits antiguos. Las migraciones antiguas presentes sí se leyeron.

## Fuente A: dump con filas, descartado por ser TEST

Directorio relativo común:
`context/database/transfer_calidad/evidence.local/2026-10-22T17-06-08-857Z/`.
Archivo: **project.dump**, ignorado por Git. La identidad de project.list,
source-audit.json y source.jsonl coincide: **artecnologia_test_local**, PG16.15.
source-audit.json registra production_connections=0 y transfer_completed=false.
Fecha de creación del archivo: 2026-10-22; una fecha reciente no acredita vigencia
productiva. Los siguientes son conteos de filas decodificadas del COPY del dump,
no estimaciones de secuencias ni cifras inventadas a partir del nombre del archivo.

| Tabla | Fuente / ruta | Filas disponibles | Parece configuración real | Parece TEST/fixture | Vigencia productiva demostrable | Puede usarse como seed |
| --- | --- | ---: | --- | --- | --- | --- |
| machine_family | A / directorio anterior, project.dump | 1 | NO | SI | NO | NO |
| machine_model | A / project.dump | 1 | NO | SI | NO | NO |
| maintenance_template | A / project.dump | 3 | NO | SI | NO | NO |
| template_section | A / project.dump | 3 | NO | SI | NO | NO |
| template_task | A / project.dump | 2 | NO | SI | NO | NO |
| template_task_inspection | A / project.dump | 4 | NO | SI | NO | NO |
| plantilla_tecnicos | A / project.dump | 0 | NO | SI, entorno de prueba vacío | NO | NO |

Contenido verificable, sin reusar esas filas:

- machine_family.id=2: TEST_FAMILIA_LOCAL; machine_model.id=1:
  TEST_MODELO_LOCAL, family_id=2, bond_value/standard_days NULL.
- maintenance_template.id=1,4,5: TEST_PLANTILLA_LOCAL,
  TEST_INSPECCION_ENSAMBLE_LOCAL y TEST_INSPECCION_PINTURA_LOCAL; los tres
  publicados, model_id=1. Publicado no convierte un TEST en configuración real.
- template_section.id=1,4,5 → template_id=1,4,5. La primera se llama TEST_SECCION_1;
  las otras dos tienen títulos funcionales normales pero pertenecen a plantillas TEST.
- template_task.id=1,2 → section_id=1; TEST_TAREA_1/2, code=NULL.
- template_task_inspection.id=5,6 → section_id=4 e id=7,8 → section_id=5;
  revision_point/specs/suggestions TEST_*. No hay técnico que recuperar.

No hay huérfanos en ese grafo maestro local. Su coherencia demuestra relaciones
de prueba, no procedencia/vigencia productiva. No se recupera LIB001 de una
work_order_task para convertirlo en template_task: sería convertir un evento en
maestro. Tampoco se infieren técnicos desde correos de órdenes o históricos.

Hashes SHA256 calculados y coincidentes con archive-hashes.json:

```text
project.dump 6a714c7392c281d06ff21d32737d1e9adcf94589294e8d5adf2684110df94b4b
catalog.dump cc8ff8fcbbaf2fea57a60e0994436ed579af1fb0dd6e8565afadabd5c4b62a10
```

## Otras fuentes y comparación

| Fuente | Ruta relativa | Filas disponibles de los siete maestros | Configuración real | TEST/fixture | Vigencia demostrable | Seed utilizable |
| --- | --- | --- | --- | --- | --- | --- |
| B, catálogo schema-only | Directorio A / catalog.dump y catalog.list | 0 en cada tabla; no TABLE DATA | NO, solo estructura | SI, origen LOCAL | NO productiva | NO |
| C, snapshots/conteos | Directorio A / source.jsonl, source-before.json, source-after.json, dependencies.jsonl, source-audit.json; transfer_calidad/RESULTADO_LOCAL.md | 0 filas completas. Conteos 1/1/3/3/2/4/0 para las tablas de la matriz A | NO, no contienen las filas | SI, ensayo LOCAL | NO productiva | NO |
| D, fixture SQL | src/pages/BEGIN;.sql | 1 plantilla propuesta; 1 sección por INSERT SELECT; 2 puntos por INSERT SELECT; 0 familias/modelos/tareas/técnicos. Son instrucciones condicionales, no resultados de ejecución adicionales | NO | SI, explícito TEST_LOCAL | NO | NO |
| E, consulta auxiliar | src/pages/SELECT.sql | 0 en cada tabla; solo SELECT del fixture | NO | SI, filtra TEST_* | NO | NO |
| F, fixture sintético offline | context/database/deploy_calidad/seed_calidad.test.mjs, función fixture() | Familia 1, modelo 1, plantillas 2, secciones 3, tareas 2, puntos 2, técnico 1; variantes mutan copias, no son nuevos catálogos | NO | SI, comentario synthetic y ejemplo .invalid | NO | NO |
| G, otros tests/snapshots simulados | context/database/transfer_calidad/{compare_snapshots,delta,local_safety}.test.mjs; context/api10/tests/; context/database/tests/{local,prod}/ | 0 filas maestras productivas; conteos/metadatos/mock de API y eventos sintéticos | NO | SI | NO | NO |
| H, DDL y generadores | context/database/create tables.sql; functions/functions.sql; migrations/{local,prod}/; deploy_calidad/{create_calidad.sql,build_clean_baseline.mjs,build_seed_support.mjs} | 0 filas en los siete maestros; el ledger es metadato de schema, no seed maestro | NO, solo definiciones/contratos | NO como fuente de datos | NO de filas | NO |
| I, contratos UI/runtime | src/pages/{Templates,CreateWorkOrderFromTemplate,TemplateTasksBuilder,Models,Families}.tsx; Plantel Producción.tsx; src/services/api5.ts; context/api10/routes/ | 0 filas maestras reales; dos patrones de sección, tipos/defaults y códigos funcionales | SI como reglas, no como filas reales | NO | SI del código actual, NO del contenido productivo | NO por sí sola |
| J, auditoría/documentación | AUDITORIA_DB_AS_IS.md; context/database/transfer_calidad/INVENTARIO.md y docs de deploy | 0 filas completas. DDL, hallazgos y agregados aportados sobre producción | NO como juego de configuración | NO, salvo referencias a ensayos | NO de filas actuales | NO |
| K, importaciones antiguas | context/database/importers/output/*.json (nueve archivos) y scripts de importers/API10 scripts/importers | 0 filas de cualquiera de los siete maestros. Contienen eventos legacy o sus reportes, no catálogos | NO para este objetivo | NO se presume TEST; pueden ser históricos reales | NO como configuración actual | NO, fuera de alcance |
| L, otros catálogos | context/api15/routes/ | 0 filas de los siete maestros; CRUD de bom_catalogo/productos/unidades/BOM, sin catálogo de máquinas API10 exportado | NO para este objetivo | NO | NO de los maestros requeridos | NO |

D coincide con una parte de A (plantilla de ensamble de prueba, sección y dos
puntos); no es una segunda fuente independiente. C confirma los conteos de A y
el origen LOCAL. B contiene la estructura del mismo origen, sin filas. F es un
grafo diferente escrito para tests, no una actualización de A. No sumar ni mezclar
estos registros para fabricar un catálogo supuestamente productivo.

**Canónica para describir el ensayo LOCAL:** A, verificada por sus bytes/hash y
C. **Canónica para el seed productivo:** ninguna fuente local. El código actual
es canónico para contratos y filtros, pero no acredita identidades, modelos,
contenido de tareas ni publicaciones de la DB real.

## Reconstrucción posible y mínimo externo

Se reconstruyen **definiciones y relaciones de los siete maestros**, no sus filas
productivas: familia → modelo → plantilla → sección → tarea/punto; técnicos como
catálogo independiente. Se conocen los seis template_type, valores default,
dos títulos de inspección y códigos de liberación; no se asignan a modelos,
plantillas ni personas ficticias. Cero tablas con datos maestros vigentes completos.

Hallazgo adicional: el selector activo sí está definido en
CreateWorkOrderFromTemplate.tsx:123 y Plantel Producción.tsx:159:
`(t.estatus || "").toLowerCase() === "activo"`. Ambas pantallas obtienen datos de
API5 mediante src/services/api5.ts; no hay respuesta/roster de API5 guardado aquí
ni su implementación. Eso no demuestra que el roster de API5 sea idéntico al de
artecnologia. No se consultó API5, Firebase ni ningún endpoint remoto.

Para evitar pedir una consulta previa de estados, el export READ ONLY ya incluye
las filas candidatas de plantilla_tecnicos con lower(estatus)='activo' y puestos
consumidos por API10, más perfil agregado de estados. Reproduce el filtro sin
añadir trim, asumir IDs ni inventar nombres; la vigencia administrativa final de
las filas se revisa al recibir el resultado. Los usuarios Logística siguen fuera.

Solo falta **un export coherente de los siete maestros**, no un dump completo:

| Tabla | Información externa mínima |
| --- | --- |
| machine_family | id de referencia y name de las familias de los modelos seleccionados. |
| machine_model | id de referencia, family_id, name, manufacturer, bond_value, standard_days de los modelos de plantillas candidatas. |
| maintenance_template | id de referencia, name, template_type, model_id, version e is_published de las plantillas publicadas vigentes. Sin created_by ni timestamps. |
| template_section | id de referencia, template_id, title, position de sus secciones. |
| template_task | id de referencia, section_id, code, title, expected_minutes, required, position, category de actividades no INSPECCION. |
| template_task_inspection | id de referencia, section_id, revision_point, specs, suggestions, required, position, category de puntos INSPECCION. |
| plantilla_tecnicos | estatus, sucursal, nombre_tecnico, correo_tecnico, telefono, puesto, nombre_bonos, numero_empleado reales de técnicos activos requeridos; id solo como referencia. Sin passwords, tokens ni UID Firebase. |

El administrador ejecuta un solo archivo preparado:
[export_seed_config_artecnologia.sql](export_seed_config_artecnologia.sql), devuelve
íntegra la celda EXPORT_CONFIG_JSON y no selecciona tablas ni interpreta conteos.
La DB de origen y fecha/modo READ ONLY viajan como metadatos de procedencia.
El equipo revisa publicación/vigencia, cuarentenas TEST, padres faltantes y
ambigüedades antes de generar el seed. Si hay discrepancias, se pide únicamente
la aclaración concreta; no otra captura de eventos. No se requiere autorización
Logística en ese export: su alta manual posterior ya está documentada.

Los IDs de origen no son datos transaccionales a restaurar: solo permiten
remapear FK entre maestros a IDs nuevos del destino. Sin estas siete fuentes
no se puede reducir honestamente la solicitud a menos tablas: las copias locales
no aportan ninguna fila productiva utilizable. No hace falta backup completo,
históricos, delta, inspecciones realizadas, entregas, evidencias, legacy/mappings
ni siete migraciones posteriores para resolver este faltante.

## Resultado

seed_calidad_operativo.sql completado = NO; filas seed = 0.
validate_seed_calidad.sql mantiene READ ONLY y el bloqueo por datos pendientes,
sin confundirlo con LOGISTICA_AUTH_PENDIENTE. API10 completo después del seed
actual = NO. logistica_authorized_users = ALTA_MANUAL_REQUERIDA.
No se cambiaron datos, baseline, runtime API10/frontend ni los cuatro untracked
ajenos. No hubo deploy, stage, commit o push.

Validación offline final: deploy_calidad 74/74 PASS, transfer_calidad 23/23 PASS
(97/97 en total), node --check de generador/tests PASS. Los tests adicionales
comprueban el selector activo real, exclusión de puestos ajenos y personas TEST;
no acreditan contenido productivo. git diff --check PASS.
