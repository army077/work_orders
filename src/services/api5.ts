import { IS_TEST, API5_ENABLED, API5_URL, assertApi5WriteEnabled } from "../config/api";

export async function getApi5Technicians<T>(): Promise<T[]> {
    if (IS_TEST || !API5_ENABLED) return [];

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

export async function sendApi5Notification(payload: { correoTecnico: string; ordenNumero?: string }): Promise<any> {
    const NOTIF_URL = "https://desarrollotecnologicoar.com/api5/enviarNotificacion/";
    const response = await fetch(NOTIF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.warn("API5 enviarNotificacion respondió:", data);
        return { ok: false, data };
    }
    return { ok: true, data };
}
