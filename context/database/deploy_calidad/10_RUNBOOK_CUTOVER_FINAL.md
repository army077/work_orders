# Runbook de calidad: Fase B preparada, sin ejecutar

Estado comunicado por el administrador al preparar este hotfix (29/10/2026):
FASE A cerrada correctamente; CALIDAD_SCHEMA_VALIDO=SI, 21 tablas, siete filas
ledger, cero filas de aplicación y TEST, siete secuencias restauradas al baseline.
API27 está DETENIDA; /api10 productiva no fue modificada. Esta preparación es
local/offline; no vuelve a consultar el servidor ni acredita una ejecución nueva.

**SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO.** Hotfix preparado:
seed y validador comparten checksCTEs + expressionGuard del baseline semántico
aprobado para PostgreSQL 16.15. Conservan las 1.139 filas, IDs originales y los
siete next values. Ver [verificación offline](21_FASE_B_HOTFIX_SEED.md).

No ejecutar nada de este runbook durante esta preparación. La sección FASE A
siguiente conserva el procedimiento histórico: ya está cerrada; no repetir CREATE,
seed TEST, cleanup ni reset. El orden vigente posterior es FASE B.

## FASE A — Validación

**Entregar al administrador únicamente estos dos archivos, en este orden:**

1. [01_create_calidad.sql](fase_a/01_create_calidad.sql).
2. [02_seed_calidad_test.sql](fase_a/02_seed_calidad_test.sql).

Son SQL autónomos para HeidiSQL. Ambos incluyen sus validaciones bloqueantes y
transacciones; no requieren generadores, includes ni los validadores internos.
La carpeta fase_a contiene solo esos dos archivos. No generar ZIP todavía.
build_phase_a_delivery.mjs los genera desde las fuentes vigentes, y los tests
comprueban igualdad exacta con create_calidad.sql y seed_calidad_test.sql.

Flujo completo del equipo técnico:

1. Administrador: 01_create_calidad.sql. Exige ausencia de objetos de aplicación,
   PG16 y extensiones plpgsql/citext ya instaladas. Esperado:
   CALIDAD_BASELINE_CREADO=SI con COMMIT exitoso. Incluye las siete versiones
   Logística; no ejecutar migraciones incrementales encima.
2. Validación interna mediante validate_create_calidad.sql, READ ONLY:
   CALIDAD_SCHEMA_VALIDO=SI, negocio vacío y secuencias frescas.
3. Administrador: 02_seed_calidad_test.sql, solo tras CREATE exitoso. Esperado:
   SEED_TEST_CARGADO=SI, FILAS=14 y COMMIT exitoso.
4. Validación interna mediante validate_seed_calidad_test.sql, READ ONLY:
   SEED_TEST_VALIDO=SI, FILAS=14. Comprueba arquitectura, conteos, contenido exacto
   y relaciones. Las tablas ajenas al seed deben seguir vacías.
5. Pruebas DB/API/CRUD en el entorno autorizado por el administrador. Esta entrega
   no despliega ni cambia tráfico. Usar familia/modelo 910001, ENSAMBLE 910001 e
   INSPECCION 910002. La orden materializa tres tareas. LIB001/LIB002 permiten
   probar las liberaciones de «Inspección de ensamble» y «Inspección de pintura».
   Usar únicamente información ficticia. Una prueba autenticada de Logística
   requiere alta explícita aparte; este seed no crea UID ni usuario Logística.
6. Cierre preparado en [20_CLEANUP_FINAL_FASE_A.md](20_CLEANUP_FINAL_FASE_A.md):
   bloquear escritores y ejecutar primero cleanup_runtime_test_calidad.sql con
   el journal final de 20 filas. Validar runtime=0 mediante el checkpoint READ ONLY.
   Solo entonces ejecutar cleanup_seed_calidad_test.sql para las 14 filas originales.
7. Exigir TEST_LOCAL_RESTANTES=0 con COMMIT y ejecutar el checkpoint READ ONLY
   validate_test_cleanup_calidad.sql. Después ejecutar el reset separado de las
   siete secuencias TEST, protegido por tablas vacías. Finalmente validate_create:
   CALIDAD_SCHEMA_VALIDO=SI, application_rows=0 y ledger_rows=7. No ejecutar Fase B.

