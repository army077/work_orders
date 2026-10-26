# Seed del export productivo autorizado

EXPORT_CONFIG_PROD_RECIBIDO = SI. Se aceptan conjuntamente el JSON proporcionado
en consulta_artecnologia.txt y el query adaptado realmente ejecutado, pegado después
por el usuario. No se pide otra consulta, acceso, credencial ni nuevo export.
La cadena heredada status=PENDIENTE_EXPORT_CONFIG_PROD se conserva en el original
como dato de procedencia; no es una condición de bloqueo ni invalida este export.

La fuente JSON se conserva sin alterar sus bytes en
[sources/export_config_prod_20261023.json](sources/export_config_prod_20261023.json).
SHA256: `47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0`.
Origen declarado: artecnologia, PostgreSQL 16.15, read_only=on, captura
2026-10-23T22:02:20.831481+00:00. Contiene datos maestros personales aprobados,
no tokens, passwords o UID Firebase: no publicar el JSON o SQL en logs abiertos.

[export_seed_config_artecnologia.sql](export_seed_config_artecnologia.sql) es una
transcripción con formato normalizado del query ejecutado entregado por el usuario.
Mantiene BEGIN REPEATABLE READ READ ONLY, environment_check con DB artecnologia /
PG16 / modo on, selección de maestros, filtros de TEST/FIXTURE, técnicos activos,
SELECT condicionado al entorno y ROLLBACK. El guard es WHERE, no el DO del primer
borrador: con entorno incorrecto produce cero filas. Se conserva como evidencia;
**no volver a ejecutarlo como actividad obligatoria**. No se afirma igualdad de
bytes/espacios con el mensaje pegado. Su hash se calcula sobre la transcripción
versionada y queda separado del hash del JSON real.

## Integridad y alcance de la carga

| Tabla | Filas | ID máximo preservado | Próximo ID de secuencia |
| --- | ---: | ---: | ---: |
| machine_family | 8 | 8 | 9 |
| machine_model | 37 | 51 | 52 |
| maintenance_template | 51 | 130 | 131 |
| template_section | 155 | 405 | 406 |
| template_task | 869 | 1250 | 1251 |
| template_task_inspection | 2 | 222 | 223 |
| plantilla_tecnicos | 17 | 130 | 131 |
| Total | 1139 | — | — |

Validación offline: JSON bien formado, sin claves repetidas, IDs duplicados,
columnas ajenas, tipos/longitudes incompatibles, huérfanos ni marcadores explícitos
TEST/FIXTURE. Se comprueban las cinco relaciones familia → modelo → plantilla →
sección → tarea/punto y unicidad de posiciones/nombre de modelo por familia.
Las tareas normales y puntos de inspección están separados por template_type.
Las 51 plantillas están publicadas; no se crean nuevas ni se reutilizan históricos.
Los 17 técnicos son exactamente los del export, activos y de puesto Operador de
producción. Los cinco Supervisor de calidad Inactivo del perfil agregado no se
copian. No se infieren personas ni se corrigen sus datos silenciosamente.

El seed inserta exclusivamente esas siete tablas, conservando sus IDs y valores,
incluidos NULL/cadenas vacías. Los timestamps nuevos de maintenance_template se
obtienen de los defaults del baseline; no se copian created_by/created_at/updated_at.
No se inserta ledger, orden, avance, inspección realizada, entrega, evidencia,
legacy, mapping o autorización Logística. El baseline ya contiene el ledger.

Se exige calidad/PG16, baseline íntegro y negocio completamente vacío. Los locks
impiden una carga concurrente. Un destino parcial o distinto aborta: no hay
upsert, limpieza, reparación ni reintento automático. Después de los INSERT se
reinician solo las siete secuencias, dentro de la misma transacción. ALTER SEQUENCE
RESTART es transaccional; no se usa setval/nextval como reparación independiente.
La comprobación integrada antes de COMMIT contrasta cada fila completa con el
JSON aprobado, sus conteos, relaciones, schema y secuencias. Un error revierte
la carga y los reinicios. CALIDAD_SEED_CARGADO=SI exige también COMMIT exitoso.

## Las tres plantillas excluidas

El export declara 54 publicadas, 51 candidatas, diferencia 3. El resultado contiene
únicamente candidatas y sus dependencias, sin lista de raw_published completa ni
diagnósticos individuales de exclusión. Por tanto:

- IDs excluidos = NO DETERMINABLES con este export.
- Nombres excluidos = NO DETERMINABLES con este export.
- Motivo individual exacto = NO DETERMINABLE con este export.
- Motivo agregado compatible con el query = falta de modelo/familia por JOIN o
  marcador TEST/FIXTURE en plantilla, modelo, familia, sección, tarea o punto.

No se deducen IDs desde huecos, no se agregan esas tres plantillas y no se solicita
otra consulta para recuperarlas. El recibo usa null para identidades/motivos
desconocidos, no nombres o causas inventados.

## Suficiencia funcional: no equivale a integridad del export

La fuente real tiene relaciones válidas y reproduce la configuración autorizada.
La revisión del runtime de [17_AUDITORIA_RUNTIME_BASELINE.md](17_AUDITORIA_RUNTIME_BASELINE.md)
confirma que las siguientes limitaciones no impiden el arranque ni la creación
general de órdenes. Se conservan como WARNING, sin reparar el seed:

