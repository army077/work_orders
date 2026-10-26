# Runbook: calidad con configuración, sin históricos

**5 pasos. EXPORT_CONFIG_PROD_RECIBIDO=SI.** JSON real y query ejecutado aceptados.
No solicitar otro export por la etiqueta heredada PENDIENTE_EXPORT_CONFIG_PROD.
El seed reproduce exactamente las 1.139 filas autorizadas. Las incidencias 39/5/9
son WARNING por alcance limitado, sin bloqueo general del runtime:
[17_AUDITORIA_RUNTIME_BASELINE.md](17_AUDITORIA_RUNTIME_BASELINE.md).
Se espera BASELINE_APTO_PARA_DEPLOY=SI. Los ERROR siguen bloqueando; el alta
manual de Logística es independiente y obligatoria para usar ese módulo.

Prerrequisitos: backup confirmado por el administrador mediante su procedimiento
habitual, calidad existente, PostgreSQL 16.15, extensiones plpgsql/citext instaladas,
Node **18.19.1**, acceso/permisos y respaldo de API10/configuración.
Los SQL son autónomos para HeidiSQL, íntegros sobre calidad. Ante error/NO/salida
incompleta: **STOP**, conservar salida; no limpiar, reparar ni reintentar a ciegas.
Un marcador SI dentro de una transacción requiere COMMIT posterior exitoso.

| PASO | ACCIÓN | RESULTADO ESPERADO |
| --- | --- | --- |
| 1 — Crear | Ejecutar [create_calidad.sql](create_calidad.sql). | CALIDAD_BASELINE_CREADO=SI y COMMIT exitoso; arquitectura final con ledger, negocio vacío. |
| 2 — Seed | Ejecutar [seed_calidad_operativo.sql](seed_calidad_operativo.sql). | CALIDAD_SEED_CARGADO=SI, 1139 filas y COMMIT exitoso; IDs preservados y siete secuencias ajustadas dentro de la transacción. Esto certifica carga, no aceptación funcional. |
| 3 — Validar | Ejecutar [validate_seed_calidad.sql](validate_seed_calidad.sql), READ ONLY; devolver salida completa. | Schema/datos/operativo SI y BASELINE_APTO_PARA_DEPLOY=SI. Las 39/5/9 permanecen como WARNING y no bloquean. ERROR o NO de esos checks: STOP. No pedir otro export ni reparar configuraciones heredadas. |
| 4 — Alta Logística si pendiente | Si LOGISTICA_AUTH_PENDIENTE=SI, alta explícita del usuario real aprobado mediante el INSERT parametrizado de [13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md); repetir validación. | LOGISTICA_AUTH_PENDIENTE=NO; sin UID inventado/copias de usuarios. Es un bloqueo del módulo Logística, independiente del baseline apto. |
| 5 — Deploy API10 | Administrador/backend: FileZilla → dependencias/configuración → reinicio habitual → health. Jairo: Samsung. | Validación operativa SI, HTTP 200 y prueba funcional completa. |

En el PASO 5 subir exactamente
[07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt), desde context/api10/
al directorio habitual, conservando rutas/modo binario, incluidos package.json,
package-lock.json y .npmrc. No subir SQL, fuentes JSON con personas, herramientas
administrativas, tests, entornos, credenciales o node_modules.
Dentro de API10: `npm ci --omit=dev`, Node 18.19.1.
Configurar `APP_ENV=production`, `PGDATABASE=calidad`,
`FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar` y demás variables PG/Firebase/Drive
según [06_CHECKLIST_CUTOVER.md](06_CHECKLIST_CUTOVER.md), sin imprimir secretos.
Configurar permisos habituales del rol API10/search_path; server.js no carga .env
automáticamente. Reiniciar API10 mediante el procedimiento habitual del administrador.
Comprobar `GET /api10/health`: HTTP 200, que solo acredita HTTP.
Jairo valida login → crear entrega → foto → firma → GPS → finalizar → Mis registros;
exigir COMPLETED, evidencia Drive y registro visible. Si falla, no aceptar el deploy.

Datos iniciales: únicamente siete maestros y alta Logística posterior aprobada.
Sin órdenes/avances/inspecciones realizadas/entregas/evidencias/históricos/legacy/
mappings/TEST. No dump, restore, delta, migración histórica ni siete migraciones
posteriores: la arquitectura final está incluida en create_calidad.sql.
validate_create_calidad.sql se conserva para diagnosticar el baseline vacío antes
del seed. El query de export se conserva como evidencia ejecutada, no se repite.

Conservar salidas completas de creación/seed/validación para revisión. El seed
no contacta artecnologia ni genera archivos de salida automáticos. Tras nuevas
escrituras, no volver ciegamente al sistema anterior: preservar ambos lados y
coordinar la decisión con el equipo. Ningún SQL de esta entrega se ejecutó aquí.