Los tres archivos internos no se incluyen en la entrega inicial al administrador.
Los SQL 01/02 ya contienen los guards necesarios para bloquear sus errores.

El seed usa IDs explícitos 910001–910003 según tabla. No consume, reinicia ni
rebobina secuencias. Los correos son ficticios @example.invalid. Dos títulos de
sección y LIB001/LIB002 conservan los valores requeridos por el runtime; la
propiedad TEST se acredita por el manifiesto completo y las plantillas TEST_LOCAL.
No se leen fuentes productivas ni se cargan históricos, entregas, evidencias,
eventos, mappings o autorizaciones Firebase.

**Límite de limpieza:** si CRUD modifica una fila del seed o crea referencias
externas hacia ella, CLEANUP_TEST_ABORTED cancela todo. Incluye relaciones lógicas
sin FK y referencias de técnicos por correo. Conservar la salida e identificar
los IDs de esas operaciones; resolverlos mediante un procedimiento aparte,
revisado y autorizado. No quitar guards ni convertirlo en un borrado por prefijos.
Los eventos creados por API no pertenecen a este seed y no se borran aquí.
CRUD avanzó siete secuencias; los cleanups no las rebobinan. La revisión final
prepara reset_sequences_after_test_calidad.sql para volver al baseline exacto
después de borrar runtime y seed, con todas las tablas de aplicación vacías.

## FASE B — Orden exacto de ejecución posterior

Precondiciones para el administrador: conservar el cierre de FASE A, API27
detenida y sin escritores contra calidad, respaldos y recuperación disponibles.
Si cambió el estado desde el cierre, detenerse y revisar antes de cargar.
No ejecutar sobre tablas pobladas ni omitir guards. Ante error, NO o salida
incompleta: STOP; conservar evidencia saneada. El seed es una transacción completa:
CALIDAD_SEED_CARGADO=SI solo vale con COMMIT posterior exitoso. No reintentar tras
COMMIT exitoso. Si la conexión se pierde, determinar el estado antes de reintentar.

1. Ejecutar seed_calidad_operativo.sql completo contra calidad / PostgreSQL 16.15.
   Exige baseline íntegro y vacío. Resultado: CALIDAD_SEED_CARGADO=SI y COMMIT.
2. Ejecutar validate_seed_calidad.sql completo, READ ONLY. Exigir
   CALIDAD_SCHEMA_VALIDO=SI, CALIDAD_SEED_DATOS_VALIDOS=SI,
   CALIDAD_SEED_OPERATIVO_VALIDO=SI y BASELINE_APTO_PARA_DEPLOY=SI. Su ROLLBACK
   final es intencional. Los ERROR bloquean; 39/5/9 son WARNING heredados.
3. Confirmar 1139 filas: machine_family=8, machine_model=37,
   maintenance_template=51, template_section=155, template_task=869,
   template_task_inspection=2, plantilla_tecnicos=17. Huérfanos=0,
   TEST/FIXTURE=0; tablas de históricos y eventos vacías; ledger=7.
   Next values: 9, 52, 131, 406, 1251, 223, 131, respectivamente;
   last_value=next value, is_called=false, sin consumir nextval para comprobarlos.
4. Alta MANUAL del usuario real activo de Logística según
   [13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md), en un paso separado.
   Firebase válido por sí solo NO basta. Usar UID real verificado de logistica-ar;
   no generar UID ni incluirlo en el seed. Exigir COMMIT exitoso del alta.
5. Validar autorización: repetir validate_seed_calidad.sql antes de cualquier
   evento. Exigir LOGISTICA_AUTH_PENDIENTE=NO y cotejar que el registro activo
   corresponde exactamente al proyecto y UID del usuario que operará. Un usuario
   activo diferente no autoriza a esta identidad. API27 permanece detenida todavía;
   la comprobación HTTP autenticada se completa en el paso 10.
6. Configurar/confirmar Firebase + Drive en la instancia aislada API27 usando
   únicamente las credenciales existentes del servidor; ver configuración abajo.
   Confirmar que apunta a calidad y que la ruta externa sigue siendo /api27.
