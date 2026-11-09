# Producción → Calidad V2: cierre de primera prueba E2E

Registro de cierre: 2026-11-09. Rama: `migracion-datos-historicos`.
Base del respaldo local: `8c6ae3c`.

## Resultado E2E reportado por el equipo

La primera prueba Producción → Calidad terminó satisfactoriamente usando API27
y PostgreSQL `calidad`. Estos resultados fueron proporcionados por el equipo en
la solicitud de cierre; en esta tarea no se repitió el E2E ni se consultaron las
APIs o la base de datos. La fecha original de ejecución no fue especificada.

| Elemento | Resultado y verificación reportados |
| --- | --- |
| Orden de producción | ID **5**, modelo **ShopPro1325**. |
| Plantilla productiva | ENSAMBLE ID **19**. |
| Plantilla de inspección | INSPECCION ID **131**, publicada, versión **2**. |
| Avance productivo | Actividades completadas desde el Panel de Producción; persistencia comprobada después de recargar. |
| Solicitud de inspección | Creada desde Producción. |
| Inspección | ID **2**, asignada a `miguel.casillas@asiarobotica.com`; estado **FINISHED** confirmado mediante SQL. |
| Liberación productiva | Tarea ID **83**, código **LIB001**, estado **DONE** confirmado mediante SQL. |
| Punto de inspección | ID **2**, estado **DONE** confirmado mediante SQL. |

El respaldo incluye el control de avance, la solicitud de inspección, la
publicación de plantillas desde la interfaz y el catálogo definitivo de cinco
inspectores. El catálogo muestra Miguel Casillas, Iván Cobián, Carlos Rodriguez,
Paulina Correa y Carlos Mercado; cada opción conserva su correo internamente.
Las asignaciones anteriores siguen visibles por correo en el detalle, sin
convertirse en opciones nuevas ni reemplazarse al abrir la inspección.

## Alcance y limitaciones del cierre

Este resultado acredita un primer recorrido E2E exitoso para los registros
indicados; **no constituye una certificación completa para producción**.
No demuestra la cobertura de otros modelos, plantillas, inspectores, LIB002,
usuarios concurrentes o todos los errores y recuperaciones del sistema. Los
casos de error y doble envío cubiertos por las pruebas offline usan simulaciones,
no verificaciones adicionales contra API27 o PostgreSQL. No se adjuntan salidas
SQL ni capturas originales; la evidencia E2E es el reporte del equipo.

El modo `api27` sigue usando `VITE_APP_ENV=test`, el destino exacto
`https://desarrollotecnologicoar.com/api27` y `VITE_API5_ENABLED=false`.
El nombre interno `API10_URL` representa la URL configurada; en TEST apunta a
API27. La configuración local de ese modo se verificó sin incluirla en Git.
Legacy/API10 y el transporte existente permanecen sin modificaciones en este
cierre. No se ejecutaron escrituras de negocio, migraciones, push ni deploy.

## Validaciones del respaldo

- Las siete suites existentes de frontend aprobaron **227 pruebas**, sin fallos,
  cancelaciones ni omisiones. HTTP, SQL y hooks están simulados; no abren
  conexiones a APIs o bases de datos.
- El chequeo TypeScript completo se comparó con HEAD en memoria, sin restaurar
  archivos ni cambiar la configuración: **32 diagnósticos en HEAD y 26 actuales**,
  todos preexistentes de símbolos sin uso (TS6133/TS6196), **cero nuevos**.
  El chequeo estricto aún no está limpio; no se certifica un build de producción.
- El catálogo y los históricos aprobaron **16 escenarios simulados** adicionales:
  cinco opciones exactas, nombres sin correo, valores y envío de correos correctos,
  históricos visibles y ausencia de reasignación automática al abrir o editar.
- El commit contiene únicamente frontend, sus pruebas y esta nota. Se excluyen
  auditorías de base de datos, el arnés PostgreSQL, registros de ejecución, los
  SQL accidentales `src/pages/BEGIN;.sql` y `src/pages/SELECT.sql`, credenciales
  y configuraciones locales. Los archivos excluidos se conservan en disco.

Comando de las suites ejecutadas, sin aislamiento de procesos:

