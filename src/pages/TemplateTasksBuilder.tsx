// src/pages/TemplateTasksBuilder.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useList, useCreate, useCustomMutation, useUpdate } from "@refinedev/core";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Template = { id: number; name: string; };
type Section  = { id: number; template_id: number; title: string; position: number; };
type Task     = { id: number; section_id: number; title: string; code: string; expected_minutes: number; position: number; };

const SortableTask: React.FC<{
  id: number;
  task: Task;
  draft: Partial<Task> | undefined;
  onChange: (patch: Partial<Task>) => void;
  onSave: () => void;
}> = ({ id, task, draft, onChange, onSave }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const t = {
    title: draft?.title ?? task.title,
    code: draft?.code ?? task.code ?? "",
    expected_minutes: draft?.expected_minutes ?? task.expected_minutes ?? 0,
  };

  return (
    <div ref={setNodeRef} style={style} className="item" >
      <div className="handle" {...attributes} {...listeners}>⠿</div>

      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8 }}>
        <input
          value={t.title}
          onChange={(e)=>onChange({ title: e.target.value })}
          placeholder="Task title"
        />
        <input
          value={t.code}
          onChange={(e)=>onChange({ code: e.target.value })}
          placeholder="Code"
        />
        <input
          type="number"
          value={t.expected_minutes}
          onChange={(e)=>onChange({ expected_minutes: Number(e.target.value) })}
          placeholder="Minutes"
        />
      </div>

      <div className="right" style={{ gap:10 }}>
        <span className="pill">{t.expected_minutes} min</span>
        <button className="btn-save" onClick={onSave}>Guardar</button>
        <span className="badge">#{task.position}</span>
      </div>
    </div>
  );
};

export default function TemplateTasksBuilder() {
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [sectionId,  setSectionId]  = useState<number | null>(null);

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

  const sections = useMemo(() => (sectionsRes?.data ?? []).sort((a,b)=>a.position-b.position), [sectionsRes?.data]);
  const tasks    = useMemo(() => (tasksRes?.data ?? []).sort((a,b)=>a.position-b.position), [tasksRes?.data]);

  const { mutate: createTask } = useCreate();
  const { mutate: patchReorder, isLoading: savingOrder } = useCustomMutation();
  const { mutate: updateTask, isLoading: savingOne } = useUpdate();

  // Draft local por tarea
  const [draft, setDraft] = useState<Record<number, Partial<Task>>>({});

  useEffect(()=>{ setSectionId(null); }, [templateId]);

  useEffect(()=>{
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

  const setTaskDraft = (id:number, patch: Partial<Task>) =>
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
        },
      },
      { onSuccess: () => refetch() }
    );
  };

  return (
    <div className="card">
      <h2>Template Tasks Builder</h2>
      <p className="muted">Organiza las tareas dentro de una sección de plantilla.</p>

      <div className="row cols-3">
        <div>
          <label>Template</label>
          <select value={templateId ?? ""} onChange={(e)=>setTemplateId(Number(e.target.value) || null)}>
            <option value="">— seleccionar —</option>
            {(templates?.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label>Section</label>
          <select value={sectionId ?? ""} onChange={(e)=>setSectionId(Number(e.target.value) || null)}>
            <option value="">— seleccionar —</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
        <div>
          <label>Acciones</label>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onAddTask}>+ Add Task</button>
            {savingOrder ? <span className="badge">Guardando orden…</span> : null}
          </div>
        </div>
      </div>

      <br/>

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
                  onChange={(patch)=>setTaskDraft(t.id, patch)}
                  onSave={()=>saveOne(t)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}