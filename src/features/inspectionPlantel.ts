export type InspectionTask = {
    id: number;
    status: string;
    revision_point: string;
    section_title: string | null;
    finished_at?: string | null;
    category?: string | null;
};

/** API10 orders_all uses an explicit inspection ID, never a generic id. */
export type InspectionOrder = {
    inspection_order_id: number;
    status: string;
    created_at: string;
    inspection_template_id?: number;
    model_id?: number | null;
    assigned_tech_email?: string | null;
    operador_produccion?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    work_order_id?: number | null;
    work_order_id_real?: number | null;
    folio_sai?: string | null;
    estacion?: number | null;
    comments?: string | null;
    evidencias?: string[];
    inspection_type?: string | null;
    machine_serial?: string | null;
    customer_name?: string | null;
    site_address?: string | null;
    scheduled_at?: string | null;
    equipo?: string | null;
    titulo?: string | null;
    tasks?: InspectionTask[];
};

export const INSPECTION_STATUSES = ["OPEN", "PENDING", "IN_PROGRESS", "CLOSED", "FINISHED"] as const;
export type InspectionStatus = typeof INSPECTION_STATUSES[number];
export const STATUS_LABELS: Record<string, string> = {
    OPEN: "Abierta", PENDING: "Pendiente", IN_PROGRESS: "En proceso",
    CLOSED: "Cerrada", FINISHED: "Finalizada",
};
export type SearchScope = "all" | "inspection" | "production" | "folio" | "text";
export type ReleaseCode = "LIB001" | "LIB002";
export type ReleaseState = "PENDING" | "DONE" | "UNKNOWN";
export type ReleaseFilter = "" | `${ReleaseCode}:${ReleaseState}`;
export type ProductionReleaseOrder = {
    id: number;
    tasks: { id: number; work_order_id: number; code?: string | null; status: string }[];
};
export type ProductionReleases = ReadonlyMap<number, ProductionReleaseOrder>;
export const RELEASE_LABELS: Record<ReleaseState, string> = { PENDING: "Pendiente", DONE: "Completada", UNKNOWN: "Sin información verificable" };
export const RELEASE_FILTERS: ReadonlyArray<{ value: ReleaseFilter; label: string }> = [
    { value: "", label: "Todas las liberaciones" },
    ...(["LIB001", "LIB002"] as const).flatMap(code => (["PENDING", "DONE", "UNKNOWN"] as const)
        .map(state => ({ value: `${code}:${state}` as ReleaseFilter, label: `${code} · ${RELEASE_LABELS[state]}` }))),
];
export const SEARCH_SCOPES: ReadonlyArray<{ value: SearchScope; label: string }> = [
    { value: "all", label: "Todos los campos" },
    { value: "inspection", label: "ID de inspección" },
    { value: "production", label: "ID de orden de producción" },
    { value: "folio", label: "Folio SAI de producción" },
    { value: "text", label: "Cliente, serie, inspector o título" },
];

const normalized = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export function productionOrderId(order: InspectionOrder): number | null {
    return positiveInteger(order.work_order_id_real) ? order.work_order_id_real
        : positiveInteger(order.work_order_id) ? order.work_order_id : null;
}

/** Current work_order_task state, NOT the inspection's historical release. */
export function productionReleaseState(order: InspectionOrder, releases: ProductionReleases | undefined, code: ReleaseCode): ReleaseState | undefined {
    if (!releases) return undefined;
    const id = productionOrderId(order);
    const tasks = id === null ? [] : releases.get(id)?.tasks.filter(task => task.code === code) ?? [];
    if (tasks.length !== 1) return "UNKNOWN";
    if (tasks[0].status === "DONE") return "DONE";
    if (["OPEN", "PENDING", "IN_PROGRESS"].includes(tasks[0].status)) return "PENDING";
    return "UNKNOWN";
}