```powershell
node --test --test-isolation=none --test-reporter=spec src/services/apiIsolation.test.mjs src/services/apiResponse.test.mjs src/services/catalogCompatibility.test.mjs src/services/sectionDeletion.test.mjs src/services/productionProgress.test.mjs src/services/inspectionRequest.test.mjs src/services/templatePublication.test.mjs
```

## Notas técnicas de la fase previa al primer E2E

Se conservan las notas originales de implementación y sus verificaciones
offline como referencia histórica. Sus menciones a un E2E pendiente y a fases
sin cambios en plantillas o inspectores describen aquella etapa; el resultado
y alcance actuales son los registrados arriba.

Rama: `migracion-datos-historicos`. HEAD inicial: `8c6ae3c`.

Implementado: finalización de actividades productivas ENSAMBLE y solicitud de
inspección desde el Panel de Producción. La revisión dirigida de `estacion`
confirma que puede omitirse en el contrato local. No se ejecutaron operaciones
E2E ni se crearon órdenes o inspecciones reales.

## Avance productivo

- La lista utiliza `GET /work-orders?include=tasks`; el detalle utiliza
  `GET /work-orders/{work_order_id}?include=tasks`. Las tareas son snapshots de
  `work_order_task`, no los IDs de `template_task`.
- Se conservan los filtros existentes de plantilla ENSAMBLE y operador de
  producción activo. Los operadores se obtienen mediante
  `getProductionTechnicians`: en TEST usa `/quality/inspectors`.
- Cada actividad muestra su ID, código y estado recibido. «Marcar como
  completada» abre una confirmación con minutos reales opcionales.
- La única acción nueva es pasar a `DONE`. La referencia del endpoint no define
  una secuencia de transiciones ni valida el estado anterior; la columna local
  es `VARCHAR`, sin enum ni CHECK de estados. No se inventaron estados
  intermedios, reinicios ni transiciones adicionales.
- LIB001 y LIB002 permanecen visibles y sin controles de avance. También se
  excluyen en el servicio, aunque se invoque fuera de la interfaz. Se valida la
  pertenencia de la tarea a la orden seleccionada y el tipo ENSAMBLE.
- Se bloquean envíos simultáneos con una referencia síncrona, incluso antes del
  siguiente render. No hay reintentos automáticos de escrituras.
- Se comprueba la respuesta antes de confirmar el guardado y luego se recargan
  detalle y lista. Si falla esa recarga, se conserva el DONE confirmado y se
  muestra una advertencia separada del resultado del guardado.
- Se conserva el transporte `fetchApi`/`apiFetch`, su timeout, errores HTTP y
  protección de destinos TEST. El entrypoint revisado no configura un
  `authProvider` ni `accessControlProvider`, y las rutas locales revisadas no
  incorporan middleware de autorización para estas operaciones. No se agregaron
  credenciales, roles ni excepciones de permisos; 401/403 se muestran como error.

Petición implementada:

```http
PUT /work-orders/{id_tarea}/stavance
Content-Type: application/json
```

```json
{
  "status": "DONE",
  "finished_at": "<fecha actual ISO 8601 con Z>",
  "started_at": "<misma fecha, solamente si no hay inicio registrado>",
  "actual_minutes": 17
}
```

`actual_minutes` solo se envía si hay un valor explícito: entero entre 0 y
2147483647, conforme al tipo INTEGER local. Vacío conserva el valor registrado.
El inicio existente se conserva omitiendo `started_at`; el backend usa COALESCE.
Las fechas nuevas se generan con `toISOString()`. No se deduce una duración a
partir de tiempos que no estén registrados.

## Estaciones: parámetro opcional en el contrato local

`estacion` no es obligatoria en el JSON. Se acepta `null` y puede omitirse por
completo. No se exige un entero positivo. Evidencia de la revisión dirigida:

1. `context/api10/routes/quality.js:243`: el POST extrae `estacion` del body sin
   validación de presencia, tipo, signo o catálogo. Si falta, queda `undefined`.
   En las líneas 332–350 la pasa como cuarto parámetro SQL al INSERT.
2. `context/api10/node_modules/pg/lib/utils.js:53`: el cliente instalado convierte
   tanto `undefined` como `null` en SQL NULL mediante `if (val == null) return null`.
   Las pruebas usan esta función real sin abrir conexiones.
