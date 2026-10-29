import type { HttpError } from "@refinedev/core";
import { fetchApi } from "./apiResponse";
import { requirePositiveId } from "./catalogQueries";

export type TemplateSection = { id: number; template_id: number; title: string; position: number };
type DetailBase = { id: number; section_id: number; position: number };
export type TemplateDetailItem = DetailBase & (
    { kind: "task"; title: string; code: string | null; expected_minutes: number | null } |
    { kind: "inspection"; revision_point: string; specs: string | null; suggestions: string | null; required: boolean | null; category: string | null }
);

function invalidResponse(): never {
    throw { message: "La respuesta de actividades no corresponde al contrato o a la sección solicitada.", statusCode: 502 } satisfies HttpError;
}
function nullableText(value: unknown): string | null {
    if (value === null || typeof value === "string") return value;
    return invalidResponse();
}

/** Distinct API schemas; inspection points never receive invented task fields. */
export function adaptTemplateItems(data: unknown, sectionId: number, inspection: boolean): TemplateDetailItem[] {
    if (!Array.isArray(data)) return invalidResponse();
    const seen = new Set<number>();
    return data.map((row): TemplateDetailItem => {
        if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || row.id > 2147483647 ||
            row.section_id !== sectionId || !Number.isInteger(row.position) || row.position < 0 || seen.has(row.id)) return invalidResponse();
        seen.add(row.id);
        const common = { id: row.id, section_id: row.section_id, position: row.position };
        if (inspection) {
            if (typeof row.revision_point !== "string" || !row.revision_point.trim() ||
                (row.required !== null && typeof row.required !== "boolean")) return invalidResponse();
            return { ...common, kind: "inspection", revision_point: row.revision_point,
                specs: nullableText(row.specs), suggestions: nullableText(row.suggestions),
                category: nullableText(row.category), required: row.required };
        }
        const minutes = row.expected_minutes === null ? null :
            (typeof row.expected_minutes === "number" ||
                (typeof row.expected_minutes === "string" && /^\d+(\.\d+)?$/.test(row.expected_minutes))) ? Number(row.expected_minutes) : NaN;
        if (typeof row.title !== "string" || !row.title.trim() ||
            (minutes !== null && (!Number.isFinite(minutes) || minutes < 0))) return invalidResponse();
        return { ...common, kind: "task", title: row.title, code: nullableText(row.code), expected_minutes: minutes };
    }).sort((a, b) => a.position - b.position || a.id - b.id);
}

export async function loadTemplateItems(
    apiUrl: string,
    templateId: number,
    templateType: string,
    sections: TemplateSection[],
    signal: AbortSignal,
): Promise<Record<number, TemplateDetailItem[]>> {
    requirePositiveId(templateId, "template_id");
    const ids = sections.map(section => {
        const id = requirePositiveId(section.id, "section_id");
        if (section.template_id !== templateId) return invalidResponse();
        return id;
    });
    if (new Set(ids).size !== ids.length) return invalidResponse();
    if (!ids.length) return {};
    const inspection = templateType === "INSPECCION";
    const resource = inspection ? "quality/template_task_inspection" : "tasks";
    // Bound the batch even with a caller cancellation signal, without requiring AbortSignal.any.
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    const timer = setTimeout(() => controller.abort(new DOMException("Tiempo de consulta agotado", "TimeoutError")), 20000);
    signal.addEventListener("abort", abort, { once: true });
    try {
        if (signal.aborted) { abort(); throw { message: "Consulta cancelada.", statusCode: 0 } satisfies HttpError; }
        const entries = await Promise.all(ids.map(async id => {
            const response = await fetchApi(`${apiUrl}/${resource}?section_id=${id}`, {
                method: "GET", signal: controller.signal, headers: { "Content-Type": "application/json" },
            });
            return [id, adaptTemplateItems(await response.json(), id, inspection)] as const;
        }));
        return Object.fromEntries(entries);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        controller.abort();
    }
}
