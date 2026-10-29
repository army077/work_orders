# calidad: procedimiento vigente

Estado vigente confirmado por el administrador: FASE A cerrada y seed productivo
EJECUTADO Y VALIDADO en PostgreSQL 16.15. Schema/datos/operativo/deploy=SI,
1.139 filas maestras, cero transaccionales/históricos/TEST/FIXTURE y ningún ERROR.
LOGISTICA_AUTH_PENDIENTE=SI. API27 DETENIDA; /api10 productiva sin cambios.
No repetir seed, CREATE, TEST, cleanup ni reset.
Runtime previsto: Node.js v18.19.1; configuración aislada de API27 según el runbook.

**SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO.** El hotfix local está
aplicado por el administrador. El siguiente bloque está preparado, sin ejecutar:
[autorización real + Firebase + Drive + API27](22_API27_AUTORIZACION_FIREBASE_DRIVE.md).
El runbook anterior conserva la secuencia histórica completa de Fase B.

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

Orden vigente: PG → Firebase → Drive → alta manual real → autorización DB →
arrancar API27 → health 200 → GET autenticado → mantener /api10 intacta.
Después se prepara E2E real y, en otra etapa, Flutter y Samsung E2E.
Esta preparación no ejecuta SQL, conexiones, deploy, cambios productivos, commit o push.
