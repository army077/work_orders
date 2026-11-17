# Work Orders V2: entrega para publicación independiente

Fecha: 13 de noviembre de 2026. Rama `migracion-datos-historicos`, base `e3c4ba2`.

**Build preparado para un entorno restringido de pruebas. No certificado para uso operativo general.**
La preparación original no hizo requests reales de negocio, cambios de backend/DB,
migraciones, copias de datos, E2E real ni despliegue. La entrega para commit y push
de la rama V2 se describe en [PRUEBAS_LOCALES_V2.md](PRUEBAS_LOCALES_V2.md).

## Artefacto y configuración

Carpeta exacta que se debe publicar:

`C:\Proyectos\work_orders\work_orders\dist\v2`

Publicar **su contenido** en `/work-orders-v2/`. No publicar el directorio padre
`dist`, que puede contener artefactos anteriores, ni el repositorio completo.

| Parámetro | Valor del build |
| --- | --- |
| Base Vite y BrowserRouter | `/work-orders-v2/` |
| API principal | `https://desarrollotecnologicoar.com/api27` |
| `VITE_APP_ENV` | `test` (conserva aislamiento existente) |
| `VITE_API10_URL` | URL de API27; el nombre es compatibilidad interna, no el destino API10 |
| API5, administración Firebase/Firestore | Deshabilitadas por los controles TEST existentes |
| Source maps | No incluidos |

`.env.v2` solo contiene configuración pública y se versiona expresamente.
`vite.v2.config.mjs` rechaza otro modo, destino API, entorno o habilitación de API5.
No usar variables `VITE_*` para tokens/contraseñas. Las variables se incorporan
al compilar; no hace falta copiar archivos `.env` al hosting.

El archivo `vite.config.ts`, los scripts originales `build/dev/start`,
`.env.local` y `.env.api27.local` permanecen intactos. La salida `dist/v2` se
limpia de forma independiente; el build no vacía el resto de `dist`.

## Publicación que necesita Armando

1. Usar un directorio estático exclusivo para V2. Conservar el directorio,
   reglas, proceso y destino API10 de `/work-orders/`.
2. Copiar únicamente el contenido de `dist/v2` al directorio V2 autorizado.
3. Servir JS/CSS/imágenes/manifest como archivos reales y aplicar fallback SPA
   a `/work-orders-v2/index.html` para las rutas de la aplicación. Una recarga
   en `/work-orders-v2/plantel-inspeccion` debe devolver ese HTML.
4. Mantener el acceso restringido de pruebas ya autorizado. Un prefijo distinto
   no autoriza usuarios ni reemplaza los controles del backend.
5. Preferir el mismo origen de API27, por ejemplo
   `https://desarrollotecnologicoar.com/work-orders-v2/`. Con otro dominio,
   API27 debe aceptar ese origen por su configuración CORS existente.

Ejemplo Nginx para que Armando adapte **sin ejecutarlo desde esta entrega**:
si copia el contenido del build a `/var/www/work-orders-v2/`, agregar al server
HTTPS correspondiente (sin sustituir las ubicaciones de Legacy):

```nginx
location = /work-orders-v2 {
    return 301 /work-orders-v2/;
}
location ^~ /work-orders-v2/assets/ {
    root /var/www;
    try_files $uri =404;
}
location ^~ /work-orders-v2/ {
    root /var/www;
    try_files $uri $uri/ /work-orders-v2/index.html;
}
```

El control de acceso autorizado debe cubrir las ubicaciones V2 pertinentes.
Este ejemplo no modifica el proxy de API27 ni agrega un sistema de permisos.
Si el servidor usa Apache/IIS, aplicar el mismo fallback limitado al prefijo V2.
Las reglas del servidor real no se verificaron ni se aplicaron en esta tarea.

## Validaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Suites existentes | 227 aprobadas, sin fallos ni omisiones |
| Casos adicionales de flujo V2 | 5 aprobados; total **232** |
| TypeScript completo (`tsc -b`) | Aprobado con strict y reglas de símbolos sin uso originales |
| Sintaxis de configuración/scripts y `git diff --check` | Aprobados |
| Build Vite 5.4.20 | Aprobado, salida `dist/v2` |
| Artefacto | Recursos y manifest válidos bajo V2; API27 presente; sin URLs API10/API5, `.env`, SQL, source maps ni material de claves/credenciales detectado |
| Chrome con el build real | **22 comprobaciones aprobadas**, cero excepciones de ejecución |

Chrome verificó acceso directo y recarga de las diez rutas existentes, navegación
lista → detalle y redirección inicial; también logos y enlaces bajo el prefijo.
Se simularon 41 solicitudes API27, incluidas preflight; se bloquearon 42 solicitudes
externas de recursos. **Cero solicitudes de negocio despachadas**. El servidor
local simula el fallback requerido; esto no certifica el servidor de publicación.

Los mocks cubren visualización y creación de órdenes, tareas de Producción,
solicitud de inspección, asignación, puntos, DONE, liberación y finalización.
Los casos adicionales ejecutan los callbacks reales de Inspección para ensamble
y pintura, conservan sus payloads y comprueban el rechazo 401/403. El backend de
referencia mapea ensamble a LIB001 y pintura a LIB002; no se añadió dependencia
entre ellas ni se cambiaron estados o transiciones. Se conserva FINISHED y la
presentación de los estados existentes. HTTP y SQL de las suites están simulados.

