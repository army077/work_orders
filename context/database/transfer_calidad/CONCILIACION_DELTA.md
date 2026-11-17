# Delta PostgreSQL después del snapshot

Decisión aceptada: no exigir freeze total. No significa aceptar pérdida silenciosa.
El runner mantiene un snapshot MVCC compartido por el dump y dos baselines:
estructura/conteos y PK/hash de cada fila soportada. El recibo snapshot.json une
SNAPSHOT_ID, inicio/finalización y hashes de artefactos/capturas. Conservarlo junto
al backup completo privado y al export selectivo de esa misma ventana.

Después de validar calidad y hacer el cutover, ejecutar bloque I de
[05_COMANDOS_TRANSFERENCIA.md](../deploy_calidad/05_COMANDOS_TRANSFERENCIA.md).
El runner solo reporta diferencias: no tiene aplicador de conciliación.

## Capturas y comparación offline

capture_delta_artecnologia.sql solo admite artecnologia/PG16 y
capture_delta_calidad.sql solo calidad/PG16. Cada uno usa BEGIN REPEATABLE READ
READ ONLY, catálogos y SELECT. No crea funciones/tablas temporales ni hace DML.
Los genera build_delta_sql.mjs desde manifest.psql; no mantener listas paralelas.

Salida TSV CHECK/ESTADO/DETALLE, como el paquete administrativo. También se puede
guardar en JSONL usando exclusivamente los objetos DELTA. Los archivos deben
contener identidad, todas las tablas del inventario y marcador delta_complete;
el comparador rechaza duplicados, scopes alterados o capturas truncadas.

```bash
node context/database/transfer_calidad/compare_delta.mjs \
  "$BACKUP_DIR/delta_origen_<captura>.tsv" \
  "$BACKUP_DIR/delta_destino_<captura>.tsv" "$BACKUP_DIR/delta_baseline.tsv"
```

El comando no conecta a PostgreSQL. Código 0: sin diferencias observadas; 2:
conciliación pendiente o tablas no comparables; 1: entrada inválida/incompleta.
No generar ni ejecutar correcciones a partir del código de salida.

Para una revisión inicial, se admiten los dos primeros archivos sin baseline;
eso solo compara estados observados y no atribuye el cambio al periodo posterior
al snapshot. El flujo operativo sí conserva y proporciona el tercer archivo.

## Comparación de contenido y privacidad

Para tablas ordinarias con PK y tipos admitidos se calcula SHA-256 sobre JSONB
de la fila completa, en PostgreSQL 16 con UTC, DateStyle ISO/YMD, IntervalStyle
iso_8601 y extra_float_digits=3. No hay delimitadores ambiguos entre columnas o
nulos. PK compuestas también se codifican como JSONB y se identifican por SHA-256.
El hash es semántico JSONB, no igualdad byte a byte del texto original de JSON.
La misma forma de columnas/PK se comprueba por schema_sha256 antes de comparar.

No se emite el contenido completo de las filas. PK enteras/UUID se muestran como
strings sin perder BIGINT; PK textuales/otros tipos permanecen identificadas por
pk_sha256 para evitar exponer correos/nombres. No mostrar credenciales ni datos
de negocio para explicar una diferencia. Los hashes son identificadores técnicos,
no una garantía de anonimato público; compartir solo con el equipo responsable.

Sin PK, con RLS, herencia/particiones, foreign tables, vistas o tipos fuera de la
lista admitida: NO_COMPARABLE_REQUIERE_REVISION. No fingir igualdad por conteos,
omitir la tabla silenciosamente o convertirla en SIN_DIFERENCIAS_OBSERVADAS.
Las capturas completas pueden ser grandes: revisar duración/memoria antes de la
ventana; el timeout no produce un resultado aprobado.

## Interpretación humana

Cada diferencia incluye tabla, PK o su huella y:

- SOLO_ORIGEN: PK presente solamente en artecnologia al capturar.
- SOLO_DESTINO: PK presente solamente en calidad al capturar.
- CONTENIDO_DISTINTO: misma PK con hash de fila distinto, incluso con conteos iguales.

Con baseline se añaden source_changed_since_snapshot y
destination_changed_since_snapshot. Son hechos observados frente al baseline,
no instrucciones de INSERT/UPDATE/DELETE ni resolución de conflictos.

Las nuevas altas que quedaron en artecnologia pueden revisarse y trasladarse
mediante un cambio posterior autorizado, comprobando PK/FK y relaciones lógicas.
Dos escritores pueden asignar el mismo ID después del corte: nunca copiar una
PK ni sus dependientes ciegamente. Se reportará CONTENIDO_DISTINTO; cualquier
remapeo de IDs/FK exige un plan controlado independiente.

Los updates divergentes requieren comparar ambas versiones antes de sobrescribir.
Una ausencia puede ser alta en un lado, delete en el otro o cambio de PK; no
inferir automáticamente cuál ni reconstruir deletes. Una eliminación y reinserción
con igual contenido o cambios revertidos entre dos capturas no son visibles como
historial de eventos. Esta herramienta no es CDC ni un log de auditoría de negocio.

Las capturas de origen/destino tras el corte no son simultáneas: registrar ambas
ventanas, considerar cambios en vuelo y repetirlas. Cuando se cierre la ruta vieja,
verificar jobs/sesiones pendientes y acordar la última escritura relevante del
origen. No declarar conciliación terminada mientras continúen cambios sin revisar.
No se exige congelar todas las escrituras durante el snapshot ni detener calidad
para producir un primer reporte; diferencias concurrentes requieren revisión.

Registrar por cada caso: identificación, responsable, decisión, evidencia de
validación y fecha de resolución. Conservar reportes anteriores y generar otros
nuevos para verificar. El resultado técnico sin diferencias no sustituye el cierre
humano de los casos ya detectados ni demuestra ausencia histórica de eventos.

## Secuencias y rollback

Las secuencias no son MVCC. El modo production_snapshot_delta excluye solo la
igualdad temporal de last_value/is_called; reporta las diferencias y mantiene
estricta la definición. El runner valida candidato siguiente contra MIN/MAX de
las filas restauradas y exige igualdad exacta con SEQUENCE SET extraído del archive
(sequence_states.json), incluso para tablas vacías. El extractor solo interpreta
metadatos SQL; no ejecuta su setval. Rechaza estados incompletos/duplicados y el
selector exige todos los SEQUENCE SET. Nunca llama nextval/setval
para reparar. Eso no elimina colisiones si el origen sigue asignando IDs después
de la copia; se detectan y concilian con sus referencias.

Antes de nuevas escrituras de negocio en calidad, conservar API10 anterior sobre
artecnologia permite cancelar el corte. Después de nuevas escrituras, no volver
ciegamente al origen: preservar ambas bases y conciliar efectos de DB/Drive.

El snapshot final del Sheet de Entregas/legacy se mantiene separado. No mezclar
sus aprobaciones, hashes o conciliaciones con el delta artecnologia → calidad.
