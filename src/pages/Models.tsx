import React from "react";
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";

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
  const { data: famData } = useList<Family>({
    resource: "machine-families",
    pagination: { pageSize: 500 },
  });
  const families = famData?.data ?? [];

  // Filtro por familia
  const [familyFilter, setFamilyFilter] = React.useState<number | "">("");

  // Listado de modelos (con query param ?family_id=)
  const { data, isLoading, refetch } = useList<Model>({
    resource: "machine-models",
    pagination: { pageSize: 500 },
    meta: {
      queryParams:
        familyFilter === "" ? {} : { family_id: String(familyFilter) },
    },
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
    <div className="card">
      <h2>Modelos de máquina</h2>
      <p style={{ color: "var(--muted)" }}>Crea y administra modelos de máquina.</p>

      {/* Filtro por familia */}
      <div className="row cols-3" style={{ alignItems: "end" }}>
        <div>
          <label>Filtrar por familia</label>
          <select
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
        <div style={{ marginTop: 16 }}>
          <button onClick={() => refetch()}>Aplicar</button>
        </div>
      </div>
      <br></br>

      {/* Crear */}
      <div className="row cols-3" style={{ alignItems: "end" }}>
        <div>
          <label>Nombre del modelo</label>
          <input
            value={form.name}
            onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))}
            placeholder="Ej. Router 1325"
          />
        </div>
        <div>
          <label>Familia</label>
          <select
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
        <div>
          <label>Fabricante (opcional)</label>
          <input
            value={form.manufacturer}
            onChange={(e) => setForm((x) => ({ ...x, manufacturer: e.target.value }))}
            placeholder="Ej. Acme"
          />
        </div>
        <label>Valor en bono de la máquina (opcional)</label>
        <input
          type="number"
          value={form.bond_value}
          onChange={(e) => setForm((x) => ({ ...x, bond_value: Number(e.target.value) }))}
          placeholder="Ej. Acme"
        />
        <label>Días estándar de la máquina (opcional)</label>
        <input
          type="number"
          value={form.standard_days}
          onChange={(e) => setForm((x) => ({ ...x, standard_days: Number(e.target.value) }))}
          placeholder="Ej. Acme"
        />

        <div style={{ marginTop: 16 }}>
          <button onClick={onCreate} disabled={creating}>
            {creating ? "Creando…" : "Crear modelo"}
          </button>
        </div>
      </div>

      <br></br>

      {/* Lista tipo ListTile */}
      {isLoading ? (
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
                <div className="list-tile__content" style={{ display: "grid", gap: 6 }}>
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
                    <div className="list-tile__edit" style={{ gridTemplateColumns: "1fr 220px 220px" }}>
                      <input
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
                      <select
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
                      <input
                        value={edit.manufacturer}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [m.id]: { ...prev[m.id], manufacturer: e.target.value },
                          }))
                        }
                        placeholder="Fabricante (opcional)"
                      />
                      <input
                        style={{ maxWidth: 100 }}
                        value={edit.bond_value}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [m.id]: { ...prev[m.id], bond_value: Number(e.target.value) },
                          }))
                        }
                        placeholder="Valor en bono"
                      />
                      <input
                        style={{ maxWidth: 100 }}
                        value={edit.standard_days}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [m.id]: { ...prev[m.id], standard_days: Number(e.target.value) },
                          }))
                        }
                        placeholder="Valor en bono"
                      />
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
    </div>
  );
}