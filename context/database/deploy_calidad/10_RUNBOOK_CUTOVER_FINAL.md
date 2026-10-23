# Runbook final: cutover artecnologia → calidad

**11 pasos, en orden.** Procedimiento preparado; no ejecutado durante su edición.
Base revisada: rama `migracion-datos-historicos`, HEAD
`18501d6be8c6ea49bc025f076bb4aa6736c2420b`.

Confirmado: `calidad` ya dio `DESTINO_VACIO_Y_APTO = SI` y cero objetos de
aplicación. Origen y destino comparten servidor PostgreSQL 16.15 y administrador.
Node productivo: **18.19.1**. No pedir otro inventario, versión ni nombre/ruta PM2.
El control de origen se ejecuta dentro de la transferencia; no hay preflight
independiente ni repetición manual del preflight de calidad.

Comandos `node context/...`: desde la raíz del checkout administrativo, con los
clientes PostgreSQL y dependencias ya disponibles. Usar el entorno seguro conocido
(`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSFILE` privado o `PGPASSWORD`, `APP_ENV=production`,
`PGDATABASE=calidad` y `BACKUP_DIR` privado, nuevo por ventana y fuera del checkout).
Conservar el mismo `BACKUP_DIR` para transferencia, validadores, migraciones y delta.
No imprimir entornos ni secretos. El rol administrativo no se hereda a API10.

Ante **STOP**: detenerse, conservar salidas y compartir solo metadatos; no continuar
ni reintentar automáticamente. Con éxito, seguir al próximo paso sin otra revisión
manual de conteos, secuencias, funciones o triggers. No se requiere freeze total:
las diferencias posteriores al snapshot se detectan en el paso 11.

