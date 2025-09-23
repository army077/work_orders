// src/pages/Templates.tsx
import React from "react";
import { useList, useCreate, useCustomMutation, useDataProvider } from "@refinedev/core";
import TemplateDetailsDrawer from "./components/TemplateDetailsDrawer";
import type { Template } from "./components/TemplateDetailsDrawer";

type MachineModel = {
  id: number;
  name: string;
  manufacturer?: string | null;
  family_name?: string | null;
};

type Section = { id: number; template_id: number; title: string; position: number; };
type Task = { id: number; section_id: number; title: string; code: string | null; expected_minutes: number | null; position: number; };


/* ---------------------------------------------------------------- */

export default function Templates() {

  const [openTmpl, setOpenTmpl] = React.useState<Template | null>(null);

  // Templates
  const { data, refetch, isLoading } = useList<Template>({
    resource: "templates",
    pagination: { pageSize: 200 },
  });

  // Modelos (para el select)
  const { data: modelsRes, isLoading: loadingModels } = useList<MachineModel>({
    resource: "machine-models",
    pagination: { pageSize: 500 },
  });

  const modelOptions = React.useMemo(() => {
    const list = modelsRes?.data ?? [];
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((m) => ({
        id: m.id,
        label: [
          m.name,
          m.manufacturer ? ` · ${m.manufacturer}` : "",
          m.family_name ? ` · ${m.family_name}` : "",
        ]
          .join("")
          .trim(),
      }));
  }, [modelsRes?.data]);

  const getModelLabel = (id?: number | null) => {
    if (!id) return "—";
    const found = modelOptions.find((o) => o.id === id);
    return found?.label ?? `Modelo #${id}`;
  };

  const { mutate: createMutate, isLoading: creating } = useCreate();
  const { mutate: publishMutate, isLoading: publishing } = useCustomMutation();

  const [form, setForm] = React.useState<{ name: string; template_type: string; model_id: string }>({
    name: "",
    template_type: "MANTENIMIENTO",
    model_id: "",
  });

  const [infoTemplate, setInfoTemplate] = React.useState<Template | null>(null);

  const onCreate = () => {
    const name = form.name.trim();
    if (!name) return alert("Falta el nombre");
    createMutate(
      {
        resource: "templates",
        values: {
          name,
          template_type: form.template_type,
          model_id: form.model_id ? Number(form.model_id) : null,
        },
      },
      {
        onSuccess: () => {
          setForm({ name: "", template_type: "MANTENIMIENTO", model_id: "" });
          refetch();
        },
      }
    );
  };

  const onPublish = (id: number) => {
    publishMutate(
      {
        url: `/templates/${id}/publish`,
        method: "post",
        values: {},
        meta: { headers: { "Content-Type": "application/json" } },
      },
      { onSuccess: () => refetch() }
    );
  };

  const items = React.useMemo(() => {
    const arr = data?.data ?? [];
    return arr.slice().sort((a, b) => {
      if (a.is_published !== b.is_published) return a.is_published ? -1 : 1;
      return a.name.localeCompare(b.name, "es");
    });
  }, [data?.data]);

  return (
    <div className="card">
      <h2>Templates</h2>
      <p className="muted">Crea nuevas plantillas y publícalas cuando estén listas.</p>

      {/* Crear */}
      <div className="row cols-3" style={{ alignItems: "end" }}>
        <div>
          <label>Nombre</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ej. Mantenimiento preventivo VMC-850"
          />
        </div>
        <div>
          <label>Tipo</label>
          <select
            value={form.template_type}
            onChange={(e) => setForm((f) => ({ ...f, template_type: e.target.value }))}
          >
            <option value="MANTENIMIENTO">MANTENIMIENTO</option>
            <option value="INSTALACION">INSTALACION</option>
            <option value="DIAGNOSTICO">DIAGNOSTICO</option>
            <option value="REPARACION">REPARACION</option>
          </select>
        </div>
        <div>
          <label>Modelo</label>
          <select
            value={form.model_id}
            onChange={(e) => setForm((f) => ({ ...f, model_id: e.target.value }))}
            disabled={loadingModels}
          >
            <option value="">— seleccionar modelo —</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {loadingModels && <div className="muted" style={{ marginTop: 6 }}>Cargando modelos…</div>}
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={onCreate} disabled={creating || loadingModels}>
            {creating ? "Creando…" : "Crear plantilla"}
          </button>
        </div>
      </div>

      <br />

      {/* Lista tipo ListTile */}
      {isLoading ? (
        <div className="badge">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="badge">No hay plantillas aún.</div>
      ) : (
        <div className="list-tiles">
          {items.map((t) => (
            <div key={t.id} className="list-tile">
              <div className="list-tile__leading" aria-hidden>
                <div className="avatar">{t.name.slice(0, 1).toUpperCase()}</div>
              </div>
              <div className="list-tile__content">
                <div className="list-tile__title">{t.name}</div>
                <div className="list-tile__subtitle">
                  {(t.model_name && t.model_name.trim()) || getModelLabel(t.model_id)} ·{" "}
                  {String(t.template_type).toUpperCase()} · ID #{t.id}
                </div>
              </div>

              <div className="list-tile__trailing" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setOpenTmpl(t)} title="Ver detalles">
                  ⓘ
                </button>
                <span className="pill">v{t.version}</span>
                {t.is_published ? (
                  <span className="pill pill--ok">Publicado</span>
                ) : (
                  <button
                    className="btn btn--primary"
                    onClick={() => onPublish(t.id)}
                    disabled={publishing}
                  >
                    {publishing ? "Publicando…" : "Publicar"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer */}
      {openTmpl && (
        <TemplateDetailsDrawer
          template={openTmpl}
          onClose={() => setOpenTmpl(null)}
        />
      )}
    </div>
  );
}