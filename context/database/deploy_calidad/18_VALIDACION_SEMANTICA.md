# Sustitución del fingerprint textual del baseline

## Evidencia disponible

El usuario reportó PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), un único error
LOGISTICA_FINAL_SCHEMA_DRIFT y rollback confirmado desde una conexión nueva:
CREATE_APLICADO=NO / tablas_presentes=0.

- Huella anterior: c7e7d4d23745580b151b7b8876b35023ecc0cd8e908f0f79cb46f2417582bead.
- Huella real recalculada del archivo adjunto: c0ec5fd20ab1caec10fd2651155a8cacd42928124b9b6fa12fa612c11eb7cc22.
- shape_servidor.txt fue leído completo desde su ubicación local, sin copiarlo al
  repositorio. Se retiró únicamente el prefijo de exportación SHAPE:: y el salto
  final exterior al JSON. Los 22.930 bytes UTF8 restantes son el shape::text.
- **FALSO_POSITIVO_DE_FINGERPRINT=SI**, demostrado por recuperación exacta del
  hash anterior y contraste semántico completo del shape contra las fuentes.

build_clean_baseline.mjs tomaba el hash de states().at(-1).fingerprint; no lo
calculaba desde el DDL. logistica_schema_states.json conserva columnas y hashes,
no el shape completo. README_LOGISTICA_PROD.md documenta su comprobación con
PostgreSQL 16 sobre tablas temporales. Ahora se recupera exactamente esa huella
desde el shape real mediante la única transformación detallada a continuación.

## Causa exacta demostrada

El cambio de namespace textual **public. → pg_temp. en 28 campos concretos**, sin
cambiar ningún otro valor ni byte de serialización JSONB, produce exactamente:

```text
SHA256(shape real) =
c0ec5fd20ab1caec10fd2651155a8cacd42928124b9b6fa12fa612c11eb7cc22
SHA256(mismo shape con esos 28 calificadores de referencia) =
c7e7d4d23745580b151b7b8876b35023ecc0cd8e908f0f79cb46f2417582bead
```

| Ruta JSON (índices base cero) | Campos | Servidor | Referencia recuperada |
| --- | ---: | --- | --- |
| tables.logistica_deliveries.indexes[0..6][3] | 7 | ON public.logistica_deliveries USING | ON pg_temp.logistica_deliveries USING |
| tables.entregas_logistica_legacy.indexes[0..6][3] | 7 | ON public.entregas_logistica_legacy USING | ON pg_temp.entregas_logistica_legacy USING |
| tables.logistica_authorized_users.indexes[0..1][3] | 2 | ON public.logistica_authorized_users USING | ON pg_temp.logistica_authorized_users USING |
| tables.logistica_delivery_evidence.indexes[0..5][3] | 6 | ON public.logistica_delivery_evidence USING | ON pg_temp.logistica_delivery_evidence USING |
| tables.logistica_schema_migrations.indexes[0][3] | 1 | ON public.logistica_schema_migrations USING | ON pg_temp.logistica_schema_migrations USING |
| tables.logistica_legacy_owner_mapping.indexes[0..2][3] | 3 | ON public.logistica_legacy_owner_mapping USING | ON pg_temp.logistica_legacy_owner_mapping USING |
| tables.logistica_legacy_owner_mapping.triggers[0..1][2] | 2 | EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping() | EXECUTE FUNCTION pg_temp.protect_logistica_legacy_owner_mapping() |

Origen: tests/prod/fixture.js crea objetos en pg_temp_N, transforma el DDL a ese
namespace y fija search_path=pg_catalog. PostgreSQL 16.15 representa el namespace
temporal propio mediante el alias **pg_temp**, por get_namespace_name_or_temp().
logistica_schema_shape.sql intentaba normalizar el prefijo físico pg_temp_N. al
usar replace(...,quote_ident(r.ns)||'.','public.'); ese patrón no captura pg_temp.
Los 26 índices conservan ese alias en su tabla y los dos triggers en su función.
En public, pg_get_indexdef produce ON public.; el antiguo generador además
aseguraba EXECUTE FUNCTION public. en los triggers. El hash importado, en cambio,
seguía describiendo las referencias temporales. Esta es la causa concreta; no se
atribuye el fallo a espacios, quoting genérico ni a una diferencia de versión menor.

