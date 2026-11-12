# P2 — Plantel de Inspección Legacy

Implementación local del 11 de noviembre de 2026.

- Repositorio definitivo: `C:\Proyectos\work_orders\main-inspector-miguel`.
- Rama `main`, HEAD inicial `69f71ed1a3fb40631dfb45d6c64d4e5bd66da7db`.
- Estado inicial limpio; 70 archivos iniciales registrados mediante SHA256.
- Fuente auditada: contexto local API10. No acredita la versión desplegada.
- Sin cambios en backend, PostgreSQL, Firebase, Flutter, V2 o API27.

## Implementado

### Búsqueda e identidad

El control ahora es visible y ofrece los ámbitos:

- Todos los campos.
- ID de inspección: comparación exacta contra `inspection_order_id`.
- ID de orden de producción: `work_order_id_real`, o `work_order_id` si falta el
  alias de la relación. No se inventa un número de orden.
- Folio SAI de producción: `folio_sai`, con etiqueta explícita.
- Cliente, serie, inspector o título: conserva búsqueda textual sin distinguir
  mayúsculas. Se eliminan espacios exteriores de la búsqueda.

Un ID 7 no coincide con 17 en los ámbitos de ID. En Todos los campos puede
coincidir con cualquier campo incluido: elegir el ámbito distingue una inspección
7 de una orden de producción 7. Las tarjetas y detalles muestran ambos IDs y el
folio SAI por separado. Encabezados, claves React y selección usan el ID explícito
de inspección, nunca `o.id` ni `selectedOrder.id`.

La búsqueda se combina con el estado y se limpia mediante botón, conservando el
filtro de estado. Se mantiene el orden por creación descendente. Vacío de API y
vacío por filtros tienen mensajes diferentes.

### Estados y actualización

Se puede seleccionar **En proceso → IN_PROGRESS**, además de Todas, Abierta,
Pendiente, Cerrada y Finalizada. No se crearon estados de base de datos ni se
asignó significado de liberación a IN_PROGRESS.

Se añadieron Actualizar inspecciones en el listado y Actualizar esta inspección
en el detalle. Ambos hacen una lectura de:

`GET https://desarrollotecnologicoar.com/api10/quality/inspection/orders_all?include=tasks`

Si se utiliza el filtro de liberación, se consulta además el endpoint existente
`GET /api10/work-orders?include=tasks`, una sola lectura global de Producción por
actualización; no una por tarjeta. Sin ese filtro, esa consulta permanece deshabilitada.
Las pulsaciones concurrentes comparten la operación de refresco. Se indica carga,
se bloquea el botón durante la consulta y no se agregaron polling ni reintentos
automáticos. El GET tiene límite de 30 segundos, incluyendo lectura del body,
y aborta al agotarse. HTTP no exitoso, JSON inválido, IDs incorrectos/repetidos y
error de conexión se distinguen de una respuesta vacía.

El dataProvider limita ese tratamiento a sus dos nombres existentes de recurso
de inspección y un alias interno nuevo `inspection-production-releases` que apunta
al GET de Producción ya existente; no es un endpoint nuevo. Las demás operaciones
conservan su código y URLs. La asignación
web mantiene su POST y payload y, tras éxito, refresca la consulta en lugar de
recargar el navegador completo. El detalle se sincroniza por ID con la nueva fila;
si desaparece del resultado se cierra. Si falla el refresco, se muestra el error,
también dentro del detalle, sin afirmar que sus datos se actualizaron.

| Cambio externo | Actualización del Plantel |
| --- | --- |
| Crear inspección desde Producción | Actualizar inspecciones; no se añadió listener |
| Asignar inspector desde este detalle | Refresco de API10 tras el POST exitoso |
| Cambiar estado/completar puntos desde Calidad | Actualización manual de lista o detalle |
| Liberar LIB001/LIB002 | Con filtro de liberación activo, relee las tareas actuales de Producción y actualiza el criterio separado |
| Finalizar inspección | Refresco manual; aparece con el estado real y respeta el filtro elegido |
| Cancelación anterior | Conserva su recarga completa previa; no se ejecutó durante esta tarea |

### Personas: solicitante, operador e inspector

Las tarjetas y el detalle presentan etiquetas separadas:

- **Solicitante:** `Solicitante no registrado` en la integración actual.
- **Operador de Producción:** campo real `operador_produccion`.
- **Inspector asignado:** campo real `assigned_tech_email`.

