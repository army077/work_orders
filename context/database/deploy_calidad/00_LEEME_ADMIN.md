# calidad: procedimiento vigente

FASE A cerrada según confirmación del administrador: CALIDAD_SCHEMA_VALIDO=SI,
21 tablas, ledger=7, aplicación=0, TEST=0 y siete secuencias restauradas al baseline.
API27 DETENIDA; /api10 productiva sin cambios. No repetir CREATE/TEST/cleanup.
Runtime previsto: Node.js v18.19.1; configuración aislada de API27 según el runbook.

**SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO.** El hotfix local está
preparado; Fase B aún no se ejecuta. Seguir el orden de trece pasos del
[runbook](10_RUNBOOK_CUTOVER_FINAL.md) y su configuración de API27.

[seed_calidad_operativo.sql](seed_calidad_operativo.sql) exige calidad/PG16 y
baseline semántico completo vacío. Bloquea las tablas, valida catálogos y expresiones,
inserta exclusivamente 1.139 filas de siete maestros aprobados, preserva IDs y
reinicia siete secuencias transaccionalmente. Su guard textual antiguo se eliminó.
No incluye eventos, históricos, TEST, fixtures, legacy, mappings ni usuarios Logística.

[validate_seed_calidad.sql](validate_seed_calidad.sql) usa la misma política
semántica; es READ ONLY y termina en ROLLBACK. Exigir schema/datos/operativo SI;
los ERROR bloquean. Los WARNING heredados 39/5/9 no generan NO-GO global.
La falta de autorización se reporta aparte: LOGISTICA_AUTH_PENDIENTE.

EXPORT_CONFIG_PROD_RECIBIDO=SI; no pedir otro export por su etiqueta heredada.
Fuente aprobada sin alterar y recibo: [15_RECEPCION_EXPORT_CONFIG_PROD.json](15_RECEPCION_EXPORT_CONFIG_PROD.json).
Alta real MANUAL de Logística: [13_SEED_OPERATIVO.md](13_SEED_OPERATIVO.md).
Firebase válido por sí solo NO basta: se exige usuario real activo en
logistica_authorized_users con proyecto/UID coincidentes. No inventar UID.

[Verificación del hotfix](21_FASE_B_HOTFIX_SEED.md): datos y secuencias preservados,
pruebas offline sin motores SQL. Los SQL son autónomos para el administrador;
los generadores no conectan a servicios. No publicar fuentes personales, SQL,
credenciales ni herramientas administrativas junto a la aplicación.

La carpeta fase_a conserva los dos SQL históricos de esa fase ya cerrada;
create_calidad.sql y validate_create_calidad.sql son referencias del baseline vacío.
Los procedimientos anteriores de transferencia y el checklist de despliegue API10
se conservan como antecedentes: no ejecutarlos durante esta Fase B inicial.

Orden posterior: seed → validar → confirmar 1139 → alta manual → autorización →
Firebase/Drive → reactivar API27 → health 200 → web real → Logística → Flutter
Release → Samsung E2E → solo después evaluar promoción /api27 → /api10.
Esta preparación no ejecuta SQL, conexiones, deploy, cambios productivos, commit o push.
