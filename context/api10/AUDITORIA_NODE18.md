# Auditoría Node 18.19.1 — API10

Fecha: 2026-10-22. Baseline del lock: HEAD b4b4b812fd7d645a40e54f8874150516d7677713.
Runtime fijo del servidor: **v18.19.1**. No se actualizó Node global ni producción.

## Árbol completo y método

El lock inicial contiene 275 paquetes: 24 entradas incompatibles con 18.19.1.
El lock final contiene 309: 211 runtime requeridos, 98 ramas runtime opcionales y 0 exclusivamente dev.
Los JSON versionados tests/engines_node18_original.json y tests/engines_node18_final.json
incluyen cada paquete, versión, engine, padres, clasificación y resultado, no solo directas.
scripts/audit_node18_engines.cjs recorre dependencies, optionalDependencies y peers
instalados desde la raíz runtime; comprueba rangos con semver contra 18.19.1.
Paquetes dev-only quedan separados; ramas opcionales incompatibles también hacen fallar
la auditoría aunque la aplicación no las use. Paquetes sin engines se identifican como
tales: su compatibilidad no se deduce solo de esa ausencia, se prueba install/import/uso.
Semver se declara como herramienta dev y también es requerido por jsonwebtoken en runtime;
por eso permanece instalado con --omit=dev. No se cuenta falsamente como dev-only.

Se cambiaron tres dependencias directas: firebase-admin, file-type y googleapis.
Dos overrides acotados dentro del rango SDK 13 fijan @firebase/database-compat 2.0.11
y @firebase/database-types 1.0.15. Sus rangos originales admitían actualizaciones de
@firebase/util/logger/component que exigen Node 20. No se ignoran esas engines.

## Incompatibilidades iniciales

Candidata = última versión estable cuyo engine admite 18.19.1 según metadatos npm.
No equivale a forzar la última major en todos los padres: final conserva las ramas
compatibles declaradas por el SDK para minimizar cambios. Todos los finales pasan
la auditoría completa. Padres y paths exactos se conservan en los JSON.

