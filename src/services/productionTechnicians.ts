import type { HttpError } from "@refinedev/core";
import { API10_URL, IS_TEST } from "../config/api";
import { getApi5Technicians } from "./api5";
import { fetchApi } from "./apiResponse";
import { isPositiveId } from "./catalogQueries";

/** The quality catalog contains production operators, not a general service roster. */
export async function getProductionTechnicians<T>(): Promise<T[]> {
    if (!IS_TEST) return getApi5Technicians<T>();
    const response = await fetchApi(`${API10_URL}/quality/inspectors`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.some(row => !row || !isPositiveId(row.id) ||
        ["nombre_tecnico", "correo_tecnico", "estatus", "sucursal", "puesto"].some(field => typeof row[field] !== "string") ||
        !row.nombre_tecnico.trim() || !row.correo_tecnico.trim())) {
        throw { message: "El catálogo de operadores no corresponde al contrato esperado.", statusCode: 502 } satisfies HttpError;
    }
    // Never offer quality supervisors or inactive operators as production assignees.
    return rows.filter(row => row.puesto === "Operador de producción" && row.estatus.trim().toLowerCase() === "activo") as T[];
}
