# Conciliación histórica de Entregas: infraestructura LOCAL

La migración 20261021_create_logistica_legacy_owner_mapping.sql crea una tabla
vacía. No consulta Firebase, Workspace ni Drive, no recorre el histórico para
generar mappings y no cambia endpoints ni Flutter.

Una cuenta Workspace puede haberse renombrado, reutilizado o reasignado.
Correo, alias, nombre, UID Firebase y persona histórica son conceptos distintos.
Una coincidencia técnica actual no acredita autoría pasada.

## Aprobaciones futuras

Cada mapping requiere una decisión humana documentada: approval_basis,
approved_by y approved_at. No se genera fundamento ni aprobador.
Los CHECK rechazan valores vacíos y ejemplos literales insuficientes, pero
no determinan si un texto acredita realmente la relación: la revisión
administrativa sigue siendo obligatoria.

La identidad se compara exactamente por snapshot, hoja, usuario y correo,
con collation C. No se recortan espacios ni se normalizan mayúsculas, acentos,
correos o aliases. Las dos identidades históricas de Octavio siguen separadas.
La FK valida solo el destino técnico actual, no la autoría histórica.

Solo existe una aprobación activa por identidad y scope. La aprobación
original no se edita: se revoca con fecha, responsable y motivo y luego se
inserta una aprobación nueva. La fila revocada mantiene destino, fundamento,
aprobador y fecha originales. No se reactiva ni se modifica. DELETE y TRUNCATE
están bloqueados. Los triggers solo protegen auditoría; no crean mappings.

CHOFER FORANEO y Choferes AR son cuentas potencialmente compartidas y no se
autoasignan. Un mapping global futuro solo es válido si se aprueba toda la
identidad para el mismo destino. Si hay varios autores históricos, se necesitará
una excepción futura por legacy_key. Esa excepción NO está implementada;
no debe sustituirse por una asignación global a una persona.

No se implementan herramientas de aprobación, endpoints ni integración con GET.
Tampoco se resuelven zona horaria, finalización o evidencias.

## Pruebas reales LOCAL

Desde la raíz del repo, usando las credenciales PostgreSQL locales existentes:

    $env:RUN_LOGISTICA_LEGACY_OWNER_MAPPING_LOCAL_TESTS = '1'
    node --env-file=context/api10/.env.local --test --test-isolation=none context/database/tests/local/logistica_legacy_owner_mapping.test.js
    Remove-Item Env:RUN_LOGISTICA_LEGACY_OWNER_MAPPING_LOCAL_TESTS

El runner verifica host 127.0.0.1, puerto 5432, base artecnologia_test_local
y rol workorders_test. Aplica la migración solo si falta la tabla y exige
que esté vacía antes de ejecutar fixtures.

Los fixtures usan identidades ficticias, snapshots de prueba e IDs negativos
explícitos, sin avanzar secuencias. Dos filas allowlisted y una fila legacy
temporales se revierten con ROLLBACK. No crean usuarios Firebase ni asignan
ninguna de las nueve identidades reales.

Se comparan las huellas completas de las cuatro tablas protegidas antes y
después. Al finalizar quedan cero mappings y solo persiste la infraestructura.
No ejecutar importadores o tests de importación para validar esta tabla.
