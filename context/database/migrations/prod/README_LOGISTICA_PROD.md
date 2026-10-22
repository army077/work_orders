# Logistica: artefactos para un cutover PROD posterior

Estos archivos **no autorizan un despliegue ni una importacion**. Preparacion y
tests se realizan en LOCAL. No usan Firebase, HTTP, PM2 ni Google Drive.
Los archivos de `../local/` y los importadores LOCAL permanecen intactos.

## Orden y dependencias

Aplicar **un archivo por operacion**, detenerse y comprobar el preflight despues
de cada COMMIT:

1. `20261016_create_logistica_authorized_users.sql`: allowlist y ledger vacios.
2. `20261016_create_logistica_deliveries.sql`: FK a allowlist; crea evidence base.
3. `20261019_extend_logistica_delivery_evidence.sql`: requiere evidence **vacia**;
   toma ACCESS EXCLUSIVE, agrega UUID NOT NULL, estado y lease. No hace backfill.
4. `20261019_add_logistica_delivery_drive_folder.sql`: referencia de carpeta.
5. `20261020_add_logistica_delivery_completion.sql`: metadatos de finalizacion.
6. `20261021_create_entregas_logistica_legacy.sql`: historico independiente vacio.
7. `20261021_create_logistica_legacy_owner_mapping.sql`: infraestructura vacia;
   conserva los guards de auditoria y revocacion. No copia ningun mapping LOCAL.

No se encontro un ledger equivalente en el alcance revisado. La primera
migracion crea `public.logistica_schema_migrations`, exclusivo de estos siete
archivos: nombre PK, SHA256 de bytes, `applied_at` del servidor y `applied_by`
del rol de sesion. No hay descubrimiento automatico ni ejecucion de carpetas.

## Prerrequisitos y limite de la identificacion

Antes de cualquier ejecucion futura, el operador debe aprobar fuera de banda
el servidor/instancia, base, rol y puerto contra el inventario de produccion,
respaldo recuperable y ventana de mantenimiento. **Todavia no hay una IP/host
productivo confirmado en estos artefactos**. No se lo inventa ni se adopta un
destino desde `.env.local`.

El entorno debe suministrar `APP_ENV=production`, `PGDATABASE=calidad`,
`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` y el transporte TLS aprobado. Usar el
mecanismo de secretos operativo; no poner passwords en CLI, README ni archivos
versionados. Configurar/verificar TLS segun infraestructura, sin desactivar la
verificacion del certificado. Los scripts no cargan archivos `.env` por defecto.

Se exige adicionalmente `--expected-user`, `--expected-server-address` (direccion
TCP observada **por PostgreSQL**, no necesariamente el hostname del cliente),
`--expected-server-port` y `--confirm-production calidad`. Se valida
`current_database`, `current_user=session_user`, direccion y puerto observados;
se rechaza `workorders_test` y se admite exclusivamente PostgreSQL **16**.
No se admite conexion Unix sin direccion TCP ni SET ROLE a un rol distinto.
PG16 es la version verificada en LOCAL; otro major exige revision de catalogos.

Estas comprobaciones evitan errores de destino, pero **no atestiguan por si
solas que una copia de la base sea produccion**. Una clonacion podria coincidir
con nombre/rol/direccion. Confirmar la instancia contra inventario es una
precondicion operacional obligatoria, no un dato deducido por los scripts.

## Integridad del esquema y SQL

`logistica_schema_states.json` contiene ocho estados: inicial y despues de cada
migracion. Las huellas incluyen columnas/tipos/nullability/defaults/collations,
constraints validadas, FKs, indices, triggers, reglas, RLS/policies, herencia,
secuencias y funcion de proteccion de mappings. No incluyen filas, valores
actuales de secuencias, propietarios ni grants. Revisar por separado permisos,
roles, encoding/collation del destino y acceso de API10; no se conceden permisos
automaticamente. Los defaults implicitos de collation dependen de la base.

La representacion se comprobo con PostgreSQL 16 en tablas temporales aisladas;
solo para `pg_temp_N` se normaliza la persistencia temporal a permanente.
Las consultas reales fijan el namespace `public`, sin aceptar esa excepcion
para objetos productivos. No se renombran tablas public ni se debilitan guards.

Cada SQL inicia transaccion, valida destino, obtiene advisory lock y bloqueos
de tablas, exige la huella anterior y el prefijo exacto del ledger, ejecuta DDL,
verifica la huella posterior y registra el checksum antes de COMMIT.
Timeouts: lock 5s / statement 30s. Una precondicion fallida hace abortar; nunca
arregla drift ni ignora objetos por `IF NOT EXISTS`.

