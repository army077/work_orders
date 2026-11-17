# Evidencias de entregas: pruebas locales

Pruebas aisladas con Node 18.19.1, sin credenciales ni conexiones productivas:

```powershell
cd context/api10
npm.cmd run test:evidence
```

El script deshabilita las dos integraciones DB. Los repositorios usan pools
simulados; multipart usa streams reales en memoria. Las pruebas de compatibilidad
ejercitan Firebase SDK/ADC/verifyIdToken y OAuth/Drive con descubrimiento y
transportes simulados. El smoke de arranque importa server.js en un proceso TEST,
abre solo el HTTP de loopback y bloquea las conexiones salientes: health debe dar
200 sin contactar DB ni Google. Los identificadores TEST_ONLY_* son ficticios.

Instalar con npm ci y engine-strict bajo Node 18.19.1; no usar --test-isolation
ni --env-file, que no están disponibles en ese runtime. Para el servidor LOCAL
se proporciona npm run start:local con un cargador restringido de .env.local.
Auditoría completa: [AUDITORIA_NODE18.md](../AUDITORIA_NODE18.md).

La detección de tipo revisa firmas binarias, no decodifica ni certifica que una
imagen sea íntegra. Los tamaños se limitan a 10 MiB (PHOTO) y 2 MiB (SIGNATURE).
Se normalizan aliases MIME de JPEG/PNG; se rechazan los formatos incompatibles.
Un prefilter de firmas limita el detector a JPEG/PNG/WEBP y bloquea ASF/ZIP antes
de invocarlo; fileTypeFromBuffer sigue siendo obligatorio para validar MIME real.
Las filas PENDING, UPLOADED y FAILED consumen cupo: un nuevo UUID no permite
saltarse las 15 fotos o la firma única. Un retry válido reutiliza su propia fila.

## Prueba de integración preparada, pendiente de autorización para ejecución

No ejecutar todavía. Requiere exclusivamente la base `artecnologia_test_local`,
las migraciones locales de entregas, lifecycle y carpeta ya aplicadas, y una raíz
Drive de pruebas aislada. Implica escrituras reales y no forma parte del comando
`test:evidence`. No usar una carpeta operacional para estas comprobaciones.

Matriz para ejecutar posteriormente con dos conexiones/requests independientes:

| Caso | Preparación/acción | Resultado que debe verificarse |
| --- | --- | --- |
| Propiedad | Usuario B intenta adjuntar a entrega de A | 403 genérico; ninguna fila nueva ni llamada a Drive |
| Reserva concurrente | Pausar A después de COMMIT PENDING; B envía mismo UUID y bytes | B recibe 202; un solo token vigente; una sola evidencia |
| UUID global | Dos entregas propias distintas reciben simultáneamente el mismo UUID | Solo una reserva confirmada; la otra recibe 409 sin información ajena |
| Cupo de fotos | Entrega con 14 filas PHOTO; dos UUID distintos concurrentes | Solo una fila nueva; secuencia asignada en servidor; total 15 |
| Firma única | Dos SIGNATURE con UUID distintos concurrentes | Una firma; segundo request 409; índice parcial intacto |
| Lock padre | Conexión A retiene FOR UPDATE; B intenta reservar | B espera o agota lock_timeout sin reservar ni contactar Drive |
| Lease expirado | Expirar lease en fixture; repetir exactamente el intento | Token nuevo; mismo sequence_no, folder y external_file_id |
| Fencing | Worker A reanuda después de que B tomó el lease | A no renueva, confirma ni libera el token de B; devuelve 202 |
| Carpeta compartida | Dos evidencias distintas de una entrega sin carpeta | Una referencia canónica de carpeta; candidatos no usados no crean objetos |
| Pedido repetido | Dos entregas distintas con mismo pedido | Carpetas con nombres iguales permitidas; IDs distintos |
| Crash antes de crear | Detener proceso tras persistir IDs | Retry crea exactamente los IDs reservados |
| Crash después de subir | Detener proceso antes de confirmar UPLOADED en DB | Retry consulta el ID, verifica metadata/checksum y confirma sin duplicar |
| Timeout ambiguo | Simular pérdida de respuesta de files.create | PENDING recuperable; no FAILED automático; retry usa el mismo ID |
| Metadata incorrecta | ID externo con parent/MIME/size/checksum diferente | 500 genérico; PENDING; ningún ID alternativo ni éxito ficticio |
| Replay inmutable | Confirmar UPLOADED y luego cambiar status padre en fixture | Mismo retry devuelve 200/replay; UUID nuevo devuelve 409 |
| UUID cambiado | Variar entrega/tipo/hash/tamaño/MIME del UUID reservado | 409; fila original intacta |
| Commit incierto | Perder conexión al confirmar UPLOADED | Respuesta genérica; retry reconcilia fila/Drive usando el ID existente |

Antes de activar esta matriz deben definirse explícitamente los fixtures y su
limpieza. No incluir tokens, rutas locales de OAuth ni IDs operacionales en tests
o logs. Los tests aislados comprueban decisiones y contratos SQL, pero no prueban
el comportamiento real de locks, índices, OAuth o consistencia de Drive.

## Referencias de implementación

- [Multer: almacenamiento en memoria y límites](https://github.com/expressjs/multer#memorystorage)
- [file-type: detección desde bytes y ESM](https://github.com/sindresorhus/file-type#filetypefrombufferbuffer-options)
- [Drive: retries con IDs pregenerados](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files)
- [Drive: metadata y checksums](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
