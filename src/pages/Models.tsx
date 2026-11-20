import React from "react";
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";
import { retryApiQuery } from "../services/apiResponse";
import "./models.css";

type Family = { id: number; name: string };
type Model = {
  id: number;
  name: string;
  family_id: number | null;
  family_name?: string | null;
  manufacturer?: string | null;
  bond_value?: number | null;
  standard_days?: number | null;
};

export default function Models() {
  // Families para selector y filtro
  const { data: famData, error: familiesError } = useList<Family>({
    resource: "machine-families",
    pagination: { pageSize: 500 },
    queryOptions: { retry: retryApiQuery },
  });
  const families = famData?.data ?? [];

  // Filtro por familia
  const [familyFilter, setFamilyFilter] = React.useState<number | "">("");

  // Listado de modelos (con query param ?family_id=)
  const { data, isLoading, refetch, error: modelsError } = useList<Model>({
    resource: "machine-models",
    pagination: { pageSize: 500 },
    meta: {
      queryParams:
        familyFilter === "" ? {} : { family_id: String(familyFilter) },
    },
    queryOptions: { retry: retryApiQuery },
  });

  // Mutations
  const { mutate: createMutate, isLoading: creating } = useCreate();
  const { mutate: updateMutate, isLoading: updating } = useUpdate();
  const { mutate: deleteMutate, isLoading: deleting } = useDelete();

  // Form de creación
  const [form, setForm] = React.useState<{
    name: string;
    family_id: string; // guardamos como string para fácil binding
    manufacturer: string;
    bond_value: number;
    standard_days: number;
  }>({ name: "", family_id: "", manufacturer: "", bond_value: 0, standard_days: 0 });

  const onCreate = () => {
    const name = form.name.trim();
    if (!name) return alert("Escribe el nombre del modelo");
    createMutate(
      {
        resource: "machine-models",
        values: {
          name,
          family_id: form.family_id ? Number(form.family_id) : null,
          manufacturer: form.manufacturer.trim() || null,
          bond_value: Number(form.bond_value) || null,
          standard_days: Number(form.standard_days) || null,

        },
      },
      {
        onSuccess: () => {
          setForm({ name: "", family_id: familyFilter === "" ? "" : String(familyFilter), manufacturer: "", bond_value: 0, standard_days: 0 });
          refetch();
        },
      }
    );
  };

  // Edición inline
  const [editing, setEditing] = React.useState<Record<
    number,
    { name: string; family_id: string; manufacturer: string; bond_value: number; standard_days: number }
  >>({});

  const startEdit = (m: Model) => {
    setEditing((e) => ({
      ...e,
      [m.id]: {
        name: m.name,
        family_id: m.family_id ? String(m.family_id) : "",
        manufacturer: m.manufacturer ?? "",
        bond_value: m.bond_value ? Number(m.bond_value) : 0,
        standard_days: m.standard_days ? Number(m.standard_days) : 0,
      },
    }));
  };

  const cancelEdit = (id: number) => {
    setEditing((e) => {
      const { [id]: _, ...rest } = e;
      return rest;
    });
  };

  const saveEdit = (id: number) => {
    const draft = editing[id];
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return alert("El nombre no puede estar vacío");
    updateMutate(
      {
        resource: "machine-models",
        id,
        values: {
          name,
          family_id: draft.family_id ? Number(draft.family_id) : null,
          manufacturer: draft.manufacturer.trim() || null,
          bond_value: draft.bond_value !== undefined ? Number(draft.bond_value) : null,
          standard_days: draft.standard_days !== undefined ? Number(draft.standard_days) : null,
        },
      },
      {
        onSuccess: () => {
          cancelEdit(id);
          refetch();
        },
      }
    );
  };

  const onDelete = (id: number) => {
    if (!confirm("¿Eliminar modelo? Esta acción no se puede deshacer.")) return;
    deleteMutate({ resource: "machine-models", id }, { onSuccess: () => refetch() });
  };

  const models = data?.data ?? [];

  return (
    <div className="models">
      <header className="models__header">
        <span className="models__eyebrow">Ingeniería y catálogos</span>
        <h1>Modelos de máquina</h1>
        <p>Crea y administra modelos de máquina.</p>
      </header>
      {familiesError && <div role="alert">No se pudieron cargar las familias: {familiesError.message}</div>}

      <section className="models__filter" aria-labelledby="models-filter-title">
        <h2 id="models-filter-title">Filtrar modelos</h2>
        <div className="models__filter-controls">
          <div className="models__field">
            <label htmlFor="models-filter-family">Filtrar por familia</label>
            <select
              id="models-filter-family"
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Todas</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => refetch()}>Aplicar</button>
        </div>
      </section>

      <section className="models__create" aria-labelledby="models-create-title">
        <h2 id="models-create-title">Nuevo modelo</h2>
        <div className="models__create-grid">
          <div className="models__field">
            <label htmlFor="models-name">Nombre del modelo</label>
            <input
              id="models-name"
              value={form.name}
              onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))}
              placeholder="Ej. Router 1325"
            />
          </div>
          <div className="models__field">
            <label htmlFor="models-family">Familia</label>
            <select
              id="models-family"
              value={form.family_id}
              onChange={(e) => setForm((x) => ({ ...x, family_id: e.target.value }))}
            >
              <option value="">— Sin familia —</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="models__field">
            <label htmlFor="models-manufacturer">Fabricante (opcional)</label>
            <input
              id="models-manufacturer"
              value={form.manufacturer}
              onChange={(e) => setForm((x) => ({ ...x, manufacturer: e.target.value }))}
              placeholder="Ej. Acme"
            />
          </div>
          <div className="models__field">
            <label htmlFor="models-bond">Valor en bono de la máquina (opcional)</label>
            <input
              id="models-bond"
              type="number"
              value={form.bond_value}
              onChange={(e) => setForm((x) => ({ ...x, bond_value: Number(e.target.value) }))}
              placeholder="Ej. Acme"
            />
          </div>
          <div className="models__field">
            <label htmlFor="models-days">Días estándar de la máquina (opcional)</label>
            <input
              id="models-days"
              type="number"
              value={form.standard_days}
              onChange={(e) => setForm((x) => ({ ...x, standard_days: Number(e.target.value) }))}
              placeholder="Ej. Acme"
            />
          </div>
        </div>

        <div className="models__create-actions">
          <button className="models__primary" onClick={onCreate} disabled={creating}>
            {creating ? "Creando…" : "Crear modelo"}
          </button>
        </div>
      </section>

      <section className="models__records" aria-labelledby="models-records-title">
        <h2 id="models-records-title">Modelos registrados</h2>
        {modelsError ? (
          <div role="alert">No se pudieron cargar los modelos: {modelsError.message}</div>
        ) : isLoading ? (
          <div className="badge">Cargando…</div>
        ) : models.length === 0 ? (
          <div className="badge">No hay modelos.</div>
        ) : (
          <div className="list-tiles">
            {models.map((m) => {
              const edit = editing[m.id];
              const isEditing = !!edit;
              return (
                <div key={m.id} className="list-tile">
                  {/* leading: inicial del modelo */}
                  <div className="list-tile__leading" aria-hidden>
                    <div className="avatar">{m.name.slice(0, 1).toUpperCase()}</div>
                  </div>

                  {/* content */}
                  <div className="list-tile__content">
                    {!isEditing ? (
                      <>
                        <div className="list-tile__title">{m.name}</div>
                        <div className="list-tile__subtitle">
                          ID #{m.id}
                          {" · "}
                          {m.family_name ? `Familia: ${m.family_name}` : "Sin familia"}
                          {m.manufacturer ? ` · Fab.: ${m.manufacturer}` : ""}
                        </div>
                      </>
                    ) : (
                      <div className="list-tile__edit">
                        <div className="models__field">
                          <label htmlFor={`models-edit-name-${m.id}`}>Nombre del modelo</label>
                          <input
                            id={`models-edit-name-${m.id}`}
                            value={edit.name}
                            onChange={(e) =>
                              setEditing((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], name: e.target.value },
                              }))
                            }
                            placeholder="Nombre del modelo"
                            autoFocus
                          />
                        </div>
                        <div className="models__field">
                          <label htmlFor={`models-edit-family-${m.id}`}>Familia</label>
                          <select
                            id={`models-edit-family-${m.id}`}
                            value={edit.family_id}
                            onChange={(e) =>
                              setEditing((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], family_id: e.target.value },
                              }))
                            }
                          >
                            <option value="">— Sin familia —</option>
                            {families.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="models__field">
                          <label htmlFor={`models-edit-manufacturer-${m.id}`}>Fabricante (opcional)</label>
                          <input
                            id={`models-edit-manufacturer-${m.id}`}
                            value={edit.manufacturer}
                            onChange={(e) =>
                              setEditing((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], manufacturer: e.target.value },
                              }))
                            }
                            placeholder="Fabricante (opcional)"
                          />
                        </div>
                        <div className="models__field">
                          <label htmlFor={`models-edit-bond-${m.id}`}>Valor en bono de la máquina (opcional)</label>
                          <input
                            id={`models-edit-bond-${m.id}`}
                            value={edit.bond_value}
                            onChange={(e) =>
                              setEditing((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], bond_value: Number(e.target.value) },
                              }))
                            }
                            placeholder="Valor en bono"
                          />
                        </div>
                        <div className="models__field">
                          <label htmlFor={`models-edit-days-${m.id}`}>Días estándar de la máquina (opcional)</label>
                          <input
                            id={`models-edit-days-${m.id}`}
                            value={edit.standard_days}
                            onChange={(e) =>
                              setEditing((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], standard_days: Number(e.target.value) },
                              }))
                            }
                            placeholder="Valor en bono"
                          />
                        </div>
                        <div className="list-tile__edit-actions">
                          <button className="btn btn--ok" onClick={() => saveEdit(m.id)} disabled={updating}>
                            Guardar
                          </button>
                          <button className="btn" onClick={() => cancelEdit(m.id)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* trailing acciones */}
                  {!isEditing && (
                    <div className="list-tile__trailing">
                      <button className="btn" onClick={() => startEdit(m)}>Editar</button>
                      <button
                        className="btn btn--danger"
                        onClick={() => onDelete(m.id)}
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
      </section>
    </div>
  );
}
