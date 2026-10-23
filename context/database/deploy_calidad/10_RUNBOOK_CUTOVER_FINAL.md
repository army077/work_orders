# Runbook final: cutover artecnologia → calidad

Secuencia operativa vigente: **16 fases, en orden**. Los comandos de esta tabla
son para el administrador durante la ventana; este documento no ejecuta acciones.
Base revisada: rama `migracion-datos-historicos`, commit
`ef9949d9159f4a74b98957106a2c2ff5d467336a`.

**Confirmado:** el preflight real de `calidad` dio `DESTINO_VACIO_Y_APTO = SI`,
`application_objects = 0`, `unexpected_application_objects = 0`, PostgreSQL
16.15 y timezone UTC. No repetir ese preflight como tarea manual ni solicitar
inventarios, versiones, nombre PM2 o ruta API10. Node productivo: **v18.19.1**.

Ejecutar los comandos `node context/...` desde la raíz del checkout administrativo
revisado. El administrador usa su acceso y configuración segura existentes:
`PGHOST`, `PGPORT`, `PGUSER`, autenticación mediante `PGPASSFILE` privado o
`PGPASSWORD`, `APP_ENV=production`, `PGDATABASE=calidad` y `BACKUP_DIR` privado,
nuevo para esta ventana y fuera del checkout. Conservar ese mismo `BACKUP_DIR`
en las fases 4–8 y 15. Los clientes PostgreSQL 16 y las dependencias de las
herramientas administrativas deben estar disponibles; no se publican por FileZilla.
El rol administrativo de estas herramientas no se hereda a la aplicación.

Ante **STOP**: detener la secuencia, conservar salidas/recibos y compartir solo
metadatos con el responsable técnico. No continuar ni reintentar automáticamente.
Con un resultado apto se pasa a la siguiente fase sin otra aprobación humana.

