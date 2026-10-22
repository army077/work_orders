# Transferencia controlada artecnologia -> calidad

Procedimiento final preparado para el cutover del proyecto. Revision offline
del 2026-10-22. Rama `migracion-datos-historicos`.
**No ejecutar los ejemplos productivos sin una operacion de corte posterior.**
El destino definitivo es `calidad`, creada vacia por el administrador segun la
confirmacion del usuario; no se ha comprobado mediante conexion en este cierre.
`artecnologia` sigue activa hasta el cutover. API10 no enviara trafico a calidad
hasta terminar transferencia, siete migraciones y validaciones. Se conservan
PROD=calidad, LOCAL/TEST originales y los checksums actuales de los siete SQL.
No se implementa ningun runner PREPROD ni se crearan otras bases de ensayo.

Este cierre solo audita archivos, actualiza documentacion y ejecuta pruebas
offline. No conecta a ninguna DB, modifica DBs, despliega, hace stage, commit
o push. Los documentos [ENSAYO_LOCAL.md](./ENSAYO_LOCAL.md) y
[RESULTADO_LOCAL.md](./RESULTADO_LOCAL.md) conservan antecedentes; su bloqueo
administrativo fue aceptado y no es un requisito de crear una DB LOCAL para
seguir preparando este procedimiento.

## Resultado y alcance

| Campo solicitado | Resultado |
|---|---|
| tablas API10 detectadas | **15** del proyecto productivo previo a Logistica; **20** referencias del runtime en este checkout al sumar cinco futuras. Mas ledger y cuatro historicos LOCAL = 25 nombres documentados |
| inventario completo | [INVENTARIO.md](./INVENTARIO.md), por tabla, modulo, acceso, FK, secuencia, funciones/triggers, datos y clasificacion |
| objetos auxiliares | Secuencias reales, tres move_*, rutinas transitivas necesarias, indices/constraints/defaults/identity, triggers/reglas/policies/ACL relacionados; cierre real pendiente |
| dependencias externas | Ninguna tabla adicional demostrada por codigo; plantilla_tecnicos compartida ya incluida; catalogo/funciones/roles/extensiones por confirmar |
| estrategia recomendada | pg_dump custom selectivo para tablas/datos/secuencias + schema-only y TOC aprobado para completar dependencias; pg_restore por secciones |
| copia completa artecnologia necesaria | **NO** para esta transferencia. Un respaldo global operativo adicional es opcional del DBA y nunca se restaura indiscriminadamente en calidad |
| validacion conteos preparada | **SI**, COUNT exacto y MAX de claves numericas/id cuando corresponde |
| validacion secuencias preparada | **SI**, parametros/ownership, last_value e is_called, sin avanzarlas; evaluacion de colisiones segun consumidores antes del corte |
| validacion constraints preparada | **SI**, definiciones/estado PK/FK/UNIQUE/CHECK/exclusion e indices; consulta de violaciones FK compuestas |
| db.js acepta calidad actualmente | **SI**, production=calidad; artecnologia y bases LOCAL rechazadas como PROD nueva |
| migraciones PROD aceptan calidad actualmente | **SI**, siete SQL y soporte fijan calidad; mantienen identidad/rol/IP/puerto/major y antidrifts |
| PostgreSQL 16.15 compatible | **SI** segun el diseno y los resultados LOCAL previos; sin nuevo ensayo DB ni certificacion de restauracion productiva en este cierre |
| produccion modificada / DB modificada / deploy / commit / push en este cierre | **NO / NO / NO / NO / NO**; solo pruebas offline |

No se puede certificar una lista exacta de triggers, firmas, secuencias y FK
**de produccion** sin su catalogo. El inventario exacto del codigo y las
consultas pendientes separan lo conocido de lo no confirmado. No usar el
informe AS-IS anterior como sustituto del codigo actual: su fecha/commit y la
antigua configuracion de db.js difieren del checkout inspeccionado.

