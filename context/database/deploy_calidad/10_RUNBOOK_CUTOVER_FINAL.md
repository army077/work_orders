# Cutover calidad: validación primero, producción después

Destino: calidad / PostgreSQL 16.15. API10 conserva Node.js v18.19.1. Ejecutar
archivos SQL completos; un marcador SI exige el COMMIT posterior exitoso.
Ante error/NO: STOP y conservar la salida. Codex no ejecuta SQL ni modifica DB.

El administrador confirmó desde una conexión nueva: database=calidad,
CREATE_APLICADO=NO y tablas_presentes=0. CREATE_ROLLBACK_CONFIRMADO=SI para el
intento anterior. Esa observación no sustituye una comprobación futura de estado.

El drift anterior fue un falso positivo demostrado: el shape temporal de
referencia conservaba pg_temp. en 26 índices y dos funciones de trigger; el
servidor produjo public. Sustituir solo esos 28 calificadores recupera exactamente
el hash anterior. Ver [evidencia y cobertura](18_VALIDACION_SEMANTICA.md).

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
6. Limpieza interna mediante cleanup_seed_calidad_test.sql, cuando se autorice
   ese paso. Bloquea las tablas dentro de su transacción y borra únicamente las
   14 filas originales por ID + contenido completo, en orden FK. No usa TRUNCATE.
7. Exigir TEST_LOCAL_RESTANTES=0 y COMMIT exitoso. El contador cubre los IDs de
   este manifiesto, no otros datos creados por API. Repetir validate_create para
   comprobar negocio vacío y secuencias frescas antes del siguiente paso.

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
CRUD también puede avanzar secuencias; el cleanup no las rebobina. Un fallo de
SEQUENCE_NOT_FRESH requiere revisión explícita antes de FASE B.

## FASE B — Producción posterior

**SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=SI.**
seed_calidad_operativo.sql permanece byte por byte intacto y conserva el guard
textual anterior. Esto **no bloquea FASE A**, porque no se ejecuta ese seed.
Antes de FASE B actualizar controladamente su guard a la política semántica,
conservando las 1.139 filas aprobadas y repitiendo los tests. Su fuente histórica
reproducible es frozen_productive_seed_checks.mjs; no es la política de CREATE.

Precondiciones: plataforma aceptada en FASE A, limpieza comprobada, ausencia de
eventos TEST, secuencias compatibles, backup y configuración de API10 respaldados.
EXPORT_CONFIG_PROD_RECIBIDO=SI; no solicitar otro export por la etiqueta heredada.

1. Confirmar plataforma validada y preparar el hotfix del seed productivo.
2. seed_calidad_operativo.sql, ya actualizado y revisado: 1.139 filas aprobadas,
   IDs preservados y CALIDAD_SEED_CARGADO=SI con COMMIT exitoso.
3. validate_seed_calidad.sql, READ ONLY, valida la configuración productiva real.
   Las incidencias heredadas 39/5/9 siguen como WARNING; los ERROR bloquean.
   Ver [auditoría de runtime](17_AUDITORIA_RUNTIME_BASELINE.md).
4. Alta real explícita de logistica_authorized_users según
   [13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md), y repetir la validación.
   Exigir LOGISTICA_AUTH_PENDIENTE=NO para operar Logística.
5. Deploy API10 por el administrador: [checklist](06_CHECKLIST_CUTOVER.md),
   [manifiesto FileZilla](07_ARCHIVOS_API10_FILEZILLA.txt), Node 18.19.1,
   npm ci --omit=dev, configuración PG/Firebase/Drive habitual, reinicio y health.
6. Flutter Release.
7. Samsung E2E: login → entrega → foto → firma → GPS → finalizar → Mis registros;
   exigir COMPLETED y evidencias Drive. Health 200 solo acredita HTTP.
8. Históricos posteriormente, mediante un plan independiente aprobado.

No dump/restore/delta durante estas fases. No borrar DB ni reintentar CREATE sobre
objetos existentes. Tras nuevas escrituras no volver al sistema anterior sin
preservar ambos lados y revisar la reconciliación.
