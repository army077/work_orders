# API27: autorización real, Firebase y Drive — preparado, sin ejecutar

Estado comunicado por el administrador el 29/10/2026: FASE A cerrada y seed
productivo EJECUTADO Y VALIDADO en PostgreSQL 16.15. Schema, datos, operativo y
BASELINE_APTO_PARA_DEPLOY=SI; 1.139 filas (8/37/51/155/869/2/17), cero históricos,
transaccionales y TEST/FIXTURE; sin ERROR ni NO-GO. LOGISTICA_AUTH_PENDIENTE=SI.
API27 permanece DETENIDA; API10 productiva sigue intacta. Esta es evidencia
aportada por el administrador; no se consultó el servidor durante la preparación.

No repetir seed, CREATE, migraciones, cleanup ni reset. Los WARNING de nueve
plantillas sin LIB001/LIB002, cinco secciones vacías y técnicos duplicados o
incompletos permanecen como tales; tampoco se repara la limitación 39 ENSAMBLE
documentada en la fase anterior. Históricos siguen fuera de este bloque.

Todos los comandos y SQL de este documento son instrucciones para ejecución
posterior por el administrador. No se ejecutaron SQL, requests, validación real
de OAuth/Firebase, arranque, deploy ni operaciones sobre Drive. No hay UID
inventado, secretos o JSON de credenciales en estos archivos.

## Orden exacto del administrador

1. Confirmar PG y proceso aislado: Node 18.19.1, APP_ENV=production,
   PGDATABASE=calidad, PGHOST/PGPORT/PGUSER/PGPASSWORD de la conexión autorizada.
   Conservar API27 detenida hasta el paso 6. Confirmar directorio, proceso y
   puerto temporal ya utilizados por el administrador, diferentes del proceso
   productivo. Revisar que ningún otro escritor alcance calidad durante el alta.
2. Confirmar Firebase Admin para logistica-ar y las credenciales existentes,
   según el checklist inferior. No crear otro proyecto ni copiar credenciales.
3. Confirmar OAuth, token y carpeta de Drive existentes. Ejecutar posteriormente
   la comprobación de metadatos de solo lectura; exigir DRIVE_CONFIG_OK=SI.
4. Registrar MANUALMENTE al usuario REAL aprobado con
   [register_logistica_real_user.sql](register_logistica_real_user.sql), usando
   binding de parámetros y cliente configurado para detenerse al primer error.
   Exigir COMMIT exitoso; no sobrescribir ni reactivar un registro ya existente
   sin revisar y aprobar esa acción por separado.
5. Ejecutar [validate_logistica_real_user.sql](validate_logistica_real_user.sql)
   con el mismo UID real: exigir LOGISTICA_AUTH_ACTIVA=SI. La consulta es READ
   ONLY y termina en ROLLBACK; no devuelve identidades ni datos de otros usuarios.
6. Arrancar únicamente el proceso aislado API27 con su configuración confirmada.
   No se proporciona un nombre PM2 ni puerto inventado. La copia temporal y su
   mapeo externo deben seguir atendiendo https://desarrollotecnologicoar.com/api27.
7. Comprobar GET /api27/health = 200 y JSON de health. Confirmar separadamente
   proceso y destino calidad: el health no consulta DB, Firebase ni Drive.
8. Con login real en Firebase, comprobar GET /api27/logistica/entregas?limit=1
   con Authorization: Bearer ID_TOKEN obtenido del SDK, sin body. Esperado:
   200, ok=true, items=[] y next_cursor=null si todavía no hay entregas completadas.
   No poner el token en URLs, historial de shell, logs, capturas ni Git.
9. NO tocar /api10, su proceso, su entorno ni su URL productiva. Solo después
   de aceptar este bloque preparar la prueba E2E siguiente; Flutter sigue pendiente.

La reactivación en paralelo es viable manteniendo procesos, puerto y ruta
aislados. El repo no acredita el mapeo vivo: server.js de referencia fija 3010
y /api10; PORT y un supuesto API_BASE_PATH no son variables soportadas allí.
No reemplazar ese archivo ni esos defaults en API10. El administrador debe cotejar
la copia temporal API27 y el proxy ya utilizado; no desplegarlos desde este plan.

## Allowlist: campos exactos y parámetros