La transformación solo de índices produce e931b287bf3376015b8bbbc12ea19347a94364e5c5f048cc5b7178207a8d64a1;
también son necesarios los dos calificadores de función para recuperar c7e7d4d2.
No se cambia la tabla ON de los triggers: en ambas representaciones está sin schema.

analyze_server_shape.mjs reproduce el cálculo offline y enumera las 28 rutas:

```text
node analyze_server_shape.mjs --shape RUTA_LOCAL_AL_ARCHIVO
```

El analizador conserva 9223372036854775807 como BigInt y reconstruye JSONB por
longitud UTF8 y orden binario de claves. Primero exige que su serialización sea
idéntica byte por byte a la evidencia; no usa JSON.stringify sobre enteros
redondeados. Requiere Node 22+ solo para este análisis offline, sin cambiar el
runtime Node 18 de API10. El archivo bruto y la ruta personal no se versionan.

Resultado del contraste: seis tablas, 98 columnas/defaults, 49 constraints,
26 índices con sus predicados, cinco secuencias/dependencias, una función con hash
de código 5394f65cdb6638c6347147f9ab61857509350470b9285f73883f423d81b46837 y dos
triggers coinciden con el DDL definitivo. Columnas también coinciden íntegramente
con el último estado JSON. RLS/force RLS apagados; policies/reglas/herencia vacías.
No hay diferencias semánticas detectadas en el shape. Los atributos adicionales
que no exporta ese shape se conservan como controles de catálogo bloqueantes en
el hotfix; la evidencia no se presenta como captura de campos que no contiene.

logistica_schema_shape.sql calcula SHA256 UTF8 de shape::text, con definiciones
decompiladas. pg_get_constraintdef(...,true) y pg_get_triggerdef(...,true) pueden
variar la calificación según visibilidad/search_path. pg_get_indexdef(oid) califica
la tabla en PG16.15. El shape usa prosrc y atributos, no pg_get_functiondef.
CREATE fijaba search_path=pg_catalog,public y normalizaba CR y una calificación de
trigger; eso no convierte todo el shape en una representación semántica canónica.

