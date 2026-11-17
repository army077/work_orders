# Ensayo aislado de transferencia y Logistica

Los ejemplos con --env-file/--test-isolation pertenecen al runtime anterior del
ensayo archivado; no están disponibles en Node 18.19.1 ni son instrucciones del
cutover vigente. Para pruebas offline usar context/api10/scripts/run_tests.cjs
y node --test con los archivos explícitos del paquete operativo actual.

**Antecedente archivado, no ejecutar como parte del cierre actual.** El usuario
acepto el bloqueo administrativo LOCAL y descarto crear calidad_test_local u
otra base de ensayo. No se solicitan nuevas credenciales ni cambios de permisos.
El destino definitivo es calidad, ya creada vacia por el administrador segun
la confirmacion del usuario. El procedimiento vigente es [README.md](./README.md):
artecnologia READ ONLY -> copia selectiva -> calidad sin trafico -> validaciones
-> siete migraciones PROD -> validacion final -> cutover. Nada de ello esta
autorizado para ejecutarse en este cierre offline. Los comandos y runners LOCAL
de este documento se conservan como antecedentes, sin habilitarlos ni adaptarlos
para produccion. No se implementa ningun runner PREPROD.

La ruta es fija: `127.0.0.1:5432`, rol `workorders_test`, origen
`artecnologia_test_local`, destino `calidad_test_local`, PostgreSQL 16.
Los scripts no aceptan nombres productivos ni servidores remotos. La
configuracion normal de db.js sigue admitiendo LOCAL/TEST originales; la base
de simulacion se usa exclusivamente mediante inyeccion de un pool de prueba.
No hay doble conexion en API10 ni una excepcion nueva en el guard de db.js.

## Administracion previa

El 2026-10-22 se confirmo LOCAL PostgreSQL 16.15 y clientes nativos 16.15 en
`C:\Program Files\PostgreSQL\16\bin`. El rol configurado no es superusuario,
no tiene CREATEDB y `calidad_test_local` no existia al inspeccionar.
No se inventan ni solicitan passwords para guardarlas en el repositorio.