| Paquete | Inicial | Engine inicial | Tipo | Introducido por | Uso API10 | Candidata Node18 | Final resuelto | Cambios relevantes |
|---|---|---|---|---|---|---|---|---|
| @firebase/component | 0.7.5 | >=20.0.0 | transitiva requerida | @firebase/database, @firebase/database-compat | Rama RTDB instalada del SDK; API10 no invoca Realtime Database | 0.6.18 | 0.6.18 | Pins dentro de rangos SDK 13; RTDB no se usa |
| @firebase/database | 1.1.5 | >=20.0.0 | transitiva requerida | @firebase/database-compat | Rama RTDB instalada del SDK; API10 no invoca Realtime Database | 1.0.20 | 1.0.20 | Pins dentro de rangos SDK 13; RTDB no se usa |
| @firebase/database-compat | 2.1.7 | >=20.0.0 | transitiva requerida | firebase-admin | Rama RTDB instalada del SDK; API10 no invoca Realtime Database | 2.0.11 | 2.0.11 | Pins dentro de rangos SDK 13; RTDB no se usa |
| @firebase/logger | 0.5.2 | >=20.0.0 | transitiva requerida | @firebase/app-types, @firebase/database, @firebase/database-compat | Rama RTDB instalada del SDK; API10 no invoca Realtime Database | 0.4.4 | 0.4.4 | Pins dentro de rangos SDK 13; RTDB no se usa |
| @firebase/util | 1.15.3 | >=20.0.0 | transitiva requerida | @firebase/component, @firebase/database, @firebase/database-compat, @firebase/database-types | Rama RTDB instalada del SDK; API10 no invoca Realtime Database | 1.12.1 | 1.12.1 | Pins dentro de rangos SDK 13; RTDB no se usa |
| @google-cloud/firestore | 9.3.1 | >=22 | transitiva opcional instalada | firebase-admin | Rama opcional Firestore/Storage instalada; API10 no la invoca | 8.7.1 | 7.11.6 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| @google-cloud/paginator | 7.2.0 | >=22 | transitiva opcional instalada | @google-cloud/storage | Rama opcional Firestore/Storage instalada; API10 no la invoca | 6.1.0 | 5.0.2 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| @google-cloud/projectify | 6.2.0 | >=22 | transitiva opcional instalada | @google-cloud/storage | Rama opcional Firestore/Storage instalada; API10 no la invoca | 5.2.0 | 4.0.0 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| @google-cloud/promisify | 6.2.0 | >=22 | transitiva opcional instalada | @google-cloud/storage | Rama opcional Firestore/Storage instalada; API10 no la invoca | 5.1.0 | 4.0.0 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| @google-cloud/storage | 8.4.0 | >=22 | transitiva opcional instalada | firebase-admin | Rama opcional Firestore/Storage instalada; API10 no la invoca | 7.22.0 | 7.22.0 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| file-type | 22.2.0 | >=22 | directa | ROOT | Detección real de evidencias desde bytes | 20.5.0 | 20.5.0 | 22 → 20: ESM + fileTypeFromBuffer se conservan; no se usa detección de streams |
| firebase-admin | 14.5.0 | >=22 | directa | ROOT | ADC + verifyIdToken; endpoints modulares app/auth | 13.10.0 | 13.10.0 | 14 → 13: conserva APIs modulares/ADC; no se usan novedades de 14 |
| gcp-metadata | 9.2.0 | >=22 | transitiva requerida | google-auth-library | Infraestructura ADC/OAuth/HTTP de Firebase y Drive | 8.1.4 | 6.1.1, 8.1.2 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| google-auth-library | 11.3.0 | >=22 | transitiva requerida | @google-cloud/storage, firebase-admin, google-gax, googleapis, googleapis-common | Infraestructura ADC/OAuth/HTTP de Firebase y Drive | 10.9.1 | 9.15.1, 10.9.1, 10.5.0 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| google-gax | 6.12.1 | >=22 | transitiva opcional instalada | @google-cloud/firestore | Rama opcional Firestore/Storage instalada; API10 no la invoca | 5.0.8 | 4.6.1 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| google-logging-utils | 2.1.0 | >=22 | transitiva requerida | gcp-metadata, google-auth-library, google-gax, googleapis-common | Infraestructura ADC/OAuth/HTTP de Firebase y Drive | 1.2.0 | 0.0.2, 1.1.3 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| googleapis | 186.0.0 | >=22.0.0 | directa | ROOT | Drive v3 + OAuth2 refresh | 178.0.0 | 178.0.0 | 186 → 178: Drive v3/OAuth2 conservados; otros productos no se utilizan |
| googleapis-common | 9.3.1 | >=22 | transitiva requerida | googleapis | Infraestructura ADC/OAuth/HTTP de Firebase y Drive | 8.0.3 | 8.0.3 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| gaxios | 8.3.1 | >=22 | transitiva requerida | googleapis-common | Infraestructura ADC/OAuth/HTTP de Firebase y Drive | 7.3.1 | 6.7.1, 7.3.1, 7.1.3 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| jwks-rsa | 4.1.0 | ^20.19.0 \|\| ^22.12.0 \|\| >= 23.0.0 | transitiva requerida | firebase-admin | Dependencia SDK de claves/caché; ID token usa x509 en este flujo | 3.2.2 | 3.2.2 | Rama compatible SDK 13; no se llama su API directamente |
| lru-cache | 11.5.3 | 20 \|\| >=22 | transitiva requerida | jwks-rsa, lru-memoizer | Dependencia SDK de claves/caché; ID token usa x509 en este flujo | 10.4.3 | 6.0.0, 10.4.3 | Rama compatible SDK 13; no se llama su API directamente |
| proto3-json-serializer | 4.1.0 | >=22 | transitiva opcional instalada | google-gax | Rama opcional Firestore/Storage instalada; API10 no la invoca | 3.0.6 | 2.0.2 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| retry-request | 9.1.0 | >=22 | transitiva opcional instalada | @google-cloud/storage, google-gax | Rama opcional Firestore/Storage instalada; API10 no la invoca | 8.0.4 | 7.0.2 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |
| teeny-request | 11.1.0 | >=22 | transitiva opcional instalada | @google-cloud/storage | Rama opcional Firestore/Storage instalada; API10 no la invoca | 10.1.4 | 9.0.0 | Rama compatible resuelta por sus padres; no se cambia una API directa de API10 |

## Directas conservadas y versiones finales

| Paquete | Versión final | Resultado |
|---|---|---|
| cors | 2.8.6 | engine compatible; probado en Node18 |
| express | 4.22.3 | engine compatible; probado en Node18 |
| file-type | 20.5.0 | engine compatible; probado en Node18 |
| firebase-admin | 13.10.0 | engine compatible; probado en Node18 |
| googleapis | 178.0.0 | engine compatible; probado en Node18 |
| multer | 2.4.0 | engine compatible; probado en Node18 |
| pg | 8.23.1 | engine compatible; probado en Node18 |

