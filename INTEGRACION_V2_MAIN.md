# Integración de Work Orders V2 en main

Fecha: 2026-11-17. Integración mediante merge normal, conservando ambos historiales.

- Main anterior: `d20e70eb41d4879de12d4051910f4bae437556aa`.
- Respaldo remoto de ese main: `origin/backup/legacy-v1-main-2026-11-17`.
- Origen V2: `origin/migracion-datos-historicos`, commit
  `a6f3039e9aa18278b30fb4def848ac3ff9fff7b8`. La rama se conserva.
- Trabajo realizado en un worktree independiente; los archivos locales ajenos
  a la integración se conservaron en sus directorios originales.

## Conciliación

Se conservan las rutas, servicios, plantillas, avance de Producción, solicitud de
inspección y controles de Calidad de V2. También se conservan la búsqueda/filtros,
consulta de liberaciones y actualización manual de Inspección de main, junto con
su pantalla de Documentación de Ingeniería. Sus lecturas pasan por la configuración
y transporte API27; no quedan destinos API10 fijos en esos servicios.

Con autorización expresa, se conciliaron únicamente las copias versionadas de
`context/api10/package.json`, `package-lock.json` y `server.js`. Se conservaron
los scripts, rutas de Ingeniería y Logística y todas las entradas de dependencias
bloqueadas originales de ambas ramas; las entradas compartidas eran idénticas.
No se inició ningún servidor backend ni se desplegaron esos archivos.

Las pruebas existentes de contrato usaban un `node_modules/pg` local de API10
que no viene en un clon. Ahora `pg` 8.23.1 es una dependencia de desarrollo del
frontend y esas pruebas lo resuelven desde el paquete raíz. No se actualizaron
las versiones ni integridades de las dependencias frontend existentes.
Los ajustes de los simuladores conservan los mismos casos y afirmaciones de negocio.

## Validación de la integración

| Comando | Resultado |
| --- | --- |
| `npm.cmd run test:v2` | 253 aprobadas, sin fallos ni omisiones |
| `node --test --test-isolation=none --test-reporter=spec test/inspection-plantel.test.cjs` | 70 aprobadas, sin fallos ni omisiones |
| `npm.cmd run build:v2` | TypeScript estricto y build Vite correctos |
| `npm.cmd run check:v2` | Artefacto correcto bajo `/work-orders-v2/`; API27 presente; sin URLs API10/API5 ni material secreto detectado |
| `npm.cmd run test:browser:v2` | 24 comprobaciones aprobadas, incluidas entrada y recarga de Ingeniería; cero errores de ejecución |

El navegador interceptó 45 solicitudes API27 y bloqueó 46 solicitudes externas:
**cero solicitudes de negocio despachadas**. Las pruebas de contrato ejecutan
handlers de referencia con HTTP/SQL simulados; no abren conexiones PostgreSQL.
Los logs y artefactos de validación son locales e ignorados por Git.

La compilación conserva el aviso de tamaño del bundle de Vite. No se introdujo
una refactorización para cambiarlo. No hay despliegues ni workflows de GitHub
Actions incorporados por esta integración.

## Límites vigentes

El adaptador Bearer permanece preparado y sin registrar en el arranque. No se
añadieron login, bypasses, tokens ni notificaciones directas de API27.
La autenticación/CORS y las rutas de Ingeniería en API27 no se verificaron contra
el servicio real. Las pruebas manuales protegidas dependen del contrato pendiente
descrito en [AUTENTICACION_API27.md](AUTENTICACION_API27.md).

Los comandos de clonación de `main`, configuración y ejecución están en
[PRUEBAS_LOCALES_V2.md](PRUEBAS_LOCALES_V2.md). El servidor local normal conecta a
API27 real; sus escrituras de prueba persisten en `calidad`.
