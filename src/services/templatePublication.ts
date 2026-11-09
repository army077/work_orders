import { API10_URL } from "../config/api";
import { fetchApi } from "./apiResponse";
import { isPositiveId, requirePositiveId } from "./catalogQueries";
import { loadTemplateItems } from "./templateDetails";
import type { TemplateSection, TemplateDetailItem } from "./templateDetails";

export type PublicationTemplate = {
    id: number; name: string; template_type: string; model_id: number | null;
    version: number; is_published: boolean;
};
export type PublicationReview = {
    template: PublicationTemplate;
    modelName: string;
    sections: TemplateSection[];
    points: Record<number, TemplateDetailItem[]>;
};

function invalid(message: string): never {
    throw new Error(message);
}

function templateFrom(value: unknown, id: number): PublicationTemplate {
    const t = value as PublicationTemplate | null;
    if (!t || t.id !== id || typeof t.name !== "string" || !t.name.trim() ||
        typeof t.template_type !== "string" || !t.template_type.trim() ||
        (t.model_id !== null && (typeof t.model_id !== "number" || !isPositiveId(t.model_id))) ||
        !Number.isSafeInteger(t.version) || t.version < 1 || typeof t.is_published !== "boolean") {
        return invalid("La API no devolvió una plantilla válida. Actualiza la lista y vuelve a revisar.");
    }
    return { id: t.id, name: t.name, template_type: t.template_type, model_id: t.model_id,
        version: t.version, is_published: t.is_published };
}

/** Fresh reads only. Empty unused sections are allowed by the request contract. */
export async function prepareTemplatePublication(templateId: number): Promise<PublicationReview> {
    const id = requirePositiveId(templateId, "template_id");
    const response = await fetchApi(`${API10_URL}/templates/${id}`);
    const template = templateFrom(await response.json(), id);
    const review: PublicationReview = { template, modelName: "", sections: [], points: {} };
    if (template.is_published || template.template_type !== "INSPECCION") return review;

    const modelId = requirePositiveId(template.model_id, "Modelo de la plantilla");
    const modelResponse = await fetchApi(`${API10_URL}/machine-models/${modelId}`);
    const model = await modelResponse.json();
    if (model?.id !== modelId || typeof model.name !== "string" || !model.name.trim()) {
        return invalid("No se pudo verificar el modelo de la plantilla.");
    }
    review.modelName = model.name;

    const sectionsResponse = await fetchApi(`${API10_URL}/sections?template_id=${id}`);
    const sections: unknown = await sectionsResponse.json();
    if (!Array.isArray(sections) || sections.some(s => !s || typeof s.id !== "number" || !isPositiveId(s.id) ||
        s.template_id !== id || typeof s.title !== "string" || !s.title.trim() ||
        !Number.isInteger(s.position) || s.position < 0) ||
        new Set(sections.map(s => s.id)).size !== sections.length) {
        return invalid("No se pudieron verificar las secciones de esta plantilla.");
    }
    review.sections = sections.sort((a, b) => a.position - b.position || a.id - b.id);
    review.points = await loadTemplateItems(API10_URL, id, "INSPECCION", review.sections, new AbortController().signal);
    return review;
}

export function defaultInspectionTexts(review: PublicationReview): string[] {
    const defaults = new Set(["nuevo punto de revisión", "nueva especificación", "nueva sugerencia"]);
    return review.sections.flatMap(section => (review.points[section.id] ?? []).flatMap(point => {
        if (point.kind !== "inspection") return [];
        return [point.revision_point, point.specs, point.suggestions]
            .filter((value): value is string => typeof value === "string" && defaults.has(value.trim().toLocaleLowerCase("es")))
            .map(value => `${section.title} · ${point.revision_point}: ${value}`);
    }));
}

export function validatePublicationReview(review: PublicationReview, sectionId: number | null, defaultsReviewed: boolean): void {
    if (review.template.is_published) return invalid("La plantilla ya está publicada. Actualiza la lista.");
    if (review.template.template_type !== "INSPECCION") return;
    const section = review.sections.find(s => s.id === sectionId);
    if (!section) return invalid("Selecciona la sección de inspección que se utilizará.");
    if (review.sections.filter(s => s.title === section.title).length !== 1) {
        return invalid("La sección tiene un título duplicado. Revisa su configuración antes de publicar.");
    }
    if (!review.points[section.id]?.length) return invalid("La sección seleccionada no tiene puntos de inspección guardados.");
    if (defaultInspectionTexts(review).length && !defaultsReviewed) {
        return invalid("Revisa los textos predeterminados con Calidad y confirma su aprobación, o corrígelos en el Constructor de tareas.");
    }
}

/** No automatic POST retries. Re-read before writing so an old review cannot authorize changed content. */
export async function publishReviewedTemplate(
    reviewed: PublicationReview, sectionId: number | null, defaultsReviewed: boolean,
): Promise<PublicationTemplate> {
    validatePublicationReview(reviewed, sectionId, defaultsReviewed);
    const current = await prepareTemplatePublication(reviewed.template.id);
    if (JSON.stringify(current) !== JSON.stringify(reviewed)) {
        return invalid("La plantilla cambió desde la revisión. Vuelve a abrir Publicar y revisa los datos actuales.");
    }
    validatePublicationReview(current, sectionId, defaultsReviewed);
    const response = await fetchApi(`${API10_URL}/templates/${current.template.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    let result: PublicationTemplate;
    try {
        result = templateFrom(await response.json(), current.template.id);
    } catch {
        return invalid("El servidor no confirmó la publicación con una respuesta válida. Actualiza la lista antes de volver a intentarlo.");
    }
    if (response.status !== 200 || !result.is_published || result.version !== current.template.version + 1 ||
        result.model_id !== current.template.model_id || result.template_type !== current.template.template_type ||
        result.name !== current.template.name) {
        return invalid("El servidor no confirmó la publicación esperada. Actualiza la lista antes de volver a intentarlo.");
    }
    return result;
}

export function publicationErrorMessage(error: unknown): string {
    const e = error as { statusCode?: number; message?: unknown } | null;
    const context = e?.statusCode === 401 || e?.statusCode === 403 ? "No tienes autorización para esta operación. "
        : e?.statusCode === 404 ? "No se encontró la plantilla, el modelo o el recurso solicitado. "
            : e?.statusCode === 409 ? "El servidor rechazó la operación por un conflicto. "
                : e?.statusCode === 0 || (e?.statusCode ?? 0) >= 500
                    ? "No se pudo confirmar la operación. Actualiza la lista antes de volver a intentarlo. " : "";
    return context + (typeof e?.message === "string" ? e.message : "No se pudo publicar la plantilla.");
}
