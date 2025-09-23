import React from "react";
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";

type Family = { id: number; name: string };

export default function Families() {
    const { data, isLoading, refetch } = useList<Family>({
        resource: "machine-families",
        pagination: { pageSize: 200 },
    });

    const { mutate: createMutate, isLoading: creating } = useCreate();
    const { mutate: updateMutate, isLoading: updating } = useUpdate();
    const { mutate: deleteMutate, isLoading: deleting } = useDelete();

    const [newName, setNewName] = React.useState("");
    const [editing, setEditing] = React.useState<Record<number, string>>({}); // id -> name

    const onCreate = () => {
        const name = newName.trim();
        if (!name) return alert("Escribe el nombre de la familia");
        createMutate(
            { resource: "machine-families", values: { name } },
            {
                onSuccess: () => {
                    setNewName("");
                    refetch();
                },
            }
        );
    };

    const onEditStart = (f: Family) => {
        setEditing((e) => ({ ...e, [f.id]: f.name }));
    };

    const onEditCancel = (id: number) => {
        setEditing((e) => {
            const { [id]: _, ...rest } = e;
            return rest;
        });
    };

    const onEditSave = (id: number) => {
        const name = (editing[id] ?? "").trim();
        if (!name) return alert("El nombre no puede estar vacío");
        updateMutate(
            { resource: "machine-families", id, values: { name } },
            {
                onSuccess: () => {
                    onEditCancel(id);
                    refetch();
                },
            }
        );
    };

    const onDelete = (id: number) => {
        if (!confirm("¿Eliminar familia? Esta acción no se puede deshacer.")) return;
        deleteMutate(
            { resource: "machine-families", id },
            { onSuccess: () => refetch() }
        );
    };

    return (
        <div className="card">
            <h2>Machine Families</h2>
            <p style={{ color: "var(--muted)" }}>
                Crea y administra familias de máquinas.
            </p>

            {/* Crear */}
            <div className="row cols-3" style={{ alignItems: "end", margin: 5 }}>
                <div>
                    <label>Nombre</label>
                    <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Ej. CNC"
                    />
                </div>
                <div style={{marginTop: 16}}>
                    <button onClick={onCreate} disabled={creating}>
                        {creating ? "Creando…" : "Crear familia"}
                    </button>
                </div>
            </div>

            <br></br>

            {/* Lista */}
            {isLoading ? (
                <div className="badge">Cargando…</div>
            ) : (data?.data ?? []).length === 0 ? (
                <div className="badge">No hay familias.</div>
            ) : (
                <div className="list-tiles">
                    {(data?.data ?? []).map((f) => {
                        const isEditing = editing[f.id] !== undefined;
                        return (
                            <div key={f.id} className="list-tile">
                                {/* leading */}
                                <div className="list-tile__leading" aria-hidden>
                                    <div className="avatar">{f.name.slice(0, 1).toUpperCase()}</div>
                                </div>

                                {/* content */}
                                <div className="list-tile__content">
                                    {!isEditing ? (
                                        <>
                                            <div className="list-tile__title">{f.name}</div>
                                            <div className="list-tile__subtitle">ID #{f.id}</div>
                                        </>
                                    ) : (
                                        <div className="list-tile__edit">
                                            <input
                                                value={editing[f.id]}
                                                onChange={(e) =>
                                                    setEditing((prev) => ({ ...prev, [f.id]: e.target.value }))
                                                }
                                                placeholder="Nombre de la familia"
                                                autoFocus
                                            />
                                            <div className="list-tile__edit-actions">
                                                <button
                                                    className="btn btn--ok"
                                                    onClick={() => onEditSave(f.id)}
                                                    disabled={updating}
                                                >
                                                    Guardar
                                                </button>
                                                <button className="btn" onClick={() => onEditCancel(f.id)}>
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* trailing */}
                                {!isEditing && (
                                    <div className="list-tile__trailing">
                                        <button className="btn" onClick={() => onEditStart(f)}>Editar</button>
                                        <button
                                            className="btn btn--danger"
                                            onClick={() => onDelete(f.id)}
                                            disabled={deleting || updating}
                                        >
                                            Eliminar
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}