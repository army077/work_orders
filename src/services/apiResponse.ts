import type { HttpError } from "@refinedev/core";

/** Keep failed requests out of Refine's success/cache path. */
export async function fetchApi(input: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(20000),
        });
    } catch (cause) {
        const error: HttpError = {
            message: cause instanceof Error && cause.name === "TimeoutError"
                ? "La solicitud tardó demasiado. Intenta nuevamente."
                : "No se pudo conectar con la API.",
            statusCode: 0,
        };
        throw error;
    }
    if (!response.ok) {
        let body: unknown;
        try { body = await response.json(); } catch { body = null; }
        const detail = body && typeof body === "object" && "error" in body ? body.error : null;
        const error: HttpError = {
            message: typeof detail === "string" ? detail : `Error HTTP ${response.status}`,
            statusCode: response.status,
        };
        throw error;
    }
    return response;
}

/** Client errors are final; transient failures get at most one retry. */
export function retryApiQuery(failures: number, error: { statusCode?: number }): boolean {
    return !(error.statusCode && error.statusCode >= 400 && error.statusCode < 500) && failures < 1;
}
