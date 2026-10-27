# Deploy API10 y conciliación posterior

Secuencia vigente: [runbook por fases](10_RUNBOOK_CUTOVER_FINAL.md).
Este checklist corresponde al despliegue definitivo de **FASE B**. Primero
completar FASE A, limpiar las filas TEST y resolver cualquier dependencia creada
por CRUD mediante un procedimiento aprobado aparte. El cleanup no borra eventos.
El seed productivo conservado mantiene el guard antiguo: actualizar ese guard
controladamente antes de ejecutarlo; no iniciar FASE B con los bytes actuales.
Requisitos: baseline creado, seed real aprobado y
CALIDAD_SEED_OPERATIVO_VALIDO=SI / CALIDAD_SCHEMA_VALIDO=SI de
validate_seed_calidad.sql; API10 anterior/configuración respaldadas.
EXPORT_CONFIG_PROD_RECIBIDO=SI. La etiqueta heredada no bloquea ni pide otro export.
Las incidencias heredadas 39/5/9 se reportan como WARNING y no bloquean el deploy.
Solo los ERROR producen NO operativo; ver
[17_AUDITORIA_RUNTIME_BASELINE.md](17_AUDITORIA_RUNTIME_BASELINE.md).
Sin transferencia, restore, migraciones incrementales ni delta PostgreSQL.
Solo maestros/configuración se cargan; eventos/legacy/mappings quedan vacíos. Revisar el
[inventario de seeds](12_INVENTARIO_BASELINE_LIMPIO.md): sin usuario Logística
activo aprobado, la prueba Samsung responderá 403. El baseline no lo crea.

- [ ] API10 anterior respaldada = SI (ya confirmado), incluida su configuración.
- [ ] Node del proceso PM2 = v18.19.1; NO actualizar Node del servidor.
- [ ] Archivos subidos con FileZilla = SI: todos los de
  [07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt), desde context/api10/
  hacia el directorio API10 habitual del administrador, conservando rutas y usando transferencia binaria.
  No subir tests, entornos, credenciales, dumps ni node_modules.
- [ ] package.json/package-lock.json/.npmrc actualizados = SI. engine-strict permanece
  activado; no usar force, legacy-peer-deps ni ignorar engines.
- [ ] Variables productivas configuradas mediante el mecanismo seguro de PM2.
  server.js no carga archivos .env automáticamente. No heredar el rol administrativo
  del runner hacia API10; usar el rol de aplicación autorizado.

Nombres de variables (sin valores secretos):

```text
APP_ENV
PGHOST
PGPORT
PGUSER
PGPASSWORD
PGDATABASE
FIREBASE_LOGISTICA_PROJECT_ID
GOOGLE_APPLICATION_CREDENTIALS
LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH
LOGISTICA_DRIVE_TOKEN_PATH
LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID
```

Valores públicos:

```text
APP_ENV=production
PGDATABASE=calidad
FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar
```

Después de DB validada, coordinar el cambio de tráfico y considerar requests
en vuelo. No se exige detener todos los escritores durante el snapshot. Evitar
que nuevos clientes sigan llegando al artefacto anterior después del cutover.

```bash
npm ci --omit=dev
```

Ejecutar dentro de API10 con Node 18.19.1. Si falla: STOP, no reiniciar PM2.
Con la configuración completa, reiniciar API10 mediante el procedimiento habitual
del administrador. No solicitar nombre de proceso ni ruta.

```bash
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1:3010/api10/health
```

- [ ] npm ci --omit=dev = PASS y árbol runtime Node 18.19.1 compatible.
- [ ] Proceso PM2 reiniciado = SI con entorno nuevo, health = 200.
- [ ] Tráfico dirigido a calidad, hora del cutover registrada.
- [ ] Prueba Samsung por Jairo tras autorización separada del usuario: login,
  crear entrega, foto, firma, GPS, finalizar, Mis registros; COMPLETED y evidencias
  PostgreSQL/Drive confirmadas. Health 200 por sí solo no certifica este flujo.

Health valida HTTP; no acredita DB ni credenciales externas. No hacer escrituras
reales en Firebase/Drive solo para validar el arranque. Las pruebas locales usan
transportes simulados y la aplicación real con conexiones salientes bloqueadas.

Rollback antes de nuevas escrituras de negocio en calidad: mantener/restaurar
artefacto y configuración anterior de API10 sobre artecnologia. El binario nuevo
rechaza artecnologia por su guard. Seed/ledger no cuentan como eventos de
negocio nuevos. No volver ciegamente a artecnologia una vez que calidad reciba
altas/updates nuevos: preservar ambos lados, revisar delta/efectos externos y
autorizar una reconciliación o roll-forward. No borrar ninguna DB.

No importar Sheet ni mappings durante este despliegue limpio.
Riesgos de dependencias y mitigaciones: [AUDITORIA_NODE18.md](../../api10/AUDITORIA_NODE18.md).
