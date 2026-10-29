import axios from "axios";
import { IS_TEST, assertTestApiUrl } from "../config/api";

/** All main API fetch consumers share the TEST destination and redirect policy. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
    assertTestApiUrl(input);
    return fetch(input, IS_TEST ? { ...init, redirect: "error" } : init);
}

// XHR follows redirects before an interceptor can inspect the destination.
// Only TEST uses Axios's installed fetch adapter so redirects can fail closed.
export const apiAxios = IS_TEST ? axios.create() : axios;
if (IS_TEST) {
    apiAxios.interceptors.request.use(config => {
        assertTestApiUrl(config.url ?? "");
        config.url = assertTestApiUrl(axios.getUri(config));
        config.baseURL = undefined;
        config.params = undefined;
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
}
