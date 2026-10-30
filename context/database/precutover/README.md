# Inventario comparativo pre-cutover: solo lectura

Estado: implementado y validable offline. **No ejecutado contra PostgreSQL real.**
Esta herramienta no autoriza una migración ni un cutover. No carga datos, crea
objetos, repara secuencias, aplica migraciones, genera dumps ni consulta APIs.
No es un conciliador de escritura.

## Archivos y reutilización

- `run_inventory.mjs`: CLI explícito y conexiones separadas.
- `scope.mjs`: reutiliza exclusivamente el lector estático de
  `../transfer_calidad/manifest.mjs`, sin importar runners operativos.
- `sql.mjs`: consultas de catálogo, conteos, huellas y referencias.
- `inventory.mjs`: captura READ ONLY, controles y cierre de conexiones.
- `compare.mjs`: comparación en memoria y síntesis sanitizada.
- `inventory.test.mjs`, `offline_guard.cjs`: pruebas con mocks y red bloqueada.

Se reutilizan los patrones del paquete existente: catálogo PostgreSQL, PK
descubierta, metadatos de secuencias, reportes por comprobación y huellas SHA-256
en PostgreSQL 16. No se importan ni ejecutan `08_operar.mjs`,
`09_comparar_restore.mjs`, aplicadores, generadores, `db.js` ni `server.js`.

Alcance fijo: **25 tablas**, las 15 base, seis de Logística contando el ledger
y cuatro históricos legacy. Incluye `entregas_logistica_legacy`. Las 15 base
son obligatorias en origen; las 21 del baseline son obligatorias en destino.
La ausencia de Logística en origen o de históricos opcionales se informa como
WARNING; no se supone que existan. Una tabla obligatoria ausente produce NO-GO.

## Planificación: sin PostgreSQL ni credenciales

Desde la raíz del repositorio:

```powershell
node context/database/precutover/run_inventory.mjs --plan
```

Enumera tablas, 19 relaciones explícitas, controles y limitaciones. No carga
`pg`, no abre conexiones, no lee filas del seed ni escribe archivos.
No existe modo de ejecución predeterminado: omitir el modo o combinar flags
incorrectamente falla antes de conectarse.

## Requisitos para una ejecución futura autorizada

- PostgreSQL **16** en ambas bases, catálogo y recursos disponibles.
- Node compatible con el runtime documentado 18.19.1 o posterior. Las pruebas
  de esta implementación se ejecutaron con el Node disponible del workspace;
  la ejecución real del SQL y del runtime del servidor aún debe comprobarse.
- Dependencia `pg` ya existente en `context/api10/node_modules`; se resuelve
  desde su `package.json`. No instalar dependencias como parte del inventario.
- Archivo original aprobado `../deploy_calidad/sources/export_config_prod_20261023.json`
  con SHA-256 `47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0`.
  Solo se extraen sus IDs; el contenido personal no se copia al reporte.
- Directorio padre privado para reportes y espacio disponible. El directorio
  final indicado por `--out` debe ser absoluto y **no existir**.
- Aprobación del administrador sobre instancia, duración y carga. Los nombres
  de DB y la identidad del usuario no acreditan por sí solos la instancia real.

No se cargan archivos `.env`, servicios libpq ni destinos predeterminados.
Configurar todas las variables mediante el mecanismo privado del administrador;
no pegar sus valores en chat, CLI, capturas, Git o documentación.