Si la base aun no existe, un administrador LOCAL debe ejecutar una sola vez:

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\createdb.exe' -h 127.0.0.1 -p 5432 -U postgres -O workorders_test -T template0 -E UTF8 --lc-collate=Spanish_Mexico.1252 --lc-ctype=Spanish_Mexico.1252 calidad_test_local
```

Locale/encoding corresponden al origen LOCAL inspeccionado. No crear si ya
existe, no usar DROP DATABASE, no modificar el rol para concederle CREATEDB
como atajo. El harness verifica propietario, identidad y objetos antes de
restaurar; una base existente ocupada se rechaza por defecto.

## Ejecucion reproducible

Desde la raiz del repositorio, utilizando solo la configuracion LOCAL ya
existente y sin copiarla a nuevos archivos:

```powershell
node --env-file=context/api10/.env.local context/database/transfer_calidad/run_local_rehearsal.mjs --execute-local
```

`CALIDAD_PG_BIN` permite indicar el directorio de clientes PostgreSQL 16 en otro
equipo. El script ejecuta clientes nativos con argumentos separados, sin eval,
con host/base/rol fijos y entorno PG reducido; no hereda PGSERVICE/PGOPTIONS ni
destinos alternativos. En Windows, los procesos auxiliares no abren ventanas.

El ensayo:

1. Verifica ambas identidades LOCAL; nunca crea ni conecta a una DB productiva.
2. Congela temporalmente con SHARE las tablas relevantes del origen LOCAL,
   incluidas las de Logistica ya existentes, sin DDL/DML. Registra digests,
   conteos y secuencias antes/despues. No copia el mapping TEST_LOCAL revocado.
3. Reutiliza `manifest.psql`: 15 tablas base y los historicos presentes, con
   aprobacion explicita limitada a esta simulacion. Excluye las cinco tablas
   Logistica del origen, su funcion de mapping y la vista `work_order_totals`,
   que no esta referenciada por el runtime API10 auditado.
4. Captura catalogo, COUNT/MAX, constraints/indices/defaults/funciones/triggers,
   secuencias y sus valores. Rechaza dependencias FK salientes externas,
   tipos de usuario o rutinas auxiliares no inventariadas: requieren revision,
   no inclusion automatica. No admite SECURITY DEFINER con remapeo de propietario.
5. Exporta con pg_dump selectivo (tablas/secuencias), obtiene las funciones
   necesarias de un schema-only mediante TOC y restaura con pg_restore, por
   fases y con single-transaction/exit-on-error. Verifica el conjunto TABLE DATA
   exacto antes de restaurar.
6. Compara la estructura completa capturada y los datos agregados. Evalua el
   proximo candidato de cada secuencia contra MIN/MAX de cada columna que la
   consume, sin INSERT, nextval, setval o ajustes para hacer pasar pruebas.
7. Prueba que los siete SQL PROD completos **rechazan LOCAL**. Luego ejecuta
   mediante `apply_local_logistica.mjs` un wrapper de identidad LOCAL fijo con
   los locks, DDL, guards de forma, ledger y COMMIT derivados de cada artefacto.
   Conserva orden, rechazo de drift y evidencia vacia; valida las ocho etapas.
8. Confirma stage=7, seis tablas esperadas contando ledger, huella final y siete
   registros de versionado; verifica que el origen sigue exacto.

El wrapper no ejecuta los bytes completos PROD: estos deben rechazar esta DB.
El ledger LOCAL referencia SHA del artefacto fuente para verificar linaje y
`logistica-stages.json` registra por separado `source_sha256`,
`submitted_sha256` y `production_sql_executed=false`. El runner PROD permanece
sin transformaciones y su prueba offline verifica SHA de los bytes exactos que
envia a pg. No usar el ledger LOCAL como evidencia de ejecucion productiva.

Los objetos base LOCAL tienen propietarios `postgres` y `workorders_test`.
Un ensayo con el rol sin privilegios usa `--no-owner --no-acl` exclusivamente
en `calidad_test_local`; registra `permission_differences` sin declararlos
equivalentes. La comparacion PROD sigue exigiendo owners/ACL exactos. El
procedimiento productivo no adopta estas excepciones de simulacion.

Las evidencias se guardan en `evidence.local/<fecha>/`, ignorado por Git. Contienen
dump y datos de prueba: no hacer stage, commit ni publicar esa carpeta.
`result.json` solo existe al pasar todas las fases; `failure.json` no acredita
transferencia. No se borran/restablecen tablas ni secuencias automaticamente.
Tras un error, revisar la fase fallida; `--resume-validated-local` permite
continuar **solo si** el baseline del destino ya coincide con el origen. No
rellena datos faltantes ni repara drift. Ante COMMIT incierto, inspeccionar
ledger/estado antes de decidir un reintento.

## API10 y pruebas

Una vez validado el baseline y las siete etapas:

```powershell
$env:RUN_CALIDAD_API_TESTS='1'
try {
  node --env-file=context/api10/.env.local --test --test-isolation=none context/api10/tests/calidadLocal.test.js
} finally {
  Remove-Item Env:RUN_CALIDAD_API_TESTS -ErrorAction SilentlyContinue
}
```

La prueba usa handlers, middlewares y repositories reales contra destino LOCAL,
con Firebase/Drive aislados. No es una certificacion E2E de Firebase, HTTP o
Drive reales. Prueba auth/allowlist, crear/idempotencia, PHOTO/SIGNATURE,
finalizar, listado e historial combinado, ownership y revocacion.

Usa el snapshot sintetico conocido `tests/prod/snapshot_fixture.js`. Nunca
importa un XLSX operativo o snapshot productivo final. Conserva fecha legacy
sin offset inventado, estado RECORDED, contador legacy independiente, y no
asigna ownership sin mapping TEST_ONLY explicito. Todo fixture se revierte con
ROLLBACK; los BEGIN/COMMIT de repositories se representan con SAVEPOINT dentro
de esa transaccion de prueba. Las secuencias nuevas de Logistica pueden avanzar
legitimamente por fixtures aun con ROLLBACK: no se reinician para ocultarlo.
No se tocan los datos ni secuencias base transferidos.

Validaciones adicionales:

```powershell
node --test --test-isolation=none context/database/transfer_calidad/compare_snapshots.test.mjs context/database/transfer_calidad/local_safety.test.mjs
node --test --test-isolation=none context/database/tests/prod/logistica_prod.test.js
$env:RUN_LOGISTICA_PROD_ARTIFACT_TESTS='1'
try {
  node --env-file=context/api10/.env.local --test --test-isolation=none context/database/tests/prod/logistica_prod.integration.test.js
} finally {
  Remove-Item Env:RUN_LOGISTICA_PROD_ARTIFACT_TESTS -ErrorAction SilentlyContinue
}
# Suite API10 aislada, desde context/api10:
node --test --test-isolation=none tests/*.test.js
```

El test de integracion PROD existente conserva sus guards estrictos, ejecuta
fixtures temporales en `artecnologia_test_local` y verifica datos/secuencias
public exactos antes/despues. No se cambia su destino para abrir LOCAL/PROD.
La prueba especifica nueva es la que usa `calidad_test_local`.
