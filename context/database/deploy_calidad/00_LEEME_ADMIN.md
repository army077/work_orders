# Paquete administrativo: artecnologia → calidad

Estado: **PREPARADO PARA REVISIÓN; NO EJECUTADO EN DB**. Esta entrega no autoriza
iniciar el cutover. Ejecutar únicamente durante la ventana autorizada, con los
escritores detenidos y API10 todavía sobre `artecnologia`.

El inventario, el comparador y las siete migraciones siguen siendo los de
[`transfer_calidad`](../transfer_calidad/README.md) y [`migrations/prod`](../migrations/prod/).
El administrador no elige tablas, no compara conteos manualmente y no decide el
orden de las migraciones. Cualquier `NO`, `REVISAR`, error o conexión perdida
significa **DETENERSE; NO continuar; NO reintentar automáticamente**. Enviar los
reportes de metadatos a Codex para resolver el motivo.

Antes del cutover solamente necesitamos estas **cinco confirmaciones**:

1. Salida de `node --version` (el lock actual incluye dependencias que requieren Node ≥22).
2. Nombre exacto del proceso API10 en PM2.
3. Ruta real del directorio API10.
4. Backup actualizado de `artecnologia` realizado = SI (bloque C).
5. Mecanismo para detener temporalmente escritores durante el snapshot = CONFIRMADO.

PostgreSQL 16.15, Ubuntu, HeidiSQL, FileZilla y respaldo de API10 ya están
confirmados. Las rutas de servidor y el nombre PM2 se sustituyen en el checklist
cuando lleguen las respuestas 2 y 3. Host, puerto, rol y directorio de respaldo
son parámetros del entorno administrado; no se incluyen credenciales aquí.

Orden de uso:

- `01_preflight_artecnologia.sql`: ejecutar completo en HeidiSQL sobre
  `artecnologia`; guardar la tabla CHECK/ESTADO/DETALLE. Incluye 15 tablas con
  conteos exactos y cuatro históricos separados como PENDIENTE_VERIFICACION_PROD.
- `02_preflight_calidad.sql`: ejecutar completo sobre `calidad`; repetir es seguro.
- Seguir [05_COMANDOS_TRANSFERENCIA.md](05_COMANDOS_TRANSFERENCIA.md), bloques A–F.
  El runner guarda automáticamente los mismos reportes en TSV, evitando exportar
  manualmente desde HeidiSQL.
- `03_validar_post_restore_calidad.sql`: captura en `calidad` antes de Logística.
  `CAPTURA_RESTORE_APTA=SI` no certifica igualdad. El comparador determina
  **RESTORE_VALIDADO=SI/NO** contra `origen_definitivo.tsv` del mismo freeze.
- Bloque G: las siete migraciones se aplican y verifican una por una por el runner.
- `04_validar_post_logistica_calidad.sql`: ledger, orden, checksums y fingerprint
  completo esperado; no exige usuarios, mappings ni entregas reales.
- Solo después seguir [06_CHECKLIST_CUTOVER.md](06_CHECKLIST_CUTOVER.md).

Los cuatro SQL son READ ONLY, compatibles con PostgreSQL/HeidiSQL sin comandos
psql. Un guard de base/versión equivocada aborta la transacción; ejecutar ROLLBACK
o reconectar antes de otro intento. El límite de 120 segundos puede detener
conteos grandes: no es un resultado aprobado y requiere revisión técnica.

Compartir únicamente los `.tsv` y reportes de resultados JSON. Contienen
metadatos, firmas, conteos y estados de secuencia; las definiciones/defaults se
representan mediante SHA-256. No contienen filas de negocio ni cuerpos de
funciones. Los nombres de roles/objetos son metadatos de infraestructura.
**No compartir** dumps, export SQL, archivos de entorno, passfiles ni archivos
de Firebase/Drive. El backup completo puede contener toda la información de la
base y debe quedar privado fuera del repositorio.

Las cuatro tablas históricas pendientes se reportan pero **no se transfieren**.
No se crea ni utiliza PREPROD ni una DB LOCAL. El destino está fijado a `calidad`.
Un objeto auxiliar no soportado produce REVISAR; Codex ajustará el paquete tras
revisar la captura, sin trasladar decisiones de alcance al administrador.

Los SQL y el manifiesto FileZilla se generan offline con `build_package.mjs`
desde las fuentes existentes. No editarlos a mano. Los tests comprueban que
continúan sincronizados. Este paquete no sustituye un ensayo real autorizado:
no se ha ejecutado SQL para producir esta entrega.

Límites de la certificación: conteos/MAX y hashes estructurales no demuestran
igualdad de cada celda; el freeze es obligatorio. `pg_depend` no registra todas
las referencias dentro de PL/pgSQL o SQL dinámico. Se conserva el alcance de
funciones ya inventariado; un hallazgo nuevo vuelve a Codex, sin pedir al
administrador diseñar consultas o elegir objetos. Las comprobaciones offline no
sustituyen ejecutar los preflights/validadores durante la ventana autorizada.