Fuente: baseline vigente y auth/requireLogisticaAuthorizedUser.js. El middleware
consulta únicamente firebase_project, firebase_uid e is_active=true; nunca toma
la identidad del body ni autoriza por email.

| Campo | Requisito / origen |
| --- | --- |
| firebase_project | Obligatorio; valor exacto logistica-ar, protegido por CHECK. |
| firebase_uid | Obligatorio; UID REAL verificado y aprobado, no vacío. Copiar exactamente, sin inventarlo ni inferirlo del email. |
| email | Nullable; email aprobado o NULL. No concede autorización. |
| display_name | Nullable; nombre aprobado o NULL. No concede autorización. |
| is_active | Obligatorio; true para habilitar esta membresía. |
| id | BIGSERIAL, dejar al default; no suministrar ID ni reiniciar secuencia. |
| created_at / updated_at | TIMESTAMPTZ con default now(); omitir en el INSERT. |

Existe UNIQUE(firebase_project,firebase_uid). El SQL no contiene ON CONFLICT ni
UPDATE: un duplicado aborta. NULL o UID vacío fallan por constraints. Email y
nombre NULL permiten que la entrega tome los valores del token como snapshot;
si se proporcionan valores aprobados, el backend los prioriza. El alta consume
la secuencia normal de usuarios y no altera las siete secuencias del seed.

Binding del alta: $1=UID real, $2=email aprobado o NULL, $3=nombre aprobado o NULL.
Binding de la comprobación: $1=el mismo UID real que hará login. Usar un cliente
que soporte parámetros; estos archivos no son pegables con $1/$2/$3 sin binding
en HeidiSQL. Ejecutar las sentencias secuencialmente en una misma conexión y
transacción; vincular parámetros solo al INSERT o SELECT correspondiente. No
enviar el archivo completo como una única consulta preparada multiparámetro.
En un editor manual sin binding, el administrador debe completar
privadamente valores reales mediante el mecanismo seguro de ese cliente y
revisar el escaping; nunca publicar ese SQL completado.

No interpretar un SI previo al COMMIT como alta confirmada. Ante cualquier error,
rollback y revisar; no repetir el INSERT a ciegas. LOGISTICA_AUTH_ACTIVA comprueba
esa identidad exacta, a diferencia del marcador global de algún usuario activo.

**Firebase válido por sí solo NO basta:** un token válido sin membresía activa
en PostgreSQL recibe 403. Token ausente, inválido o expirado recibe 401. Error
de configuración Firebase o de consulta de autorización puede producir 500.
No usar /auth/logistica/me ni /authorized-me en production: el router de
diagnóstico solo se monta en local/test.

## Firebase Admin: checklist sin imprimir secretos

| Variable / configuración | Requerida | Propósito y comprobación segura posterior |
| --- | --- | --- |
| FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar | Sí | getLogisticaProjectId rechaza ausencia u otro valor. El checker local devuelve solo SI/NO. |
| Application Default Credentials (ADC) | Sí | getLogisticaAuth usa applicationDefault e initializeApp con projectId explícito. Debe resolver bajo la cuenta del proceso API27. |
| GOOGLE_APPLICATION_CREDENTIALS | Para el modo archivo preparado | Ruta al service account existente fuera de Git. El SDK también admite ADC ambiental; esta variable no es universalmente obligatoria. El checker preparado comprueba únicamente el modo archivo absoluto. |
| Archivo service account legible | Si se usa ese modo | JSON type=service_account, project_id/client_email/private_key presentes y clave parseable; solo flags, no valores. Cotejar en privado que la cuenta es la ya aprobada. |
| Hora y acceso de salida a Google | Sí para validación efectiva | El SDK valida firma RS256, issuer, aud y expiración. Verificar con el login del paso 8; presencia de un archivo no prueba el token ni la conectividad. |

auth/requireLogisticaFirebaseAuth.js exige Bearer, llama verifyIdToken y vuelve
a exigir decoded.aud=logistica-ar. req.auth se construye del token verificado.
Después requireLogisticaAuthorizedUser exige proyecto/UID coincidentes y activo.
verifyIdToken se llama sin checkRevoked=true; no se afirma una comprobación
inmediata de revocación. La allowlist activa sí se consulta en cada petición.
No se cambia esa política en esta preparación.