3. `context/database/create tables.sql:155`: la columna es
   `estacion INTEGER NULL DEFAULT NULL`, sin CHECK de positividad ni FK a un
   catálogo. El tipo INTEGER sí limita los valores no nulos a su representación
   válida; eso no hace obligatorio enviar uno.
4. `context/api10/routes/quality.js:882` y `:1058`: liberar y finalizar consultan
   `work_order_id`, `inspection_type`, puntos DONE y liberación LIB001/LIB002.
   No leen ni exigen `estacion`. La lista devuelve el campo solo como información.

Los tests ejecutan los handlers locales reales con todas las consultas SQL
simuladas: omisión y null llegan a 201; liberar y finalizar funcionan sin leer
estación. Esto verifica el código local, no una base PostgreSQL ni API27.

El comportamiento del POST sí depende de que exista la orden, no haya una
inspección PENDING/IN_PROGRESS de la misma orden y tipo, exista exactamente una
plantilla INSPECCION publicada del modelo y tipo, y esa sección tenga puntos.
No exige completar previamente las actividades productivas. No se añadió esa
restricción al frontend.

## Solicitud implementada

```http
POST /quality/inspection/request
```

```json
{
  "work_order_id": 41,
  "inspection_type": "Inspección de ensamble"
}
```

41 es únicamente un ejemplo documental; la interfaz usa el ID real seleccionado.
Se omite `estacion` por completo. No hay valor predeterminado, selector de
estaciones ni selector de plantillas; la plantilla la determina el backend.

El nuevo componente consulta el mismo recurso de Calidad,
`quality/inspection/orders_all?include=tasks`. Bloquea una nueva solicitud si hay
una inspección de ensamble PENDING/IN_PROGRESS de esa orden, si la lista no se
puede verificar o mientras una solicitud está en curso. El bloqueo síncrono con
useRef evita el doble clic antes del siguiente render. Tras una creación
confirmada, el botón permanece protegido en esa vista aunque falle la recarga.

Solo confirma creación con HTTP 201 y una respuesta correspondiente a la orden y
tipo solicitados. Refresca el recurso compartido de Calidad; distingue una
creación exitosa con recarga fallida. Muestra errores 404 (orden/plantilla), 409
(inspección activa o plantilla ambigua), 422 (sección sin puntos), permisos y red,
conservando el detalle del backend. Después de un error vuelve a consultar la
lista, para detectar una creación cuya respuesta se haya perdido, sin reintentar
automáticamente el POST. El backend mantiene la autoridad ante otra pestaña o
usuario concurrente mediante su transacción y respuesta 409.

## Pendiente de confirmar con el administrador de API27

Antes del E2E, confirmar que el handler desplegado permite omitir `estacion`,
que el adaptador convierte undefined/null en SQL NULL y que la columna desplegada
sigue permitiendo NULL, sin middleware, CHECK, FK o trigger adicional que exija
una estación. Confirmar también que liberar/finalizar no añadieron esa condición.
La referencia local no acredita esas propiedades del despliegue. No se consultó
API27 ni PostgreSQL para verificarlas y no se cambiaron sus reglas.

## Compatibilidad con Calidad

No se modificó `Plantel Inspeccion.tsx`. Su consulta
`GET /quality/inspection/orders_all?include=tasks` proporciona
`inspection_order_id` y `work_order_id`. El POST de referencia materializa los
puntos en `inspection_order_task`, que es lo que consume ese panel.

La finalización de actividades productivas excluye LIB001/LIB002 y no sustituye
las operaciones existentes de asignación, puntos DONE, liberación LIB001 ni
finalización. El E2E completo con ENSAMBLE sigue pendiente de autorización y de
confirmar la correspondencia del contrato desplegado.

## Archivos y validación

En la fase de resolución de `estacion` se modificaron o añadieron únicamente:
`src/pages/Plantel Producción.tsx`,
`src/pages/components/ProductionInspectionRequest.tsx`,
`src/services/inspectionRequest.ts`, `src/services/inspectionRequest.test.mjs`,
`src/services/productionProgress.test.mjs` (adaptación del test del panel al nuevo
componente) y este informe. La implementación de avance productivo y los
handlers/esquemas permanecen sin cambios respecto de la fase anterior.