Usar el runner: calcula SHA256 de los **mismos bytes UTF-8** enviados a PG y
provee los valores de sesion requeridos por el SQL. El SHA auto-suministrado
por una ejecucion SQL manual no es prueba independiente del archivo enviado;
no es un flujo soportado. Los SQL se versionan LF mediante `.gitattributes`.
No editar/regenerar SQL aplicado: su SHA y las referencias en archivos
posteriores deben conservarse. La plantilla en tests verifica reproducibilidad;
no es una herramienta de reparacion ni de despliegue.

## Comandos conceptuales (no ejecutados en PROD)

En PowerShell, una vez preparado el entorno mediante el mecanismo aprobado:

```powershell
$target = @('--expected-user','<ROL_APROBADO>',
  '--expected-server-address','<DIRECCION_SERVIDOR_APROBADA>',
  '--expected-server-port','<PUERTO_APROBADO>',
  '--confirm-production','calidad')

node context/database/migrations/prod/preflight_logistica_prod.js @target

# Solo si GO; repetir manualmente por cada nombre, en el orden indicado.
node context/database/migrations/prod/apply_logistica_migration_prod.js @target --migration <NOMBRE_SQL>
node context/database/migrations/prod/preflight_logistica_prod.js @target
```

El preflight abre `BEGIN READ ONLY`, consulta catalogos/conteos y termina con
ROLLBACK. No usa `nextval`, DDL, DML ni `set_config`. Muestra solo identidad
administrativa, version, tablas, conflictos, conteos y ledger; nunca credenciales,
filas de personas ni definiciones SQL arbitrarias. Ante ledger incompatible
reporta conflicto/NO-GO, no interpreta ni corrige ese registro.

**GO por etapa:** identidad aprobada, huella exacta, ledger con prefijo/checksums
esperados, sin migracion parcial, dependencias presentes y evidencia vacia antes
del paso 3. Verificar despues de cada etapa SHA, rol y fecha registrados, conteos
y ausencia de drift. Un archivo registrado con esquema exacto aborta como
`MIGRATION_ALREADY_REGISTERED`; no se vuelve a aplicar. Un schema distinto
aborta incluso si su ledger afirma que ya fue aplicado. NO-GO requiere revision
manual y un plan separado; no cambiar checksums/ledger para forzar continuidad.

## Importacion historica futura (NO ejecutarla durante preparacion)

Primero completar y verificar las siete migraciones. Aprobar **una sola vez**
el snapshot final congelado, su SHA256, hoja literal `Entregas` y conteo util.
No usar el snapshot LOCAL como importacion previa al final productivo.

```powershell
node context/database/importers/apply_entregas_logistica_prod.js @target `
  --input '<RUTA_ABSOLUTA_LOCAL_SNAPSHOT_FINAL.xlsx>' `
  --approved-sha256 '<SHA256_FINAL_APROBADO>' `
  --sheet Entregas --expected-count '<CONTEO_FINAL_APROBADO>'