## Drive: OAuth independiente de Firebase

| Variable / configuración | Requerida | Propósito y comprobación segura posterior |
| --- | --- | --- |
| LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH | Sí | Ruta absoluta legible a JSON existente con installed o web y client_id/client_secret no vacíos. No imprimir contenido. |
| LOGISTICA_DRIVE_TOKEN_PATH | Sí | Ruta absoluta legible al token existente con refresh_token. No se requieren access_token ni expiry_date persistidos: el backend usa refresh. |
| LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID | Sí | Carpeta raíz aprobada; formato de ID, nunca URL. El checker no imprime el ID ni el nombre. |
| Cuenta / consentimiento / scopes OAuth | Sí | El refresh debe seguir vigente y permitir metadatos y crear carpetas/archivos en esa raíz. Con drive.file la carpeta debe estar autorizada para la aplicación; no ampliar scopes ni cambiar consentimiento en esta preparación. |
| Permisos efectivos de carpeta | Sí | GET de metadatos: carpeta, no papelera y capabilities.canAddChildren=true. Mantener políticas de Shared Drive si aplica; supportsAllDrives=true. |
| Salida HTTPS a OAuth y Drive | Sí | La prueba de metadatos fuerza el acceso real del cliente existente. No usar Firebase ADC ni service account para sustituir este OAuth. |

El backend inicializa Drive de forma perezosa. Construir el cliente o lograr
health 200 no prueba OAuth ni acceso a carpeta. El helper administrativo preparado
es [api27_integration_preflight.cjs](api27_integration_preflight.cjs); no modifica
API10, no importa server.js ni DB y no es un nuevo endpoint público.

Comprobación LOCAL de configuración, para ejecución posterior bajo el mismo
usuario y entorno de API27 (la shell no hereda automáticamente el entorno PM2):

```sh
node /ruta/administrativa/api27_integration_preflight.cjs --local-config
```

Devuelve únicamente PG_CONFIG_LOCAL_OK, FIREBASE_CONFIG_LOCAL_OK y
DRIVE_LOCAL_CONFIG_OK con SI/NO. Lee archivos locales; no realiza conexiones ni
certifica credenciales vigentes. FIREBASE_CONFIG_LOCAL_OK se limita al modo
archivo service account; con otro ADC hace falta verificación específica del SDK,
sin concluir que el backend está mal configurado solo por ese NO.

Comprobación Drive READ ONLY, también preparada para después:

```sh
node /ruta/administrativa/api27_integration_preflight.cjs --drive-readonly --api-dir /ruta/real/copia/API27
```

Las rutas son metavalores para el administrador; no se afirman rutas del servidor.
El modo Drive requiere ruta absoluta de la copia API27 y su módulo existente
integrations/logisticaDrive.js. Usa sus mismas credenciales y hace únicamente
files.get de mimeType, trashed y capabilities(canAddChildren), con timeout 45s y
sin retries. Devuelve solo DRIVE_CONFIG_OK=SI/NO (exit 0/1). Errores de Google,
rutas, IDs y tokens no se imprimen. No llama create/update/delete/generateIds,
ni sube evidencia, ni modifica permisos. OAuth puede renovar un access token
transitorio en memoria; el helper no persiste tokens ni altera archivos de Drive.

Un SI acredita esa lectura y capacidad declarada sobre la raíz en ese momento;
no garantiza cuota, todas las restricciones posteriores ni una subida real.
La aceptación de escritura se obtiene únicamente en la E2E autorizada siguiente.

## E2E mínima posterior, sin ejecutar ahora

Base externa: https://desarrollotecnologicoar.com/api27. Todas las rutas de
Logística requieren el Bearer ID token real vigente. Las identidades y estados
se obtienen del servidor, nunca se mandan UID, authorized_user_id o status en body.
Usar una entrega real aprobada, no fixtures ni importación histórica. Guardar
privadamente los IDs de seguimiento y usar el mismo UUID/payload/bytes al reintentar.

