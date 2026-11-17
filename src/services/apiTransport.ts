import axios from "axios";
import { IS_TEST, assertTestApiUrl } from "../config/api";
import { Api27AuthError } from "./api27Auth";
import type { Api27TokenProvider } from "./api27Auth";

// Intentionally unconfigured: no project/session contract for Production/Quality
// has been confirmed. No automatic import of the legacy Firebase app or login.
let api27TokenProvider: Api27TokenProvider | null = null;
export function setApi27TokenProvider(provider: Api27TokenProvider | null): void {
    if (!IS_TEST) throw new Error("La sesión API27 solo se configura en el cliente TEST aislado.");
    api27TokenProvider = provider;
}

async function sessionToken(provider: Api27TokenProvider): Promise<string> {
    try {
        const token = await provider();
        if (typeof token !== "string" || !token || /\s/.test(token)) throw new Api27AuthError();
        return token;
    } catch { throw new Api27AuthError(); }
}

async function authenticatedFetch(input: string, init: RequestInit | undefined, provider: Api27TokenProvider): Promise<Response> {
    const token = await sessionToken(provider);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    try {
        return await fetch(input, { ...init, headers, redirect: "error" });
    } catch (error) {
        // Never propagate request/header-bearing errors into page console.error calls.
        if (error instanceof Error && error.name === "TimeoutError") {
            const timeout = new Error("La solicitud a API27 tardó demasiado.");
            timeout.name = "TimeoutError";
            throw timeout;
        }
        throw new Error("No se pudo conectar con API27.");
    }
}

/** All main API fetch consumers share the TEST destination and redirect policy. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
    assertTestApiUrl(input);
    if (IS_TEST && api27TokenProvider) return authenticatedFetch(input, init, api27TokenProvider);
    return fetch(input, IS_TEST ? { ...init, redirect: "error" } : init);
}

// XHR follows redirects before an interceptor can inspect the destination.
// Only TEST uses Axios's installed fetch adapter so redirects can fail closed.
export const apiAxios = IS_TEST ? axios.create() : axios;
if (IS_TEST) {
    const authenticatedConfigs = new WeakSet<object>();
    apiAxios.interceptors.request.use(async config => {
        assertTestApiUrl(config.url ?? "");
        config.url = assertTestApiUrl(axios.getUri(config));
        config.baseURL = undefined;
        config.params = undefined;
        const provider = api27TokenProvider;
        if (provider) {
            const token = await sessionToken(provider);
            config.auth = undefined;
            config.headers.set("Authorization", `Bearer ${token}`);
            authenticatedConfigs.add(config);
        }
        config.adapter = "fetch";
        config.fetchOptions = { ...config.fetchOptions, redirect: "error" };
        config.env = {
            ...config.env,
            fetch: (input: RequestInfo | URL, init?: RequestInit) => {
                assertTestApiUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
                return fetch(input, { ...init, redirect: "error" });
            },
        };
        return config;
    });
    apiAxios.interceptors.response.use(undefined, error => {
        if (error instanceof Api27AuthError) throw error;
        if (!error?.config || !authenticatedConfigs.has(error.config)) throw error;
        const status = typeof error.response?.status === "number" ? error.response.status : 0;
        // AxiosError includes config.headers and request objects; pages log errors.
        // Preserve the HTTP status without exposing those credential-bearing objects.
        const safeError = Object.assign(new Error(status ? `Error HTTP ${status}` : "No se pudo conectar con API27."), {
            statusCode: status,
            response: status ? { status } : undefined,
        });
        throw safeError;
    });
}