7. Reactivar API27 con el proceso y puerto de pruebas que ya administra el
   administrador, después de los pasos anteriores. No reiniciar ni cambiar /api10.
8. Exigir /api27/health = 200. Confirmar también el destino efectivo calidad y
   el proceso aislado; health solo acredita HTTP, no datos ni autorización/Drive.
9. Pruebas finales web con datos reales aprobados contra API27: lectura de los
   siete maestros, selección de plantilla, creación de orden y sus actividades.
   Registrar IDs de eventos reales. No usar fixtures ni reparar la fuente para
   ocultar los WARNING. ENSAMBLE sin inspección/códigos y secciones vacías conservan
   las limitaciones documentadas; no confundirlas con corrupción o fallo de carga.
10. Pruebas Logística con la identidad real: petición autenticada de lectura de
    entregas en /api27/logistica/entregas, verificar acceso y alcance por usuario;
    entrega real aprobada → foto → firma → GPS → finalizar → Mis registros.
    Exigir COMPLETED y evidencias existentes en Drive. Token inválido=401;
    token válido sin usuario activo autorizado=403. No crear identidades ficticias.
11. Flutter Release, solamente después de aceptar web y Logística en API27.
    Revisar el destino API27 de esa build antes de instalarla. No tocar Flutter
    durante esta preparación.
12. Samsung E2E: login real → entrega → foto → firma → GPS → finalizar → Mis
    registros; cotejar COMPLETED, persistencia en calidad y evidencias en Drive.
13. Solamente después evaluar promoción /api27 → /api10 mediante una decisión
    y procedimiento posteriores. Esta preparación no autoriza ni realiza cambios
    en /api10, proxy, tráfico productivo, Firebase o Drive.

La validación del seed es un checkpoint inicial, antes de actividad de negocio:
tras los pasos 9/10 habrá eventos reales y secuencias avanzadas. No repetir seed,
cleanup TEST ni reset para volver a obtener tablas vacías o los next values iniciales.

## Configuración necesaria de API27 (confirmación posterior)

Usar el runtime Node.js v18.19.1 ya previsto. Confirmar en el proceso API27:

- APP_ENV=production.
- PGDATABASE=calidad, junto con PGHOST, PGPORT, PGUSER y PGPASSWORD del rol ya
  autorizado para calidad. Confirmar acceso/permisos sin imprimir valores secretos.
- FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar.
- GOOGLE_APPLICATION_CREDENTIALS: referencia a las credenciales Firebase Admin
  existentes en servidor, fuera del repositorio y legibles por el proceso API27.
  No copiar claves, tokens ni JSON de credenciales al runbook o a logs.
- LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH y LOGISTICA_DRIVE_TOKEN_PATH: referencias
  a OAuth/token existentes; LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID: carpeta ya aprobada.
  Comprobar permisos del proceso, vigencia y acceso a esa carpeta sin mostrar tokens.
- Puerto interno, nombre/ruta del proceso, directorio de trabajo y mapeo externo
  /api27: conservar y confirmar la configuración actual del administrador.
  No se infieren de los defaults del repositorio. La fuente local compartida
  context/api10/server.js usa 3010 y rutas /api10 fijas; no permite cambiar el
  puerto por PORT. No copiar esos defaults sobre la instancia API27 ni modificar
  el proceso productivo. El administrador confirma su mapeo aislado antes de iniciar.

En production no se monta /auth/logistica/authorized-me (solo local/test).
Para autorización real usar la ruta protegida de entregas del paso 10 con un token
válido, manteniéndolo fuera de URLs, logs y capturas. Firebase Admin comprueba el
proyecto; el middleware exige además el UID real activo en logistica_authorized_users.

## Históricos fuera de esta fase inicial

Históricos Work Orders, inspecciones realizadas, desviaciones, entregas y Sheet
de Logística se importarán posteriormente mediante una fase separada. El seed
inicial no incluye históricos, eventos, TEST, fixtures, legacy, mappings ni usuarios.
No usar dump/restore/delta ni migraciones incrementales encima del baseline limpio.
No borrar DB. Tras nuevas escrituras, cualquier reversión requiere preservar los
datos creados y revisar su reconciliación; no volver a la limpieza de FASE A.
