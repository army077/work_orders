// Reuse only the static manifest reader. No operational runner is imported.
import { core, historical, logistics } from '../transfer_calidad/manifest.mjs';

export const VERSION = '1.0.0';
export const DATABASES = Object.freeze({ source: 'artecnologia', destination: 'calidad' });
export const TABLES = Object.freeze([...new Set([...core, ...logistics, ...historical])].map(name => name.slice(7)));
export const REQUIRED = Object.freeze({ source: core.map(n => n.slice(7)), destination: [...core, ...logistics].map(n => n.slice(7)) });
export const MASTERS = Object.freeze(['machine_family', 'machine_model', 'maintenance_template', 'template_section', 'template_task', 'template_task_inspection', 'plantilla_tecnicos']);
export const RECREATED_METADATA = Object.freeze(['created_at', 'updated_at', 'created_by']);
export const SEED_SHA256 = '47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0';
export const SEED_URL = new URL('../deploy_calidad/sources/export_config_prod_20261023.json', import.meta.url);

// Explicit application relationships, not inferred from column names. Actual FKs
// are discovered independently; the report says whether each relationship has one.
export const RELATIONSHIPS = Object.freeze([
    ['machine_model', 'family_id', 'machine_family'],
    ['maintenance_template', 'model_id', 'machine_model'],
    ['template_section', 'template_id', 'maintenance_template'],
    ['template_task', 'section_id', 'template_section'],
    ['template_task_inspection', 'section_id', 'template_section'],
    ['work_order', 'template_id', 'maintenance_template'],
    ['work_order', 'model_id', 'machine_model'],
    ['work_order_task', 'work_order_id', 'work_order'],
    ['work_order_customs', 'work_order_id', 'work_order'],
    ['prod_delayments', 'id_actividad', 'work_order_task'],
    ['inspection_order', 'inspection_template_id', 'maintenance_template'],
    ['inspection_order', 'model_id', 'machine_model'],
    ['inspection_order', 'work_order_id', 'work_order'],
    ['inspection_order_task', 'inspection_order_id', 'inspection_order'],
    ['inspection_order_task', 'template_task_inspection_id', 'template_task_inspection'],
    ['desviaciones_calidad', 'id_actividad', 'inspection_order_task'],
    ['logistica_deliveries', 'authorized_user_id', 'logistica_authorized_users'],
    ['logistica_delivery_evidence', 'delivery_id', 'logistica_deliveries'],
    ['logistica_legacy_owner_mapping', 'authorized_user_id', 'logistica_authorized_users'],
].map(([child, column, parent]) => Object.freeze({ child, columns: [column], parent, parentColumns: ['id'] })));

export const LIMITATIONS = Object.freeze([
    'Capturas REPEATABLE READ separadas: no son un snapshot atomico entre sistemas.',
    'Inventario de lectura; PASS no autoriza migracion, cutover ni conciliacion de escritura.',
    'Ausencias y diferencias no prueban altas o bajas posteriores al 23/10/2026; no es CDC.',
    'El seed selecciona 51 de 54 plantillas publicadas; no identifica las tres excluidas.',
    'El baseline del seed se usa como conjunto de IDs, no como auditoria temporal ni tercera version del contenido.',
    'Huella de negocio de maintenance_template excluye created_at, updated_at y created_by recreados por el seed.',
    'No compara personas por correo/nombre ni deduce relaciones legacy con ordenes modernas.',
    'No certifica archivos Drive/Firebase, permisos externos, funciones operativas, owners ni ACL equivalentes.',
    'Secuencias no son MVCC; su estado y seguridad son observaciones puntuales, no reservas de IDs.',
    'Huellas por fila limitadas por maxRows; verificacion incompleta nunca produce PASS.',
]);

export function plan() {
    return { mode: 'PLAN', inventoryVersion: VERSION, connections: 0, databases: DATABASES,
        tables: TABLES, required: REQUIRED, applicationRelationships: RELATIONSHIPS,
        checks: ['identity_pg16', 'effective_read_only_privileges', 'catalog_structure', 'exact_counts',
            'primary_keys', 'numeric_id_bounds', 'sequences', 'actual_foreign_keys', 'application_relationships',
            'source_reference_coverage_in_destination', 'business_fingerprints', 'potential_id_collisions', 'seed_id_coverage'],
        limitations: LIMITATIONS };
}
