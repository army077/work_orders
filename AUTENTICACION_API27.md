# Autenticación API27: preparación mínima

13 de noviembre de 2026. Rama `migracion-datos-historicos`.

## Resultado y bloqueo concreto

No hay una sesión reutilizable **confirmada** para Producción/Calidad en V2.
`src/firebase/firebase-config.ts` configura el proyecto **ordentrabajoar** y
exporta Auth/Firestore, pero el arranque de V2 no lo importa ni implementa login,
restauración de sesión o un authProvider. Sus usos existentes son administración
de operadores, deshabilitada por los controles TEST de V2. No se leyó el
almacenamiento del navegador ni se obtuvo un token real.

La referencia local de Bearer en API27 corresponde a **Logística** y exige
**logistica-ar**. Las rutas locales de órdenes/Calidad no documentan ese mismo
contrato. No se puede asumir que ordentrabajoar sea aceptado, ni trasladar el
contrato de Logística a Producción/Calidad. La referencia local tampoco confirma
el middleware del servicio desplegado; no se sondeó API27.

Para conectar una sesión falta que el responsable de API27 confirme:

1. Proyecto Firebase y audiencia/emisor aceptados para las rutas de órdenes,
   Producción y Calidad, y cuáles requieren Bearer.
2. La instancia/sesión de usuario existente que debe proporcionar el ID token
   desde esta web y cómo accede V2 a ella. Configurar un SDK no demuestra que
   exista una sesión iniciada en este origen.
3. El contrato existente de autorización de esas rutas para dicha identidad.
   No se proponen roles, claims o tablas nuevos.

**Bearer no se activó en el arranque ni en el build entregado.** Se preparó el
soporte independiente y se probó con mocks. V2 continúa preparada para publicación
restringida de pruebas; la operación autenticada/general sigue bloqueada por el
contrato anterior. No se interpreta un prefijo web diferente como autorización.

## Componentes preparados, sin login nuevo

- `src/services/api27Auth.ts`: adaptador sin inicialización de Firebase. Recibe
  una sesión existente y un projectId confirmado explícitamente; rechaza una
  discrepancia, espera `authStateReady()` y solicita `currentUser.getIdToken()`.
- `src/services/apiTransport.ts`: punto central opcional para Fetch y Axios.
  Una vez registrado el proveedor, adjunta `Authorization: Bearer` solo después
  de validar el destino API27. No requiere modificar pantallas.
- `src/services/apiResponse.ts`: conserva el 401 local de sesión ausente/expirada
  en lugar de convertirlo en un fallo de red. Su política de reintentos existente
  no reintenta 401/403.

La conexión futura, únicamente con esos datos confirmados, será registrar
`createFirebaseIdTokenProvider(sesionExistente, proyectoConfirmado)` mediante
`setApi27TokenProvider`. Actualmente no hay ninguna llamada de registro en la
aplicación. Los nombres anteriores representan datos pendientes, no credenciales
ni un proyecto predeterminado. No se agregaron flags de activación o tokens en env.

El SDK instalado documenta que getIdToken renueva un token vencido o próximo a
vencer. El adaptador no mantiene su propia caché ni lee refresh tokens. Si falla
la restauración/renovación, falta usuario/token o cambia la sesión durante la
espera, falla con 401 antes de enviar HTTP. Con el proveedor configurado no hay
fallback anónimo. Una sesión cerrada se representa por currentUser=null dentro
del proveedor; no se debe desconfigurar el proveedor para tratar la expiración.
Sin configurar un proveedor se conserva el comportamiento anterior de V2.

No hay reintentos automáticos de escrituras ni ciclos de refresh ante 401/403.
El backend conserva la autoridad. Se preservan payloads, métodos, estados,
aislamiento de destinos y bloqueo de redirects. Local/production no pueden
registrar este proveedor API27 y conservan sus transportes anteriores.

No se registran ni persisten tokens. Se descartan errores originales del SDK y
los errores Axios de solicitudes autenticadas que contienen config/request con
headers; se conserva el status HTTP mediante un error seguro para los logs de
las pantallas. Los fallos de red Fetch también se sanitizan, conservando la
clasificación de timeout. No se cambia el contrato de respuestas de negocio.

## Validación

- **253 pruebas aprobadas**: 232 previas y 21 específicas de autenticación.
- La suite de orden simulada ahora inyecta el proveedor exclusivamente dentro
  del mock: verifica creación/listado, asignación, puntos DONE, liberaciones
  LIB001/LIB002 y finalización con los mismos callbacks y payloads.
- Casos Auth: usuario/token disponible, restauración pendiente, renovación SDK
  simulada, ausencia de usuario/token, sesión expirada, cambio de usuario,
  proyecto incompatible, HTTP 401/403, timeout, errores sanitizados, destinos
  prohibidos y conservación de clientes local/production.
- TypeScript estricto y build Vite repetidos; salida `dist/v2`.
- Artefacto comprobado sin secretos detectados ni URLs API10/API5. Chrome:
  **22 comprobaciones aprobadas**, sin excepciones y con cero solicitudes de
  negocio despachadas. Se conservan `/work-orders-v2/` y el destino API27.
- Sin cambios de pantallas, Firebase Console, backend, PostgreSQL, roles, claims,
  login, dependencias ni despliegue. No se ejecutaron escrituras reales.

Comandos desde el repositorio:

```powershell
node --test --test-isolation=none --test-reporter=spec src/services/api27Auth.test.mjs
npm.cmd run test:v2
npm.cmd run build:v2
npm.cmd run check:v2
npm.cmd run test:browser:v2
```

Los tests usan sesiones y HTTP simulados. La comprobación de navegador bloquea
la red de negocio; `dev:v2` y `preview:v2` normales siguen apuntando a API27 real.
