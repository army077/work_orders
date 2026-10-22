# Deploy API10 y conciliación posterior

Requisitos: RESTORE_VALIDADO=SI y LOGISTICA_SCHEMA_VALIDO=SI de la misma ventana,
snapshot.json COMPLETE y artefacto anterior respaldado. **No requiere freeze total**.
API10 permanece en artecnologia hasta terminar la migración/validación de calidad.

- [ ] API10 anterior respaldada = SI (ya confirmado), incluida su configuración.
- [ ] Node del proceso PM2 = v18.19.1; NO actualizar Node del servidor.
- [ ] Nombre exacto PM2 y directorio API10 confirmados.
- [ ] Archivos subidos con FileZilla = SI: todos los de
  [07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt), desde context/api10/
  hacia <DIRECTORIO_API10_REAL>, conservando rutas y usando transferencia binaria.
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
cd '<DIRECTORIO_API10_REAL>'
node --version
npm ci --omit=dev --engine-strict
npm run audit:node18
pm2 restart '<NOMBRE_EXACTO_PM2_API10>' --update-env
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1:3010/api10/health
```

- [ ] npm ci --omit=dev = PASS y árbol runtime Node 18.19.1 compatible.
- [ ] Proceso PM2 reiniciado = SI con entorno nuevo, health = 200.
- [ ] Tráfico dirigido a calidad, hora del cutover registrada.
- [ ] Ejecutar bloque I de 05: CONCILIACION DELTA; asignar revisión y registrar
  resoluciones; repetir hasta cerrar diferencias sin pérdidas silenciosas.

Health valida HTTP; no acredita DB ni credenciales externas. No hacer escrituras
reales en Firebase/Drive solo para validar el arranque. Las pruebas locales usan
transportes simulados y la aplicación real con conexiones salientes bloqueadas.

Rollback antes de nuevas escrituras de negocio en calidad: mantener/restaurar
artefacto y configuración anterior de API10 sobre artecnologia. El binario nuevo
rechaza artecnologia por su guard. Restore/ledger no cuentan como operaciones de
negocio nuevas. No volver ciegamente a artecnologia una vez que calidad reciba
altas/updates nuevos: preservar ambos lados, revisar delta/efectos externos y
autorizar una reconciliación o roll-forward. No borrar ninguna DB.

El snapshot final Entregas/Sheet es independiente del delta PostgreSQL.
Riesgos de dependencias y mitigaciones: [AUDITORIA_NODE18.md](../../api10/AUDITORIA_NODE18.md).