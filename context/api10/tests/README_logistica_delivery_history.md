# Historial combinado de Logística

GET /api10/logistica/entregas/historial requiere los mismos middlewares Firebase
y allowlist que el GET existente. El endpoint anterior mantiene su contrato y
continúa consultando exclusivamente entregas modernas COMPLETED.

Query admitida: limit (entero 1..100, default 25 para CADA sección), pedido
(substring literal, máximo 200 caracteres), current_cursor y legacy_cursor.
No admite body con campos ni parámetros de identidad/ownership.

La respuesta tiene ok=true y dos secciones: current y legacy. Cada sección
contiene items y next_cursor, null cuando no existe página siguiente. Omitir
un cursor solicita la primera página de ESA sección; el consumidor administra
ambas paginaciones por separado. Cambiar pedido exige reiniciar ambos cursores.
Los cursores son base64url versionados, ligados a sección y búsqueda. No son
credenciales ni autorizaciones: los filtros de ownership se aplican siempre.

CURRENT reutiliza el repositorio del listado existente: propietario server-side,
COMPLETED, orden created_at DESC / id DESC, ID BIGINT como String y fecha UTC
con microsegundos. photo_count cuenta únicamente PHOTO UPLOADED.

LEGACY exige EXISTS de un mapping activo del propietario server-side y compara
snapshot, hoja, usuario y correo EXACTOS con collation C. No busca propietarios
por correo ni nombre. Un mapping inexistente, ajeno o revocado no autoriza.
Cada página vuelve a evaluar el mapping; revocarlo impide páginas posteriores.
No se aprueba ninguna de las nueve identidades históricas mediante este código.

LEGACY se ordena por local_datetime DESC / legacy_key DESC (collation C).
Las fechas NULL conservan el orden NULLS FIRST de DESC y su cursor correspondiente;
no se descartan ni se completan. El reloj histórico se formatea en PostgreSQL sin
AT TIME ZONE, no pasa por Date y nunca recibe Z ni offset. Se omiten únicamente
ceros fraccionales finales; las fracciones significativas se preservan.

Cada item expone source, id, pedido, display_name, email, status,
legacy_record_state, created_at, recorded_local_at, time_zone, photo_count y
legacy_image_count. En CURRENT los campos legacy son null. En LEGACY status,
created_at, time_zone y photo_count son null; legacy_record_state es RECORDED.
El ID legacy es legacy_key. Deduplicar por source + id, sin inferir origen del ID.
Usuario/correo legacy son declaraciones históricas, no snapshots autenticados.
legacy_image_count conserva el contador declarado, no acredita fotos subidas,
firma ni archivos disponibles. No se consulta Drive ni se crean evidencias.

Las secciones NO representan una cronología absoluta. Tampoco se usa imported_at
para sustituir FECHA/HORA ni se convierte el histórico a COMPLETED.
No hay migración nueva ni escrituras de datos en los handlers/repositorios.

## Validación

Desde context/api10, sin instalación de paquetes:

    node --test --test-isolation=none tests/*.test.js

La prueba real de PostgreSQL requiere habilitación explícita y la configuración
LOCAL existente; aborta ante otra base/host/puerto/rol o mappings persistentes:

    $env:RUN_LOGISTICA_DELIVERY_HISTORY_LOCAL_TESTS = '1'
    node --env-file=.env.local --test --test-isolation=none tests/logisticaDeliveryHistoryLocal.test.js
    Remove-Item Env:RUN_LOGISTICA_DELIVERY_HISTORY_LOCAL_TESTS

No aplica migraciones ni importa el XLSX. Usa identidades ficticias, IDs explícitos
sin avanzar secuencias y una transacción con ROLLBACK obligatorio. Los mappings
temporales se revierten; no se intenta borrarlos saltando la protección de auditoría.
Compara huellas completas de las cinco tablas y estados de sus secuencias antes
y después. La prueba invoca handlers con contexto sintético: NO acredita un HTTP
autorizado con Firebase real. Esa validación requiere el mecanismo seguro existente
para obtener un token del usuario de prueba; no inventar autenticación ni guardar
tokens/credenciales como parte de estas pruebas.
