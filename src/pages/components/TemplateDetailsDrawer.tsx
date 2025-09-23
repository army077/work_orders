// src/pages/components/TemplateDetailsDrawer.tsx
import React from "react";
import { useApiUrl, useList } from "@refinedev/core";

export type Template = {
  id: number;
  name: string;
  template_type: "MANTENIMIENTO" | "INSTALACION" | string;
  model_id: number | null;
  version: number;
  is_published: boolean;
  model_name?: string | null;
};

type Section = {
  id: number;
  template_id: number;
  title: string;
  position: number;
};

type Task = {
  id: number;
  section_id: number;
  title: string;
  code: string | null;
  expected_minutes: number | null;
  position: number;
};

type Props = {
  template: Template | null;
  onClose: () => void;
};

const truncate = (s: string | null | undefined, n = 60) =>
  !s ? "—" : s.length > n ? `${s.slice(0, n)}…` : s;

/* ====== SKELETON: tarjeta de carga ====== */
const SkeletonCard: React.FC<{ lines?: number }> = ({ lines = 3 }) => {
  return (
    <div className="skeleton-card">
      <div className="sk-avatar" />
      <div className="sk-lines">
        {[...Array(lines)].map((_, i) => (
          <div
            key={i}
            className="sk-line"
            style={{ width: i === 0 ? "70%" : i === lines - 1 ? "85%" : "95%" }}
          />
        ))}
      </div>
    </div>
  );
};

export default function TemplateDetailsDrawer({ template, onClose }: Props) {
  const apiUrl = useApiUrl();

  if (!template) return null;

  const {
    data: sectionsRes,
    isLoading: loadingSections,
    isError: errorSections,
  } = useList<Section>({
    resource: "sections",
    pagination: { pageSize: 500, current: 1 },
    meta: { queryParams: { template_id: template.id } },
    queryOptions: { enabled: !!template?.id },
  });

  const sections = React.useMemo<Section[]>(
    () => (sectionsRes?.data ?? []).slice().sort((a, b) => a.position - b.position),
    [sectionsRes?.data]
  );

  const [tasksBySection, setTasksBySection] = React.useState<Record<number, Task[]>>({});
  const [loadingTasks, setLoadingTasks] = React.useState<boolean>(false);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      if (!sections.length) {
        setTasksBySection({});
        return;
      }
      setLoadingTasks(true);
      try {
        const results: Task[][] = await Promise.all(
          sections.map(async (s) => {
            const res = await fetch(`${apiUrl}/tasks?section_id=${s.id}`, {
              method: "GET",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
            });
            const data: Task[] = await res.json();
            return data.slice().sort((a, b) => a.position - b.position);
          })
        );
        if (!cancelled) {
          const map: Record<number, Task[]> = {};
          sections.forEach((s, idx) => {
            map[s.id] = results[idx];
          });
          setTasksBySection(map);
        }
      } catch {
        /* opcional: manejar error */
      } finally {
        if (!cancelled) setLoadingTasks(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sections, apiUrl]);

  const totalMinutes = (arr: Task[]) =>
    arr.reduce((acc, t) => acc + (t.expected_minutes ?? 0), 0);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        zIndex: 60,
      }}
    >
      <aside
        className="modal drawer"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: "min(720px, 92vw)",
          background: "var(--panel, #111216)",
          borderLeft: "1px solid #1f2330",
          boxShadow: "0 10px 30px rgba(0,0,0,.35)",
          padding: 20,
          overflow: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{template.name}</h3>
            <div className="muted" style={{ marginTop: 4 }}>
              {(template.model_name && template.model_name.trim()) ||
                `Modelo #${template.model_id ?? "—"}`}{" "}
              · {String(template.template_type).toUpperCase()} · v{template.version}{" "}
              {template.is_published ? "· Publicado" : "· Borrador"}
            </div>
          </div>
          <button onClick={onClose} className="btn" aria-label="Cerrar">
            Cerrar
          </button>
        </div>

        {/* Body */}
        {loadingSections ? (
          // ====== SKELETON: mientras cargan secciones ======
          <div className="list" style={{ marginTop: 8 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : errorSections ? (
          <div className="badge fail">Error cargando secciones</div>
        ) : sections.length === 0 ? (
          <div className="badge">Este template no tiene secciones.</div>
        ) : (
          <div className="list" style={{ marginTop: 8 }}>
            {sections.map((sec) => {
              const tasks = tasksBySection[sec.id] ?? [];
              const isLoadingTasksForThis =
                loadingTasks && (!tasks || tasks.length === 0);

              return (
                <div key={sec.id} className="card" style={{ padding: 14 }}>
                  <div
                    className="section-header"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {sec.position}. {sec.title}
                    </div>
                    <div className="section-meta">
                      <span className="pill">
                        {tasks.length} tareas · {totalMinutes(tasks)} min
                      </span>
                    </div>
                  </div>

                  {isLoadingTasksForThis ? (
                    // ====== SKELETON: mientras cargan tareas de esta sección ======
                    <div className="list">
                      <SkeletonCard lines={2} />
                      <SkeletonCard lines={2} />
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="muted">Sin tareas en esta sección.</div>
                  ) : (
                    <div className="list">
                      {tasks.map((t) => (
                        <div
                          key={t.id}
                          className="item"
                          style={{
                            gridTemplateColumns: "40px 1fr auto",
                            alignItems: "center",
                          }}
                        >
                          <div className="badge">#{t.position}</div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{t.title}</div>
                            <div className="muted">
                              {truncate(t.code, 80)} · {t.expected_minutes ?? 0} min
                            </div>
                          </div>
                          <div className="right">
                            <span className="pill">{t.expected_minutes ?? 0} min</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}