Express permanece en 4.x para evitar una migración no requerida a 5.x. Multer 2.4.0
y pg 8.23.1 ya son compatibles y no precisaron cambios. google-auth-library queda en
ramas 9.x/10.x compatibles de sus padres; no se instala la 11.x incompatible.

## Verificación reproducible aislada

Se descargó el ZIP oficial node-v18.19.1-win-x64.zip a runtime-node18.local,
se verificó SHA-256 contra SHASUMS256.txt oficial y se usó su npm 10.2.4.
Ese directorio/caché y node_modules están ignorados; no se cambió PATH global.
Se comprobaron npm ci completo y npm ci --omit=dev, ambos con engine-strict.
La instalación productiva no emitió incompatibilidades de engines. .npmrc mantiene
engine-strict=true y package.json declara el target exacto, sin force ni opciones
para saltar engines/peers. La prueba se realizó en Windows; el deploy Ubuntu
debe repetir el mismo npm ci con su binario 18.19.1, sin acceso desde esta tarea.

Reproducción con Node 18.19.1 en el PATH del proceso, desde context/api10:

```bash
node --version
npm ci --omit=dev --engine-strict
npm run audit:node18
npm ci --engine-strict
npm run test:evidence
```

Las suites existentes cubren create/evidence/completion/list/history/ownership y Drive
con dobles. node18Compatibility añade el SDK real Firebase con firmas RSA verificadas,
rechazo de aud/exp inválidos, applicationDefault con descubrimiento simulado y refresh
OAuth2 por transporte mock. Usa el cliente real googleapis/Drive, OAuth refresh mock
y petición generada real. No se usa Firebase Auth emulator para simular aceptación
de tokens sin firma. La allowlist real se ejecuta con pool falso, sin SQL real.
La detección MIME real conserva import ESM/fileTypeFromBuffer y bytes JPEG/PNG/WEBP;
multipart, SHA-256 y streams/buffers se ejercitan con Multer/Node reales.
API10 arranca y responde health 200 sobre loopback con configuración TEST,
mientras un preload bloquea todas las conexiones salientes del proceso.
Las integraciones DB siguen SKIP; no se escriben Firebase/Drive ni DB reales.

## Seguridad y límites

npm audit productivo informa 9 vulnerabilidades moderadas propagadas, 0 altas y
0 críticas. No se ocultan ni equivalen a fallos de engines. Las ramas opcionales
Firestore/Storage no usadas arrastran uuid y avisos de sus wrappers. No se forzaron
majors transitivas fuera del contrato del SDK para fingir un audit limpio.
file-type 20.5.0 es la última rama admitida por Node18 y tiene avisos ASF/ZIP.
Se bloquean por magic bytes todos los formatos salvo JPEG/PNG/WEBP **antes** de
invocar el detector; la detección MIME real sigue siendo obligatoria después.
Los límites 10 MiB/2 MiB siguen activos. Se añadieron pruebas de rechazo ASF/ZIP
con MIME falso. Esta mitigación de alcance no convierte el paquete en una
versión upstream parcheada ni elimina los avisos del lock. Revisar el riesgo
residual antes del deploy. Node18.19.1 es una restricción aceptada del servidor;
compatibilidad funcional no significa que ese runtime antiguo reciba parches.
Se recomienda planificar una actualización futura de Node como deuda técnica,
en un trabajo separado; este cutover conserva la restricción actual del servidor.

## Fuentes primarias consultadas

- [Firebase Admin: versiones 13/14 y soporte Node](https://firebase.google.com/support/release-notes/admin/node).
- [Metadatos npm Firebase Admin 13.10.0](https://registry.npmjs.org/firebase-admin/13.10.0).
- [Metadatos npm file-type 20.5.0](https://registry.npmjs.org/file-type/20.5.0).
- [Metadatos npm googleapis 178.0.0](https://registry.npmjs.org/googleapis/178.0.0).
- [Distribución oficial Node 18.19.1](https://nodejs.org/dist/v18.19.1/).
- [Advisory ASF](https://github.com/sindresorhus/file-type/security/advisories/GHSA-5v7r-6r5c-r473).
- [Advisory ZIP](https://github.com/sindresorhus/file-type/security/advisories/GHSA-j47w-4g3g-c36v).

No stage, commit, push, deploy, conexiones productivas ni SQL ejecutado en esta adaptación.