| Variable | Requisito |
| --- | --- |
| `PRECUTOVER_READ_ONLY_ACK` | Valor literal `SI`; declaración adicional, no sustituye los controles de permisos |
| `PRECUTOVER_SOURCE_PGHOST` | Host explícito del origen aprobado |
| `PRECUTOVER_SOURCE_PGPORT` | Puerto TCP explícito |
| `PRECUTOVER_SOURCE_PGUSER` | Rol lector aprobado |
| `PRECUTOVER_SOURCE_PGPASSWORD` | Secreto suministrado privadamente |
| `PRECUTOVER_SOURCE_PGDATABASE` | Literal `artecnologia` |
| `PRECUTOVER_SOURCE_SSL_MODE` | `verify-full` o `disable`, selección obligatoria |
| `PRECUTOVER_SOURCE_SSL_CA_FILE` | Opcional: ruta absoluta a CA aprobada |
| `PRECUTOVER_DESTINATION_PGHOST` | Host explícito del destino aprobado |
| `PRECUTOVER_DESTINATION_PGPORT` | Puerto TCP explícito |
| `PRECUTOVER_DESTINATION_PGUSER` | Rol lector aprobado |
| `PRECUTOVER_DESTINATION_PGPASSWORD` | Secreto suministrado privadamente |
| `PRECUTOVER_DESTINATION_PGDATABASE` | Literal `calidad` |
| `PRECUTOVER_DESTINATION_SSL_MODE` | `verify-full` o `disable`, selección obligatoria |
| `PRECUTOVER_DESTINATION_SSL_CA_FILE` | Opcional: ruta absoluta a CA aprobada |

`verify-full` valida el certificado y hostname con la CA indicada o la confianza
del sistema. No se admite un modo que acepte certificados sin verificar.
`disable` se reserva a un transporte sin TLS aprobado, por ejemplo un túnel
controlado; no seleccionarlo para una conexión remota sin esa evaluación.

### Privilegios mínimos y transacciones

Se necesitan CONNECT, USAGE del esquema y SELECT sobre las tablas y secuencias
que se inspeccionarán, además de acceso a los catálogos públicos usados. El DBA
prepara o verifica esos privilegios por separado: este programa no ejecuta grants.
La ausencia de SELECT se registra; no se suple con un rol de aplicación/escritura.

Se rechazan roles privilegiados (superuser, CREATEDB, CREATEROLE, replicación o
BYPASSRLS), escritura en relaciones/secuencias de esquemas de usuario y CREATE
en esquemas de usuario o la DB, también al detectar membresías que lo permiten.
USAGE de una secuencia permitiría `nextval`, por eso para ella solo se requiere
SELECT. Un rol estándar de aplicación puede fallar aunque se declare lector.
Estos controles no son una auditoría de todas las funciones SECURITY DEFINER
del servidor. No se invocan funciones operativas o expresiones del aplicativo.