| Paso / endpoint | Entrada y respuesta esperada | Persistencia DB / Drive esperada |
| --- | --- | --- |
| Login Firebase SDK, sin endpoint de login API27 | Login del usuario real en logistica-ar; getIdToken obtiene el ID token. | Sin escritura DB o Drive por login. |
| POST /logistica/entregas | JSON: client_request_id UUID canónico nuevo, pedido/equipos/chofer reales no vacíos; observaciones/instalara/app_version opcionales. GPS puede omitirse aquí. 201 ok=true; replay idéntico 200. | Una logistica_deliveries con authorized_user_id y proyecto/UID verificados, status=PENDING_EVIDENCE, snapshots auth_email/auth_display_name. Crear entrega todavía no crea carpeta Drive. |
| POST /logistica/entregas/{id}/evidencias — foto | multipart: file, client_evidence_id UUID nuevo, evidence_type=PHOTO. JPEG/PNG/WEBP hasta 10 MiB; 201, evidence.status=UPLOADED. | Una logistica_delivery_evidence PHOTO con delivery_id, sequence_no, external_file_id, checksum y status=UPLOADED; delivery.drive_folder_id apunta a carpeta bajo la raíz configurada. Archivo de foto dentro de esa carpeta. |
| POST /logistica/entregas/{id}/evidencias — firma | Mismo formato, otro UUID, evidence_type=SIGNATURE; PNG hasta 2 MiB. 201, UPLOADED. | Exactamente una firma, fila UPLOADED y PNG en la misma carpeta de entrega. Máximo una firma y quince fotos contando reservas. |
| Obtener GPS en el cliente | Permiso y coordenadas reales válidas: latitude -90..90 y longitude -180..180, ambas numéricas. | No existe un endpoint separado para actualizar GPS: se envía al finalizar o se usa el GPS ya guardado al crear. |
| POST /logistica/entregas/{id}/finalizar | JSON con latitude y longitude reales; 200 ok=true, delivery.status=COMPLETED y completed_at. | Misma entrega COMPLETED con completion_latitude/completion_longitude y completed_at. Requiere al menos una PHOTO UPLOADED, exactamente una SIGNATURE UPLOADED y cero PENDING/FAILED. No sube archivos nuevos. |
| GET /logistica/entregas/historial?limit=25 — Mis registros Flutter | 200 ok=true; current.items contiene id/pedido propios, source=CURRENT, COMPLETED y photo_count>=1. legacy.items=[] mientras no haya históricos. | Solo lecturas; filtrado por usuario autorizado. GET /logistica/entregas?limit=25 es el listado current alternativo y devuelve items. |

Evidencias: 200 significa replay ya confirmado, 202 significa PENDING y requiere
esperar/reintentar con el mismo UUID y bytes; no tratarlo como subida completa.
Ante timeout no cambiar UUID ni crear una entrega alternativa. No finalizar
hasta confirmar ambas UPLOADED. 409 al finalizar señala evidencia/GPS/estado
incompatible. Un replay de cierre con mismo GPS es 200 idempotente. Conservar
evidencia de COMPLETED y existencia de foto/firma en Drive sin publicar IDs o PII.
No borrar ni resetear datos reales para volver al checkpoint del seed.

## Flutter: lectura realizada, cambio posterior pendiente

Proyecto localizado en C:/Proyectos/calidad_ylogistica/calidad_ylogistica.
Se revisó únicamente su código; no se modificó ni se ejecutó Flutter.

- lib/config/logistica_api_config.dart centraliza LOGISTICA_API10_BASE_URL vía
  String.fromEnvironment. _parse exige /api10 tanto en uri.path como en el sufijo
  literal. Actualmente rechaza /api27 en todos los modos: cambiar solo dart-define
  no basta. Release/profile tampoco tiene URL por defecto.
- Cambio posterior necesario: habilitar /api27 únicamente mediante selección
  explícita de entorno/build TEST, conservando HTTPS y la política productiva
  /api10. Usar la build TEST con LOGISTICA_API10_BASE_URL apuntando temporalmente
  a https://desarrollotecnologicoar.com/api27; preservar la build productiva con
  https://desarrollotecnologicoar.com/api10. Este comando aún no funcionaría sin
  el ajuste de validación y no se ejecuta aquí.
- lib/services/logistica_delivery_service.dart consume el config para alta,
  evidencias y cierre; lib/services/logistica_delivery_list_service.dart consume
  historyUri para Mis registros. Deben revisarse sus mensajes y pruebas al
  introducir el entorno, sin cambiar destinos productivos por reemplazo global.