Fuentes primarias: [funciones de información PG16](https://www.postgresql.org/docs/16/functions-info.html)
y [ruleutils.c de PG16.15](https://github.com/postgres/postgres/blob/REL_16_15/src/backend/utils/adt/ruleutils.c),
con el alias confirmado en [lsyscache.c de PG16.15](https://github.com/postgres/postgres/blob/REL_16_15/src/backend/utils/cache/lsyscache.c#L3267).
No se sustituye ningún hash ni se reescriben migraciones/estados históricos.

## Política nueva

El manifiesto procede del DDL definitivo. checksCTEs cubre las 21 tablas completas,
no solo las 15 base. CREATE, validate_create, validate_seed productivo y los tres
archivos TEST comparten la política. Los controles estructurales producen errores
o incidencias bloqueantes; no hay excepción automática por «todo lo demás pasó».

| Cobertura | Criterio bloqueante |
| --- | --- |
| Inventario/tablas | Objetos exactos, tablas permanentes, tipos/arrays asociados, RLS y force RLS apagados. |
| Columnas | Nombre, posición, tipo/typmod, nullability, identidad/generación y collation, incluidas las cuatro COLLATE C de mappings. Defaults mediante AST. |
| Constraints | Nombre, clase, validez, deferrability, columnas ordenadas PK/UNIQUE/FK, destino y acciones FK. Incluye el CHECK inline del ledger. |
| CHECK | AST de pg_get_expr(conbin), preservando literales, operadores y agrupación lógica. |
| Índices | 48 nombres/tablas, btree, claves en orden, unicidad, PK, validez/readiness/live, null semantics, INCLUDE/expresiones, opclass/collation y opciones de orden. Predicados parciales por AST. |
| Secuencias | 20 nombres, tipo, límites/incremento/cache/cycle, propietario y dependencia OWNED BY; default nextval resuelto por regclass. Frescura sigue bloqueando cuando corresponde. |
| Funciones | Cuerpos por SHA256 con normalización CR ya existente, firmas, lenguaje, retorno, volatility, security, strictness, leakproof, parallel y search_path. Sin overloads ajenos. |
| Triggers | Los dos exactos: tabla, función, eventos/tipo, estado habilitado, argumentos, columnas, WHEN, deferrability y transition tables. Se rechazan otros triggers de usuario. |
| Otros | Reglas, policies y herencia bloqueadas; dependencias de expresiones en funciones/operadores fuera de pg_catalog bloqueadas. Ledger/checksums/orden y vaciedad siguen bloqueantes. |

semantic_expressions.mjs genera ASTs esperados offline y un bloque anónimo DO que
analiza las expresiones reales sin ejecutarlas. No crea funciones auxiliares ni
tablas temporales; también funciona dentro de READ ONLY. La gramática es limitada
al baseline y falla cerrada ante sintaxis desconocida. Normaliza whitespace fuera
de literales, comillas equivalentes, calificadores pg_catalog de builtins conocidos,
regclass por identidad de catálogo, IN/ANY y BETWEEN/comparaciones. Conserva el
contenido de strings/regex, operadores, precedencia y agrupación AND/OR. No elimina
todos los paréntesis ni todos los espacios indiscriminadamente.

Los dos guards (catálogos y expresiones) forman una unidad. Los scripts autónomos
incluyen ambos antes de sus resultados de éxito. Una excepción aborta la transacción.
No ejecutar fragmentos aislados del validador para acreditar integridad.

## Seed productivo conservado y validación pendiente

seed_calidad_operativo.sql conserva exactamente sus bytes y su SHA256 anterior:
e2e8ff8c05ba485ad56ab889c095485efac15df612b32e862f4c1d18d6b04da8.
frozen_productive_seed_checks.mjs mantiene la fuente de sus guards antiguos;
render_seed.mjs la usa exclusivamente para reproducir ese archivo conservado.
validate_seed_calidad.sql sí usa la política nueva.
**SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=SI.** Eso no bloquea FASE A,
que solo usa CREATE y el seed TEST de 14 filas. No se corrige aún el seed real.

## Entrega FASE A

La carpeta fase_a contiene únicamente 01_create_calidad.sql y
02_seed_calidad_test.sql, copias autónomas y exactas de las salidas de las fuentes
de verdad. build_phase_a_delivery.mjs las regenera; los tests verifican igualdad
byte por byte con create_calidad.sql y seed_calidad_test.sql. No se genera ZIP.
validate_create_calidad.sql, validate_seed_calidad_test.sql y
cleanup_seed_calidad_test.sql permanecen internos. Los dos SQL entregables ya
integran sus validaciones bloqueantes dentro de sus transacciones.

No se ejecutó SQL ni se abrió conexión a DB. Las pruebas nuevas usan JavaScript
y contratos de archivos. Las pruebas SQLite opcionales se desactivan mediante
--no-experimental-sqlite para respetar la instrucción de no ejecutar SQL.
CREATE y seed TEST están preparados para la prueba real por el administrador.
La ejecución de los nuevos guards en PostgreSQL 16.15 sigue pendiente; no se
presentan las pruebas offline ni la lectura del shape como ejecución del hotfix.

La suite incluye los casos iniciales y las regresiones sobre la evidencia real,
con mutaciones estructurales rechazadas. Los casos SQLite se omiten expresamente
para no ejecutar SQL. Se incluyen
todas las suites de deploy_calidad, la suite unitaria de artefactos PROD y las
tres suites offline de transfer_calidad, con node --no-experimental-sqlite --test.
Las pruebas del seed TEST ejecutan handlers reales de API10 con respuestas
simuladas en JavaScript para creación, ambas inspecciones y ambas liberaciones.

Revisión con el adjunto real: **333/333 tests ejecutados PASS, 0 FAIL**, 38 casos
SQLite omitidos (371 descubiertos). LOGISTICA_SHAPE_EVIDENCE se estableció solo
para el proceso de pruebas apuntando al archivo local, sin copiarlo al proyecto.
server_shape.test.mjs verifica ambos hashes y rechaza 47 mutaciones del shape
(tipos, defaults, claves, predicados, secuencias/dependencias, función, triggers,
RLS/policies/reglas/herencia). Esas pruebas contrastan el manifiesto y su
normalización offline; no se presentan como ejecución del bloque PL/pgSQL.
phase_a_delivery.test.mjs verifica las dos copias de entrega y el contenido de
la carpeta. Los guards estructurales del hotfix no necesitaron cambios adicionales
tras leer el shape real: sus expresiones y el manifiesto ya aceptan esa estructura.
