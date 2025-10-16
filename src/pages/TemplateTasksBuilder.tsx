// src/pages/TemplateTasksBuilder.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useList, useCreate, useCustomMutation, useUpdate, useDelete } from "@refinedev/core";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog } from "@mui/material"
import axios from 'axios'

type Template = { id: number; name: string; };
type Section = { id: number; template_id: number; title: string; position: number; };
type Task = { id: number; section_id: number; title: string; code: string; expected_minutes: number; position: number; category?: string; };

const SortableTask: React.FC<{
  id: number;
  task: Task;
  draft: Partial<Task> & { __saved?: boolean };
  onChange: (patch: Partial<Task>) => void;
  onSave: () => void;
  onDelete: () => void;
  savingOne: boolean;
}> = ({ id, task, draft, onChange, onSave, onDelete, savingOne }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const t = {
    title: draft?.title ?? task.title,
    code: draft?.code ?? task.code ?? "",
    expected_minutes: draft?.expected_minutes ?? task.expected_minutes ?? 0,
    category: draft?.category ?? (task as any).category ?? "Mantenimiento",
  };

  return (
    <div ref={setNodeRef} style={style} className="item" >
      <div className="handle" {...attributes} {...listeners}>⠿</div>

      <div style={{ display: "flex",  alignItems: "center", gap: 8, flex: 1 }}>
        <input
          value={t.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Task title"
        />
        <input
          value={t.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="Code"
        />
        <input
          type="number"
          value={t.expected_minutes}
          onChange={(e) => onChange({ expected_minutes: Number(e.target.value) })}
          placeholder="Minutes"
        />
        <select 
          value={t.category}
          onChange={(e) => onChange({ category: e.target.value })}
          style={{ maxWidth: 150 }}
          >
          <option value="Mantenimiento">Mantenimiento</option>
          <option value="Reparación">Reparación</option>
          <option value="Inspección">Inspección</option>
          <option value="Limpieza">Limpieza</option>
          <option value="Ensamble">Ensamble</option>
          <option value="Detallado">Detalle</option>
          <option value="Verificación">Verificación</option>
        </select>
      </div>

      <div className="right" style={{ gap: 8, alignItems: "center" }}>
        <span className="pill">{t.expected_minutes} min</span>
        <button className="btn-save" onClick={onSave} disabled={savingOne}>
          {savingOne ? "Guardando…" : draft?.__saved ? "✔️ Guardado" : "Guardar"}
        </button>
        {draft?.__saved && (
          <audio autoPlay src="https://cdn.pixabay.com/audio/2022/03/15/audio_115b6c2b3e.mp3" />
        )}
        <button className="btn-cancel" onClick={onDelete}>Eliminar</button>
        <span className="badge">#{task.position}</span>
      </div>
    </div>
  );
};

export default function TemplateTasksBuilder() {
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [templateId2, setTemplateId2] = useState<number | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const handleDialogOpen = () => setDialogOpen(true);
  const handleDialogClose = () => setDialogOpen(false);
  const [clonedTemplate, setClonedTemplate] = useState<any>(null);
  const [clonedSections, setClonedSections] = useState<any[]>([]);
  const [clonedTasks, setClonedTasks] = useState<any[]>([]);
  const [isCloning, setIsCloning] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState<string>("");


  const resetCloneState = () => {
    setClonedTemplate(null);
    setClonedSections([]);
    setClonedTasks([]);
    setTemplateId2(null);
  };

  const isCloneReady = Boolean(
    clonedTemplate &&
    (clonedSections?.length || 0) > 0 &&
    (clonedTasks?.length || 0) > 0
  );

  const { data: templates } = useList<Template>({ resource: "templates", pagination: { pageSize: 200 } });
  const { data: sectionsRes } = useList<Section>({
    resource: "sections",
    filters: [{ field: "template_id", operator: "eq", value: templateId ?? -1 }],
    queryOptions: { enabled: !!templateId },
    pagination: { pageSize: 500 },
  });
  const { data: tasksRes, refetch } = useList<Task>({
    resource: "tasks",
    filters: [{ field: "section_id", operator: "eq", value: sectionId ?? -1 }],
    queryOptions: { enabled: !!sectionId },
    pagination: { pageSize: 1000 },
  });

  const sections = useMemo(() => (sectionsRes?.data ?? []).sort((a, b) => a.position - b.position), [sectionsRes?.data]);
  const tasks = useMemo(() => (tasksRes?.data ?? []).sort((a, b) => a.position - b.position), [tasksRes?.data]);

  const { mutate: createTask } = useCreate();
  const { mutate: patchReorder, isLoading: savingOrder } = useCustomMutation();
  const { mutate: updateTask, isLoading: savingOne } = useUpdate();
  const { mutate: deleteMutate, isLoading: deleting } = useDelete();


  // Draft local por tarea
  const [draft, setDraft] = useState<Record<number, Partial<Task>>>({});

  useEffect(() => { setSectionId(null); }, [templateId]);

  useEffect(() => {
    const map: Record<number, Partial<Task>> = {};
    (tasks ?? []).forEach(t => map[t.id] = {
      title: t.title, code: t.code ?? "", expected_minutes: t.expected_minutes ?? 0
    });
    setDraft(map);
  }, [tasksRes?.data?.length]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onAddTask = () => {
    if (!sectionId) return;
    const nextPos = (tasks?.length ?? 0) + 1;
    createTask(
      {
        resource: "tasks",
        values: { section_id: sectionId, title: "New Task", code: "", expected_minutes: 0, position: nextPos },
      },
      { onSuccess: () => refetch() }
    );
  };

  const onDelete = (id: number) => {
    if (!confirm("¿Eliminar modelo? Esta acción no se puede deshacer.")) return;
    deleteMutate({ resource: "tasks", id }, { onSuccess: () => refetch() });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const ids = tasks.map(t => t.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    const moved = arrayMove(tasks, oldIndex, newIndex);

    patchReorder(
      {
        url: "/tasks/reorder",
        method: "patch",
        values: {
          section_id: sectionId,
          items: moved.map((t, idx) => ({ id: t.id, position: idx + 1 })),
        },
        meta: { headers: { "Content-Type": "application/json" } },
      },
      { onSuccess: () => refetch() }
    );
  };

  const setTaskDraft = (id: number, patch: Partial<Task>) =>
    setDraft(d => ({ ...d, [id]: { ...(d[id] ?? {}), ...patch } }));

  const saveOne = (t: Task) => {
    const d = draft[t.id] ?? {};
    updateTask(
      {
        resource: "tasks",
        id: t.id,
        values: {
          title: d.title ?? t.title,
          code: d.code ?? t.code,
          expected_minutes: (d.expected_minutes ?? t.expected_minutes) as number,
          category: (d.category ?? (t as any).category) as string,
        },
      },
      { onSuccess: () => refetch() }
    );
  };

  // 🔸 ACTUALIZA tu clonación para limpiar antes y marcar loading
  const clonacionDePlantilla = async () => {
    if (!templateId2) {
      alert("Selecciona una plantilla para clonar");
      return;
    }

    try {
      setIsCloning(true);
      // limpiar por si hiciste clonaciones previas
      setClonedTemplate(null);
      setClonedSections([]);
      setClonedTasks([]);

      // 1) plantilla
      const response = await axios.get(
        `https://desarrollotecnologicoar.com/api10/templates/${templateId2}`
      );
      setClonedTemplate(response.data);

      // 2) secciones
      const response1 = await axios.get(
        `https://desarrollotecnologicoar.com/api10/sections?template_id=${templateId2}`
      );
      const sections = response1.data;
      setClonedSections(sections);

      // 3) tareas por sección
      const tasksBySection = await Promise.all(
        sections.map(async (s: any) => {
          const resp = await axios.get(
            `https://desarrollotecnologicoar.com/api10/tasks?section_id=${s.id}`
          );
          return resp.data;
        })
      );

      const allTasks = tasksBySection.flat();
      setClonedTasks(allTasks);
    } catch (e) {
      console.error(e);
      alert("Error al clonar");
    } finally {
      setIsCloning(false);
    }
  };

  // 🔸 NUEVO: util para agrupar tareas por sección en la vista de revisión
  const tasksBySectionMap = useMemo(() => {
    const map: Record<number, Task[]> = {};
    for (const s of clonedSections) map[s.id] = [];
    for (const t of clonedTasks) {
      if (!map[t.section_id]) map[t.section_id] = [];
      map[t.section_id].push(t);
    }
    // orden por position
    Object.values(map).forEach(arr => arr.sort((a, b) => a.position - b.position));
    return map;
  }, [clonedSections, clonedTasks]);



  // 🔸 REEMPLAZA completamente tu CloneDialog por este
  const handleFinalize = () => {
    if (!clonedTemplate || clonedSections.length === 0) return alert("No hay datos para clonar");
    try {
      axios.post(
        `https://desarrollotecnologicoar.com/api10/templates/`,
        {
          name: newTemplateName.trim() || `Copia de ${clonedTemplate.name}`,
          template_type: clonedTemplate.template_type,
          model_id: clonedTemplate.model_id,
        },
        { headers: { "Content-Type": "application/json" } }
      ).then(res => {
        const newTemplateId = res.data.id;
        // Publicar la nueva plantilla
        axios.post(
          `https://desarrollotecnologicoar.com/api10/templates/${newTemplateId}/publish`,
          { version: 1 },
          { headers: { "Content-Type": "application/json" } }
        );
        // clonar secciones
        Promise.all(clonedSections.map(s => {
          return axios.post(
            `https://desarrollotecnologicoar.com/api10/sections/`,
            { template_id: newTemplateId, title: s.title, position: s.position },
            { headers: { "Content-Type": "application/json" } }
          ).then(resSec => {
            const newSectionId = resSec.data.id;
            // clonar tareas de esta sección
            const tasksToClone = clonedTasks.filter(t => t.section_id === s.id);
            return Promise.all(tasksToClone.map(t => {
              return axios.post(
                `https://desarrollotecnologicoar.com/api10/tasks/`,
                { section_id: newSectionId, title: t.title, code: t.code, expected_minutes: t.expected_minutes, position: t.position },
                { headers: { "Content-Type": "application/json" } }
              );
            }));
          });
        })).then(() => {
          alert("Clonación completada");
          resetCloneState();
          handleDialogClose();
        });
      });
    } catch (e) {
      console.error(e);
      alert("Error al finalizar clonación");
    }
  };




  const handleBack = () => {
    resetCloneState();
  };



  return (
    <div className="card">
      <h2>Constructor de actividades</h2>
      <p className="muted">Organiza las actividades dentro de cada sección de plantilla.</p>

      <div className="row cols-3">
        <div>
          <label>Plantilla</label>
          <select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value) || null)}>
            <option value="">— seleccionar —</option>
            {(templates?.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label>Sección</label>
          <select value={sectionId ?? ""} onChange={(e) => setSectionId(Number(e.target.value) || null)}>
            <option value="">— seleccionar —</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
        <div>
          <label>Acciones</label>
          <div className="right" style={{ gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onAddTask}>+ Añadir actividad</button>
              {savingOrder ? <span className="badge">Guardando orden…</span> : null}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className='btn--clone' onClick={handleDialogOpen}>+ Clonar plantilla</button>
              {savingOrder ? <span className="badge">Clonando orden…</span> : null}
            </div>
          </div>

        </div>
      </div>

      <br />

      {!sectionId ? (
        <div className="badge">Selecciona sección</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="list">
              {tasks.map(t => (
                <SortableTask
                  key={t.id}
                  id={t.id}
                  task={t}
                  draft={draft[t.id]}
                  onChange={(patch) => setTaskDraft(t.id, patch)}
                  onSave={() => saveOne(t)}
                  onDelete={() => onDelete(t.id)}
                  savingOne={savingOne}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Dialog open={dialogOpen} onClose={handleDialogClose} sx={{ borderRadius: 4, overflow: "hidden" }}>
        {!isCloneReady ? (
          // ===== Vista de selección / clonando =====
          <div style={{ padding: 20, minWidth: 380 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <h2 className='modal-title' style={{ marginBottom: 4 }}>Clonar plantilla</h2>
              <p className="muted" style={{ marginTop: 0, textAlign: "center" }}>
                Elige una plantilla y clona su estructura de secciones y actividades.
              </p>
              <div style={{ width: "100%" }}>
                <select
                  style={{
                    width: "100%",
                    minWidth: 300,
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    marginBottom: 16,
                    fontSize: 16,
                    padding: "8px 12px",
                  }}
                  className="select-modal"
                  value={templateId2 ?? ""}
                  onChange={(e) => setTemplateId2(Number(e.target.value) || null)}
                  disabled={isCloning}
                >
                  <option value="">— seleccionar —</option>
                  {(templates?.data ?? []).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className='right' style={{ gap: 8 }}>
              <button
                className='btn--clone'
                onClick={clonacionDePlantilla}
                disabled={!templateId2 || isCloning}
              >
                {isCloning ? "Clonando…" : "Clonar plantilla"}
              </button>
              <button onClick={handleDialogClose} disabled={isCloning}>Cerrar</button>
            </div>
          </div>
        ) : (
          // ===== Vista de revisión (cuando ya hay datos clonados) =====
          <div style={{ padding: 20, minWidth: 520, maxWidth: 720 }}>
            <h2 className='modal-title' style={{ marginBottom: 8 }}>
              Revisión de clonación
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Confirma la estructura clonada es correcta antes de finalizar.
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginBottom: 12
            }}>
              <div className="stat">
                <div className="label"><b>Plantilla</b></div>
                <input
                  type="text"
                  value={newTemplateName}
                  placeholder={`Copia de ${clonedTemplate.name}`}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: 15,
                    borderRadius: 6,
                    border: "1px solid #ccc",
                  }}
                />
              </div>
              <div className="stat">
                <div className="label"><b>Secciones</b></div>
                <div className="value">{clonedSections.length}</div>
              </div>
              <div className="stat">
                <div className="label"><b>Actividades</b></div>
                <div className="value">{clonedTasks.length}</div>
              </div>
            </div>

            <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              {clonedSections
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((s) => (
                  <div key={s.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      {s.position}. {s.title}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {(tasksBySectionMap[s.id] ?? []).map((t) => (
                        <li key={t.id} style={{ marginBottom: 4 }}>
                          <span style={{ fontWeight: 500 }}>{t.title}</span>
                          {t.code ? <span style={{ marginLeft: 6, opacity: 0.7 }}>({t.code})</span> : null}
                          <span className="pill" style={{ marginLeft: 8 }}>{t.expected_minutes ?? 0} min</span>
                        </li>
                      ))}
                      {((tasksBySectionMap[s.id] ?? []).length === 0) && (
                        <li style={{ opacity: 0.6, fontStyle: "italic" }}>Sin actividades</li>
                      )}
                    </ul>
                  </div>
                ))}
            </div>

            <div className='right' style={{ gap: 8, marginTop: 12 }}>
              <button className='btn--ok' onClick={() => handleFinalize()}>Finalizar</button>
              <button className='btn-cancel' onClick={() => handleBack()}>Regresar</button>
            </div>
          </div>
        )}
      </Dialog>
    </div>

  );
}