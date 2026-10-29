import React, { useEffect, useMemo, useRef, useState } from "react";
import { useList, useCreate, useCustomMutation, useUpdate, useDataProvider } from "@refinedev/core";
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
import { retryApiQuery } from "../services/apiResponse";
import { deleteEmptySection } from "../services/sectionDeletion";
import { isPositiveId } from "../services/catalogQueries";

type Template = { id: number; name: string; model_name?: string; version: number; is_published: boolean; };
type Section = { id: number; template_id: number; title: string; position: number; };

const SortableRow: React.FC<{
    id: number;
    title: string;
    onTitleChange: (v: string) => void;
    onSave: () => void;
    onDelete: () => void;
    saving?: boolean;
    deleting: boolean;
    disabled: boolean;
}> = ({ id, title, onTitleChange, onSave, onDelete, saving, deleting, disabled }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled });
    const style = { transform: CSS.Transform.toString(transform), transition };

    return (
        <div ref={setNodeRef} style={style} className="item">
            <div className="handle" {...attributes} {...listeners}>⠿</div>
            <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Section title"
                disabled={disabled}
            />
            <div className="right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge">#{id}</span>
                <button className="btn btn--ok" onClick={onSave} disabled={saving || disabled}>
                    {saving ? "…" : "Guardar"}
                </button>
                <button className="btn btn--danger" onClick={onDelete} disabled={saving || disabled}>
                    {deleting ? "Eliminando…" : "Eliminar"}
                </button>
            </div>
        </div>
    );
};

export default function SectionsBuilder() {
    const getDataProvider = useDataProvider();
    const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
    const { data: tpls } = useList<Template>({ resource: "templates", pagination: { pageSize: 200 } });

    const { data: sectionsRes, refetch, error: sectionsError, isLoading: loadingSections } = useList<Section>({
        resource: "sections",
        filters: [{ field: "template_id", operator: "eq", value: selectedTemplate }],
        pagination: { pageSize: 500 },
        queryOptions: { enabled: isPositiveId(selectedTemplate), retry: retryApiQuery, keepPreviousData: false },
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
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const deletingRef = useRef(false);
    const [deleteError, setDeleteError] = useState("");
    const [deleteSuccess, setDeleteSuccess] = useState("");

    const onDeleteSection = async (section: Section) => {
        if (deletingRef.current || savingTitle || savingOrder) return;
        if (!window.confirm(`¿Eliminar la sección "${section.title}" (#${section.id})? Solo se eliminan secciones sin actividades ni puntos de inspección.`)) return;
        deletingRef.current = true;
        setDeletingId(section.id);
        setDeleteError("");
        setDeleteSuccess("");
        try {
            await deleteEmptySection(section.id, getDataProvider());
            setDeleteSuccess(`Sección #${section.id} eliminada.`);
            await refetch();
        } catch (error) {
            const detail = error && typeof error === "object" && "message" in error ? error.message : null;
            setDeleteError(typeof detail === "string" ? detail : "No se pudo eliminar la sección.");
        } finally {
            deletingRef.current = false;
            setDeletingId(null);
        }
    };

    useEffect(() => {
        const map: Record<number, string> = {};
        sections.forEach(s => { map[s.id] = s.title; });
        setDraft(map);
    }, [sections]);

    const onAddSection = () => {
        if (!selectedTemplate || deletingRef.current) return;
        const title = prompt("Título de la nueva sección", "New Section")?.trim();
        if (!title) return;
        const nextPos = (sections?.length ?? 0) + 1;
        createSection(
            {
                resource: "sections",
                values: { template_id: selectedTemplate, title, position: nextPos },
            },
            { onSuccess: () => refetch() }
        );
    };

    const handleDragEnd = (event: DragEndEvent) => {
        if (deletingRef.current) return;
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
        if (deletingRef.current) return;
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
                <p style={{ color: "var(--muted)" }}>Elige una plantilla previamente creada y seccionala en orden a tus necesidades. </p>

                <div className="row cols-2">
                    <div>
                        <label>Elegir plantilla</label>
                        <select value={selectedTemplate ?? ""} disabled={deletingId !== null} onChange={(e) => {
                            setSelectedTemplate(Number(e.target.value) || null);
                            setDeleteError("");
                            setDeleteSuccess("");
                        }}>
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
                            <button onClick={onAddSection} disabled={deletingId !== null} style={{backgroundColor:"#8B0000"}}>+ Añadir sección</button>
                            {savingOrder ? <span className="badge">Guardando orden…</span> : null}
                        </div>
                    </div>
                </div>

                <br></br>

                {sectionsError && <div role="alert">No se pudieron cargar las secciones: {sectionsError.message}</div>}
                {selectedTemplate !== null && !isPositiveId(selectedTemplate) && <div role="alert">El identificador de la plantilla no es válido.</div>}
                {deleteError && <div role="alert">No se pudo eliminar la sección: {deleteError}</div>}
                {deletingId !== null && <div role="status">Verificando y eliminando sección…</div>}
                {deleteSuccess && <div role="status">{deleteSuccess}</div>}
                {selectedTemplate && loadingSections ? <div role="status">Cargando secciones…</div> : null}
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
                                        onDelete={() => onDeleteSection(s)}
                                        saving={savingMap[s.id]}
                                        deleting={deletingId === s.id}
                                        disabled={deletingId !== null || savingTitle || savingOrder}
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