| PASO | RESPONSABLE | ACCIÓN/COMANDO | RESULTADO ESPERADO | SI FALLA |
| --- | --- | --- | --- | --- |
| PASO 1 — Backup | Administrador | Confirmar el respaldo mediante su procedimiento habitual, sin redefinir su mecanismo. | `BACKUP_ARTECNOLOGIA = SI`. | Sin confirmación: **STOP**. |
| PASO 2 — Transferencia | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs transfer`. Integra identidad real de `artecnologia` y [01_preflight_artecnologia.sql](01_preflight_artecnologia.sql) antes del dump/export; solo con origen apto continúa: dump/backup completo → export selectivo aprobado → restore únicamente en `calidad`. No seleccionar tablas, editar TOC ni copiar por HeidiSQL. | `TRANSFERENCIA_COMPLETADA = SI`, `restore_completed.json` y snapshot/dump identificados en `snapshot.json` (COMPLETE, inicio/final y hashes). Se conservan baseline y recibos automáticamente. | Condición crítica, captura incompleta o fallo de dump/export/restore: **STOP**, sin continuar ni reintentar a ciegas. |
| PASO 3 — Validar restore | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs validate-restore`. Ejecuta [03_validar_post_restore_calidad.sql](03_validar_post_restore_calidad.sql), capturas y comparadores automáticos contra el snapshot. | `RESTORE_VALIDADO = SI` en salida y `restore_validado.json`. | Distinto de SI o error: **STOP**. No aplicar Logística. |
| PASO 4 — Migraciones Logística | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs migrate`. Aplica las siete migraciones PROD en el [orden cerrado documentado](05_COMANDOS_TRANSFERENCIA.md#g--siete-migraciones-logística), comprobando cada éxito antes de enviar la siguiente. El administrador no decide archivos ni orden. | Siete resultados `PASS`, en orden, con recibo por migración. | Si una falla: **STOP**, no continuar ni reejecutar el lote. |
| PASO 5 — Validar Logística | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs validate-final`. Ejecuta [04_validar_post_logistica_calidad.sql](04_validar_post_logistica_calidad.sql). | `LOGISTICA_SCHEMA_VALIDO = SI` y `logistica_validada.json`; ledger 7/7 validado. | Distinto de SI o error: **STOP** antes de FileZilla. |
| PASO 6 — FileZilla | Administrador | Subir todos los archivos de [07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt), desde `context/api10/` al directorio API10 habitual, conservando rutas y en modo binario. | `API10 anterior respaldada = SI` (incluida configuración); `archivos FileZilla subidos = SI`; `package.json/package-lock.json actualizados = SI`. Incluir `.npmrc`. | Si falta respaldo o un archivo: **STOP**, no reiniciar PM2. |
| PASO 7 — npm ci | Administrador | Dentro de API10 en el servidor: `npm ci --omit=dev`, con Node **18.19.1**. Confirmar entorno de aplicación: `APP_ENV=production`, `PGDATABASE=calidad`, `FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar` y variables PG/Firebase/Drive de [06_CHECKLIST_CUTOVER.md](06_CHECKLIST_CUTOVER.md), sin imprimir secretos. | Instalación correcta y configuración disponible para el proceso. `server.js` no carga `.env` automáticamente. | Si falla instalación o configuración: **STOP**, **NO reiniciar PM2**. |
| PASO 8 — PM2 | Administrador | Reiniciar API10 mediante su procedimiento habitual. | API10 con entorno nuevo; registrar hora del cambio de tráfico y considerar solicitudes/jobs en vuelo hacia la API anterior. | Si falla: **STOP**, conservar logs sin secretos. |
| PASO 9 — Health | Administrador | Comprobar `GET /api10/health`. | **HTTP 200**. Solo acredita HTTP; aún no valida PostgreSQL, Firebase ni Drive. | Si no responde 200: **STOP**. |
| PASO 10 — Samsung | **Jairo** | Con usuario autorizado: **login → crear entrega → foto → firma → GPS → finalizar → Mis registros**. | `COMPLETED`, evidencia en Drive, registro en PostgreSQL y entrega visible en Mis registros. | Si falla: **STOP** de aceptación funcional; conservar evidencias. |
| PASO 11 — Conciliación delta | Administrador (captura); equipo de datos (resolución humana) | Después del corte: `node context/database/deploy_calidad/08_operar.mjs delta`. Compara `artecnologia` vs `calidad` y el baseline con herramientas READ ONLY existentes. | Reporte de `SOLO_ORIGEN`, `SOLO_DESTINO`, `CONTENIDO_DISTINTO`. Código 0: sin diferencias observadas; 2: pendientes/no comparables; 1: captura inválida. El equipo resuelve manualmente los casos y repite hasta cerrar. | Código 1: **STOP**, revisar captura. Código 2: no declarar cierre. No aplicar `INSERT/UPDATE/DELETE` automáticamente ni inferir deletes; revisar colisiones de PK/FK. |

El guard de destino/servidor/rol sigue siendo automático dentro de `restore`, sin
otro paso para el administrador. La transferencia reutiliza las etapas existentes;
no ejecutar además `backup`, `export`, `restore` o `preflight` por separado.
Las operaciones sobre `artecnologia` son READ ONLY; restore/migraciones escriben
únicamente en `calidad`. Los detalles técnicos están en [05_COMANDOS_TRANSFERENCIA.md](05_COMANDOS_TRANSFERENCIA.md).

El histórico Sheet sigue **FUERA del primer deploy**: tras estabilizar el flujo
moderno, snapshot final → SHA256 → auditoría delta legacy → importador PROD →
validación → mappings aprobados, según el [procedimiento histórico](../migrations/prod/README_LOGISTICA_PROD.md#importacion-historica-futura-no-ejecutarla-durante-preparacion).
Las migraciones crean su estructura; no importan el Sheet ni insertan mappings.

Antes de nuevas escrituras de negocio puede cancelarse el corte conservando la
API10 anterior/configuración sobre origen. Después, no volver ciegamente a origen:
preservar ambos lados y revisar delta y efectos en Drive con el equipo.
No compartir dumps, export SQL, passwords, tokens ni credenciales.