| PASO | RESPONSABLE | ACCIÓN/COMANDO | RESULTADO ESPERADO | SI FALLA |
| --- | --- | --- | --- | --- |
| FASE 1 — Preflight origen | Administrador | En HeidiSQL, ejecutar íntegro [01_preflight_artecnologia.sql](01_preflight_artecnologia.sql) en `artecnologia` (READ ONLY). Guardar la salida. | `ORIGEN_APTO = SI` → continuar, sin revisión adicional de conteos. | `ORIGEN_APTO != SI`, error o salida incompleta → **STOP** y compartir salida. |
| FASE 2 — Backup | Administrador | Confirmar el respaldo de `artecnologia` por su procedimiento habitual. El mecanismo de backup queda a su cargo. | `BACKUP_ARTECNOLOGIA = SI`. | **STOP** si no está confirmado. |
| FASE 3 — Punto de corte | Administrador | Abrir el registro de corte con fecha/hora de inicio y zona horaria. Registrar el identificador del snapshot/dump en cuanto lo emita la fase 4, antes de restaurar. No exigir freeze total: pueden entrar registros posteriores en origen; se compararán en la fase 15. | Registro de la ventana abierto; se vinculará a `snapshot_started.json`, `snapshot.json` y al dump de la fase 4. | **STOP** si no se puede identificar la ventana o vincular su snapshot/dump. |
| FASE 4 — Dump/export | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs backup` y, solo si termina bien, `node context/database/deploy_calidad/08_operar.mjs export`. Genera backup completo y export selectivo aprobado desde el mismo snapshot; no copiar tablas con HeidiSQL ni seleccionar tablas/editar TOC. | `snapshot.json`: `status = COMPLETE`, `snapshot_id`, inicio/final y hashes; `backup_ok.json` y `export_ok.json` creados. Conservar `artecnologia_seguridad.dump`, `selectivo.toc`, `calidad_selectivo.sql`, `origen_definitivo.tsv`, `delta_baseline.tsv` y `sequence_states.json`. Completar el registro de la fase 3. | **STOP** ante error, recibo ausente/incompleto o cambio estructural concurrente. No reutilizar un intento incompleto. |
| FASE 5 — Restore | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs restore`. Restaura únicamente el selectivo en `calidad`; `artecnologia` permanece sin escrituras de este procedimiento. | `pg_restore` finaliza con éxito y se crea `restore_completed.json`. | Si falla `pg_restore` o no hay éxito confirmado: **STOP**. No restaurar el backup completo en `calidad` ni reintentar a ciegas. |
| FASE 6 — Validación post-restore | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs validate-restore`. Ejecuta [03_validar_post_restore_calidad.sql](03_validar_post_restore_calidad.sql), la captura delta de destino y los comparadores preparados contra el baseline del snapshot. | `RESTORE_VALIDADO = SI` en salida y `restore_validado.json`. Incluye estructura, conteos, filas y estado de secuencias del dump; sin comparación manual. | Resultado distinto de SI o cualquier error → **STOP**. No aplicar Logística. |
| FASE 7 — Migraciones Logística | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs migrate`. El runner ejecuta y comprueba cada migración antes de enviar la siguiente, en este orden cerrado de `context/database/migrations/prod/`:<br>1. `20261016_create_logistica_authorized_users.sql`<br>2. `20261016_create_logistica_deliveries.sql`<br>3. `20261019_extend_logistica_delivery_evidence.sql`<br>4. `20261019_add_logistica_delivery_drive_folder.sql`<br>5. `20261020_add_logistica_delivery_completion.sql`<br>6. `20261021_create_entregas_logistica_legacy.sql`<br>7. `20261021_create_logistica_legacy_owner_mapping.sql` | Siete resultados `PASS`, en orden, y un archivo `<nombre-migracion>.result.json` por éxito. El administrador no elige archivos ni orden. | Si una falla: **STOP**, no continuar con la siguiente ni reejecutar el lote. |
| FASE 8 — Validación Logística | Administrador | Ejecutar `node context/database/deploy_calidad/08_operar.mjs validate-final`. Ejecuta [04_validar_post_logistica_calidad.sql](04_validar_post_logistica_calidad.sql). | `LOGISTICA_SCHEMA_VALIDO = SI` y `logistica_validada.json`; ledger 7/7 y esquema validado. | Resultado distinto de SI o error → **STOP** antes del deploy. |
| FASE 9 — Deploy API10 | Administrador | Usar [07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt) como lista exacta: origen `context/api10/`, destino el directorio API10 conocido por el administrador. Subir todos los archivos conservando rutas y en modo binario. No seleccionar un subconjunto. | `API10 anterior respaldada = SI` (incluida configuración); `archivos FileZilla subidos = SI`; `package.json/package-lock.json actualizados = SI`. Incluir `.npmrc` del manifiesto. | **STOP** si falta respaldo o algún archivo. No reiniciar PM2. |
| FASE 10 — Dependencias | Administrador | En el servidor, dentro de API10, ejecutar `npm ci --omit=dev` con Node **v18.19.1**. | Instalación finalizada con éxito; no cambiar Node ni omitir la comprobación de engines. | Si falla: **STOP**, **NO reiniciar PM2**. |
| FASE 11 — Configuración | Administrador | Confirmar por el mecanismo seguro habitual, sin imprimir valores privados: `APP_ENV=production`, `PGDATABASE=calidad`, `FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar`. Confirmar configuración de `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS`, `LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH`, `LOGISTICA_DRIVE_TOKEN_PATH` y `LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID`. El proceso debe recibir el entorno; `server.js` no carga `.env` automáticamente. | Configuración presente y correcta para el rol de aplicación autorizado, Firebase y Drive. Sin volcar entornos ni credenciales. | **STOP** si falta configuración. No reiniciar PM2 con un entorno incompleto. |
| FASE 12 — PM2 | Administrador | Reiniciar únicamente API10 mediante el procedimiento habitual del administrador. | API10 ejecutándose con los archivos y entorno nuevos. Registrar hora del cambio de tráfico; evitar nuevas solicitudes hacia la API anterior y considerar peticiones/jobs en vuelo. | **STOP** si el reinicio falla; conservar logs sin secretos. |
| FASE 13 — Health | Administrador | Comprobar `GET /api10/health`. En el servidor: `curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3010/api10/health`. | **HTTP 200**. Solo acredita HTTP; todavía no valida PostgreSQL, Firebase ni Drive. | **STOP** si no responde 200. |
| FASE 14 — Prueba funcional Samsung | **Jairo** | Con un usuario autorizado, probar en Samsung: **login → crear entrega → foto → firma → GPS → finalizar → Mis registros**. | Entrega en `COMPLETED`; evidencia en Drive; registro en PostgreSQL; entrega visible en Mis registros. | **STOP** para aceptación funcional si falla cualquiera; registrar el fallo y conservar evidencias de ambos lados. |
| FASE 15 — Conciliación delta | Administrador (captura); responsables de datos (revisión humana) | Después del corte, ejecutar `node context/database/deploy_calidad/08_operar.mjs delta`. Usa las herramientas READ ONLY de `transfer_calidad/` para comparar `artecnologia` vs `calidad` y el baseline del snapshot. | Reportes `delta_origen_<captura>.tsv`, `delta_destino_<captura>.tsv` y `delta_<captura>.json` con `SOLO_ORIGEN`, `SOLO_DESTINO`, `CONTENIDO_DISTINTO`. Código 0: sin diferencias observadas; 2: pendientes/no comparables; 1: captura inválida. Registrar decisiones humanas y repetir hasta cerrar los casos. | Código 1 → **STOP** y revisar captura. Código 2 → conciliación pendiente: no declarar cierre. No aplicar `INSERT/UPDATE/DELETE` automáticamente ni inferir deletes; revisar también colisiones de PK/FK. |
| FASE 16 — Histórico Sheet | Responsables de datos y administrador, después de estabilizar el flujo moderno | **FUERA del primer deploy**. Después: snapshot final Sheet → SHA256 → auditoría delta legacy → importador PROD existente → validación → mappings aprobados. Seguir el [procedimiento histórico PROD](../migrations/prod/README_LOGISTICA_PROD.md#importacion-historica-futura-no-ejecutarla-durante-preparacion). | Primer deploy sin importación Sheet ni mappings históricos. Ejecución posterior con snapshot/aprobaciones propios, separada del delta PostgreSQL. | Si no hay estabilidad, validación o aprobaciones: **STOP** del histórico; mantenerlo fuera del despliegue inicial. |

El runner `restore` conserva su guard automático de destino y servidor/rol antes
de escribir; no añade una tarea manual de preflight ni pide otro inventario.
`backup` vuelve a capturar origen dentro del snapshot para obtener el baseline
consistente. Usar esta tabla; no ejecutar de nuevo el subcomando `preflight` ni
el bloque A del documento técnico.

Las siete migraciones crean también la estructura legacy, pero no importan el
Sheet ni insertan mappings. La conciliación delta es humana: los comandos de
origen son de solo lectura; las escrituras de restore/migraciones son en `calidad`.
No se agrega SQL destructivo ni un aplicador de conciliación. No compartir dumps,
export SQL, passwords, tokens, passfiles ni credenciales en salidas o tickets.

Antes de nuevas escrituras de negocio en `calidad`, el administrador puede
cancelar el corte conservando la API10 anterior y su configuración sobre origen.
Después de nuevas escrituras, no volver ciegamente a `artecnologia`: preservar
ambos lados y revisar delta y efectos en Drive con el responsable técnico.

Detalle técnico solo si hay incidencias: [comandos y recibos](05_COMANDOS_TRANSFERENCIA.md),
[configuración y rollback](06_CHECKLIST_CUTOVER.md),
[alcance de la conciliación delta](../transfer_calidad/CONCILIACION_DELTA.md).