No se deduce el solicitante de ninguno de los otros dos correos, comentarios o
campos no contratados. El componente de presentación admite un solicitante
registrado para una integración futura; sus pruebas pasan un correo de fixture.
**No está conectado a una fuente real de solicitante**, porque el contrato actual
no la proporciona. Esa prueba acredita presentación, no persistencia ni identidad
de un solicitante en el servidor.

### Liberación actual de Producción: filtro implementado

`orders_all?include=tasks` devuelve tareas de `inspection_order_task`. No incluye
las tareas LIB001/LIB002 de `work_order_task`. En el contexto local, la ruta
`PUT /quality/liberar_orden/:workOrderId` utiliza la sección para determinar:

- Inspección de ensamble → LIB001.
- Inspección de pintura → LIB002.

Actualiza la tarea de producción correspondiente. No se puede concluir que esté
liberada porque una inspección esté IN_PROGRESS, FINISHED o tenga todos sus puntos
DONE. Tampoco todos los registros necesariamente requieren ambos códigos.

El contrato local de `GET /work-orders?include=tasks` sí ofrece `work_order.id`
y sus `work_order_task` con ID, código, estado y FK. Se implementó el filtro
**Liberación actual de Producción**, separado de Estado de inspección:

- LIB001 pendiente/completada/sin información verificable.
- LIB002 pendiente/completada/sin información verificable.

Se vincula por el ID real de la orden de producción, no por ID de inspección ni
por posición en el array. DONE significa completada; OPEN/PENDING/IN_PROGRESS de
esa tarea concreta significan pendiente. Estado desconocido, código duplicado,
tarea u orden ausente se presentan como sin información verificable después de
una consulta exitosa. Un GET fallido o sin terminar es error/carga, no un resultado
pendiente ni sin información. No se usa el estado de puntos de inspección como sustituto.

La lectura se activa solo al elegir un criterio de liberación; comparte caché de
consulta y el refresco manual, sin polling ni refetch al enfocar la ventana para
esa consulta adicional. Las tarjetas filtradas identifican el código y el estado
actual de Producción. Los criterios combinan liberación, estado y búsqueda.

No se afirma que la tarea sea aplicable a esa inspección ni que su valor actual
corresponda a la liberación histórica de ella: el filtro elige explícitamente un
código de la orden relacionada. Por ejemplo, una inspección finalizada puede
vincularse a una orden cuya tarea se reinició después. Para historial o un filtro
de liberación atribuible a una inspección concreta, Armando debe definir y devolver
esa asociación y la aplicabilidad de códigos; no es deducible del contrato actual.
Como optimización futura puede devolver únicamente liberaciones de las órdenes
del Plantel o incluirlas en orders_all, evitando cargar todos los checklists. No
se inventaron estados ni se modificó ningún endpoint/esquema.

## Preparado sin activar y contratos pendientes

### Solicitante

`GET /quality/inspection/orders_all` selecciona `io.assigned_tech_email` como
inspector y `wo.assigned_tech_email AS operador_produccion`. No selecciona un
solicitante. El contexto local de `POST /quality/inspection/request` recibe
work_order_id, estacion, inspection_type y comments; no registra identidad de quien
lo pidió.

Armando debe acordar un campo explícito de solicitante, registrarlo en la creación
y devolverlo inequívocamente en el listado. Flutter Producción, emisor confirmado
del flujo, debe aportar su identidad autenticada o permitir que el servidor la
obtenga de la sesión; revisar también otros emisores antes de cambiar el contrato.
La identidad debe validarse en servidor, no confiar en un correo libre del body.
El nombre del campo y su persistencia requieren acuerdo; esta etapa no añadió
columnas, endpoints ni modificaciones Flutter. Los históricos sin ese dato deben
seguir sin solicitante registrado, sin rellenarlos con operador o inspector.

### Cancelar

La acción anterior está dentro del diálogo, al final del panel izquierdo con
scroll. No está en la tarjeta ni en la barra del Plantel. La altura fija del
diálogo y el desplazamiento requerido ayudan a explicar que algunos usuarios no
la encuentren. Antes, además, ciertos títulos mostraban `id` genérico indefinido.

**Se preservan exactamente el handler anterior, su botón y su disponibilidad.**
No se añadió cancelación a tarjetas, menús ni barra ni se cambió el endpoint.
Esto **no corrige la falta de autorización/validación del servidor existente**:
el contexto local de `PUT /quality/:id/insp_cancel` cambia a CANCELED sin comprobar
permiso, estado anterior ni efectos sobre liberaciones. No se ejecutó ese handler.

