# Deploy API10 mediante FileZilla, después de DB validada

Requisitos: RESTORE_VALIDADO=SI y LOGISTICA_SCHEMA_VALIDO=SI de la misma ventana;
freeze vigente; artefacto API10 anterior respaldado (ya confirmado). Una comprobación
fallida detiene el deploy. No copiar el paquete administrativo al runtime público.

- [ ] API10 anterior respaldada = SI; conservar su configuración para `artecnologia`.
- [ ] Confirmaciones 1–5 del LEEME recibidas. Node del proceso PM2 compatible con ≥22.
- [ ] Archivos nuevos subidos = SI: con FileZilla subir **todos** los archivos de
  [07_ARCHIVOS_API10_FILEZILLA.txt](07_ARCHIVOS_API10_FILEZILLA.txt) desde
  `context/api10/` a `<DIRECTORIO_API10_REAL>`, conservando subdirectorios.
  Usar transferencia binaria para conservar los bytes del artefacto revisado.
  No subir tests, `.env`, credenciales, dumps, `node_modules` ni scripts SQL.
- [ ] `package.json` / `package-lock.json` actualizados = SI (incluidos en esa lista).
- [ ] Variables productivas configuradas = SI, mediante el mecanismo seguro
  existente que alimenta PM2. `server.js` no carga archivos `.env` automáticamente.
  No asumir que subir un `.env` configura el proceso.

Nombres de variables requeridas (sin valores secretos):

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

Valores públicos esperados:

```text
APP_ENV=production
PGDATABASE=calidad
FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar
```

Los archivos de Firebase/Drive permanecen privados fuera del runtime compartido;
configurar sus rutas según el mecanismo existente. Usar el rol de API10, no
propagar el entorno administrativo del runner al proceso API. No ejecutar
`pm2 env`, volcados de entorno ni publicar logs con secretos.

Con el proceso sin tráfico y antes de levantar el freeze:

```bash
cd '<DIRECTORIO_API10_REAL>'
npm ci --omit=dev
pm2 restart '<NOMBRE_EXACTO_PM2_API10>' --update-env
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1:3010/api10/health
```

- [ ] `npm ci --omit=dev` = PASS.
- [ ] PM2 proceso API10 reiniciado = SI, con el nombre exacto confirmado.
- [ ] Health = 200.
- [ ] Configuración activa confirmada para `calidad` sin imprimir secretos.
- [ ] Responsable autoriza abrir tráfico y finalizar freeze.

El health comprueba HTTP del proceso; **no prueba una consulta DB ni la operación
Firebase/Drive**. Las validaciones previas certifican el schema; la habilitación
operativa de usuarios/mappings y validaciones funcionales de negocio se realizan
según el alcance posterior autorizado. No insertar datos de negocio para probar.

Rollback antes de nuevas escrituras de negocio en `calidad`: mantener/restaurar
el artefacto y configuración anterior de API10 sobre `artecnologia`, reiniciar
el mismo proceso y verificar health antes de levantar el freeze. Las escrituras
administrativas de restore/ledger no equivalen a nuevas escrituras de negocio.

Si `calidad` ya recibió **cualquier escritura nueva de negocio**, no volver
ciegamente a `artecnologia`. Detener escritores, preservar ambos estados y
reconciliar/reproducir las diferencias mediante un plan autorizado antes de
cambiar tráfico. No automatizar esa decisión ni borrar ninguna DB.
