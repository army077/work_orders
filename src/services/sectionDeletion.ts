import type { DataProvider, HttpError } from "@refinedev/core";

/** The current DELETE API can cascade tasks; only offer empty-section deletion. */
export async function deleteEmptySection(
    id: number,
    provider: Pick<DataProvider, "getList" | "deleteOne">,
): Promise<void> {
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
        throw { message: "ID de sección inválido.", statusCode: 400 } satisfies HttpError;
    }

    // Check both relations, regardless of the selected template's type. Inspection
    // points do not have a section FK. This preflight is not a server-side lock.
    const results = await Promise.all(["tasks", "quality/template_task_inspection"].map(resource =>
        provider.getList({
            resource,
            pagination: { mode: "off" },
            meta: { queryParams: { section_id: id } },
        }),
    ));
    if (results.some(result => !Array.isArray(result.data))) {
        throw { message: "No se pudieron verificar las dependencias de la sección.", statusCode: 502 } satisfies HttpError;
    }
    if (results.some(result => result.data.length > 0)) {
        throw {
            message: "La sección tiene actividades o puntos de inspección. Elimínalos o muévelos antes de borrar la sección.",
            statusCode: 409,
        } satisfies HttpError;
    }

    await provider.deleteOne({ resource: "sections", id });
}