Se prepararon `CancellationConfirmation`, `cancellationProposalReady` y una
previsualización `InspectionCancellationProposal`, **sin montar en el Plantel y
sin handler HTTP**. Incluso la previsualización confirmada mantiene su botón
deshabilitado. Las pruebas de permiso/estado se refieren a esta propuesta aislada,
no acreditan que la ruta anterior esté protegida.

La integración futura debe recibir de un backend autenticado: permiso del usuario,
estado cancelable, efectos confirmados sobre LIB001/LIB002 y contrato del resultado
de transición. El servidor debe volver a validar todo al ejecutar, incluyendo
carreras/cambios de estado y una respuesta inequívoca con el estado real resultante.
Un flag de cliente no autoriza la operación. Hasta ese contrato no se conectará
la propuesta ni se ampliará disponibilidad. No se borran inspecciones.

## Archivos modificados y nuevos

Existentes:

- `src/pages/Plantel Inspeccion.tsx`.
- `src/dataProvider.ts`, exclusivamente el recurso de inspecciones.

Nuevos:

- `src/features/inspectionPlantel.ts`: tipos, filtros, lectura y coordinación de refresco.
- `src/features/InspectionPlantelControls.tsx`: controles, etiquetas, mensajes y propuesta sin conectar.
- `test/inspection-plantel.test.cjs`: pruebas offline.
- `test/inspection-support.cjs`: compilación TS en memoria y carga de React para las pruebas.
- `tools/check-inspection-p2.cjs`: análisis TypeScript y compilación aislada, sin instalar dependencias.
- Este documento.

Los cambios funcionales están en el repositorio definitivo, no únicamente en la
copia de compilación temporal. Se eliminaron los scripts de preparación de un solo uso.

## Pruebas y compilación

**70 pruebas aprobadas, exit 0**, con Node v24.19.0. Cubren búsqueda por inspección/
producción/folio, IDs coincidentes y distintos, búsquedas anteriores, combinación
con cada estado, IN_PROGRESS, limpieza, separación de liberación, solicitante
registrado en presentación y ausente en contrato, inspector distinto, códigos
LIB001/LIB002 por FK real, liberación independiente del estado de inspección,
datos ausentes/desconocidos/duplicados, carga diferida y fallos de esa consulta, propuesta
de permisos/estados de cancelación, refresco concurrente, errores y vacíos.

Incluyen renderizado React/MUI en servidor del Plantel real con `useList`
simulado, controles y tarjetas, callbacks de los controles, fetch/dataProvider con
respuestas simuladas, HTTP 401/403/500, JSON inválido y timeout de cabecera/body.
No son una prueba de interacción en navegador ni una E2E del servidor desplegado.
No se ejecutaron escrituras reales ni cancelaciones, y las pruebas bloquean fetch
real fuera de sus mocks.

El worktree no tenía node_modules. Se leyeron paquetes ya instalados sin
modificarlos; las versiones directas coinciden con package-lock.json y no hay
diferencias de versiones en los 919 registros del lock frente al conjunto usado.
No hubo npm install/ci/upgrade, cambios en package.json/lock ni instalación de
dependencias de pruebas. No se ejecutaron scripts de backend.

El análisis utiliza tsconfig.app.json y resolución de dependencias existentes;
la comparación inicial restaura en memoria los dos archivos originales y excluye
archivos nuevos. La comparación ignora posiciones y conserva archivo/código/mensaje.
TypeScript estricto **ya tenía 35 diagnósticos**. Los resultados finales figuran al
cierre: no se presenta todo el proyecto como libre de errores preexistentes.

Vite carga la configuración original revisada y compila una copia aislada de los
inputs frontend. Dist/cache y configuración generada se escriben en TEMP. El enlace
a dependencias existentes es solo para resolver paquetes; no se compila ni cambia
el código de Work Orders V2. No se copian .env, contexto backend ni credenciales
al entorno de compilación. El build emite el aviso de chunks mayores de 500 kB.
No se ejecutó el script general de Refine ni se desplegó el resultado.

Reproducción en este entorno (las variables de rutas son únicamente del verificador):

```powershell
$env:LEGACY_P2_DEPENDENCIES = 'C:\Proyectos\work_orders\work_orders\node_modules'
$env:LEGACY_P2_STAGE = Join-Path $env:TEMP 'plantel-p2-20261111'
node --test test/inspection-plantel.test.cjs
node tools/check-inspection-p2.cjs baseline-types
node tools/check-inspection-p2.cjs types
node tools/check-inspection-p2.cjs build
git diff --check
```