## Archivos preparados y uso futuro de solo lectura

| Archivo | Funcion |
|---|---|
| manifest.psql | 15 tablas requeridas, cuatro historicos condicionales, seis objetos Logistica excluidos y tres funciones raiz |
| identity.psql | Guard de DB, rol/sesion, IP observada por PG, puerto y major 16, dentro de transaccion READ ONLY |
| preflight_empty.sql | Inventario de objetos y configuracion de calidad; verifica mas que un `\dt` |
| dependencies.sql | FK entrantes/salientes y cierre de dependencias de catalogos; definiciones de rutinas, extensiones/event triggers/configuracion |
| snapshot.sql | JSONL comparable del baseline: estructura, conteos/MAX, secuencias, funciones y violaciones FK |
| prepare_dump_args.mjs | Produce argumentos JSON de pg_dump desde captura origen completa; no lanza procesos ni conecta; `ready_to_execute=false` |
| compare_snapshots.mjs | Compara capturas locales origen/destino, rechaza incompletas y devuelve diferencias sin conectar |
| compare_snapshots.test.mjs / local_safety.test.mjs | 10 pruebas offline: comparacion, alcance selectivo, guards LOCAL y colisiones |
| local_support.mjs / sequence_safety.mjs | Identidad LOCAL fija y limites/consumidores reales de secuencias, sin nextval/setval |
| run_local_rehearsal.mjs | Exportacion/restauracion nativa LOCAL, evidencia e igualdad de baseline antes de Logistica |
| apply_local_logistica.mjs | Harness LOCAL: rechaza SQL PROD completo y valida las siete etapas con wrapper LOCAL fijo |
| ENSAYO_LOCAL.md / RESULTADO_LOCAL.md | Comandos reproducibles, limites del ensayo, creacion administrativa y resultados reales |

Ejemplo **futuro**, con herramientas cliente PostgreSQL 16 en Ubuntu y valores
de servidor/rol validados por el administrador. Las variables de shell siguientes
son marcadores del operador, **no datos descubiertos por esta auditoria**. Las
cuatro variables `expected_*` son obligatorias. Los SQL no cargan .env.local.
Usar secretos operativos/PGPASSFILE y transporte TLS aprobado; no passwords en
comandos o archivos versionados. No seguir con una salida parcial ni ignorar
exit codes. Todos los comandos mostrados estan sin ejecutar.

```bash
# Directorio local de evidencias autorizado, fuera de Git; previamente creado.
# Variables SOURCE_HOST, DEST_HOST, PORT, AUDIT_ROLE, SOURCE_ADDR, DEST_ADDR,
# RESTORE_ROLE, SQL_DIR y EVIDENCE deben ser definidas por el operador.
psql -X -q -t -A -h "$DEST_HOST" -p "$PORT" -U "$AUDIT_ROLE" -d calidad \
  -v expected_database=calidad -v expected_user="$AUDIT_ROLE" \
  -v expected_server_address="$DEST_ADDR" -v expected_server_port="$PORT" \
  --output="$EVIDENCE/calidad-vacia.jsonl" -f "$SQL_DIR/preflight_empty.sql"

psql -X -q -t -A -h "$SOURCE_HOST" -p "$PORT" -U "$AUDIT_ROLE" -d artecnologia \
  -v expected_database=artecnologia -v expected_user="$AUDIT_ROLE" \
  -v expected_server_address="$SOURCE_ADDR" -v expected_server_port="$PORT" \
  --output="$EVIDENCE/dependencias-origen.jsonl" -f "$SQL_DIR/dependencies.sql"

psql -X -q -t -A -h "$SOURCE_HOST" -p "$PORT" -U "$AUDIT_ROLE" -d artecnologia \
  -v expected_database=artecnologia -v expected_user="$AUDIT_ROLE" \
  -v expected_server_address="$SOURCE_ADDR" -v expected_server_port="$PORT" \
  --output="$EVIDENCE/origen.jsonl" -f "$SQL_DIR/snapshot.sql"

node "$SQL_DIR/prepare_dump_args.mjs" "$EVIDENCE/origen.jsonl" > "$EVIDENCE/dump-args.json"
```

