import { API10_URL } from "../config/api";
import { fetchApi } from "./apiResponse";
import { isPositiveId, requirePositiveId } from "./catalogQueries";

export const ASSEMBLY_INSPECTION_TYPE = "Inspección de ensamble";

export type InspectionSummary = {
    inspection_order_id: number;
    work_order_id: number | null;
    inspection_type: string | null;
    status: string | null;
};

export type RequestedInspection = {
    id: number;
    work_order_id: number;
    inspection_type: string;
    status: string;
};

export function isInspectionSummaryList(value: unknown): value is InspectionSummary[] {
    return Array.isArray(value) && value.every(row => row && typeof row === "object" &&
        typeof row.inspection_order_id === "number" && isPositiveId(row.inspection_order_id) &&
        (row.work_order_id === null || (typeof row.work_order_id === "number" && isPositiveId(row.work_order_id))) &&
        (row.inspection_type === null || typeof row.inspection_type === "string") &&
        (row.status === null || typeof row.status === "string"));
}

export function findActiveAssemblyInspection(rows: InspectionSummary[], workOrderId: number): InspectionSummary | undefined {
    return rows.find(row => row.work_order_id === workOrderId &&
        row.inspection_type === ASSEMBLY_INSPECTION_TYPE && ["PENDING", "IN_PROGRESS"].includes(row.status ?? ""));
}

/** estacion is nullable in the local contract; omit it instead of inventing a station. */
export async function requestAssemblyInspection(workOrderId: number): Promise<RequestedInspection> {
    const id = requirePositiveId(workOrderId, "work_order_id");
    let response: Response;
    try {
        response = await fetchApi(`${API10_URL}/quality/inspection/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ work_order_id: id, inspection_type: ASSEMBLY_INSPECTION_TYPE }),
        });
    } catch (error) {
        const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : 0;
        const context = statusCode === 404 ? "No se encontró la orden o una plantilla de inspección compatible."
            : statusCode === 409 ? "Existe una inspección activa o una configuración ambigua de plantillas."
                : statusCode === 422 ? "La plantilla o sección no contiene puntos de inspección válidos." : "No se pudo solicitar la inspección.";
        const detail = error && typeof error === "object" && "message" in error && typeof error.message === "string"
            ? error.message : "Error desconocido.";
        throw { message: `${context} ${detail}`, statusCode };
    }
    const result = await response.json();
    const inspection = result?.inspection_order;
    if (response.status !== 201 || !isPositiveId(inspection?.id) || inspection.work_order_id !== id ||
        inspection.inspection_type !== ASSEMBLY_INSPECTION_TYPE || inspection.status !== "PENDING") {
        throw new Error("La respuesta no confirma la inspección esperada. Actualiza la lista antes de volver a intentarlo.");
    }
    return inspection;
}