- test/logistica_api_config_test.dart deberá cubrir /api27 TEST y /api10 PROD;
  test/logistica_delivery_service_test.dart y test/logistica_delivery_list_service_test.dart
  deberán verificar endpoints. Los consumidores son lib/pages/firma-entrega.dart
  y lib/pages/firma-entrega-registros/registros-entrega.dart; no precisan un cambio
  de URL propio si se mantiene la inyección centralizada.
- lib/firebase_options.dart ya referencia el proyecto logistica-ar. No necesita
  cambio para dirigir HTTP a API27; no copiar credenciales Admin a Flutter.

## Alcance de seguridad y pruebas

El checker y sus tests usan solo configuración explícita y dobles JavaScript.
Las suites de backend seleccionadas simulan Firebase, OAuth, DB y Drive; no se
ejecutan integraciones SQL ni el smoke de servidor. El checker de metadatos real
queda preparado, sin ejecutarse. Los SQL manuales solo se inspeccionan offline.
No se modifican fuentes API10, seed, build Flutter ni credenciales del servidor.
La revisión de secretos se limita a los archivos versionados actuales y cambios
preparados; no acredita secretos ausentes de todo el historial ni del servidor.

Resultado: **409/409 tests offline PASS, 0 FAIL, 0 omitidos**. Incluye las 18
pruebas nuevas del preflight/SQL manual, las suites de Logística con repositorios
simulados, dbGuard, node18Compatibility (SDK Firebase/OAuth con transporte
simulado) y las regresiones relevantes del seed/guards/documentación. Se
excluyeron los tests Local con DB y node18Startup; no se arrancó una API.
Los logs de prueba quedaron en TEMP, fuera del repositorio.

Selección reproducible desde la raíz del repositorio, con dependencias existentes:

```powershell
$env:RUN_CALIDAD_API_TESTS = '0'
$env:RUN_LOGISTICA_DELIVERY_HISTORY_LOCAL_TESTS = '0'
$env:RUN_CALIDAD_DISPOSABLE_PG16_TESTS = '0'
$tests = @((Get-ChildItem context/api10/tests -Filter 'logistica*.test.js' |
  Where-Object { $_.Name -notlike '*Local.test.js' } |
  ForEach-Object { $_.FullName })) + @(
  'context/api10/tests/dbGuard.test.js',
  'context/api10/tests/node18Compatibility.test.js',
  'context/database/deploy_calidad/api27_integrations.test.mjs',
  'context/database/deploy_calidad/productive_seed_hotfix.test.mjs',
  'context/database/deploy_calidad/runtime_baseline.test.mjs',
  'context/database/deploy_calidad/seed_source.test.mjs',
  'context/database/deploy_calidad/semantic_baseline.test.mjs',
  'context/database/deploy_calidad/deploy_calidad.test.mjs',
  'context/database/deploy_calidad/phase_a_delivery.test.mjs')
node --no-experimental-sqlite --test @tests
git diff --check
```

Auditoría local: 264 archivos versionados y cinco archivos nuevos preparados
revisados; cero ubicaciones con secretos detectadas. Las configuraciones públicas
de cliente Firebase no son credenciales Admin/OAuth. Los cinco archivos nuevos
son este documento, el helper, sus tests y los dos SQL manuales. No se leyeron
archivos de credenciales reales ni se imprimieron variables privadas.

```text
alta manual SQL preparada = SI
UID real requerido = SI
consulta validación autorización preparada = SI
Firebase project esperado = logistica-ar
Firebase config backend completa/documentada = SI
Drive config completa/documentada = SI
secretos encontrados en Git = NO (archivos actuales revisados)
API27 lista conceptualmente para reactivación = SI (confirmación real pendiente)
orden administrador = PG → Firebase → Drive → alta real → autorización DB → arranque API27 → health → GET autenticado → NO tocar API10
prueba logística E2E preparada = SI
Flutter requiere cambio para API27 test = SI
archivos Flutter involucrados = lib/config/logistica_api_config.dart; lib/services/logistica_delivery_service.dart; lib/services/logistica_delivery_list_service.dart; tests de config y ambos servicios
/api10 se modifica = NO
tests = 409/409 PASS
git diff check = PASS
SQL ejecutado = NO
DB modificada = NO
deploy ejecutado = NO
Flutter modificado = NO
commit = NO
push = NO
```
