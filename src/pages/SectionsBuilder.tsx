import React, { useEffect, useMemo, useState } from "react";
import { useList, useCreate, useCustomMutation, useUpdate } from "@refinedev/core";
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable,
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Template = { id: number; name: string; model_name?: string; version: number; is_published: boolean; };
type Section = { id: number; template_id: number; title: string; position: number; };

const SortableRow: React.FC<{
    id: number;
    title: string;
    onTitleChange: (v: string) => void;
    onSave: () => void;
    saving?: boolean;
}> = ({ id, title, onTitleChange, onSave, saving }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
    const style = { transform: CSS.Transform.toString(transform), transition };

    return (
        <div ref={setNodeRef} style={style} className="item">
            <div className="handle" {...attributes} {...listeners}>⠿</div>
            <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Section title"
            />
            <div className="right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge">#{id}</span>
                <button className="btn btn--ok" onClick={onSave} disabled={saving}>
                    {saving ? "…" : "Guardar"}
                </button>
            </div>
        </div>
    );
};

export default function SectionsBuilder() {
    const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
    const { data: tpls } = useList<Template>({ resource: "templates", pagination: { pageSize: 200 } });

    const { data: sectionsRes, refetch } = useList<Section>({
        resource: "sections",
        filters: [{ field: "template_id", operator: "eq", value: selectedTemplate ?? -1 }],
        pagination: { pageSize: 500 },
        queryOptions: { enabled: !!selectedTemplate },
    });

    const sections = useMemo(
        () => (sectionsRes?.data ?? []).slice().sort((a, b) => a.position - b.position),
        [sectionsRes?.data]
    );

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    const { mutate: createSection } = useCreate();
    const { mutate: patchReorder, isLoading: savingOrder } = useCustomMutation();
    const { mutate: updateSection, isLoading: savingTitle } = useUpdate();

    const [savingMap, setSavingMap] = useState<Record<number, boolean>>({});

    const [draft, setDraft] = useState<Record<number, string>>({});

    useEffect(() => {
        const map: Record<number, string> = {};
        sections.forEach(s => { map[s.id] = s.title; });
        setDraft(map);
    }, [sections]);

    const onAddSection = () => {
        if (!selectedTemplate) return;
        const nextPos = (sections?.length ?? 0) + 1;
        createSection(
            {
                resource: "sections",
                values: { template_id: selectedTemplate, title: "New Section", position: nextPos },
            },
            { onSuccess: () => refetch() }
        );
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const currentIds = sections.map((s) => s.id);
        const oldIndex = currentIds.indexOf(Number(active.id));
        const newIndex = currentIds.indexOf(Number(over.id));
        const moved = arrayMove(sections, oldIndex, newIndex);

        patchReorder(
            {
                url: "/sections/reorder",
                method: "patch",
                values: {
                    template_id: selectedTemplate!, // asegúrate de que no sea null
                    items: moved.map((s, idx) => ({ id: s.id, position: idx + 1 })),
                },
                meta: {
                    headers: { "Content-Type": "application/json" }, // opcional
                },
            },
            { onSuccess: () => refetch() }
        );
    };

    const onTitleInlineChange = (id: number, v: string) => {
        setDraft((d) => ({ ...d, [id]: v }));
    };

    const onSaveTitle = (id: number) => {
        const newTitle = draft[id];
        if (!newTitle?.trim()) return alert("El título no puede estar vacío");
        setSavingMap((m) => ({ ...m, [id]: true }));
        updateSection(
            {
                resource: "sections",
                id,
                values: { title: newTitle },
            },
            {
                onSuccess: () => {
                    setSavingMap((m) => ({ ...m, [id]: false }));
                    refetch();
                },
                onError: () => {
                    setSavingMap((m) => ({ ...m, [id]: false }));
                },
            }
        );
    };

    return (
        <div className="row" style={{ gap: 16 }}>
            <div className="card">
                <h2>Sections Builder</h2>
                <p style={{ color: "var(--muted)" }}>Elige plantilla y organiza secciones por drag & drop.</p>

                <div className="row cols-2">
                    <div>
                        <label>Template</label>
                        <select value={selectedTemplate ?? ""} onChange={(e) => setSelectedTemplate(Number(e.target.value) || null)}>
                            <option value="">— seleccionar —</option>
                            {(tpls?.data ?? []).map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name} {t.model_name ? `· ${t.model_name}` : ""} (v{t.version}{t.is_published ? " · published" : ""})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label>Acciones</label>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={onAddSection}>+ Add Section</button>
                            {savingOrder ? <span className="badge">Guardando orden…</span> : null}
                        </div>
                    </div>
                </div>

                <br></br>

                {!selectedTemplate ? (
                    <div className="badge">Selecciona una plantilla</div>
                ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext
                            items={sections.map((s) => s.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="list">
                                {sections.map((s) => (
                                    <SortableRow
                                        key={s.id}
                                        id={s.id}
                                        title={draft[s.id] ?? s.title}
                                        onTitleChange={(v) => onTitleInlineChange(s.id, v)}
                                        onSave={() => onSaveTitle(s.id)}
                                        saving={savingMap[s.id]}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>
        </div>
    );
}