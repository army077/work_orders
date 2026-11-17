import type { CrudFilters, HttpError } from "@refinedev/core";

export function isPositiveId(value: unknown): value is number | string {
    if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) return false;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}

export function requirePositiveId(value: unknown, field: string): number {
    if (!isPositiveId(value)) {
        throw { message: `${field} es obligatorio y debe ser un entero positivo válido.`, statusCode: 400 } satisfies HttpError;
    }
    return Number(value);
}

/** Only the query parameters implemented by the local backend contracts. */
export function catalogListUrl(
    base: string,
    resource: string,
    filters?: CrudFilters,
    queryParams?: Record<string, unknown>,
): string | undefined {
    const field = resource === "machine-models" ? "family_id"
        : resource === "sections" ? "template_id"
        : resource === "tasks" || resource === "quality/template_task_inspection" ? "section_id" : undefined;
    if (!field) return undefined;

    const values: unknown[] = [];
    const invalidFilter = () => {
        throw { message: `${field} solo admite un filtro de igualdad (eq) sin alternativas OR.`, statusCode: 400 } satisfies HttpError;
    };
    const visit = (items: CrudFilters, inOr = false) => {
        for (const item of items) {
            if ("field" in item) {
                if (item.field === field) {
                    if (inOr || item.operator !== "eq") invalidFilter();
                    values.push(item.value);
                }
            } else {
                visit(item.value, inOr || item.operator !== "and");
            }
        }
    };
    visit(filters ?? []);
    if (queryParams && Object.prototype.hasOwnProperty.call(queryParams, field)) values.push(queryParams[field]);
    if (!values.length && resource === "machine-models") return `${base}/${resource}`;
    const ids = (values.length ? values : [undefined]).map(value => requirePositiveId(value, field));
    if (ids.some(id => id !== ids[0])) invalidFilter();
    return `${base}/${resource}?${field}=${ids[0]}`;
}
