const appEnv = import.meta.env.VITE_APP_ENV;
const api10Url = import.meta.env.VITE_API10_URL;

export const IS_TEST = appEnv === "test";
export const API27_TEST_URL = "https://desarrollotecnologicoar.com/api27";
export const TEST_EXTERNAL_ADMIN_MESSAGE =
    "La administración externa de técnicos está deshabilitada en TEST (API5/Firebase/Firestore).";

// Compare the raw value: URL normalization would hide ports, dot segments or whitespace.
if (IS_TEST && (api10Url !== API27_TEST_URL || import.meta.env.VITE_API5_ENABLED !== "false")) {
    throw new Error("TEST_API27_CONFIG: se requiere la URL exacta de API27 y VITE_API5_ENABLED=false");
}

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
    !IS_TEST && appEnv !== "local" && import.meta.env.VITE_API5_ENABLED === "true";
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
    if (IS_TEST) throw new Error("TEST_API27_API5: API5 está deshabilitada en TEST");
    if (!API5_ENABLED) {
        throw new Error(
            appEnv === "local"
                ? `API5: POST ${endpoint} bloqueado en entorno local`
                : `API5: POST ${endpoint} bloqueado porque VITE_API5_ENABLED no es true`
        );
    }
}

/** Validate the raw path before URL/browser/server normalization can hide a bypass. */
export function assertTestApiUrl(input: string): string {
    if (!IS_TEST) return input;
    const blocked = () => { throw new Error("TEST_API27_DESTINATION: destino fuera de API27 o ruta no válida"); };
    if (typeof input !== "string" || !input.startsWith(API27_TEST_URL) ||
        input.trim() !== input || /[\u0000-\u001f\u007f\\#]/.test(input)) return blocked();

    const suffix = input.slice(API27_TEST_URL.length);
    if (suffix && !suffix.startsWith("/") && !suffix.startsWith("?")) return blocked();
    const path = suffix.split("?")[0];
    // Encoded separators, dots and double encoding are unnecessary for these API routes.
    if (!/^[a-zA-Z0-9_~./%-]*$/.test(path) || path.includes("//") ||
        /%(?:2e|2f|5c|25)/i.test(path) || path.split("/").some(part => part === "." || part === "..")) {
        return blocked();
    }
    try {
        const decodedPath = decodeURIComponent(path);
        if (!/^[a-zA-Z0-9_~./-]*$/.test(decodedPath)) return blocked();
        const parsed = new URL(input);
        if (parsed.origin !== "https://desarrollotecnologicoar.com" ||
            (parsed.pathname !== "/api27" && !parsed.pathname.startsWith("/api27/"))) return blocked();
    } catch { return blocked(); }
    return input;
}

export function resolveCustomApiUrl(input: string): string {
    if (!IS_TEST) return input.startsWith("http") ? input : `${API10_URL}${input}`;
    if (typeof input !== "string" || !input || input.startsWith("//")) {
        throw new Error("TEST_API27_DESTINATION: ruta custom no válida");
    }
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(input);
    const url = absolute ? input : `${API10_URL}${input.startsWith("/") || input.startsWith("?") ? "" : "/"}${input}`;
    return assertTestApiUrl(url);
}