La comparación baseline requiere los snapshots conservados en esa carpeta TEMP.
Con dependencias normalmente instaladas en Legacy, las pruebas no requieren
LEGACY_P2_DEPENDENCIES. No instalar paquetes para repetir esta tarea sin autorización.
El ejecutor Node y esbuild inicialmente fallaron con spawn EPERM en el sandbox;
se repitieron con aprobación fuera del sandbox, manteniendo los mocks y sin red.

## Validación posterior de interfaz y riesgos

1. Usar interfaz local y datos simulados o lecturas autorizadas. Confirmar revisión
   desplegada antes de extrapolar el contrato local a producción.
2. Buscar en cada ámbito, por ejemplo inspección 7 frente a orden 7 de otra
   inspección; verificar títulos, IDs, folio SAI, cliente, serie e inspector.
3. Combinar con Todas/Abierta/Pendiente/En proceso/Cerrada/Finalizada; limpiar
   búsqueda sin cambiar estado. Revisar contraste, anchura y controles en escritorio
   y pantalla estrecha; esta etapa no rediseña la anchura mínima previa del diálogo.
4. Confirmar mensajes de vacío real, vacío filtrado, HTTP/red/JSON y timeout; el
   botón debe permitir otro intento explícito y no generar reintentos automáticos.
5. Con un cambio de datos de prueba autorizado por separado, actualizar lista y
   detalle y comprobar el mismo inspection_order_id, nuevas tareas/estado e inspector.
   Probar doble pulsación, cierre si desaparece y error sin falsa confirmación de datos frescos.
6. Solicitante debe decir no registrado con el contrato actual. Operador e inspector
   deben conservar sus correos reales en renglones distintos. Probar los criterios
   de LIB001 y LIB002 pendientes/completadas/sin información, combinarlos con estado
   e ID, y comprobar que sin filtro no se consulta Producción. Verificar que un
   error no se convierta en pendiente. El resultado se refiere a Producción actual,
   no al historial de liberación de la inspección.
7. Localizar Cancelar al final del panel izquierdo, **sin pulsarlo contra datos
   reales**. Revisar la propuesta aislada con permiso denegado/ausente, estado no
   cancelable y efectos desconocidos. La ruta actual sigue siendo un riesgo hasta
   que Armando implemente las verificaciones de servidor; no ampliar su acceso.
8. Cuando exista ese contrato, autorizar otra etapa para probar transiciones en
   entorno aislado, con verificación de liberaciones y respuesta real. No se
   realizó esa activación aquí.

Riesgos pendientes principales: diferencia entre API10 local/desplegada,
autorización anterior de cancelación/asignación, solicitante no registrado,
asociación histórica de liberaciones no incluida, volumen del GET global de
Producción al filtrar, diagnósticos TypeScript previos y validación visual real.
Los filtros y etiquetas frontend no sustituyen autorización de API10.

Sin commit, push, deploy, migraciones ni modificaciones de datos reales.

## Resultados finales verificados en el repositorio definitivo

- `node --test test/inspection-plantel.test.cjs`: **70 aprobadas**, 0 fallidas, exit 0.
- TypeScript con `tsconfig.app.json`: **35 diagnósticos iniciales / 33 finales**.
  **0 nuevos**, comparando archivo/código/mensaje; los dos módulos nuevos de
  features no tienen diagnósticos. El proyecto completo conserva errores previos,
  por lo que el gate comparativo aprobado no equivale a un tsc global limpio.
- Compilación Vite final del frontend: **aprobada, exit 0**, con aviso de chunks
  mayores de 500 kB. Salida de validación:
  `C:\Users\SySAdmin\AppData\Local\Temp\plantel-p2-20261111\isolated-build\dist`.
  No se publicó ni se usó esa salida para reemplazar producción.
- `node --check` de los dos archivos de pruebas y del verificador: aprobado.
- `git diff --check`: aprobado. Handler previo de cancelación idéntico al inicial
  tras normalizar finales de línea.
- **68 de los 70 archivos iniciales conservan exactamente su SHA256**. Solo
  `src/pages/Plantel Inspeccion.tsx` y `src/dataProvider.ts` cambian entre los
  iniciales. Contexto API10, configuraciones y package/lock permanecen intactos.
- Los ocho archivos de esta etapa existen en el repositorio Legacy definitivo:
  dos modificados y seis nuevos enumerados arriba. Rama y HEAD iniciales conservados.
- No se realizaron peticiones reales a API10 ni escrituras, cancelaciones,
  instalaciones de dependencias, cambios de permisos, commit, push o deploy.
