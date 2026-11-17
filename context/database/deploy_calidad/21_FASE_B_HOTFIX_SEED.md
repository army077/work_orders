# Fase B: hotfix del seed preparado offline

Preparado el 29/10/2026 en `migracion-datos-historicos`. El estado del servidor
procede de la confirmación del administrador: FASE A cerrada, 21 tablas,
ledger=7, aplicación=0, TEST=0, siete secuencias restauradas y API27 detenida.
Esta revisión no conecta al servidor ni vuelve a certificar ese estado.

`SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO`: el código y los SQL están
preparados para revisión y ejecución posterior. Fase B no se ejecutó.

## Cambio y conservación de datos

`render_seed.mjs` retiró la dependencia de `frozen_productive_seed_checks.mjs`,
que se eliminó. El seed usa ahora `expressionGuard(model)` antes del primer
INSERT y `checksCTEs(model)` para exigir el baseline vacío. Conserva el bloqueo
exclusivo de todas las tablas y verifica su postcondición antes de COMMIT.
El seed y el validador comparten exactamente los CTE de integridad finales.

Se reutiliza la política semántica aprobada para PG16.15: inventario, columnas,
tipos, nulabilidad/defaults, constraints, claves y acciones FK, índices y
predicados, secuencias y ownership, funciones, triggers, ledger y extensiones.
RLS/policies/reglas/herencia ajenas al baseline siguen bloqueadas. Las expresiones
se comparan mediante su representación canónica; se retiró el fingerprint textual
global que dependía de la representación de PostgreSQL. No se cambió la política
semántica del baseline en este hotfix.

El archivo fuente aprobado conserva SHA256
`47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0`.
El hash de todos los INSERT y ALTER SEQUENCE, en su orden original y normalizados
a LF, se registró antes del cambio y permanece idéntico:
`5bce97174a21e85673c75399fc64630511a98fed60f6e4771acc150710389b3f`.
Se comprobaron las filas generadas contra la fuente completa, incluidos IDs,
valores, NULL y relaciones; no solo los conteos.

| Tabla | Filas | Next value de su secuencia |
| --- | ---: | ---: |
| machine_family | 8 | 9 |
| machine_model | 37 | 52 |
| maintenance_template | 51 | 131 |
| template_section | 155 | 406 |
| template_task | 869 | 1251 |
| template_task_inspection | 2 | 223 |
| plantilla_tecnicos | 17 | 131 |
| Total | 1139 | |

Cada secuencia es `public.<tabla>_id_seq`. Los RESTART son transaccionales y
dejan `last_value=next value`, `is_called=false`. No se consumió ningún nextval.
Las 13 secuencias restantes conservan el requisito de baseline fresco antes del
alta manual; después el validador permite el avance de la secuencia de usuarios.
Todas las tablas transaccionales deben seguir vacías; solo se permite el ledger
de siete filas y, después de la carga, el alta manual de usuarios reales.

`validate_seed_calidad.sql` mantiene ERROR para corrupción estructural, conteos,
filas no autorizadas/modificadas, huérfanos, TEST/FIXTURE, históricos/eventos y
secuencias incorrectas. Las condiciones heredadas 39 ENSAMBLE sin inspección,
cinco secciones vacías y nueve plantillas sin códigos siguen como WARNING.
Las observaciones de técnicos se conservan; no se inventan correcciones.
Con la configuración exacta se espera `CALIDAD_SEED_OPERATIVO_VALIDO=SI`.
Esto es el resultado esperado para ejecución posterior, no una salida de DB
obtenida durante esta revisión.

Se sincronizaron cinco SQL de cleanup/checkpoints históricos con el alias vigente
`collation_oid` de su generador, detectado por las pruebas de reproducibilidad.
Solo cambia ese alias; el journal revisado, IDs y alcance de borrado se conservan.
FASE A ya está cerrada: estos archivos no deben volver a ejecutarse.
Los cambios preexistentes del workspace se conservaron.

## Auditoría previa al commit

Se revisaron `git status --short`, `git diff --stat` y `git diff` antes del stage.
Se compararon de nuevo todos los INSERT y RESTART con los del seed en HEAD:
son idénticos, incluido su orden. El hash completo del seed aprobado no cambió
durante esta auditoría.

La eliminación de `frozen_productive_seed_checks.mjs` retira una fuente obsoleta
de generación que solo reproducía el fingerprint textual anterior. Su único
consumidor ejecutable era `render_seed.mjs`; ya usa `checksCTEs` y
`expressionGuard`, compartidos con el baseline. No quedan imports ni consumidores
ejecutables del módulo retirado; las referencias restantes explican su retirada
o comprueban que el generador no lo usa. No es indispensable borrar un módulo
inerte para ejecutar el hotfix, pero se elimina por esa razón técnica concreta:
evitar dos implementaciones de guards productivos con políticas incompatibles.
Su implementación anterior permanece recuperable en Git. Las pruebas de fidelidad,
los guards compartidos y los ocho casos nuevos sustituyen el antiguo test que
congelaba el hash completo del SQL anterior.

