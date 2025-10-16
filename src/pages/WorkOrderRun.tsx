import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useOne, useUpdate, useCustom } from "@refinedev/core";

type WorkOrder = {
  id: number;
  template_id: number;
  template_version: number;
  model_id: number;
  machine_serial: string;
  customer_name: string;
  site_address: string;
  assigned_tech_email: string;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED" | string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type WorkTask = {
  id: number;
  work_order_id: number;
  section_title: string;
  task_title: string;
  code: string;
  expected_minutes: number;
  position: number;
  status: "OK" | "SEGUIMIENTO" | "CRITICO" | "NA" | null;
  observation: string | null;
  actual_minutes: number | null;
  photo_url: string | null;
};
type StatusOpt = "OK" | "SEGUIMIENTO" | "CRITICO" | "NA";

export default function WorkOrderRun() {
  const { id } = useParams();
  const orderId = Number(id);

  // --- HEADER: GET /work-orders/:id (usa dataProvider.custom) ---
  const { data: woRes, isLoading: loadingHeader, isError: headerError } = useCustom<WorkOrder>({
    url: `/work-orders/${orderId}`,
    method: "get",
  });
  const wo = woRes?.data;

  // --- CHECKLIST materializado (como ya lo tenías): /work-orders/:id/tasks ---
  const { data, refetch, isLoading } = useOne<WorkTask[]>({
    resource: "work-orders",
    id: orderId,
    queryOptions: { enabled: Number.isFinite(orderId) },
  });

  const tasks = (data?.data ?? []).slice().sort((a, b) => a.position - b.position);

  const groups = useMemo(() => {
    const g: Record<string, WorkTask[]> = {};
    tasks.forEach((t) => {
      if (!g[t.section_title]) g[t.section_title] = [];
      g[t.section_title].push(t);
    });
    return g;
  }, [tasks]);

  const totals = useMemo(() => {
    const overall = { expected: 0, actual: 0 };
    const bySection: Record<string, { expected: number; actual: number }> = {};
    Object.entries(groups).forEach(([sec, arr]) => {
      const exp = arr.reduce((acc, t) => acc + (t.expected_minutes || 0), 0);
      const act = arr.reduce((acc, t) => acc + (t.actual_minutes || 0), 0);
      bySection[sec] = { expected: exp, actual: act };
      overall.expected += exp;
      overall.actual += act;
    });
    return { overall, bySection };
  }, [groups]);

  const { mutate: updateTask } = useUpdate();

  // Estado local para el select de status
  const [draft, setDraft] = useState<Record<number, Partial<WorkTask>>>({});

  useEffect(() => {
    const map: Record<number, Partial<WorkTask>> = {};
    tasks.forEach((t) => {
      map[t.id] = {
        status: t.status ?? "NA",
        observation: t.observation ?? "",
        actual_minutes: t.actual_minutes ?? 0,
        photo_url: t.photo_url ?? "",
      };
    });
    setDraft(map);
  }, [data?.data?.length]);

  const setField = (taskId: number, patch: Partial<WorkTask>) => {
    setDraft((d) => ({ ...d, [taskId]: { ...(d[taskId] ?? {}), ...patch } }));
  };

  // ------- MODAL -------
  const [modalTask, setModalTask] = useState<WorkTask | null>(null);
  const [modalForm, setModalForm] = useState<{ minutes: string; obs: string; url: string }>({
    minutes: "",
    obs: "",
    url: "",
  });

  const openModal = (t: WorkTask) => {
    const d = draft[t.id] ?? {};
    setModalTask(t);
    setModalForm({
      minutes: String(d.actual_minutes ?? t.actual_minutes ?? 0),
      obs: d.observation ?? t.observation ?? "",
      url: d.photo_url ?? t.photo_url ?? "",
    });
  };
  const closeModal = () => setModalTask(null);

  const submitModal = () => {
    if (!modalTask) return;
    const t = modalTask;
    const d = draft[t.id] ?? {};
    const minutes = Number(modalForm.minutes || 0);

    updateTask(
      {
        resource: "work-order-task",
        id: t.id,
        values: {
          status: (d.status ?? t.status) as StatusOpt,
          observation: modalForm.obs,
          actual_minutes: minutes,
          photo_url: modalForm.url || null,
        },
      },
      {
        onSuccess: () => {
          closeModal();
          refetch();
        },
      }
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
      if (e.key === "Enter" && modalTask) {
        e.preventDefault();
        submitModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalTask, modalForm]);

  // Helpers
  const statusClass = (s: StatusOpt | null | undefined) =>
    `status-chip status-${((s ?? "NA") as StatusOpt).toLowerCase()}`;

  const truncate = (s?: string | null, n = 50) =>
    !s ? "Sin observaciones" : s.length > n ? `${s.slice(0, n)}…` : s;

  const fDateTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString() : "—";

  const woStatusPill = (st?: string) => {
    const map: Record<string, string> = {
      OPEN: "wo-badge wo-badge--open",
      IN_PROGRESS: "wo-badge wo-badge--running",
      CLOSED: "wo-badge wo-badge--closed",
    };
    return map[st || ""] || "wo-badge";
  };

  return (
    <div className="card">
      <h2>Run Work Order</h2>
      <p className="muted">
        Checklist materializado de la orden #{orderId}. Cada cambio se guarda por ítem.
      </p>

      {/* ======= RESUMEN ATRACTIVO (header) ======= */}
      <div className="wo-summary" style={{ marginBottom: 16 }}>
        {loadingHeader ? (
          <div className="badge">Cargando cabecera…</div>
        ) : headerError ? (
          <div className="badge fail">No se pudo cargar la cabecera</div>
        ) : wo ? (
          <>
            <div className="wo-summary__title">Detalle de la orden #{orderId}</div>
            <div className="wo-summary__grid">
              <div className="info">
                <div className="info__label">Cliente</div>
                <div className="info__value">{wo.customer_name || "—"}</div>
                <div className="info__sub">{wo.site_address || "—"}</div>
              </div>
              <div className="info">
                <div className="info__label">Máquina</div>
                <div className="info__value">{wo.machine_serial || "—"}</div>
                <div className="info__sub">Modelo ID: {wo.model_id ?? "—"}</div>
              </div>
              <div className="info">
                <div className="info__label">Programada</div>
                <div className="stack">
                  <span className="chip"><i>📅</i>{fDateTime(wo.scheduled_at)}</span>
                  <span className="chip"><i>🕒</i>Creada: {fDateTime(wo.created_at)}</span>
                </div>
              </div>
              <div className="info">
                <div className="info__label">Estado</div>
                <span className={woStatusPill(wo.status)}>{wo.status}</span>
                <div className="info__label" style={{ marginTop: 8 }}>Técnico</div>
                <div className="info__sub">{wo.assigned_tech_email || "—"}</div>
                <div className="info__label" style={{ marginTop: 8 }}>Tiempos</div>
                <div className="info__sub">
                  Inicio: {fDateTime(wo.started_at)} · Fin: {fDateTime(wo.finished_at)}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="badge fail">Orden no encontrada</div>
        )}
      </div>

      {isLoading ? <div className="badge">Cargando checklist…</div> : null}

      <div className="wo-grid">
        {/* Totales */}
        <aside className="totals card">
          <h3>Totales por sección</h3>
          <table className="table compact">
            <thead>
              <tr><th>Sección</th><th>Esperado</th><th>Actual</th></tr>
            </thead>
            <tbody>
              {Object.entries(totals.bySection).map(([sec, v]) => (
                <tr key={sec}><td>{sec}</td><td>{v.expected} min</td><td>{v.actual} min</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th>{totals.overall.expected} min</th>
                <th>{totals.overall.actual} min</th>
              </tr>
            </tfoot>
          </table>
        </aside>

        {/* Secciones + tareas */}
        <section className="sections card">
          {Object.entries(groups).map(([sec, arr]) => (
            <div key={sec} className="section-block">
              <div className="section-header">
                <h3>{sec}</h3>
                <div className="section-meta">
                  <span className="pill">
                    {arr.reduce((a, t) => a + (t.expected_minutes || 0), 0)} min esperados
                  </span>
                </div>
              </div>

              <div className="tasks">
                {arr.map((t) => (
                  <article key={t.id} className="task-card">
                    <header className="task-head">
                      <div className="task-left">
                        <span className="pos">#{t.position}</span>
                        <div className="title-wrap">
                          <div className="task-title">{t.task_title}</div>
                          <div className="task-sub">{t.code || "—"}</div>
                          <div className="task-observation">{truncate(t.observation ?? "", 50)}</div>
                        </div>
                      </div>
                      <div className="task-right">
                        <span className="pill">{t.expected_minutes ?? 0} min</span>
                      </div>
                    </header>

                    <div className="task-body">
                      <div className="field">
                        <label>Status</label>
                        <select
                          className={statusClass(draft[t.id]?.status as StatusOpt)}
                          value={(draft[t.id]?.status as StatusOpt) ?? "NA"}
                          onChange={(e) => setField(t.id, { status: e.target.value as StatusOpt })}
                        >
                          <option value="OK">OK</option>
                          <option value="SEGUIMIENTO">SEGUIMIENTO</option>
                          <option value="CRITICO">CRITICO</option>
                          <option value="NA">NA</option>
                          <option value="PENDIENTE">PENDIENTE</option>
                        </select>
                      </div>

                      <div className="actions">
                        <span className={statusClass(draft[t.id]?.status as StatusOpt)}>
                          {(draft[t.id]?.status as StatusOpt) ?? "NA"}
                        </span>
                        <button className="btn-save" onClick={() => openModal(t)}>
                          Guardar
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* -------- Modal -------- */}
      {modalTask && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Registrar tarea</h3>
            <p className="muted" style={{ marginTop: -6 }}>
              {modalTask.section_title} · #{modalTask.position} · <strong>{modalTask.task_title}</strong>
            </p>

            <div className="row cols-3" style={{ marginTop: 12 }}>
              <div>
                <label>Actual (min)</label>
                <input
                  type="number"
                  min={0}
                  value={modalForm.minutes}
                  onChange={(e) => setModalForm((s) => ({ ...s, minutes: e.target.value }))}
                />
              </div>
              <div className="colspan-2">
                <label>Observaciones</label>
                <input
                  value={modalForm.obs}
                  onChange={(e) => setModalForm((s) => ({ ...s, obs: e.target.value }))}
                  placeholder="Observaciones…"
                />
              </div>
              <div className="colspan-3">
                <label>Photo URL</label>
                <input
                  value={modalForm.url}
                  onChange={(e) => setModalForm((s) => ({ ...s, url: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={closeModal}>Cancelar</button>
              <button className="btn btn--ok" onClick={submitModal}>Cargar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}