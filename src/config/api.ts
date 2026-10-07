const appEnv = import.meta.env.VITE_APP_ENV;
const api10Url = import.meta.env.VITE_API10_URL;

if (!appEnv) {
    throw new Error("Falta la variable de entorno VITE_APP_ENV");
}

if (!api10Url) {
    throw new Error("Falta la variable de entorno VITE_API10_URL");
}

if (!["local", "test", "production"].includes(appEnv)) {
    throw new Error(
        "VITE_APP_ENV no válido. Valores permitidos: local, test, production"
    );
}

let parsedUrl: URL;
try {
    parsedUrl = new URL(api10Url);
} catch {
    throw new Error("VITE_API10_URL debe ser una URL absoluta válida");
}

if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("VITE_API10_URL debe usar HTTP o HTTPS");
}

if (appEnv === "local" && api10Url !== "http://localhost:3010/api10") {
    throw new Error(
        "VITE_APP_ENV=local solo permite VITE_API10_URL=http://localhost:3010/api10"
    );
}

export const API10_URL: string = api10Url;

// API5 nunca se habilita en local, incluso si VITE_API5_ENABLED=true.
export const API5_ENABLED =
    appEnv !== "local" && import.meta.env.VITE_API5_ENABLED === "true";
export const API5_URL: string =
    (import.meta.env.VITE_API5_URL ?? "").replace(/\/+$/, "");

if (API5_ENABLED) {
    let parsedApi5Url: URL;
    try {
        parsedApi5Url = new URL(API5_URL);
    } catch {
        throw new Error("VITE_API5_URL debe ser una URL absoluta válida cuando API5 está habilitada");
    }
    if (!["http:", "https:"].includes(parsedApi5Url.protocol)) {
        throw new Error("VITE_API5_URL debe usar HTTP o HTTPS");
    }
}

export function assertApi5WriteEnabled(endpoint: string): void {
    if (!API5_ENABLED) {
        throw new Error(
            appEnv === "local"
                ? `API5: POST ${endpoint} bloqueado en entorno local`
                : `API5: POST ${endpoint} bloqueado porque VITE_API5_ENABLED no es true`
        );
    }
}
