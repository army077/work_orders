import { API10_URL } from "../config/api";
import { fetchApi } from "./apiResponse";
import { requirePositiveId } from "./catalogQueries";

export type ProductionTask = {
    id: number;
    work_order_id: number;
    section_title: string;
    task_title: string;
    code: string | null;
    status: string | null;
    started_at: string | null;
    finished_at: string | null;
    actual_minutes: number | null;
    position: number;
};

type ProductionOrder = { id: number; tasks?: ProductionTask[] };

export function isQualityRelease(task: Pick<ProductionTask, "code">): boolean {
    return ["LIB001", "LIB002"].includes((task.code ?? "").trim().toUpperCase());
}

export function canCompleteProductionTask(task: ProductionTask): boolean {
    return !isQualityRelease(task) && task.status !== "DONE";
}

export function productionErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return "No se pudo completar la operación.";
}

/** The local contract defines no transition sequence. Offer only the confirmed DONE action. */
export async function completeProductionTask(
    order: ProductionOrder,
    taskId: number,
    templateType: string,
    actualMinutes?: number,
): Promise<ProductionTask> {
    const orderId = requirePositiveId(order.id, "work_order_id");
    const id = requirePositiveId(taskId, "id_tarea");
    const task = order.tasks?.find(item => item.id === id && item.work_order_id === orderId);
    if (templateType !== "ENSAMBLE") throw new Error("El avance productivo solo está disponible para órdenes ENSAMBLE.");
    if (!task) throw new Error("La actividad no pertenece a la orden seleccionada.");
    if (isQualityRelease(task)) throw new Error("Las liberaciones LIB001 y LIB002 corresponden exclusivamente a Calidad.");
    if (task.status === "DONE") throw new Error("Esta actividad ya está completada.");
    if (actualMinutes !== undefined && (!Number.isInteger(actualMinutes) || actualMinutes < 0 || actualMinutes > 2147483647)) {
        throw new Error("Los minutos deben ser un entero entre 0 y 2147483647.");
    }
    const now = new Date().toISOString();
    const body = {
        status: "DONE",
        finished_at: now,
        ...(!task.started_at ? { started_at: now } : {}),
        ...(actualMinutes !== undefined ? { actual_minutes: actualMinutes } : {}),
    };
    const response = await fetchApi(`${API10_URL}/work-orders/${id}/stavance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const result = await response.json();
    if (result?.task?.id !== id || result.task.work_order_id !== orderId || result.task.status !== "DONE") {
        throw new Error("La respuesta no confirma la actividad esperada. Actualiza la orden antes de volver a intentarlo.");
    }
    return result.task;
}