1. **39 plantillas ENSAMBLE sin INSPECCION publicada del mismo modelo.** La única
   INSPECCION seleccionada es id=104, model_id=41, con secciones 336/337 y un punto
   por sección. No hay ENSAMBLE seleccionado para ese modelo. quality.js exige
   modelo, publicación y título de sección coincidentes: para órdenes creadas
   desde las 39 ENSAMBLE el POST /quality/inspection/request devuelve 404. No es
   una condición de POST /work-orders/from-template. Se puede crear la orden y
   avanzar sus actividades existentes; se bloquea ese flujo de inspección.
   No se reasigna la plantilla 104 a otros modelos ni se clonan sus puntos.
2. **Cinco secciones sin tareas:** 155 (plantilla 50), 249/250 (plantilla 61),
   263/264 (plantilla 69). Crear/materializar no aborta; esas secciones no generan
   actividades ni grupo visible. Las plantillas 61/69 quedan sin actividades y
   su reinicio de checklist responde 404. Se preservan; no se inventan tareas.
3. **Nueve plantillas ENSAMBLE sin algún código de liberación:** 30,31,32,55,61,69
   carecen de LIB001 y LIB002; 34,38,49 carecen de LIB002. No se fabrican actividades
   ni se toman de work_order_task. La creación no los exige; liberar la inspección
   devuelve 404 y finalizarla 409 si falta el código correspondiente. El cierre
   directo de producción no impone esos códigos.
4. **Observación WARNING — correo de técnico repetido:** IDs 63 y 101. No se copia el correo a este
   informe; se conserva en la fuente y seed autorizados. Los joins por correo
   de bonos pueden duplicar coincidencias. No se elimina ni cambia a la persona.
5. **Observación WARNING — nombre_bonos vacío:** técnicos 88,99,101,102,103,107,124,129,130.
   Es válido para el NOT NULL del schema; no se demuestra que su ausencia bloquee
   el runtime actual. No se sustituye por un nombre inferido ni se inventa una
   restricción de integridad adicional para obtener otros datos.

Además hay nombres de plantilla que contienen «Pruebita»/«Prueba» (31,32,33).
No coinciden con los marcadores TEST/FIXTURE del query aprobado. Se documenta la
ambigüedad y se mantienen las 51 filas autorizadas; no se decide por el nombre
que sean productivas o de pruebas, ni se cambia la selección del usuario.

El recibo [15_RECEPCION_EXPORT_CONFIG_PROD.json](15_RECEPCION_EXPORT_CONFIG_PROD.json)
enumera IDs de los hallazgos, hashes, conteos y secuencias. No contiene datos
transaccionales. La resolución de estas limitaciones requiere decisiones/datos
maestros aprobados del equipo; no nueva lectura productiva solicitada por Codex.
No se ocultan controles para obtener un SI artificial.

## Interpretación del validador

validate_seed_calidad.sql sigue READ ONLY, guard calidad y ROLLBACK. Contrasta
conteos y todas las columnas exportadas; detecta filas faltantes, distintas o
ajenas incluso cuando el conteo coincide. Valida schema/FK declaradas, relaciones
lógicas, secuencias y ausencia de eventos/históricos/legacy/mappings/TEST.

Resultado esperado con create+seed exactos, **no ejecutado aquí**:

```ini
CALIDAD_SCHEMA_VALIDO = SI
CALIDAD_SEED_DATOS_VALIDOS = SI
LOGISTICA_AUTH_PENDIENTE = SI
CALIDAD_SEED_OPERATIVO_VALIDO = SI
BASELINE_APTO_PARA_DEPLOY = SI
```

Los SI significan arquitectura/carga fieles y baseline apto para nuevos eventos.
Las incidencias 39/5/9 no provocan un NO-GO general. Las filas ERROR mantienen
el bloqueo por schema/filas/relaciones/secuencias/eventos/TEST y otros errores
que no se han reclasificado. Los WARNING conservan visibles las limitaciones.
La ausencia deliberada de autorización bloquea Logística, por separado.
Tras el alta manual aprobada, LOGISTICA_AUTH_PENDIENTE pasa a NO; las limitaciones
de las plantillas permanecen como warnings y no se reparan en este trabajo.

Procedimiento final: create_calidad.sql → seed_calidad_operativo.sql →
validate_seed_calidad.sql → alta Logística si pendiente → deploy API10, condicionado
a validación operativa SI. Sin dump/restore/delta/migración histórica ni siete
migraciones posteriores. Ningún SQL de esta entrega se ejecutó contra una DB.

Regeneración exclusivamente offline:
`node context/database/deploy_calidad/build_seed_support.mjs`. Comprueba los bytes
aprobados antes de escribir los SQL y el recibo. Los SQL son autónomos para el
administrador; el servidor no necesita el generador ni consultar artecnologia.

Verificación de la entrega anterior: deploy_calidad 97/97 PASS y transfer_calidad 23/23 PASS
(120/120; cero omitidos). node --check PASS para generador, parser, renderer y tests
afectados. git diff --check PASS. No se compiló ni ejecutó el SQL en PostgreSQL;
las pruebas de consultas usan fixtures en memoria. DB/producción/deploy/commit/push
no se modificaron ni ejecutaron durante esa entrega. La revisión runtime actual
y sus pruebas sin ejecutar SQL se documentan en 17_AUDITORIA_RUNTIME_BASELINE.md.
