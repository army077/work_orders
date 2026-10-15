# Documentacion de Ingenieria (API10)

## Alcance

Catalogo independiente `maquinas_normalizado`, sin relacion con `machine_model`.
Un documento de instalacion exitosa por maquina, con revisiones numeradas y bitacora.
No modifica ordenes, plantillas ni los catalogos existentes.

Se registra `pdf_url`; no se suben archivos ni se consulta el contenido remoto desde la API.
Se aceptan enlaces HTTP/HTTPS sin credenciales, incluidos links sin extension `.pdf`.
Ingenieria debe proporcionar el enlace al archivo individual y comprobar su contenido y acceso.
Para que una revision sea reproducible, el archivo externo debe ser inmutable y cada revision
debe tener su propio enlace. El sistema no evita que alguien reemplace un archivo en Drive.
Algunos proveedores bloquean el iframe o requieren sesion: usar el enlace externo en ese caso.

**Por decision de alcance, los permisos estan pendientes.** No hay autenticacion ni autorizacion
en estas rutas. `actor` es un nombre/correo declarado, no una identidad verificada.
No publicar estas rutas en una red no confiable como si fueran exclusivas de Ingenieria.
La futura autenticacion debe obtener el actor de la sesion validada en el servidor.

## Despliegue

1. Respaldar la base de datos.
2. Ejecutar una sola vez la migracion PostgreSQL
   [engineering_documents.sql](../database/engineering_documents.sql) con el mecanismo habitual
   de administracion de la base. Es una migracion transaccional independiente; no ejecutar de
   nuevo el archivo antiguo `create tables.sql`. No se ejecuta automaticamente al iniciar.
3. Desplegar la ruta [engineering.js](routes/engineering.js), el montaje en
   [server.js](server.js), y los manifiestos de API10.
4. En el directorio de API10: `npm ci --omit=dev` y reiniciar el servicio.
   Verificar la configuracion existente de conexion de `db.js` en el entorno de despliegue.
5. Desplegar el frontend. Por defecto utiliza la API configurada en `dataProvider`.
   Para otro entorno definir `VITE_API10_URL` antes de compilar, sin barra final,
   por ejemplo `http://localhost:3010/api10`.
6. Abrir `/engineering-documents`, crear las maquinas y registrar sus manuales y revisiones.

No se importan automaticamente los links del CSV: son carpetas, no PDFs versionados,
y no determinan cual revision es vigente.

## API

Prefijo: `/api10/engineering`. Respuestas JSON; errores con `{ "error": "..." }`.

| Metodo | Ruta | Funcion |
|---|---|---|
| GET / POST | `/machines` | Listar / crear maquinas normalizadas |
| PUT | `/machines/:id` | Editar nombre, descripcion y estado activo |
| GET | `/machines/:id/events` | Bitacora completa de la maquina |
| GET / POST | `/documents` | Listar / crear fichas documentales |
| GET / PUT | `/documents/:id` | Detalle con versiones y eventos / editar codigo y titulo |
| POST | `/documents/:id/versions` | Registrar link como nueva revision borrador |
| PUT | `/versions/:id` | Editar solamente un borrador |
| POST | `/versions/:id/publish` | Publicar borrador y volver obsoleta la vigente anterior |
| POST | `/versions/:id/retire` | Dar de baja con motivo, conservando PDF e historial |

Todas las escrituras requieren `actor` (1 a 200 caracteres).
Crear maquina: `name`, `description` opcional.
Crear documento: `maquina_id`, `code`, `title`.
Crear/editar revision: `pdf_url`, `change_summary`.
Dar de baja: `reason`.
Editar maquina: `name`, `description`, `is_active` booleano.
Editar registros, publicar y retirar requieren `updated_at` de la lectura previa:
un registro modificado devuelve 409 y debe recargarse antes de reintentar.
La relacion documento-maquina no se cambia; evita reasignar el historial a otro equipo.

Los cambios y eventos se guardan en una transaccion. La publicacion bloquea maquina y
documento, y un indice unico parcial garantiza una sola revision vigente por documento.
Una revision publicada no se puede editar ni republicar; se crea otra revision.
No se puede publicar un borrador anterior a una revision ya publicada, aun si esta fue retirada.
Se puede retirar un borrador, una vigente o una obsoleta; no hay borrado fisico.
Retirar la vigente no activa automaticamente otra revision.
No se puede desactivar una maquina con manual vigente ni crear/publicar revisiones de maquinas inactivas.

La bitacora almacena datos antes/despues y responsable declarado de cada escritura.
No se exponen endpoints para editar o eliminar eventos.

## Verificacion

En este directorio: `npm ci` y `npm test`.
Las pruebas usan `node:test` y PostgreSQL en memoria (PGlite), sin conexiones ni cambios
en bases existentes. Ejecutan la migracion real, restricciones, rutas HTTP, control de
actualizaciones, estados y rollback si falla la bitacora.
El adaptador de pruebas serializa transacciones por la unica conexion de PGlite;
no sustituye una prueba de carga/concurrencia en PostgreSQL del entorno final.

Frontend desde la raiz del repositorio: `npm run build`.
Para comprobacion estricta del proyecto TypeScript: `npx tsc -b --pretty false`.
