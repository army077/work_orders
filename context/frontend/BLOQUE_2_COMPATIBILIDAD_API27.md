# Compatibilidad del frontend con API27 — Bloque 2 offline

Referencia inicial: `b5d2ca26bd2a6a9d1796b21407b481f905a07570`.
No se consultó el servidor ni se ejecutaron SQL, órdenes, inspecciones o entregas.

## Contratos locales utilizados

Las rutas se inspeccionaron en `context/api10/routes/`, fuente local de la
preparación API27. No se presupone que esa copia pruebe el artefacto desplegado:
`context/database/deploy_calidad/19_PLAN_CRUD_API27.md` documenta diferencias de
prefijo/puerto pendientes de conciliación con el administrador.

| Lectura | Contrato de la copia local | Corrección frontend |
| --- | --- | --- |
| `machine-models` | `family_id` opcional, respuesta array | Transmitir solo ese parámetro; validar entero positivo cuando se proporciona |
| `sections` | `template_id` obligatorio, entero positivo hasta 2147483647 | Validar antes de enviar; deshabilitar consultas mientras no hay selección válida |
| `tasks` | `section_id` obligatorio, mismo rango; array ordenado por position | Validar antes de enviar; esperar que sección y plantilla estén asociadas |
| `quality/template_task_inspection` | `section_id` obligatorio; array de puntos ordenado por position | Usarlo para `template_type=INSPECCION`, sin asumir campos de tareas normales |

Refine representa filtros como hojas `{field, operator, value}` y condiciones
`and`/`or`. Models ya suministra `meta.queryParams.family_id`; el proveedor lo
descartaba. Se admiten meta y filtros `eq` equivalentes, incluyendo AND; OR,
operadores incompatibles y valores contradictorios se rechazan localmente.
No se reenvían nombres, sorters, paginación ni otros filtros que las rutas no
implementan. No hay otros filtros de catálogo utilizados actualmente en `src`
fuera de esos tres identificadores.

Una selección todavía ausente deshabilita el hook; una llamada explícita al
proveedor con un ID ausente/incorrecto devuelve error 400 sin HTTP. Los errores
HTTP 400/404 y de red no se transforman en listas vacías. Se conservan los errores
y límites de reintentos de `apiResponse.ts` y el transporte del Bloque 1.

El detalle diferencia tareas (`title`, `code`, `expected_minutes`) de puntos
(`revision_point`, `specs`, `suggestions`, `required`, `category`). Valida IDs,
asociación con sección/plantilla, duplicados y tipos, y ordena por position e ID.
No inventa títulos ni minutos para inspecciones. Los estados vacíos son
respuestas array vacías válidas; los errores se muestran por separado. La carga
en lote tiene cancelación y un límite de 20 segundos; las respuestas anteriores
no deben reemplazar una selección nueva.

## Técnicos: producción compatible; servicio pendiente

`context/api10/routes/quality.js`, GET `/inspectors`, ejecuta `SELECT * FROM
plantilla_tecnicos WHERE puesto = 'Operador de producción' OR puesto =
'Supervisor de calidad'`. No aplica filtro por estatus, no admite parámetros
para ampliar perfiles y no define un orden. Devuelve candidatos de esos perfiles
para calidad, incluyendo operadores, no un catálogo general de técnicos activos.
La ruta no incluye middleware de roles/autenticación en su declaración local;
eso no permite deducir la configuración del proxy del servidor.

Los campos de `plantilla_tecnicos` coinciden en parte con los requeridos por las
pantallas (`id`, `nombre_tecnico`, `correo_tecnico`, `estatus`, `sucursal`,
`puesto`, `telefono`, `nombre_bonos`). La coincidencia de campos no demuestra
cobertura funcional: creación admite también instalación y mantenimiento, y
los selectores actuales muestran técnicos activos sin limitarse a esos dos
puestos. El número 17 del seed no garantiza que `/inspectors` entregue 17 filas
ni que sus candidatos representen todas esas funciones.

El análisis agregado del JSON del seed local, sin ejecutar SQL ni mostrar datos
personales, encontró 17 operadores de producción activos. Esos registros sí
satisfacen el WHERE local; no se afirma que sean la respuesta del servidor.
Eso justifica un uso limitado: Producción y creación de ENSAMBLE leen en TEST
`/quality/inspectors` y ofrecen solo operadores de producción activos. Se excluyen
supervisores de calidad y operadores inactivos; no se fuerzan cantidades. Fuera
de TEST, la lectura API5 conserva su comportamiento anterior.

NO se usa `/quality/inspectors` como sustituto general, NO se añade una ruta
inventada y NO se habilita API5 en TEST. Creación sin plantilla espera la
selección; instalación/mantenimiento muestran el pendiente de catálogo de servicio
y no ejecutan solicitudes de técnicos. Los bloqueos administrativos del Bloque 1
se conservan. La integración de técnicos de servicio requiere aprobación.

Propuesta backend mínima para el catálogo general/de servicio: definir una lectura desde
`plantilla_tecnicos`, sin efectos externos, con contrato aprobado de perfiles
por función (producción/soporte/servicio), estado activo, campos mínimos, orden,
autorización y respuesta array. El nombre de la ruta debe aprobarse antes de
implementarlo; no se modifica ni se reutiliza ambiguamente `/inspectors`.
Después podrá ampliarse únicamente la lectura TEST y probarse con fixtures de
roles, estados y campos nulos. Firebase y las altas externas seguirán bloqueadas.
Si el catálogo aprobado solo contiene operadores, una lectura nueva no aportará
por sí sola técnicos de campo: también debe confirmarse la fuente y cobertura
autorizada para servicio, sin crear ni inferir personas desde el frontend.

## Límites

Las correcciones compartidas son correcciones de lectura justificadas contra
los contratos locales, sin cambiar payloads de negocio ni configuraciones de
producción. La carga XLSX de puntos ahora propaga errores HTTP antes de mostrar
éxito, usando el mecanismo existente; no se ejecutó esa operación.

Los conteos 8/37/51/155/869/2/17 son referencias, no valores forzados en código
ni afirmaciones sobre respuestas reales. No se inició Vite ni se aprobaron
pruebas manuales. Los diagnósticos TypeScript heredados se comparan con HEAD,
sin modificar tsconfig, excluir archivos ni suprimir diagnósticos.

## Validación offline

Comando ejecutado (sin iniciar Vite):

```powershell
node --no-experimental-sqlite --test src/services/apiIsolation.test.mjs src/services/apiResponse.test.mjs src/services/sectionDeletion.test.mjs src/services/catalogCompatibility.test.mjs
```

Resultado: 92/92 pruebas anteriores y 45/45 nuevas, total 137/137 PASS.
Las tres regresiones HTTP 400 anteriores ahora incluyen un padre válido para
alcanzar el backend simulado; los casos de padre ausente/incorrecto se prueban
separadamente y exigen cero solicitudes. Se ejercitan los módulos reales y
efectos de pantallas con HTTP/SDK simulados, incluidos cambio de selección,
errores, timeout, consulta de operadores, roles y comportamiento productivo.

TypeScript: 32 diagnósticos heredados en HEAD y 32 actuales; 0 nuevos por
comparación en memoria, sin emitir archivos. El chequeo global sigue fallando
por esas declaraciones sin usar. `git diff --check` y whitespace de archivos
nuevos: PASS. No se hizo stage, commit, push, deploy ni se modificaron .env,
backend, DB, Firebase o Flutter. La compatibilidad remota sigue sin probarse.