Archivos de la integración completa:

- `src/pages/Plantel Producción.tsx`: controles y refresco del panel.
- `src/services/productionProgress.ts`: petición y validaciones de avance.
- `src/services/productionProgress.test.mjs`: pruebas offline de servicio y
  callbacks reales del panel mediante el simulador de hooks usado en las suites
  existentes. No constituyen una prueba visual en navegador ni E2E.
- `src/pages/components/ProductionInspectionRequest.tsx`: control independiente
  de solicitud; no cambia la operación de avance productivo.
- `src/services/inspectionRequest.ts`: petición mínima y verificación de respuesta.
- `src/services/inspectionRequest.test.mjs`: pruebas offline de solicitud,
  duplicados, errores y contrato local de estación, liberación y finalización.
- Este documento: contratos, bloqueo y procedimiento de revisión.

Comandos de validación:

```powershell
node --test src/services/apiIsolation.test.mjs src/services/apiResponse.test.mjs src/services/catalogCompatibility.test.mjs src/services/sectionDeletion.test.mjs src/services/productionProgress.test.mjs src/services/inspectionRequest.test.mjs
.\node_modules\.bin\tsc.cmd --project tsconfig.app.json --noEmit --pretty false
.\node_modules\.bin\tsc.cmd --project tsconfig.app.json --noEmit --pretty false --noUnusedLocals false --noUnusedParameters false
git diff --check
```

Resultados actuales: **199 pruebas aprobadas**, las 166 anteriores y 33 nuevas
de solicitud/contrato; cero fallos y cero pruebas omitidas. HTTP y SQL están
simulados; los handlers reales se ejecutan sin conexiones a bases de datos.
El chequeo de tipos con
las dos reglas de símbolos sin uso desactivadas terminó correctamente, y
`git diff --check` no encontró errores de formato. El chequeo normal conserva los
28 diagnósticos preexistentes en archivos ajenos al cambio y ninguno en los
archivos de implementación afectados. No se ejecutó una compilación de producción.

El chequeo TypeScript normal tenía 32 diagnósticos preexistentes de símbolos sin
uso antes de editar. Se eliminaron los cuatro del archivo de Producción afectado;
no se modificaron los archivos ajenos que contienen los otros 28. El chequeo de
tipos con las dos comprobaciones de símbolos sin uso desactivadas permite
verificar el resto sin cambiar la configuración del repositorio.

No se cambiaron rutas API10, configuración de entornos, backend, Legacy,
Logística, Flutter, plantillas ni bases de datos. `.env.api27.local` continúa
declarando TEST, API27 y API5 deshabilitada. `.env.local` conserva su destino
local; para usar TEST debe seleccionarse expresamente el modo `api27`.
No se instalaron dependencias ni se hicieron migraciones, commit, push o deploy.
Los archivos locales preexistentes sin seguimiento se preservaron.

## Revisión posterior desde la interfaz

Solo después de autorizar las escrituras de prueba:

1. Iniciar con `npm run dev -- --mode api27` y confirmar que se está usando TEST.
2. Abrir Panel de Producción, seleccionar una orden ENSAMBLE compatible
   previamente autorizada y comprobar los IDs y códigos de sus actividades.
3. En una actividad productiva, pulsar «Marcar como completada». Introducir
   minutos enteros o dejar vacío para conservarlos, y confirmar.
4. Comprobar DONE, fecha, actualización de lista y ausencia de un segundo envío
   al hacer doble clic. Verificar que LIB001/LIB002 no ofrecen el botón.
5. Para revisar errores o fallos de recarga, usar los tests offline; no alterar
   datos de negocio para forzar esos escenarios.
6. Pulsar «Solicitar inspección de ensamble» en la orden seleccionada. Comprobar
   que el body solo contiene work_order_id e inspection_type, que no exige una
   estación ni exige todas las actividades DONE, y que confirma tras recibir 201.
7. Comprobar que la inspección aparece en Calidad y el botón impide duplicarla
   mientras esté activa, antes de continuar con asignación, puntos, liberación
   y finalización. No se ejecutaron estos pasos durante la implementación.
