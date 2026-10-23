# Paquete administrativo: artecnologia → calidad

Estado: PREPARADO PARA REVISIÓN; sin ejecución en DB ni deploy. Runtime fijo:
**Node.js v18.19.1**. No actualizar Node del servidor.

Seguir el [runbook final de 11 pasos](10_RUNBOOK_CUTOVER_FINAL.md): backup confirmado
por el administrador → transferencia → validar restore → migraciones Logística →
validar Logística → FileZilla → npm ci → PM2 → health → Samsung (Jairo) →
conciliación delta humana. El acceso, el backup y PM2 quedan a cargo del administrador.

`calidad` ya pasó el preflight real: DESTINO_VACIO_Y_APTO=SI y cero objetos de
aplicación. Origen y destino comparten servidor PostgreSQL 16.15 y administrador.
No pedir otro inventario, versión ni nombre/ruta PM2. No exigir freeze total.

Una sola transferencia: `node context/database/deploy_calidad/08_operar.mjs transfer`.
Reutiliza las etapas existentes backup → export selectivo → restore en calidad.
Dentro del snapshot READ ONLY verifica la identidad real de artecnologia y ejecuta
01_preflight_artecnologia.sql antes del dump/export. Solo con ORIGEN_APTO=SI y
captura completa continúa. No ejecutar 01 ni 02 como actividades previas separadas.
El guard automático de destino/servidor/rol antes del restore permanece interno.

El inventario y las siete migraciones siguen en transfer_calidad/ y migrations/prod/.
El administrador no selecciona tablas ni compara conteos, secuencias, funciones o
triggers manualmente. El runner registra snapshot, inicio/finalización, hashes y
recibos; los comparadores determinan RESTORE_VALIDADO=SI. Después `migrate` ejecuta
las siete migraciones en orden fijo y comprueba cada éxito antes de enviar la
siguiente. `validate-final` exige LOGISTICA_SCHEMA_VALIDO=SI antes de FileZilla.
PM2 se reinicia mediante el procedimiento habitual del administrador.

Detalle de comandos y controles internos: [05_COMANDOS_TRANSFERENCIA.md](05_COMANDOS_TRANSFERENCIA.md).
Configuración y rollback: [06_CHECKLIST_CUTOVER.md](06_CHECKLIST_CUTOVER.md).

Un NO/REVISAR, captura truncada, schema distinto, secuencia insegura o error del
restore/migración significa DETENERSE antes del corte. El código 2 del comparador
delta significa diferencias pendientes de revisión, no una conciliación realizada.
Un fallo antes del corte permite mantener API10 anterior sobre artecnologia.

Los cuatro SQL administrativos y las dos capturas delta son READ ONLY. Un guard
de base/PG16 equivocada aborta su transacción. El límite 120s puede detener
capturas grandes: revisar técnicamente, no aceptar una salida incompleta.

Compartir TSV y reportes JSON, que contienen metadatos, conteos, hashes y PK
numéricas/UUID necesarias. PK textuales se identifican por hash para evitar
exponer datos personales. No se imprimen filas completas ni cuerpos de funciones.
NO compartir dumps/export SQL, passfiles, entornos ni credenciales Firebase/Drive.

Los cuatro históricos PostgreSQL pendientes no se incorporan automáticamente.
El snapshot histórico Entregas del Sheet es un flujo distinto del delta PostgreSQL.
No se crea ni utiliza PREPROD ni una DB LOCAL.

Los generadores offline y sus tests evitan duplicar inventarios/comparadores.

Los preflight reportan todas las extensiones instaladas como EXTENSION_INFRA / INFO
con nombre, schema y versión, para comparar origen y destino. Su pertenencia se
comprueba por catálogo/OID en pg_depend y pg_extension (membership `e`), incluyendo
objetos internos derivados (`i`, por ejemplo el array de un tipo). Una dependencia
normal, automática o auto-extension (`n`, `a`, `x`) no convierte un objeto propio
en infraestructura. Referencia: [pg_depend PostgreSQL 16](https://www.postgresql.org/docs/16/catalog-pg-depend.html).

En 02, application_objects/unexpected_application_objects cuentan solo los objetos
inventariados sin esa pertenencia; unexpected_objects conserva el mismo contador
por compatibilidad. extension_objects cuenta los objetos inventariados clasificados
como infraestructura, incluyendo las propias extensiones instaladas (también
plpgsql). No es el total de miembros de todos los catálogos del servidor. Tablas,
secuencias, vistas, rutinas, triggers y tipos propios siguen bloqueando; un ledger
existente bloquea además de forma independiente. Un SI indica ausencia de objetos
de aplicación en ese inventario; no certifica compatibilidad entre extensiones ni
autoriza copiarlas, instalarlas o desinstalarlas automáticamente. Sus metadatos
quedan disponibles para diagnóstico; no se añade una comparación manual obligatoria.

Tests offline: `node --test context/database/deploy_calidad/*.test.mjs
context/database/transfer_calidad/*.test.mjs` (en una sola línea desde el repositorio).
Los casos de catálogos simulados evalúan el SELECT generado usando VALUES y el
motor SQLite en memoria integrado en Node; adaptan únicamente sintaxis y funciones
de PostgreSQL. No abren conexiones ni ejecutan DDL y no certifican ejecución real
en PostgreSQL. Estos casos se verificaron con Node 24 de desarrollo; si node:sqlite
no está disponible se marcan SKIP y siguen los contratos de seguridad de SQL.
No cambiar Node 18.19.1 del servidor ni desplegar los archivos de tests.

Los scripts no aplican INSERT/UPDATE/DELETE de conciliación. Nuevas altas que
colisionen por PK, cambios divergentes y ausencias requieren decisión humana.
El snapshot no congela secuencias ni escrituras posteriores: el restore verifica
su seguridad contra las PK restauradas y la conciliación conserva ambas versiones.

Compatibilidad y riesgos de dependencias: [AUDITORIA_NODE18.md](../../api10/AUDITORIA_NODE18.md).
Detalle y límites del delta: [CONCILIACION_DELTA.md](../transfer_calidad/CONCILIACION_DELTA.md).
