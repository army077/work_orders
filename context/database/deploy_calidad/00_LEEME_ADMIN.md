# Paquete administrativo: artecnologia → calidad

Estado: PREPARADO PARA REVISIÓN; sin ejecución en DB ni deploy. Runtime fijo:
**Node.js v18.19.1**. No actualizar Node del servidor.

El inventario y las siete migraciones siguen en transfer_calidad/ y migrations/prod/.
El administrador no elige tablas, no compara conteos manualmente y no decide el
orden. El procedimiento autorizado es **snapshot/export → restore → validación →
cutover → CONCILIACION DELTA**. No exige un freeze total de escrituras.

Datos pendientes del administrador:

1. Nombre exacto del proceso API10 en PM2.
2. Ruta real del directorio API10.

Node 18.19.1, PostgreSQL 16.15/Ubuntu, HeidiSQL, FileZilla y respaldo de API10 ya
están confirmados. El backup actualizado de artecnologia se produce y verifica
en el bloque C; el plan de conciliación manual ya está aceptado. No pedir otra
confirmación de freeze. Verificar el binario usado por PM2, no solo el del shell.

Orden operativo:

- 01_preflight_artecnologia.sql: una ejecución READ ONLY en artecnologia; 15 tablas,
  conteos/estructura/secuencias y cuatro históricos separados pendientes.
- 02_preflight_calidad.sql: una ejecución repetible READ ONLY en calidad vacía.
- [05_COMANDOS_TRANSFERENCIA.md](05_COMANDOS_TRANSFERENCIA.md), A–F: el runner
  conserva abierto un snapshot MVCC compartido por capturas y pg_dump. Registra
  SNAPSHOT_ID, inicio/finalización, artefactos y SHA-256 en snapshot.json.
- 03_validar_post_restore_calidad.sql: captura antes de Logística; el comparador
  existente valida estructura/conteos y el comparador delta valida hashes por fila
  contra delta_baseline.tsv del snapshot, sin comparar manualmente.
- G: aplicar y verificar las siete migraciones, una por una, con sus bytes/guards.
- 04_validar_post_logistica_calidad.sql: seis tablas, fingerprint, checksums y ledger.
- [06_CHECKLIST_CUTOVER.md](06_CHECKLIST_CUTOVER.md): FileZilla/PM2, después de DB validada.
- I: capturar ambos lados y revisar CONCILIACION DELTA. No cerrar la tarea de datos
  hasta resolver/registrar diferencias y repetir las capturas necesarias.

Un NO/REVISAR, captura truncada, schema distinto, secuencia insegura o error del
restore/migración significa DETENERSE antes del corte. El código 2 del comparador
delta significa diferencias pendientes de revisión, no una conciliación realizada.
Un fallo antes del corte permite mantener API10 anterior sobre artecnologia.

Los cuatro SQL administrativos y las dos capturas delta son READ ONLY. Un guard
de base/PG16 equivocada aborta su transacción. El límite 120s puede detener
capturas grandes: revisar técnicamente, no aceptar una salida incompleta.

Compartir TSV y reportes JSON, que contienen metadatos, conteos, hashes y PK
numéricas/UUID necesarias. PK textuales se identifican por hash para evitar
exponer datos personales. No se imprimen filas completas ni cuerpos de funciones.
NO compartir dumps/export SQL, passfiles, entornos ni credenciales Firebase/Drive.

Los cuatro históricos PostgreSQL pendientes no se incorporan automáticamente.
El snapshot histórico Entregas del Sheet es un flujo distinto del delta PostgreSQL.
No se crea ni utiliza PREPROD ni una DB LOCAL.

Los generadores offline y sus tests evitan duplicar inventarios/comparadores.
Los scripts no aplican INSERT/UPDATE/DELETE de conciliación. Nuevas altas que
colisionen por PK, cambios divergentes y ausencias requieren decisión humana.
El snapshot no congela secuencias ni escrituras posteriores: el restore verifica
su seguridad contra las PK restauradas y la conciliación conserva ambas versiones.

Compatibilidad y riesgos de dependencias: [AUDITORIA_NODE18.md](../../api10/AUDITORIA_NODE18.md).
Detalle y límites del delta: [CONCILIACION_DELTA.md](../transfer_calidad/CONCILIACION_DELTA.md).