Advertencia no bloqueante del build: bundle principal de aproximadamente 1,91 MB
(594 KB gzip), superior al aviso de 500 KB de Vite. No se amplió el refactor para
introducir división de bundles o dependencias nuevas.

## Autenticación y bloqueo para operación general

Actualización de compatibilidad: se preparó un proveedor opcional central de ID
token para Fetch/Axios, sin conectarlo al arranque. La configuración Firebase
existente es `ordentrabajoar`; su aceptación por Producción/Calidad API27 no está
confirmada. Los detalles y el bloqueo vigente están en
[AUTENTICACION_API27.md](AUTENTICACION_API27.md). La validación actual suma
**253 pruebas aprobadas**, incluidas 21 específicas de autenticación; las 232 de
la tabla anterior corresponden a la entrega inicial de preparación web.

El frontend actual no tiene login/authProvider ni obtiene un Bearer token de una
sesión. El transporte respeta headers suministrados por sus consumidores, pero
las llamadas actuales de Producción/Calidad no proporcionan Authorization. Las
respuestas 401/403 siguen siendo errores; no se añadió bypass ni autorización
por correo, selector de inspector o estado de la interfaz.

**Contrato concreto pendiente de API27:** confirmar qué rutas de órdenes,
Producción y Calidad exigen autenticación, qué sesión existente corresponde a
ellas y cómo obtiene el cliente su token vigente (emisor/audiencia y mecanismo
de sesión/renovación). Si esas rutas exigen Bearer, la web actual no puede
completar operaciones autenticadas hasta conectar esa sesión documentada.
El contrato Firebase de Logística no acredita el de Producción/Calidad y no se
reutilizó por suposición. No se crearon roles, tablas, claims ni usuarios.

No hay un fallo pendiente de compilación o rutas. La autorización del despliegue
real no se verificó contra el servicio. Para uso general falta cerrar el contrato
de sesión/autorización anterior y aceptar el acceso del entorno publicado. El
alcance validado de Producción sigue siendo ENSAMBLE; los catálogos de técnicos
de INSTALACION/MANTENIMIENTO dependientes de API5 siguen bloqueados en TEST.
No se habilitaron como parte de la publicación V2.

## Reproducción local y orden simulada, sin tocar datos

Desde `C:\Proyectos\work_orders\work_orders` (PowerShell):

```powershell
npm.cmd run test:v2
npm.cmd run typecheck
npm.cmd run build:v2
npm.cmd run check:v2
npm.cmd run test:browser:v2
```

El último comando requiere Chrome instalado; admite `CHROME_PATH` si está en
otra ubicación y Node 24 para el CDP/WebSocket y los tests sin aislamiento de
procesos utilizados aquí. Se usó Node 24.19.0 con las dependencias ya instaladas;
no se instalaron paquetes ni se modificó el lockfile.

Para ejecutar únicamente la prueba de orden simulada:

```powershell
node --test --test-isolation=none --test-reporter=spec src/services/v2Workflow.test.mjs
```

La prueba crea en memoria la orden **41**, serie **SIMULADA-SIN-RED**, la lista
mediante el dataProvider real, abre la inspección **98**, asigna inspector,
completa el punto **501**, libera la sección y comprueba FINISHED. Repite el
recorrido por separado para ensamble/LIB001 y pintura/LIB002. También simula
401/403 sin confirmar operaciones denegadas. Los IDs son fixtures en memoria:
no se deben buscar, modificar ni crear con ellos registros en `calidad`.

`test:browser:v2` muestra esa orden simulada en el build real, prueba sus enlaces
y las rutas con API27 interceptada. Para inspección visual manual existen
`dev:v2` (5174) y `preview:v2` (4174), pero **esos comandos apuntan a API27 real**:
no incorporan los mocks del script. Una orden de prueba creada allí persiste en
API27/`calidad`; usar solo los datos acordados con Armando y el recorrido de
[PRUEBAS_LOCALES_V2.md](PRUEBAS_LOCALES_V2.md), sujeto al acceso de API27.

## Archivos de esta entrega

- Configuración: `.env.v2`, `vite.v2.config.mjs`, `package.json`, `.gitignore`.
- Base de rutas y recursos: `src/index.tsx`, `index.html`.
- Limpieza de referencias sin uso para TypeScript, sin cambios de negocio:
  `src/pages/Bonds.tsx`, `CreateWorkOrderFromTemplate.tsx`,
  `Plantel Inspeccion.tsx`, `ProductionHistory.tsx`, `TemplateTasksBuilder.tsx`,
  `Templates.tsx`, `WorkOrderRun.tsx`.
- Verificación: `src/services/v2Workflow.test.mjs`,
  `scripts/check-v2-build.mjs`, `scripts/check-v2-browser.mjs`.
- Entrega: este documento. Build generado/ignorado por Git en `dist/v2`.

Se preservaron los archivos locales preexistentes sin seguimiento: auditorías,
arnés PostgreSQL, journal y los SQL de `src/pages`. No forman parte del build.
