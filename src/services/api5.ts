import { API5_ENABLED, API5_URL, assertApi5WriteEnabled } from "../config/api";

export async function getApi5Technicians<T>(): Promise<T[]> {
    if (!API5_ENABLED) return [];

    const response = await fetch(`${API5_URL}/tecnicos`);
    if (!response.ok) throw new Error(`API5: error cargando técnicos (HTTP ${response.status})`);
    return response.json();
}

async function postApi5(endpoint: string, payload: unknown): Promise<Response> {
    assertApi5WriteEnabled(endpoint);

    const response = await fetch(`${API5_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `API5: error en POST ${endpoint} (HTTP ${response.status})`);
    }
    return response;
}

export async function addApi5Technician<T>(payload: unknown): Promise<T> {
    const response = await postApi5("/agregar_tecnico", payload);
    return response.json();
}

export function sendApi5Notification(payload: unknown): Promise<Response> {
    return postApi5("/enviarNotificacion/", payload);
}
