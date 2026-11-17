// src/pages/components/TemplateDetailsDrawer.tsx
import React from "react";
import { useApiUrl, useList } from "@refinedev/core";
import { isPositiveId } from "../../services/catalogQueries";
import { retryApiQuery } from "../../services/apiResponse";
import { loadTemplateItems } from "../../services/templateDetails";
import type { TemplateSection, TemplateDetailItem } from "../../services/templateDetails";

export type Template = {
  id: number;
  name: string;
  template_type: "MANTENIMIENTO" | "INSTALACION" | string;
  model_id: number | null;
  version: number;
  is_published: boolean;
  model_name?: string | null;
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

  const templateId = template?.id;
  const templateType = template?.template_type ?? "";
  const ready = isPositiveId(templateId);
  const inspection = templateType === "INSPECCION";

  const {
    data: sectionsRes,
    isLoading: loadingSections,
    error: errorSections,
    isPreviousData,
  } = useList<TemplateSection>({
    resource: "sections",
    pagination: { pageSize: 500, current: 1 },
    meta: { queryParams: { template_id: templateId } },
    queryOptions: { enabled: ready, retry: retryApiQuery },
  });

  const sections = React.useMemo<TemplateSection[]>(
    () => (!ready || loadingSections || errorSections || isPreviousData ? [] : sectionsRes?.data ?? []).slice().sort((a, b) => a.position - b.position),
    [sectionsRes?.data, ready, loadingSections, errorSections, isPreviousData]
  );

  const [tasksBySection, setTasksBySection] = React.useState<Record<number, TemplateDetailItem[]>>({});
  const [loadingTasks, setLoadingTasks] = React.useState<boolean>(false);
  const [tasksError, setTasksError] = React.useState<string | null>(null);
  const [loadedKey, setLoadedKey] = React.useState("");
  const requestKey = JSON.stringify([apiUrl, templateId, templateType, sections.map(s => [s.id, s.template_id])]);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setTasksBySection({});
      setTasksError(null);
      if (!ready || !sections.length) { setLoadingTasks(false); return; }
      setLoadingTasks(true);
      try {
        const map = await loadTemplateItems(apiUrl, Number(templateId), templateType, sections, controller.signal);
        if (!cancelled) setTasksBySection(map);
      } catch (error) {
        if (!cancelled) setTasksError(String((error as { message?: string })?.message || "No se pudieron cargar las actividades."));
      } finally {
        if (!cancelled) { setLoadingTasks(false); setLoadedKey(requestKey); }
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sections, apiUrl, templateId, templateType, ready, requestKey]);

  const totalMinutes = (arr: TemplateDetailItem[]) =>
    arr.reduce((acc, t) => acc + (t.kind === "task" ? t.expected_minutes ?? 0 : 0), 0);

  if (!template) return null;

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
        {!ready ? (
          <div role="alert">El identificador de la plantilla no es válido.</div>
        ) : loadingSections || isPreviousData ? (
          // ====== SKELETON: mientras cargan secciones ======
          <div className="list" style={{ marginTop: 8 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : errorSections ? (
          <div role="alert" className="badge fail">Error cargando secciones: {errorSections.message}</div>
        ) : tasksError && loadedKey === requestKey ? (
          <div role="alert" className="badge fail">Error cargando actividades: {tasksError}</div>
        ) : sections.length === 0 ? (
          <div className="badge">Este template no tiene secciones.</div>
        ) : (
          <div className="list" style={{ marginTop: 8 }}>
            {sections.map((sec) => {
              const tasks = tasksBySection[sec.id] ?? [];
              const isLoadingTasksForThis =
                loadingTasks || loadedKey !== requestKey;

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
                        {inspection ? `${tasks.length} puntos de inspección` : `${tasks.length} tareas · ${totalMinutes(tasks)} min`}
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
                    <div className="muted">{inspection ? "Sin puntos de inspección en esta sección." : "Sin tareas en esta sección."}</div>
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
                            <div style={{ fontWeight: 600 }}>{t.kind === "inspection" ? t.revision_point : t.title}</div>
                            {t.kind === "inspection" ? (
                              <div>
                                <div>Especificaciones: {t.specs || "—"}</div>
                                <div>Sugerencias: {t.suggestions || "—"}</div>
                                <div>Categoría: {t.category || "—"}</div>
                                <div>{t.required === null ? "Requisito no especificado" : t.required ? "Obligatorio" : "Opcional"}</div>
                              </div>
                            ) : <div className="muted">{truncate(t.code, 80)} · {t.expected_minutes ?? 0} min</div>}
                          </div>
                          <div className="right">
                            {t.kind === "task" && <span className="pill">{t.expected_minutes ?? 0} min</span>}
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