`.phase_b_offline_tests.tap` era salida temporal del runner de la preparación
anterior. No existe en HEAD, índice ni historial de las referencias Git locales;
no hay una eliminación de 2.536 líneas que publicar. Se retiró únicamente el
archivo local generado. No se añade ni elimina en el commit. No se modifica
`.gitignore`: las nuevas salidas temporales se guardan en TEMP, fuera del repo.

El commit incluye el hotfix, validador, pruebas y documentación. Incluye también
el cambio equivalente de alias `colloid` a `collation_oid` en el generador de
catálogos y sus once salidas SQL, como dependencia de reproducibilidad: el seed
aprobado usa ese alias y las pruebas exigen que cada salida coincida exactamente
con su generador. Se comprobó que en esos doce archivos solo cambia el alias;
no cambia DDL, datos, journal, IDs ni alcance de cleanup. No se incluyen los
helpers PostgreSQL locales, evidencia del servidor, journals locales ni otros
archivos sin seguimiento. No se publican cambios de API o Flutter.
La prueba de la copia del índice detectó dos comparaciones sensibles a CRLF en
Windows. Se normalizan únicamente los saltos de línea en esos tests de SQL;
las comparaciones completas de datos, IDs, secuencias y guards se conservan.

## Alta manual y reactivación posterior

El seed no inserta `logistica_authorized_users`. Firebase válido por sí solo NO
basta: el usuario real debe estar activo, con proyecto `logistica-ar` y UID
coincidente. [13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md) conserva el alta manual
parametrizada separada; ningún UID se inventó ni se incorporó al seed.

El [runbook vigente](10_RUNBOOK_CUTOVER_FINAL.md) establece los trece pasos:
seed → validar → confirmar 1139 → alta manual → autorización → Firebase/Drive →
reactivar API27 → health 200 → web real → Logística → Flutter Release → Samsung
E2E → solo después evaluar promoción /api27 → /api10.
Incluye APP_ENV, PGDATABASE, Firebase Admin y Drive existentes, y confirmación
del puerto/proceso/mapeo aislados que ya usa el administrador. No muestra secretos.
La comprobación HTTP de autorización se hace tras reactivar API27; antes se coteja
el registro real. En production no existe el endpoint de autorización local/test.
Históricos Work Orders, inspecciones y Sheet de Logística quedan en otra fase.

## Validación reproducible sin ejecutar SQL

Generación local:

```powershell
node context/database/deploy_calidad/build_seed_support.mjs
```

Pruebas ejecutadas, con SQLite desactivado y PostgreSQL explícitamente omitido:

```powershell
$env:RUN_CALIDAD_DISPOSABLE_PG16_TESTS = '0'
node --no-experimental-sqlite --test context/database/deploy_calidad/*.test.mjs context/database/transfer_calidad/*.test.mjs context/database/tests/prod/logistica_prod.test.js context/api10/tests/dbGuard.test.js
git diff --check
```

Resultado final previo al commit: **334/334 tests ejecutados PASS, 0 FAIL**.
Ocho pruebas específicas nuevas cubren el hotfix. De 420 casos descubiertos,
86 quedaron omitidos: 38 SQLite por la restricción de no ejecutar SQL y 48 que
requieren `LOGISTICA_SHAPE_EVIDENCE`, no configurada en esta ejecución.
La suite local PostgreSQL y su helper no forman parte del stage ni de esta ronda;
en la preparación anterior se descubrió además ese caso, que quedó desactivado.
Las pruebas de handlers usan respuestas simuladas en JavaScript; no ejecutan SQL.
No se afirma ejecución ni validación del nuevo seed dentro de PostgreSQL.

Hashes SHA256 de artefactos, normalizados a LF:

- seed_calidad_operativo.sql: `56c16448e49766bc02ac188760566d3a8280b84adb5a01fa02eb66249044ba9f`.
- validate_seed_calidad.sql: `b010d727127cffb51fc3c65228ee194374114a4d19e34f54193a513acd6a5adf`.

## Reporte requerido

Los valores de integridad y secuencias siguientes corresponden a fuente y
artefactos verificados offline; no son conteos consultados en el servidor.

```text
seed productivo hotfix = LISTO
guard fingerprint antiguo eliminado = SI
guard semántico aplicado = SI
filas seed esperadas = 1139
filas seed verificadas = 1139
machine_family = 8
machine_model = 37
maintenance_template = 51
template_section = 155
template_task = 869
template_task_inspection = 2
plantilla_tecnicos = 17
huérfanos = 0
TEST/FIXTURE = 0
históricos incluidos = 0
secuencias finales correctas = SI
validate_seed actualizado = SI
warnings heredados siguen siendo WARNING = SI
logistica_authorized_users incluido en seed = NO
alta manual Logística documentada = SI
runbook Fase B actualizado = SI
API27 preparada para reactivación posterior = SI
tests = 334/334 PASS
git diff check = PASS
SQL ejecutado = NO
DB modificada = NO
producción modificada = NO
deploy ejecutado = NO
commit = NO
push = NO
```
