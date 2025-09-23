import React, { useMemo, useState, useEffect } from "react";
import { useList, useCreate } from "@refinedev/core";

type Template = { id:number; name:string; version:number; model_id:number; is_published:boolean; };

type Technician = {
  id: number;
  estatus: string;
  sucursal: string;
  nombre_tecnico: string;
  correo_tecnico: string;
  telefono: string;
  puesto: string;
  nombre_bonos: string;
};

// helpers
const isoToDateInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const dateToIsoAt1600Z = (yyyyMmDd: string) =>
  yyyyMmDd ? new Date(`${yyyyMmDd}T16:00:00Z`).toISOString() : "";

export default function CreateWorkOrderFromTemplate() {
  const { data: tpls } = useList<Template>({ resource: "templates", pagination:{ pageSize: 200 } });
  const published = useMemo(()=> (tpls?.data ?? []).filter(t=>t.is_published), [tpls?.data]);

  // fecha default: hoy a las 16:00Z
  const today = new Date();
  const pad = (n:number)=>`${n}`.padStart(2,"0");
  const todayStr = `${today.getUTCFullYear()}-${pad(today.getUTCMonth()+1)}-${pad(today.getUTCDate())}`;

  const [form, setForm] = useState({
    template_id: "",
    machine_serial: "",
    customer_name: "",
    site_address: "",
    assigned_tech_email: "",
    scheduled_at: dateToIsoAt1600Z(todayStr),
  });

  // --- técnicos (API externa) ---
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loadingTechs, setLoadingTechs] = useState(false);
  const [techsError, setTechsError] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoadingTechs(true);
        setTechsError(null);
        const res = await fetch("https://desarrollotecnologicoar.com/api5/tecnicos");
        const data: Technician[] = await res.json();
        if (!cancel) setTechs(data.filter(t => (t.estatus || "").toLowerCase() === "activo"));
      } catch (e:any) {
        if (!cancel) setTechsError(e?.message || "No se pudieron cargar los técnicos");
      } finally {
        if (!cancel) setLoadingTechs(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const { mutate, isLoading } = useCreate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.template_id) return;
    mutate(
      {
        resource: "work-orders",
        values: {
          fromTemplate: true,
          payload: {
            template_id: Number(form.template_id),
            machine_serial: form.machine_serial,
            customer_name: form.customer_name,
            site_address: form.site_address,
            assigned_tech_email: form.assigned_tech_email || null,
            scheduled_at: form.scheduled_at || null,
          },
        },
      },
      {
        onSuccess: ({ data }) => {
          alert(`Work order creada: ID ${data.id}`);
        },
        onError: (err) => {
          alert(`Error: ${String((err as any)?.message || err)}`);
        },
      }
    );
  };

  const onChange =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f)=>({ ...f, [k]: e.target.value }));

  return (
    <div className="card">
      <h2>Create Work Order from Template</h2>
      <p className="muted">
        Publica tu plantilla y luego crea una orden materializada (snapshot de secciones y tareas).
      </p>

      <form className="row" onSubmit={onSubmit}>
        <div className="row cols-3">
          <div>
            <label>Template (published)</label>
            <select
              value={form.template_id}
              onChange={(e)=>setForm((f)=>({ ...f, template_id: e.target.value }))}
            >
              <option value="">— seleccionar —</option>
              {published.map(t=>(
                <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>
              ))}
            </select>
          </div>

          <div>
            <label>Machine Serial</label>
            <input value={form.machine_serial} onChange={onChange("machine_serial")} />
          </div>

          <div>
            <label>Scheduled At (elige día · se guarda 16:00Z ≈ 09:00 MX)</label>
            <input
              type="date"
              value={isoToDateInput(form.scheduled_at)}
              onChange={(e) =>
                setForm((f) => ({ ...f, scheduled_at: dateToIsoAt1600Z(e.target.value) }))
              }
            />
          </div>
        </div>

        <div className="row cols-3">
          <div>
            <label>Customer Name</label>
            <input value={form.customer_name} onChange={onChange("customer_name")} />
          </div>

          <div>
            <label>Site Address</label>
            <input value={form.site_address} onChange={onChange("site_address")} />
          </div>

          {/* ====== Assigned Tech (select con API) ====== */}
          <div>
            <label>Assigned Tech Email</label>

            {!manualEmail ? (
              <select
                value={form.assigned_tech_email}
                onChange={onChange("assigned_tech_email")}
                disabled={loadingTechs || !!techsError}
              >
                <option value="">{loadingTechs ? "Cargando técnicos…" : "— seleccionar técnico —"}</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.correo_tecnico}>
                    {t.nombre_tecnico} · {t.sucursal} · {t.correo_tecnico}
                  </option>
                ))}
                <option value="__manual__">Escribir manualmente…</option>
              </select>
            ) : (
              <input
                type="email"
                placeholder="correo@ejemplo.com"
                value={form.assigned_tech_email}
                onChange={onChange("assigned_tech_email")}
              />
            )}

            {/* toggle */}
            <div className="muted" style={{ marginTop: 6 }}>
              {manualEmail ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setManualEmail(false); setForm(f => ({...f, assigned_tech_email: ""})); }}
                >
                  ← Usar lista de técnicos
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setManualEmail(true); setForm(f => ({...f, assigned_tech_email: ""})); }}
                >
                  Escribir manualmente
                </button>
              )}
            </div>

            {techsError && <div className="badge fail" style={{marginTop:6}}>Error: {techsError}</div>}
          </div>
        </div>

        <div style={{ display:"flex", gap:8, marginTop: 16 }}>
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Creando…" : "Create Work Order"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={()=>setForm({
              template_id:"",
              machine_serial:"",
              customer_name:"",
              site_address:"",
              assigned_tech_email:"",
              scheduled_at: dateToIsoAt1600Z(todayStr),
            })}
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}