export function filterInspectionOrders(orders: readonly InspectionOrder[],
    { search = "", status = "", scope = "all", release = "", releases }: {
        search?: string; status?: InspectionStatus | ""; scope?: SearchScope;
        release?: ReleaseFilter; releases?: ProductionReleases;
    } = {}) {
    const needle = normalized(search);
    return orders.filter(order => {
        if (status && order.status !== status) return false;
        if (release) {
            const [code, state] = release.split(":") as [ReleaseCode, ReleaseState];
            if (productionReleaseState(order, releases, code) !== state) return false;
        }
        if (!needle) return true;
        const inspection = String(order.inspection_order_id) === needle;
        const production = productionOrderId(order) !== null && String(productionOrderId(order)) === needle;
        const folio = normalized(order.folio_sai).includes(needle);
        const text = [order.customer_name, order.machine_serial, order.assigned_tech_email, order.titulo]
            .some(value => normalized(value).includes(needle));
        switch (scope) {
            case "inspection": return inspection;
            case "production": return production;
            case "folio": return folio;
            case "text": return text;
            default: return inspection || production || folio || text;
        }
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Presentation only. No requester field is mapped from the current API10 contract. */
export function requesterLabel(registeredEmail?: string | null): string {
    return registeredEmail?.trim() || "Solicitante no registrado";
}

/** Inactive UI proposal. These inputs must come from a future authenticated
 * server contract; they do not authorize cancellation or validate client claims. */
export type CancellationConfirmation = {
    permission: "unconfirmed" | "allowed" | "denied";
    cancelableState: boolean;
    releaseEffectsConfirmed: boolean;
    transitionResultSupported: boolean;
};

export function cancellationProposalReady(confirmation?: CancellationConfirmation): boolean {
    return confirmation?.permission === "allowed" && confirmation.cancelableState
        && confirmation.releaseEffectsConfirmed && confirmation.transitionResultSupported;
}

export const LEGACY_INSPECTION_LIST_RESOURCE = "quality/inspection/orders_all?include=tasks";
export const LEGACY_INSPECTION_LIST_URL = `https://desarrollotecnologicoar.com/api10/${LEGACY_INSPECTION_LIST_RESOURCE}`;
export const LEGACY_RELEASE_RESOURCE = "inspection-production-releases";
export const LEGACY_RELEASE_URL = "https://desarrollotecnologicoar.com/api10/work-orders?include=tasks";

async function boundedJson(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = async () => {
        const response = await fetcher(url, { method: "GET", signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error(`No se pudieron consultar los datos (${response.status}).`), { statusCode: response.status });
        try { return await response.json(); } catch { throw new Error("La respuesta no es válida."); }
    };
    try {
        return await Promise.race([request(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error("Se agotó el tiempo de espera al consultar los datos."));
                controller.abort();
            }, timeoutMs);
        })]);
    } finally { clearTimeout(timer); }
}

export async function fetchInspectionPlantel(fetcher: typeof fetch = fetch, timeoutMs = 30000): Promise<InspectionOrder[]> {
        const data = await boundedJson(fetcher, LEGACY_INSPECTION_LIST_URL, timeoutMs);
        if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object"
            || !positiveInteger(row.inspection_order_id) || typeof row.status !== "string"
            || typeof row.created_at !== "string" || (row.tasks != null && !Array.isArray(row.tasks)))) {
            throw new Error("La respuesta de inspecciones no es válida.");
        }
        const orders = data as InspectionOrder[];
        if (new Set(orders.map(row => row.inspection_order_id)).size !== orders.length) {
            throw new Error("La respuesta contiene identificadores de inspección repetidos.");
        }
        return orders;
}

export async function fetchProductionReleases(fetcher: typeof fetch = fetch, timeoutMs = 30000): Promise<ProductionReleaseOrder[]> {
    const data = await boundedJson(fetcher, LEGACY_RELEASE_URL, timeoutMs);
    if (!Array.isArray(data) || data.some(order => !order || !positiveInteger(order.id) || !Array.isArray(order.tasks)
        || order.tasks.some((task: ProductionReleaseOrder["tasks"][number]) => !task || !positiveInteger(task.id)
            || task.work_order_id !== order.id || typeof task.status !== "string"))) {
        throw new Error("La respuesta de liberaciones de Producción no es válida.");
    }
    const orders = data as ProductionReleaseOrder[];
    if (new Set(orders.map(order => order.id)).size !== orders.length) throw new Error("Órdenes de producción repetidas.");
    return orders;
}

/** One manual refresh at a time; no polling and no automatic retry. */
export function createInspectionRefresh(refresh: () => Promise<unknown>) {
    let pending: Promise<void> | undefined;
    return () => {
        if (!pending) pending = Promise.resolve().then(refresh).then(() => undefined).finally(() => { pending = undefined; });
        return pending;
    };
}