Cada cliente solicita `default_transaction_read_only=on` desde su arranque y
abre `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. Comprueba DB, PG16,
usuario esperado, ausencia de cambio de rol y estado READ ONLY. Usa SET LOCAL
para formato canónico, `search_path=pg_catalog`, timeouts y `row_security=off`.
No se leen silenciosamente subconjuntos filtrados por RLS: las tablas con RLS,
particiones/herencia o formas no soportadas quedan NO-GO.

Solo se envían SELECT/CTE de lectura y controles de transacción:
BEGIN READ ONLY, SET LOCAL, SAVEPOINT, RELEASE y ROLLBACK. Los nombres de
privilegios INSERT/UPDATE/etc. aparecen como literales en consultas de catálogo;
no son sentencias de escritura. No se envía COMMIT ni se habilita escritura.
Los savepoints recuperan errores de comprobaciones independientes sin salir de
READ ONLY; una conexión dañada detiene esa captura. Se intenta ROLLBACK y cierre
también ante errores. El cierre fallido produce NO-GO.

## Procedimiento posterior para el administrador

1. Revisar código, alcance, resultados offline y autorización. No automatizar
   este paso como tarea de producción ni reutilizar comandos del runner histórico.
2. Confirmar instancias y roles lectores, configuración TLS, permisos y directorio
   privado. Elegir una ventana sin DDL y evaluar tamaño/carga antes de capturar.
3. Ejecutar `--plan` y contrastar el inventario esperado.
4. Solo con autorización, ejecutar manualmente el siguiente patrón, sustituyendo
   la ruta por un directorio nuevo absoluto bajo un padre privado ya existente:

```powershell
node context/database/precutover/run_inventory.mjs --execute-readonly --out '<DIRECTORIO_ABSOLUTO_NUEVO>' --timeout-ms 20000 --max-rows 100000 --max-total-rows 500000 --sample-limit 20
```

5. Revisar `inventory.json` y `summary.txt`, estado y cobertura antes de compartir.
   No considerar aprobado un directorio parcial o una ejecución interrumpida.
6. Registrar pendientes con responsable; no corregir datos a partir del reporte
   sin otro diseño, ensayo y autorización. No hay reintentos automáticos.

No se ejecutó ese patrón contra bases reales durante esta implementación.

### Límites y detención

Timeout de sentencia: 20 s por defecto, configurable entre 1 y 120 s. Lock timeout:
3 s; conexión: hasta 10 s; idle-in-transaction: 60 s. El cliente tiene además
un límite de lectura ligeramente superior al del servidor. Ctrl+C o SIGTERM
solicita detener y cerrar ambos clientes. Un corte forzado pierde la captura;
no promover resultados parciales. El administrador puede verificar las sesiones
por `application_name=precutover_readonly_inventory` mediante sus herramientas.

COUNT exacto, DISTINCT de PK y huellas recorren datos. READ ONLY no significa
ausencia de carga, locks de lectura o retención de versiones por el snapshot.
Las dos capturas se ejecutan en paralelo en conexiones separadas; considerar su
carga conjunta y duración. No hay timeout global ni ejecución en segundo plano.

Por defecto las huellas se limitan a 100.000 filas por tabla y 500.000 por DB.
Los límites son de memoria/cobertura, no sustituyen el timeout del COUNT.
Excederlos conserva el conteo confirmado y marca comparaciones no disponibles,
NO-GO; no compara una muestra como si fuera toda la tabla. Los límites máximos
permitidos son 1.000.000 por tabla y 2.000.000 por DB; evaluar memoria antes de
ampliarlos. Los listados de IDs se acotan a 20 por caso (máximo 100), con conteos
completos y marca `truncated`; no se limita el conteo de diferencias a la muestra.

## Reportes y privacidad

`inventory.json` incluye versión, fechas UTC, duración, identidad no sensible
(DB y versión numérica, sin host/usuario), tablas, estructura, conteos, PK,
límites de ID, secuencias, FK y relaciones lógicas, diferencias y cobertura del seed.
`summary.txt` ofrece una síntesis y los pendientes de inspección.

Cada comprobación tiene PASS, WARNING o NO-GO y un código fijo. No disponible
es distinto de cero. `exists=null` significa no comprobado; `false`, ausencia
confirmada. No hay PASS global con tablas obligatorias inaccesibles/incompletas.
Código de salida: 0 PASS, 2 WARNING, 3 NO-GO con reportes; 1 ejecución/configuración
no completada o salida local fallida. PASS solo significa ausencia de diferencias
o impedimentos en las comprobaciones implementadas; `migrationAuthorized=false`.

No se almacenan filas completas, nombres, correos, teléfonos, valores de campos
personales, credenciales, mensajes PostgreSQL, hosts, usuarios, defaults, CHECKs
o cuerpos de funciones en texto. Los valores se convierten a huellas en PostgreSQL;
esas huellas de fila se usan solo en memoria y tampoco se exportan. Se conservan
IDs técnicos y huellas de definiciones de estructura; los nombres de columnas,
como `correo_tecnico`, son metadatos, no valores personales. Los errores se
convierten a códigos fijos. Las PK textuales se comparan mediante huellas internas
y sus valores no salen en reportes; por ello algunas diferencias solo tienen conteo.

Los archivos se crean exclusivamente en un directorio nuevo, con modos 0700/0600
en sistemas POSIX. En Windows el administrador debe verificar las ACL: esos modos
no garantizan una ACL privada. No guardar la salida en directorios públicos.
Antes de compartir: verificar ambas identidades/cobertura, revisar WARNING/NO-GO,
confirmar que no se adjuntan el seed, dumps o entornos, inspeccionar ambos archivos
y compartir solo con responsables aprobados. La política de retención es del equipo.

## Comparación y límites de interpretación

- Se descubren PK y FK reales por catálogo. Las 19 relaciones conocidas del
  aplicativo se comprueban por separado cuando no hay una FK equivalente;
  no se inventan relaciones por nombres similares. Se admiten FK numéricas
  simples/compuestas y MATCH SIMPLE/FULL con igualdad integrada; referencias
  fuera del inventario o no soportadas requieren revisión, NO-GO.
- Se cuentan huérfanos locales y referencias de origen cuyos padres faltan en
  destino. La cobertura entre DBs corresponde a las relaciones explícitas del
  aplicativo; una FK adicional se verifica localmente, no se supone cubierta entre DBs.
- Huellas determinísticas de campos completos y de negocio, JSONB/UTC/ISO PG16;
  NUMERIC normaliza escala con `trim_scale`. Se exige estructura de negocio
  comparable antes de comparar filas. Tipos personalizados/arrays no soportados
  no se convierten mediante funciones desconocidas: quedan no disponibles.
- Solo `maintenance_template` excluye `created_at`, `updated_at`, `created_by`
  de su huella de negocio: el seed los recreó. La huella completa permite contar
  diferencias exclusivamente de esos metadatos. No se excluyen del resto de tablas.
- Se comparan las siete tablas maestras actuales por contenido, y sus conjuntos
  de IDs contra el export aprobado. También se señalan referencias a maestros
  fuera de ese seed. No se compara una tercera versión del contenido histórico.
  Las 54 publicadas frente a 51 seleccionadas son contexto, no una cantidad que
  deba forzarse. No se atribuyen las tres excluidas a altas posteriores.
- Igual PK/contenido distinto indica conflicto potencial que requiere revisión;
  no autoriza sobrescritura. Igual contenido no prueba identidad de negocio.
- Las capturas tienen ventanas independientes: **no forman un snapshot atómico
  entre sistemas**. Cambios concurrentes, eliminaciones y reinserciones entre
  capturas no se reconstruyen como historial. Esto no es CDC ni un log de operaciones.
- Las secuencias se descubren por ownership/identity/default, sin `nextval` ni
  `setval`. Se informa definición y estado observado, y se comprueba el candidato
  contra el rango de ID de su tabla cuando es posible. CACHE>1 requiere revisión;
  no se afirma cuál es el próximo valor de una sesión con caché. No se reserva ni
  ajusta ningún ID. Consumidores no compatibles y secuencias sin SELECT quedan NO-GO.
- Defaults, constraints, índices y triggers se comparan por huella de definición;
  sus expresiones no se ejecutan. No se certifican cuerpos de funciones, owners,
  ACL equivalentes, vistas externas o todos los consumidores de una secuencia.
- Históricos legacy se inventarían separados; no se insertan en el modelo moderno.
  No se consultan archivos externos ni Firebase/Drive para validar referencias.

## Validación offline

```powershell
node --require ./context/database/precutover/offline_guard.cjs --test context/database/precutover/inventory.test.mjs
git diff --check
```

Los tests simulan clientes PostgreSQL: identidades equivocadas, permisos,
errores/timeout, cierre, cancelación, tablas ausentes, claves, referencias,
conflictos, configuración y privacidad. El preload bloquea sockets/TLS/fetch;
un intento de red, aunque se capture su error, hace fallar el proceso.
Resultado offline: 67/67 PASS con Node 24.19.0 del workspace y red bloqueada.
Los mocks y las comprobaciones del SQL no certifican su ejecución real en PG16.
La siguiente fase requiere revisión y autorización separada; no ejecutar aún el
inventario real ni empezar un conciliador de escritura.
