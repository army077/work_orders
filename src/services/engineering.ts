import { dataProvider } from "../dataProvider";

export type DocumentStatus = "BORRADOR" | "VIGENTE" | "OBSOLETO" | "RETIRADO";

export type NormalizedMachine = {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  updated_at: string;
};

export type VersionSummary = { id: number; revision: number; status: DocumentStatus };

export type EngineeringDocument = {
  id: number;
  maquina_id: number;
  code: string;
  title: string;
  document_type: "INSTALACION_EXITOSA";
  machine_name: string;
  machine_active: boolean;
  updated_at: string;
  versions: VersionSummary[];
};

export type EngineeringVersion = VersionSummary & {
  pdf_url: string;
  change_summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_by: string | null;
  published_at: string | null;
  retired_by: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
};

export type EngineeringEvent = {
  id: number;
  action: string;
  actor: string;
  reason: string;
  version_id: number | null;
  created_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

export type DocumentDetail = Omit<EngineeringDocument, "versions"> & {
  versions: EngineeringVersion[];
  events: EngineeringEvent[];
};

const API_URL = `${import.meta.env.VITE_API10_URL || dataProvider.getApiUrl()}/engineering`;

export async function engineeringRequest<T>(
  path: string,
  options: { method?: "POST" | "PUT"; body?: object; signal?: AbortSignal } = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    signal: options.signal,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = `Error ${response.status}: no se pudo completar la operación`;
    if (raw) {
      try {
        const payload: unknown = JSON.parse(raw);
        if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
          message = payload.error;
        }
      } catch {
        message = `Error ${response.status}: la API no devolvió una respuesta JSON`;
      }
    }
    throw new Error(message);
  }
  return response.json();
}

export const statusLabels: Record<DocumentStatus, string> = {
  BORRADOR: "Borrador",
  VIGENTE: "Vigente",
  OBSOLETO: "Obsoleto",
  RETIRADO: "Retirado",
};

export function safePdfLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
