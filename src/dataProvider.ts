// src/dataProvider.ts
import type {
    DataProvider,
    CrudFilters,
    LogicalFilter,
    ConditionalFilter,
} from "@refinedev/core";

const API_URL = "https://desarrollotecnologicoar.com/api10";

/** Busca recursivamente el valor de un filtro por 'field' */
function getFilterValue(filters: CrudFilters | undefined, targetField: string) {
    if (!filters) return undefined;
    const walk = (arr: CrudFilters): unknown => {
        for (const f of arr) {
            if ("field" in f) {
                const lf = f as LogicalFilter;
                if (lf.field === targetField) return lf.value;
            } else {
                const cf = f as ConditionalFilter;
                const found = walk(cf.value);
                if (found !== undefined) return found;
            }
        }
        return undefined;
    };
    return walk(filters);
}

export const dataProvider: DataProvider = {
    // ------ LIST ------
    getList: async ({ resource, filters, meta }) => {
        // soporta también meta.queryParams (útil con useList({ meta: { queryParams } }))
        const qp = (meta as any)?.queryParams as Record<string, any> | undefined;

        if (resource === "sections") {
            const templateId = qp?.template_id ?? getFilterValue(filters, "template_id");
            const res = await fetch(`${API_URL}/sections?template_id=${templateId}`);
            const data = await res.json();
            return { data, total: data.length ?? 0 };
        }

        if (resource === "tasks") {
            const sectionId = qp?.section_id ?? getFilterValue(filters, "section_id");
            const res = await fetch(`${API_URL}/tasks?section_id=${sectionId}`);
            const data = await res.json();
            return { data, total: data.length ?? 0 };
        }

        const res = await fetch(`${API_URL}/${resource}`);
        const data = await res.json();
        return { data, total: data.length ?? 0 };
    },

    // ------ ONE ------
    getOne: async ({ resource, id }) => {
        // work-orders: devuelve checklist materializado
        if (resource === "work-orders") {
            const res = await fetch(`${API_URL}/work-orders/${id}/tasks`);
            const data = await res.json();
            return { data };
        }
        const res = await fetch(`${API_URL}/${resource}/${id}`);
        const data = await res.json();
        return { data };
    },

    // ------ CREATE ------
    create: async ({ resource, variables }) => {
        // crear WO desde plantilla
        if (resource === "work-orders" && (variables as any)?.fromTemplate) {
            const body = { ...(variables as any).payload };
            const res = await fetch(`${API_URL}/work-orders/from-template`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            return { data };
        }

        const res = await fetch(`${API_URL}/${resource}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(variables),
        });
        const data = await res.json();
        return { data };
    },

    // ------ UPDATE ------
    update: async ({ resource, id, variables }) => {
        // actualizar ítem de WO
        if (resource === "work-order-task") {
            const res = await fetch(`${API_URL}/work-orders/tasks/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(variables),
            });
            const data = await res.json();
            return { data };
        }
        const res = await fetch(`${API_URL}/${resource}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(variables),
        });
        const data = await res.json();
        return { data };
    },

    // ------ NOT USED IN STARTER ------
    deleteOne: async () => {
        throw new Error("Not implemented");
    },
    getMany: async () => {
        throw new Error("Not implemented");
    },

    getApiUrl: () => API_URL,

    custom: async (params) => {
        const { url, method, meta } = params as any;

        const body =
            (params as any).values ??               // <- tu versión la exige
            (meta && meta.body) ??                  // soporte alterno
            (params as any).payload ??              // soporte alterno
            undefined;

        const fullUrl = url!.startsWith("http") ? url! : `${API_URL}${url}`;
        const baseHeaders = { "Content-Type": "application/json" };
        const headers = { ...baseHeaders, ...(meta?.headers || {}) };

        const res = await fetch(fullUrl, {
            method: (method || "GET").toUpperCase(),
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        let data: any = {};
        const text = await res.text();
        if (text) { try { data = JSON.parse(text); } catch { data = text; } }
        if (!res.ok) throw new Error(typeof data === "string" ? data : (data?.error || `HTTP ${res.status}`));
        return { data };
    },
};