```

Ruta absoluta local, SHA, hoja y conteo son obligatorios, sin defaults finales.
El archivo se lee y valida antes de conectar; no se siguen hyperlinks, ejecutan
formulas ni se consulta Drive. No se admiten datos fuera de A:T, encabezados
distintos, fechas invalidas o pedidos numericos sin precision segura.
Se procesa toda fila util conservando su numero fisico; filas vacias no cambian
la identidad de las demas. El conteo util debe ser exactamente el aprobado.

Dentro de una sola transaccion se verifica destino, esquema completo/checksums
y se bloquea exclusivamente la tabla legacy para la importacion. Debe estar
vacia o contener solo el mismo scope `(snapshot_sha256, 'Entregas')`. Cualquier
otro scope aborta, incluso si tiene correos/pedidos parecidos. Una key existente
con hash o contenido distinto aborta antes de insertar. La reejecucion exacta
inserta cero filas y conserva IDs, `imported_at` y batch originales.

Se conservan raw_payload, NULLs, texto de pedidos (0/1/largos), anomalias y
contador declarado. Hora textual usa el mismo parser puro LOCAL, sin modificarlo.
FECHA+HORA produce timestamp sin zona; componentes faltantes producen NULL
y, si solo falta uno, warning. No se convierte a UTC ni a `created_at`.
URL de carpeta valida produce ID historico, sin probar existencia de archivos.
El resultado reporta conteos y codigos/filas de anomalias, no datos personales.

**No** se insertan entregas/evidencias operativas, usuarios, ownership, mappings
ni estados COMPLETED. No se interpreta el contador como PHOTO UPLOADED. No se
copia el mapping TEST_LOCAL revocado. Conciliacion requiere una aprobacion futura.

## Fallos, COMMIT incierto y rollback

Un fallo dentro de transaccion requiere ROLLBACK y revision; el runner nunca
autoreintenta ni continua con el siguiente archivo. Ante corte de conexion o
resultado ambiguo, cerrar conexion y ejecutar preflight de solo lectura para
comparar **ledger + esquema** antes de decidir. En importacion, verificar scope,
conteos y contenido; una futura reejecucion solo puede usar el mismo snapshot
aprobado. No elegir otro SHA para "desbloquear" un resultado incierto.

Rollback transaccional antes de COMMIT es valido. Despues de COMMIT **no hay
down migration destructiva automatica**: restauracion de backup o migracion
correctiva revisada, con aprobacion operativa. Nunca DROP/TRUNCATE a ciegas,
DELETE de mappings auditados, desactivar triggers, falsear ledger, parchear
schemas parciales o importar otro snapshot encima. Una aprobacion de ownership
se revoca con su auditoria; no se elimina su historial.

## Tests controlados LOCAL

No se conecta a PROD. Dependencias ya instaladas (`pg`, `xlsx`); no instalar.

```powershell
$env:RUN_LOGISTICA_PROD_ARTIFACT_TESTS='1'
node --env-file=context/api10/.env.local --test context/database/tests/prod/logistica_prod.test.js context/database/tests/prod/logistica_prod.integration.test.js
```

El fixture exige APP_ENV local, loopback:5432, artecnologia_test_local y
workorders_test tanto en configuracion como desde la conexion observada.
Prueba los guards originales contra LOCAL (deben fallar), y el DDL/bloques de
preflight en `pg_temp_N` dentro de rollback. No concede permisos ni modifica
esquemas public. Los XLSX de prueba son sinteticos en memoria; no se importa
el historico real. Se comparan filas y secuencias de las cinco tablas protegidas
antes/despues. La prueba de escritura positiva del destino PROD real queda
deliberadamente pendiente del cutover autorizado.

## Identidad y ensayo de transferencia (2026-10-22)

PROD exige exclusivamente `APP_ENV=production PGDATABASE=calidad` y confirmacion
`calidad`. `artecnologia` queda como origen/rollback con el artefacto API10
anterior. Los siete SQL completos rechazan bases LOCAL/TEST y el rol de pruebas.
El intento de ensayo en `calidad_test_local` queda como antecedente archivado;
su bloqueo administrativo fue aceptado y no se creara esa base ni otra base
de ensayo. Sus runners conservan los guards LOCAL originales y no se usaran en
produccion. No se implementa ningun runner PREPROD. El procedimiento vigente
es [transfer_calidad/README.md](../../transfer_calidad/README.md): migrar las
tablas del proyecto desde artecnologia READ ONLY hacia calidad durante el
freeze; validar el baseline; aplicar estos siete SQL; validar y entonces
habilitar trafico API10. Hasta una operacion de cutover autorizada no ejecutar
conexiones, restauraciones o migraciones productivas.

El DDL y las ocho huellas estructurales no cambiaron al renombrar el destino.
`logistica_schema_shape.sql` y `logistica_schema_states.json` permanecen iguales.
Se actualizaron los hashes de los siete artefactos y todas las referencias del
ledger en orden; nunca regenerar SQL ya aplicado. Regeneracion offline exclusiva
para estos artefactos aun no aplicados:

```powershell
node context/database/tests/prod/regenerate_artifacts.mjs --write-unapplied-artifacts
```

| Artefacto | SHA-256 de bytes UTF-8/LF |
|---|---|
| 20261016_create_logistica_authorized_users.sql | `fc648e1e00f21c70bada0d7cdbd08bfcb7b6280e794ae4bbb0b05e3c2eb84844` |
| 20261016_create_logistica_deliveries.sql | `caaf530fba5860f6e7b2e1fe0659d66bef0de1bcebafa35e6241811c31504382` |
| 20261019_extend_logistica_delivery_evidence.sql | `25a31baa36e135424bcef69dc2ef73bec7c64d8c0cc7adcbcb4af7e50cf42f35` |
| 20261019_add_logistica_delivery_drive_folder.sql | `6bc3c84bd0cc830467e7f0d3dc7a72065aa72c0d259d7935663a95684f8e9f25` |
| 20261020_add_logistica_delivery_completion.sql | `9a44b2246d10d84612420f8d2cd15482238e56b4b65b3bbda96cfd5377aea8d0` |
| 20261021_create_entregas_logistica_legacy.sql | `f9e6bf843dd9dd4c8310b1af0e6b6bb6385ab7ea7ebaf6809a229e1952d35bef` |
| 20261021_create_logistica_legacy_owner_mapping.sql | `5a2d62dc71d4ee31daa64a2baa94f2ac84ebe209d9ce19d9c6d2fd3853803505` |