El ultimo comando solo pasa sin opciones cuando no existen historicos
adicionales en origen. Si el catalogo real y el administrador confirman alguno
de los cuatro historicos del inventario, agregar
`--approved-historical=public.tabla_confirmada,...` con exactamente los nombres
presentes y aprobados. No trasladar automaticamente las 19 tablas exportadas
durante el ensayo LOCAL a la lista productiva. Los cuatro historicos conservan
estado PENDIENTE VERIFICACIÓN PROD hasta contar con esa evidencia.

Exigir `empty=true`, lista de objetos vacia y configuracion compatible en
preflight; el reporte no autoriza restaurar. El guard aborta ante identidad
incorrecta o variables faltantes. No admite socket Unix sin IP: usar TCP
aprobado. El rol auditor necesita ver todas las filas y SELECT sobre secuencias;
`row_security=off` hace fallar una lectura sujeta a RLS en vez de aceptar un
conteo filtrado. Las tablas requeridas faltantes, vistas, particiones/herencia
o tablas nuevas Logistica ya presentes bloquean la captura baseline.

## Estrategia nativa y cierre de dependencias

Un `pg_dump -t` aislado no garantiza incluir las funciones/tipos necesarios.
Por ello se separan dos archivos: `proyecto.dump`, con tablas/secuencias
explicitamente seleccionadas y sus datos; y `catalogo.dump`, **solo estructura**,
para seleccionar dependencias con `pg_restore -L`. No se exportan datos de
tablas ajenas. Esta limitacion y la seleccion por TOC estan documentadas en
[pg_dump 16](https://www.postgresql.org/docs/16/app-pgdump.html) y
[pg_restore 16](https://www.postgresql.org/docs/16/app-pgrestore.html).

El schema-only puede describir objetos ajenos para inspeccion, pero **ninguna
tabla/rutina ajena entra a calidad por defecto**. Revisar `dependencies.sql`,
todos los cuerpos y los TOC; crear `estructura.aprobada.list` con solo:

1. Schemas necesarios (public ya existe: no intentar recrearlo), tipos/dominios,
   collations, lenguajes/extensiones estrictamente requeridos, y las rutinas
   raiz/transitivas necesarias, con firmas completas y atributos originales.
2. Las 15 tablas base y solo los historicos realmente presentes y aprobados;
   secuencias reales, SEQUENCE OWNED BY, defaults, identity, PK/UNIQUE/CHECK/FK,
   indices y triggers/reglas/policies asociados, comentarios y ACL aplicables.
3. Cualquier dependencia adicional demostrada, con motivo por objeto. Si una
   FK saliente requiere otra tabla y sus filas, aprobarla y ampliar manifiesto,
   capturas, comparador y exportacion; no omitir la FK ni restaurarla sin padre.

Excluir tablas ajenas, sus datos, event triggers globales, suscripciones,
publicaciones, objetos Logistica, DATABASE/CREATE DATABASE y settings
productivos globales. Revisar ACL de schema y DEFAULT ACL: pueden afectar
objetos futuros/ajenos, no se trasladan en bloque. Las dependencias de
extensiones se restauran mediante su extension/version aprobada, no extrayendo
miembros individuales. Los roles/tablespaces son externos al dump de una DB:
inventariarlos y asegurar equivalencia sin importar globals indiscriminadamente.

Mantener orden de dependencias del TOC, registrar sus IDs exactos y revisar
el SQL extraido offline. `datos.aprobada.list` debe contener un TABLE DATA por
tabla presente y un SEQUENCE SET por secuencia seleccionada; ningun TABLE DATA
ajeno, ningun BLOB. Dejar SEQUENCE SET al final de esa lista. Una secuencia
identity puede figurar con entradas asociadas a la tabla: revisar TOC/SQL, no
inferir que basta con contar entradas CREATE SEQUENCE. Esta seleccion no se
automatiza a ciegas con grep de nombres.

Los archivos TOC aprobados no pueden completarse ahora sin un dump real. El
generador offline produce solamente la seleccion respaldada por la captura y
mantiene el bloqueo de preparacion. No hay runner que migre automaticamente.

## Orden de ejecucion futura, con puntos de parada

1. **Preflight calidad vacia.** Verificar identidad contra inventario externo,
   PG16.15, rol/TLS, objetos de todos los schemas, permisos, encoding, locale,
   collation provider/version y espacio. Un `\dt` vacio no basta. Si su locale
   difiere de origen, detenerse: no alterar la DB vacia dentro de esta tarea.
2. **Backup artecnologia.** Confirmar respaldo recuperable operativo y preparar
   `proyecto.dump` como respaldo selectivo. La restauracion controlada y su
   validacion se haran sobre calidad, sin trafico API10, durante la ventana de
   cutover; este plan no depende de crear otra base. Un backup completo
   adicional es decision del DBA, no requisito de copiar datos ajenos a calidad.
3. **Exportar proyecto en corte consistente.** Antes del respaldo definitivo,
   pausar y drenar **todos** los escritores/DDL/usuarios de secuencias relevantes:
   API10, otros consumidores de plantilla_tecnicos, jobs e importadores. No
   modificar datos/constraints en origen. Mantener la pausa hasta el cambio de
   destino o la cancelacion. Capturar origen, dependencias y ambos dumps dentro
   de la misma ventana inmovil. Sin pausa hacen falta snapshot coordinado y
   estrategia de deltas; este plan no ofrece CDC. Un snapshot MVCC por si solo
   no congela secuencias. Cualquier escritura invalida conteos/secuencias del
   corte: repetir exportacion, no continuar con una mezcla de estados.
   Registrar hora de inicio del freeze, responsables y evidencia de solicitudes,
   transacciones y procesos de escritura drenados; mantener tambien congelado
   el DDL. El origen se consulta/exporta READ ONLY. Los bloqueos SHARE y el
   wrapper del runner LOCAL no forman parte del flujo productivo. No reanudar
   escritores en artecnologia mientras se prepara el cambio de trafico a calidad.
4. **Restaurar estructura pre-data** desde `catalogo.dump` con lista aprobada.
   Incluye tipos y funciones que defaults/CHECK necesitan antes de cargar datos;
   algunos CHECK validados estan en pre-data. Guardar propietarios/grants
   originales: no usar --no-owner/--no-acl por comodidad. Public existente se
   administra sin recrearlo, con ACL revisada por el DBA.
5. **Restaurar datos** desde `proyecto.dump`, con seleccion exacta. COPY nativo
   conserva PK e identity, sin remapear IDs, normalizar nulos/estados/JSON/fechas
   o volver a importar historicos. Luego **post-data** desde `catalogo.dump`
   para PK/UNIQUE/FK/indices/triggers que correspondan a esa seccion. Los triggers
   de usuario no deben dispararse durante la copia AS-IS: se recrean en post-data.
   No desactivar constraints/triggers del origen ni usar session_replication_role.
6. **Verificar secuencias.** SEQUENCE SET restaura su estado nativo en fase data;
   comparar parametros, ownership/defaults, last_value e is_called contra origen
   congelado. No llamar nextval/currval para medir. No ejecutar setval(MAX(id)):
   puede retroceder una secuencia o perder is_called=false y los huecos legitimos.
   Si hace falta reparar, detenerse y preparar una correccion separada de destino
   a partir del estado exacto aprobado; nunca tocar la secuencia de origen.
7. **Validar FK/constraints/indices.** Restauracion post-data sin errores; todas
   las constraints/indices deben coincidir con origen, incluido NOT VALID si
   existia. Las consultas de violaciones FK no hacen ALTER/VALIDATE ni crean FK
   ausentes. Un NOT VALID/huerfano historico se preserva y exige revision, no se
   limpia durante el traslado. PK/UNIQUE se comprueban al crearse y se comparan
   sus definiciones; CHECK se compara en catalogo y el COPY verifica los CHECK
   efectivos, sin invocar funciones de negocio como prueba.
8. **Comparar conteos y esquema baseline.** Capturar calidad y ejecutar comparador
   offline; exigir cero diferencias. Revisar sus advertencias. El criterio de
   equivalencia se cumple antes de Logistica, no despues de empezar escrituras.
   COUNT/MAX no prueban cada celda: el dump/COPY nativo, los hashes de artefactos
   y el ensayo de restauracion completan el control; ante dudas usar comparacion
   determinista de contenido en ensayo con tipos/collations revisados.
9. **Aplicar despues las siete PROD adaptadas a calidad**, solo en una tarea
   autorizada posterior. Hacer backup/checkpoint de calidad validada. Mantener
   API10 de Logistica sin trafico: tercera migracion exige evidence vacia. No
   poblar allowlist, legacy ni mappings desde LOCAL como parte del DDL.
10. **Validar schema completo y corte.** Preflight Logistica debe indicar
    indice de siguiente migracion=7, siete filas de ledger/checksums correctos
    y huella final sin drift. El baseline se compara en el paso 8 con
    `snapshot.sql`, antes de crear Logistica; este script rechaza su presencia
    en PROD deliberadamente y no debe ejecutarse sin cambios despues del paso 9.
    La validacion final combina ese baseline aprobado y la huella Logistica
    final. Si se requiere una nueva captura de las tablas base tras el DDL,
    preparar/revisar su consulta READ ONLY especifica antes de autorizarla;
    no usar el modo LOCAL ni eliminar guards para forzar que pase. Verificar
    separadamente
    las nuevas cinco tablas y secuencias, funcion/triggers de mapping, grants y
    ledger con siete filas. Hasta aprobar estas validaciones DB, calidad sigue
    sin trafico API10. Una vez aprobadas, comprobar salud y lecturas
    representativas con el artefacto preparado para calidad antes de habilitar
    escrituras operativas. Configurar runtime y cambiar trafico solo tras esas
    validaciones. No se realiza deploy en esta tarea.

Comandos nativos **ilustrativos, no ejecutados**, una vez cerradas dependencias,
congelados los escritores y aprobado el destino. No se suministra servidor real.

```bash
# Extraer TODOS los argumentos del JSON previamente revisado. No usar eval.
# Bash conserva cada patron entrecomillado como un argumento literal de pg_dump.
mapfile -t dump_args < <(node -e '
  const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));
  if (!Array.isArray(p.argv) || p.argv.filter(a=>a.startsWith("--table=")).length<15) process.exit(1);
  for (const a of p.argv) console.log(a);
' "$EVIDENCE/dump-args.json")
# Evitar que un JSON fallido/vacio provoque un dump de toda la DB.
(( ${#dump_args[@]} >= 19 )) || exit 1
pg_dump -h "$SOURCE_HOST" -p "$PORT" -U "$AUDIT_ROLE" \
  --file="$EVIDENCE/proyecto.dump" "${dump_args[@]}"
pg_dump -h "$SOURCE_HOST" -p "$PORT" -U "$AUDIT_ROLE" -d artecnologia \
  -Fc --schema-only --file="$EVIDENCE/catalogo.dump"

pg_restore --list "$EVIDENCE/catalogo.dump" > "$EVIDENCE/catalogo.list"
pg_restore --list "$EVIDENCE/proyecto.dump" > "$EVIDENCE/proyecto.list"
# Revision y creacion manual de estructura.aprobada.list y datos.aprobada.list.
# Inspeccion offline: --file no conecta mientras NO se pase -d.
pg_restore -L "$EVIDENCE/estructura.aprobada.list" \
  --file="$EVIDENCE/estructura.revision.sql" "$EVIDENCE/catalogo.dump"
sha256sum "$EVIDENCE/proyecto.dump" "$EVIDENCE/catalogo.dump" \
  "$EVIDENCE/estructura.aprobada.list" "$EVIDENCE/datos.aprobada.list"

# Solo despues de volver a comprobar calidad vacia e identidad del destino.
pg_restore -h "$DEST_HOST" -p "$PORT" -U "$RESTORE_ROLE" -d calidad \
  --exit-on-error --single-transaction --section=pre-data \
  -L "$EVIDENCE/estructura.aprobada.list" "$EVIDENCE/catalogo.dump"
pg_restore -h "$DEST_HOST" -p "$PORT" -U "$RESTORE_ROLE" -d calidad \
  --exit-on-error --single-transaction --section=data \
  -L "$EVIDENCE/datos.aprobada.list" "$EVIDENCE/proyecto.dump"
pg_restore -h "$DEST_HOST" -p "$PORT" -U "$RESTORE_ROLE" -d calidad \
  --exit-on-error --single-transaction --section=post-data \
  -L "$EVIDENCE/estructura.aprobada.list" "$EVIDENCE/catalogo.dump"
```

No usar `--create` (podria volver al nombre de origen), `--clean`, `--jobs` con
single-transaction, ni ignorar errores. Cada fase tiene su transaccion; las tres
no son una sola transaccion global. Si falla una, calidad puede tener fases
previas ya confirmadas: mantenerla fuera de trafico y resolver en una operacion
separada sobre destino. No autoreintentar sobre una restauracion parcial ni
borrar/recrear DB automaticamente. Retener evidencias, versiones de clientes,
TOC, hashes, stderr/exit codes y resultados de validacion fuera de Git.

## Comparacion READ ONLY de origen/destino

PostgreSQL no permite SELECT directo entre DBs distintas por nombre calificado.
Se captura cada DB por separado y se comparan archivos locales; no se instala
dblink/FDW. Durante la pausa, repetir el ejemplo de snapshot para destino:

```bash
psql -X -q -t -A -h "$DEST_HOST" -p "$PORT" -U "$AUDIT_ROLE" -d calidad \
  -v expected_database=calidad -v expected_user="$AUDIT_ROLE" \
  -v expected_server_address="$DEST_ADDR" -v expected_server_port="$PORT" \
  --output="$EVIDENCE/destino.jsonl" -f "$SQL_DIR/snapshot.sql"
node "$SQL_DIR/compare_snapshots.mjs" "$EVIDENCE/origen.jsonl" "$EVIDENCE/destino.jsonl"
```

El comparador exige las 15 tablas, misma presencia de los cuatro historicos,
secciones completas, tres funciones raiz, COUNT/MAX y estado exacto de cada
secuencia. Los valores bigint se capturan como strings, conservando precision.
Compara catalogo/owners/ACL, rutinas raiz y de triggers, configuracion de locale
y violaciones FK, sin asumir PK=id. MAX se calcula para columnas numericas de
PK y para id numerico si existe; para PK texto/compuesta se preserva y compara
la definicion completa, no se fuerza MAX(id). No hace tests de INSERT.

Las rutinas transitivas adicionales de dependencies.sql deben agregarse a la
captura/lista aprobada para poder certificarlas: el comparador no da cierre
automatico de dependencias. Verificar tambien configuracion de schema public,
search_path/role settings y defaults de permisos fuera de la huella de tablas.
El snapshot es baseline anterior a Logistica; no sirve sin adaptacion revisada
para aceptar objetos nuevos ni para las tablas externas que se aprueben despues.

Para secuencias positivas, NO CYCLE y cache=1, el siguiente candidato es
`is_called ? last_value + increment : last_value`; debe ser mayor que MAX de
**cada columna consumidora**, no solo id de la tabla propietaria. Comprobar en
catalogo defaults y ownership, incluidas secuencias compartidas. Cache>1,
incrementos negativos, CYCLE, secuencias sin ownership o consumidores mediante
funciones requieren revisar cache/sesiones, MIN/MAX y todos sus usos. El
comparador certifica igualdad de estado, **no ausencia de colisiones futuras**.
Una discrepancia o un riesgo que ya existe en origen bloquea el corte y se
resuelve por separado; no se cambia silenciosamente el valor para que pase.
La semantica de last_value/is_called y nextval/setval esta documentada en
[funciones de secuencia PG16](https://www.postgresql.org/docs/16/functions-sequence.html).

## API10 adaptado: una sola conexion

`context/api10/db.js` conserva su validacion real y un unico Pool:

```text
local      -> artecnologia_test_local, con host loopback adicional
test       -> artecnologia_test
production -> calidad
```

El unico cambio de runtime es el literal de production. No se agrega doble
conexion ni se admite calidad_test_local mediante db.js. El harness LOCAL
inyecta un unico pool de prueba contra esa DB, sin cambiar las reglas de la API.
`context/api10/tests/dbGuard.test.js` evalua el archivo real en VM con Pool
espia: production/calidad permitido; production/artecnologia, bases LOCAL y
TEST rechazadas; LOCAL/TEST conservados; host remoto LOCAL, APP_ENV invalido y
variables requeridas ausentes rechazados. No abre conexiones.

Configurar operacionalmente PGDATABASE=calidad solo durante el corte. El
artefacto nuevo rechaza production/artecnologia: rollback requiere el artefacto
anterior. .env.example LOCAL y server.js permanecen intactos.

## Siete PROD adaptadas a calidad

Los siete SQL de `migrations/prod/` exigen current_database()=calidad y
confirmacion calidad; siguen rechazando artecnologia, calidad_test_local y
artecnologia_test_local. Se mantiene este orden exacto de NAMES:

1. 20261016_create_logistica_authorized_users.sql
2. 20261016_create_logistica_deliveries.sql
3. 20261019_extend_logistica_delivery_evidence.sql
4. 20261019_add_logistica_delivery_drive_folder.sql
5. 20261020_add_logistica_delivery_completion.sql
6. 20261021_create_entregas_logistica_legacy.sql
7. 20261021_create_logistica_legacy_owner_mapping.sql

Se adapto `logistica_prod_support.js`: entorno, confirmacion, identidad,
conexion y GUC. Preflight, runner e importador PROD heredan esa identidad sin
modificar sus controles ni volverlos genericos. Se adapto el template
`tests/prod/artifact_blueprint.js` y sus pruebas. Los siete artefactos se
regeneraron secuencialmente con SHA-256 de bytes UTF-8/LF, incluyendo las nuevas
referencias de hashes previos en cada ledger guard. El test del runner verifica
que el SQL enviado coincide exactamente con los bytes cuyo SHA se registra.

`logistica_schema_shape.sql` y `logistica_schema_states.json` se auditaron y
permanecen intactos: no contienen identidad de DB y el DDL estructural no cambio.
Las ocho huellas se comprobaron en PostgreSQL LOCAL 16.15 con fixtures temporales.
Las migraciones/fixtures/importadores LOCAL conservan sus guards originales.
Hashes vigentes y comando de regeneracion offline en
[README_LOGISTICA_PROD.md](../migrations/prod/README_LOGISTICA_PROD.md).
Nunca regenerar estos artefactos una vez aplicados en un ambiente persistente.

## Rollback y riesgos

Antes de la primera escritura operativa nueva en calidad, conservar el API10 antiguo y su
configuracion `APP_ENV=production PGDATABASE=artecnologia`, origen intacto y
trafico detenible. Si falla la validacion/restauracion, no cortar: reanudar el
servicio antiguo en artecnologia con su artefacto anterior. Esto no requiere
restaurar origen ni deshacer Logistica en calidad. No permitir doble escritor.

Registrar y conservar el artefacto/configuracion anterior antes de iniciar la
ventana. Mientras calidad no recibe trafico, mantener la ruta de API10 sobre
artecnologia; durante el freeze sus escrituras deben estar pausadas. Si se
cancela antes de nuevas escrituras operativas, reanudar exclusivamente el
servicio anterior. Nunca intentar apuntar el binario nuevo a artecnologia:
su guard production=calidad lo rechaza. La copia y el DDL/ledger de las siete
migraciones en calidad no son nuevas operaciones de negocio que obliguen por
si solas a reconciliar el origen; las altas, cambios de negocio o efectos
externos posteriores si lo son, incluso antes de abrir trafico publico.

**Desde la primera escritura operativa nueva en calidad, volver a artecnologia deja
datos atras.** Parar trafico, respaldar ambos lados, registrar/conciliar deltas
y efectos externos de Drive/Firebase, incompatibilidades de esquema/IDs y
decidir roll-forward o migracion inversa probada. No prometer rollback por un
simple cambio de PGDATABASE; el binario nuevo tambien rechazaria artecnologia
si se implementa el mapa minimo recomendado. No hay conciliador inverso ni CDC
implementado en estos archivos.

Riesgos criticos: cierre real de dependencias incompleto sin catalogo; guards
API10/PROD incompatibles con calidad; perdida de cambios por escritores no
congelados; restauracion parcial aceptada como completa; secuencias omitidas,
reiniciadas o con riesgo previo de colision; alterar checksums de SQL aplicado;
rollback con escrituras divergentes. Cada uno es un punto de parada previo al
corte, no motivo para modificar ahora produccion.

Riesgos medios: locale/ICU/collation de calidad vacia diferente; owners/ACL,
search_path, extensiones/versiones o tablespaces faltantes; NOT VALID/huerfanos
historicos y estados/fechas heterogeneos; carga y duracion de COUNT/restore;
datos de catalogos compartidos y su operacion tras el cambio. No normalizar
historia ni asumir que un fallo previo de datos se resuelve por copiarlos.

## Verificacion realizada

- Transferencia offline: 10/10 PASS.
- Migraciones PROD offline: 14/14 PASS, incluidos checksums, reproduccion y bytes enviados.
- API10 aislada: 174 PASS, 0 FAIL, 2 SKIP de pruebas que requieren DB.
- `node --check`: PASS en 15 archivos JS/MJS nuevos/modificados.
- No se cargan archivos .env, credenciales ni flags que habiliten integraciones DB.
- Los resultados previos de PostgreSQL LOCAL (14 PASS y 19 consumidores de
  secuencias sin riesgo detectado) son antecedentes; no se reejecutaron en este cierre.

Se auditaron los 32 archivos de este trabajo: 12 modificados versionados y
20 nuevos, de los cuales 17 estan en transfer_calidad. Los cuatro untracked
ajenos conocidos quedan fuera del cambio: total Git pendiente 36 archivos.
Ningun SQL PROD, checksum, guard de runtime o runner cambio durante este cierre;
solo se ajusto documentacion para la decision definitiva artecnologia -> calidad.

Hallazgos criticos de codigo: ninguno detectado en la revision offline. Antes
del GO operativo siguen siendo puntos de parada el catalogo real, cierre de
dependencias/TOC, identidades/permisos/locale y evidencia del respaldo/freeze.
Hallazgos medios: restauracion completa no ensayada, bloqueo LOCAL aceptado,
limites de COUNT/MAX como prueba de contenido y necesidad de revision manual
de dependencias/owners/ACL. La preparación no certifica una migracion ejecutada.
