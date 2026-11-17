# Pruebas locales de Work Orders V2

Rama principal: `main`. La rama histórica `migracion-datos-historicos` se conserva.
Requiere Git, Node.js 24 y npm.
Resultados de esta integración: [INTEGRACION_V2_MAIN.md](INTEGRACION_V2_MAIN.md).
Los comandos siguientes son para PowerShell; usar `npm` en lugar de `npm.cmd`
en Linux/macOS. No es necesario instalar ni administrar PostgreSQL o las APIs.

## Descargar e iniciar

Desde una carpeta donde no exista `work_orders_v2`:

```powershell
git clone --single-branch --branch main https://github.com/army077/work_orders.git work_orders_v2
cd work_orders_v2
git branch --show-current
npm.cmd ci
npm.cmd run dev:v2
```

Abrir **http://127.0.0.1:5174/work-orders-v2/**. El puerto es estricto: si está
ocupado, Vite falla en lugar de elegir otro. Este clon independiente no modifica
otros checkouts que puedan existir en otra carpeta. Para actualizarlo después,
detener Vite y, desde este mismo clon y rama, ejecutar:

```powershell
git pull --ff-only origin main
npm.cmd ci
npm.cmd run dev:v2
```

## Variables de entorno

`.env.v2` está incluido como configuración pública de ejemplo, lista para usar:

```dotenv
VITE_APP_ENV=test
VITE_API10_URL=https://desarrollotecnologicoar.com/api27
VITE_API5_ENABLED=false
VITE_API5_URL=
```

`VITE_API10_URL` conserva un nombre interno por compatibilidad; el destino real
es **API27**. No copiar `.env.example` (es del entorno anterior), `.env.local`
ni archivos privados de otro checkout. No se necesitan tokens ni contraseñas en
archivos env. No definir variables `VITE_*` distintas en la terminal ni crear
`.env.v2.local` con otros destinos: la configuración V2 rechaza esos cambios.

`dev:v2` usa `vite.v2.config.mjs --mode v2`, carga `.env.v2`, deshabilita API5 y
sirve las rutas bajo `/work-orders-v2/`. Conexión directa desde el navegador a
API27: su disponibilidad, CORS para `http://127.0.0.1:5174` y autorización deben
permitirla; no hay proxy ni sesión local inventada.

## Pruebas existentes y build

```powershell
npm.cmd run test:v2
node --test --test-isolation=none --test-reporter=spec test/inspection-plantel.test.cjs
npm.cmd run build:v2
npm.cmd run check:v2
npm.cmd run test:browser:v2
```

`build:v2` ya ejecuta `typecheck` antes de Vite y genera `dist/v2`, ignorado por
Git. Para comprobar solo TypeScript: `npm.cmd run typecheck`.
`npm.cmd ci` incluye la dependencia de desarrollo `pg` para las pruebas de
contrato con SQL simulado; no hace falta instalar ni iniciar API10 o PostgreSQL.
`check:v2` y `test:browser:v2` necesitan el build previo. El último requiere
Chrome; si no está en `C:/Program Files/Google/Chrome/Application/chrome.exe`,
definir `CHROME_PATH` con la ruta al ejecutable instalado.

Para abrir el build en lugar del servidor de desarrollo:

```powershell
npm.cmd run preview:v2
```

URL: **http://127.0.0.1:4174/work-orders-v2/** (también conecta a API27 real).

Validación de la rama V2 original: **253 pruebas automatizadas**, TypeScript y build
correctos, y **22 comprobaciones de navegador**. Las suites usan HTTP/sesiones
simulados; el navegador automatizado intercepta API27 y bloquea las demás
solicitudes externas. No necesitan autenticación real ni escriben en `calidad`.
Cubren aislamiento, catálogos, plantillas, creación/listado, avance productivo,
solicitud de inspección, asignación, puntos, liberaciones y rechazos 401/403.
El navegador comprueba rutas, recargas y navegación; no ejecuta todo el flujo
manual de escrituras.

La integración conserva además los filtros/búsqueda de Inspección y la pantalla
de Documentación de Ingeniería existentes en `main`; sus llamadas usan ahora la
misma configuración y transporte API27. Las rutas de Ingeniería en API27 no se
han comprobado contra el servicio real: esta entrega no publica sus rutas backend.

Para ejecutar únicamente la orden simulada en memoria, sin red:

```powershell
node --test --test-isolation=none --test-reporter=spec src/services/v2Workflow.test.mjs
```

## Recorrido manual con Armando

El servidor `dev:v2` no incluye los mocks de las suites. Una orden de prueba
creada allí es un registro persistente de API27/`calidad`. Hacer este recorrido
con los datos de prueba acordados con Armando y solo cuando el acceso de API27
lo permita; para una simulación sin persistencia usar el comando anterior.

1. Abrir **Crear orden de trabajo** (`/work-orders-v2/create-work-order`).
   Elegir una plantilla publicada de tipo **ENSAMBLE** y su modelo acordado;
   usar una serie única como `PRUEBA-V2-ARMANDO-AAAAMMDD-01`. Seleccionar un
   técnico existente de Producción y completar los campos aplicables. Pulsar
   **Crear orden de trabajo**, confirmar y anotar el ID devuelto. No reutilizar
   IDs de las suites ni órdenes reales existentes.
2. Abrir **Panel de Producción** (`/work-orders-v2/plantel-produccion`), localizar
   esa serie y abrir el detalle. Por cada actividad productiva pendiente, pulsar
   **Marcar como completada**, introducir minutos enteros si corresponde y
   **Confirmar actividad completada**. Recargar y comprobar que conserva `DONE`.
   Las tareas **Liberación por Calidad** se completan por el flujo de Calidad;
   no se marcan desde Producción.
3. En el detalle pulsar **Solicitar inspección de ensamble**. Requiere una
   plantilla de inspección publicada y compatible. Anotar el ID confirmado;
   si ya existe una inspección activa, consultar esa inspección y no duplicarla.
4. Abrir **Panel de Inspección** (`/work-orders-v2/plantel-inspeccion`), localizar
   la inspección de la misma orden y comprobar sus puntos y estado. Si se acuerda
   extender la prueba, usar los controles existentes de asignación, puntos,
   liberación y finalización, respetando sus validaciones y respuestas backend.

Si faltan catálogos/plantillas o aparece 401/403, registrar el paso y el error;
no cambiar estados, fabricar sesiones, inyectar tokens ni desactivar controles
para continuar. Los catálogos de INSTALACION/MANTENIMIENTO que dependen de API5
y la administración externa de técnicos siguen deshabilitados en TEST.

## Límite actual de autenticación

El adaptador Bearer está preparado y **sin activar**. V2 no implementa login ni
obtiene un token de sesión al arrancar. Falta confirmar el contrato de sesión,
emisor/audiencia y autorización de Producción/Calidad en API27. Por tanto, las
lecturas y escrituras manuales protegidas no podrán completarse si API27 exige
Bearer; tampoco está confirmada aquí su política CORS para los orígenes locales.
No hay bypass. Ver [AUTENTICACION_API27.md](AUTENTICACION_API27.md).

**No hay que tocar API10, API12, la base `artecnologia` ni Legacy.** Esta entrega
no requiere desplegar cambios de API27, ejecutar SQL ni migrar/copiar datos.
Para detalles del artefacto independiente: [DESPLIEGUE_V2.md](DESPLIEGUE_V2.md).
