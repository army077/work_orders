// src/pages/WorkOrdersList.tsx
import React from "react";
import { useList } from "@refinedev/core";
import { Link } from "react-router-dom";

type WorkOrder = {
  id: number;
  template_id: number | null;
  template_version: number | null;
  model_id: number | null;
  machine_serial: string | null;
  customer_name: string | null;
  site_address: string | null;
  assigned_tech_email: string | null;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED" | string;
  scheduled_at: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

const fdt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";

const statusClass = (st?: string) => {
  const m: Record<string, string> = {
    OPEN: "status-ok",
    IN_PROGRESS: "status-follow_up",
    CLOSED: "status-na",
  };
  return `status-chip ${m[st || ""] || "status-na"}`;
};

export default function WorkOrdersList() {
  const [q, setQ] = React.useState("");
  const [st, setSt] = React.useState<"" | "OPEN" | "IN_PROGRESS" | "CLOSED">("");

  const { data, isLoading } = useList<WorkOrder>({
    resource: "work-orders",
    pagination: { pageSize: 500 }, // ajusta si quieres paginar
  });

  const items = React.useMemo(() => {
    const arr = (data?.data ?? []).slice().sort((a, b) => {
      const ad = a.scheduled_at || "";
      const bd = b.scheduled_at || "";
      return ad.localeCompare(bd); // orden por fecha programada
    });

    const needle = q.trim().toLowerCase();
    return arr.filter((w) => {
      const passStatus = st ? w.status === st : true;
      if (!needle) return passStatus;
      const hay = [
        w.customer_name,
        w.machine_serial,
        w.site_address,
        w.assigned_tech_email,
        String(w.id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return passStatus && hay.includes(needle);
    });
  }, [data?.data, q, st]);

  return (
    <div className="card">
      <h2>Work Orders</h2>
      <p className="muted">Listado de órdenes de trabajo.</p>

      {/* Controles */}
      <div className="row cols-3" style={{ alignItems: "end" }}>
        <div>
          <label>Buscar</label>
          <input
            placeholder="Cliente, serie, sitio, email, ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label>Estatus</label>
          <select value={st} onChange={(e) => setSt(e.target.value as any)}>
            <option value="">Todos</option>
            <option value="OPEN">OPEN</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
        <div>
          <label>Resultados</label>
          <div className="badge">{items.length}</div>
        </div>
      </div>

      <br />

      {/* Lista */}
      {isLoading ? (
        <div className="badge">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="badge">No hay órdenes.</div>
      ) : (
        <div className="list-tiles">
          {items.map((w) => (
            <div key={w.id} className="list-tile">
              {/* leading */}
              <div className="list-tile__leading" aria-hidden>
                <div className="avatar">#{w.id}</div>
              </div>

              {/* content */}
              <div className="list-tile__content">
                <div className="list-tile__title">
                  {w.customer_name || "—"} · {w.machine_serial || "—"}
                </div>
                <div className="list-tile__subtitle">
                  Programada: {fdt(w.scheduled_at)} · Creada: {fdt(w.created_at)}
                  <br />
                  Sitio: {w.site_address || "—"} · Técnico: {w.assigned_tech_email || "—"}
                </div>
              </div>

              {/* trailing */}
              <div className="list-tile__trailing">
                <span className={statusClass(w.status)}>{w.status || "—"}</span>
                <Link className="btn" to={`/run-work-order/${w.id}`}>
                  Abrir
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}