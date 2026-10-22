# Transferencia controlada artecnologia → calidad

Procedimiento operativo vigente: [deploy_calidad/00_LEEME_ADMIN.md](../deploy_calidad/00_LEEME_ADMIN.md).
Runtime productivo fijo: Node 18.19.1. Producción PostgreSQL 16.15/Ubuntu.
Decisión vigente: snapshot/export → restore → validación → cutover →
**CONCILIACION DELTA**, sin exigir freeze total de escrituras.

## Fuentes de verdad y alcance

- manifest.psql: inventario único. manifest.mjs lo lee para herramientas Node.
- [INVENTARIO.md](INVENTARIO.md): evidencia de las 15 tablas API10 y dependencias.
- Cuatro históricos: PENDIENTE_VERIFICACION_PROD; el paquete operativo los
  reporta y excluye explícitamente. No decidir su transferencia por presencia.
- Logística: seis tablas nuevas, incluidas ledger; se crean con las siete
  migraciones PROD exclusivamente en calidad, después de validar el restore.
- db.js conserva production → calidad, LOCAL/TEST y guards de entorno.
- No se implementa PREPROD ni se exige calidad_test_local para producción.

## Snapshot consistente sin detener todos los escritores

El runner 08_operar.mjs backup abre una transacción REPEATABLE READ READ ONLY,
valida artecnologia/PG16 y conserva pg_export_snapshot() abierto durante el dump.
origen_definitivo.tsv, delta_baseline.tsv y pg_dump --snapshot comparten la misma
visibilidad. El backup completo es de seguridad y el TOC automático selecciona
solo objetos aprobados para calidad desde ese mismo archivo consistente.

snapshot.json registra SNAPSHOT_ID, inicio/final, artefacto y SHA-256 del backup
y capturas. Si el exportador se cierra/falla, no reusar el identificador. Un backup
o captura truncado no se aprueba. DDL concurrente y snapshots largos requieren
coordinación técnica; no hay captura continua de cambios ni promesa de CDC.

Los escritores de datos pueden continuar en artecnologia. Sus operaciones
posteriores al snapshot se concilian después del corte. No se exige
ESCRITORES_DETENIDOS=SI como GO. No aceptar pérdida silenciosa ni declarar
conciliación cerrada mientras sigan apareciendo cambios no evaluados.

Las secuencias no son MVCC: no comparar ciegamente last_value/is_called de
instantes vivos. El modo production_snapshot_delta del comparador solo admite
esa diferencia con SNAPSHOT_ID; mantiene estrictos parámetros/defaults/ownership,
tablas/PK/FK/índices/funciones/triggers/conteos/ACL. El runner exige además safety
del destino contra las filas restauradas y comparación de hashes por fila con
delta_baseline.tsv. El estado del destino también debe ser exactamente el
SEQUENCE SET extraído del archive en sequence_states.json, no el contador de
otra captura viva. No usar nextval/setval como reparación automática.

## Herramientas reutilizadas

- snapshot.sql / dependencies.sql: capturas de estructura y dependencias para
  psql. Los generadores operativos reutilizan sus consultas; pg_depend no prueba
  referencias dinámicas de PL/pgSQL. Un objeto no cubierto exige REVISAR.
- compare_snapshots.mjs: comparador offline. El modo production por defecto
  conserva comparación exacta de secuencias; local_rehearsal conserva su mapeo
  de ACL exclusivamente aislado. El modo nuevo no relaja owners/ACL.
- prepare_dump_args.mjs: selectores desde la captura; no ejecuta dump ni SQL.
- build_delta_sql.mjs: genera dos capturas READ ONLY para artecnologia/calidad
  desde el mismo inventario, sin traer filas de negocio completas.
- compare_delta.mjs: archivos locales, PK/huellas por fila, sin pg ni escrituras.
- [CONCILIACION_DELTA.md](CONCILIACION_DELTA.md): formato, comandos y límites.

Los scripts genéricos psql ejecutados por separado no comparten automáticamente
un snapshot. Para el flujo productivo usar el runner, no comparar una captura
viva de una hora con el dump de otra.

## Validación y corte

Seguir A–I de [05_COMANDOS_TRANSFERENCIA.md](../deploy_calidad/05_COMANDOS_TRANSFERENCIA.md).
El destino debe estar vacío, sin tráfico API10 y en el mismo servidor/rol autorizado.
El restore usa un solo pg_restore --single-transaction/--exit-on-error, sin borrar
objetos ni omitir owners/ACL. PK/FK/índices/secuencias/funciones/triggers se
recrean con definiciones nativas. Se valida estructura y contenido del snapshot
antes de aplicar las siete migraciones en orden. No alterar sus bytes/checksums.

El equipo revisa SOLO_ORIGEN / SOLO_DESTINO / CONTENIDO_DISTINTO después del
cutover; el baseline permite observar qué cambió desde el snapshot en cada lado.
PK numéricas y UUID pueden mostrarse; PK textuales se identifican por SHA-256.
No hay INSERT, UPDATE ni DELETE de conciliación automática. Las altas en ambos
lados pueden colisionar en ID aunque cada secuencia sea localmente segura:
revisar PK y todas las referencias antes de trasladarlas. No sobrescribir.

Ausencias no equivalen automáticamente a deletes. Repetir capturas mientras
haya solicitudes/jobs antiguos; su cierre operativo se registra por el equipo.
El snapshot final del histórico Entregas del Sheet es una conciliación diferente.

## Rollback

Antes de nuevas escrituras operativas en calidad: mantener API10 anterior y su
configuración sobre artecnologia. Si falla migración/validación, no cortar.
El origen puede seguir prestando servicio. No apuntar el binario nuevo a
artecnologia: lo rechaza su guard. Restore y ledger no son operaciones nuevas
de negocio. Después de nuevas escrituras, no regresar ciegamente: preservar
ambos estados, conciliar diferencias y efectos externos, decidir roll-forward o
migración inversa controlada. No se ofrece rollback inverso automático.

## Evidencia LOCAL anterior

[ENSAYO_LOCAL.md](ENSAYO_LOCAL.md) y [RESULTADO_LOCAL.md](RESULTADO_LOCAL.md)
documentan antecedentes aislados y el bloqueo administrativo aceptado. Sus locks
LOCAL no son un requisito del flujo productivo vigente. No crear la DB LOCAL,
no habilitar integraciones DB ni cargar credenciales para reejecutar este trabajo.

Esta adaptación solo genera código, SQL de lectura y pruebas offline. No se
conectó a producción ni se ejecutó la transferencia. Datos/dumps/export SQL y
credenciales permanecen privados y fuera del repositorio. Compartir solo metadatos
y reportes de diferencias. El backup de DB no respalda los roles globales.
