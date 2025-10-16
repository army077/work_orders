// src/pages/Templates.tsx
import React from "react";
import { useList, useCreate, useCustomMutation, useDataProvider } from "@refinedev/core";
import TemplateDetailsDrawer from "./components/TemplateDetailsDrawer";
import type { Template } from "./components/TemplateDetailsDrawer";
import { BsSearch } from 'react-icons/bs';
import { FaRegEdit } from 'react-icons/fa';
import { FaSave } from 'react-icons/fa';

type MachineModel = {
  id: number;
  name: string;
  manufacturer?: string | null;
  family_name?: string | null;
};

type Section = { id: number; template_id: number; title: string; position: number; };
type Task = { id: number; section_id: number; title: string; code: string | null; expected_minutes: number | null; position: number; };


/* ---------------------------------------------------------------- */

export default function Templates() {

  const [openTmpl, setOpenTmpl] = React.useState<Template | null>(null);
  const [search, setSearch] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [editMode, setEditMode] = React.useState(false);
    const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editedName, setEditedName] = React.useState<string>("");
  const dataProvider = useDataProvider();

  // Templates
  const { data, refetch, isLoading } = useList<Template>({
    resource: "templates",
    pagination: { pageSize: 200 },
  });

  // Modelos (para el select)
  const { data: modelsRes, isLoading: loadingModels } = useList<MachineModel>({
    resource: "machine-models",
    pagination: { pageSize: 500 },
  });

  
  const { mutate: updateTemplate, isLoading: updating } = useCustomMutation();

    const handleStartEdit = (template: Template) => {
    setEditingId(template.id);
    setEditedName(template.name);
  };

    const handleSaveEdit = async (template: Template) => {
    const newName = editedName.trim();
    if (!newName) return alert("El nombre no puede estar vacío.");

    try {
      await updateTemplate({
        url: `/templates/${template.id}`,
        method: "put",
        values: { name: newName },
        meta: { headers: { "Content-Type": "application/json" } },
      });

      // Actualiza localmente
      if (data?.data) {
        const newList = data.data.map((t) =>
          t.id === template.id ? { ...t, name: newName } : t
        );
        data.data = newList;
      }

      setEditingId(null);
      setEditedName("");
      
      alert("✅ Nombre actualizado");
      await refetch();

      location.reload();
    } catch (error: any) {
      console.error("❌ Error guardando nombre:", error);
      alert(`Error al guardar: ${error.message || "Desconocido"}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, template: Template) => {
    if (e.key === "Enter") {
      handleSaveEdit(template);
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditedName("");
    }
  };

  const modelOptions = React.useMemo(() => {
    const list = modelsRes?.data ?? [];
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((m) => ({
        id: m.id,
        label: [
          m.name,
          m.manufacturer ? ` · ${m.manufacturer}` : "",
          m.family_name ? ` · ${m.family_name}` : "",
        ]
          .join("")
          .trim(),
      }));
  }, [modelsRes?.data]);

  const getModelLabel = (id?: number | null) => {
    if (!id) return "—";
    const found = modelOptions.find((o) => o.id === id);
    return found?.label ?? `Modelo #${id}`;
  };

  const { mutate: createMutate, isLoading: creating } = useCreate();
  const { mutate: publishMutate, isLoading: publishing } = useCustomMutation();

  const [form, setForm] = React.useState<{ name: string; template_type: string; model_id: string }>({
    name: "",
    template_type: "MANTENIMIENTO",
    model_id: "",
  });

  const [infoTemplate, setInfoTemplate] = React.useState<Template | null>(null);

  // ...



  const onCreateEnsamble = () => {
    const name = form.name.trim();
    if (!name) return alert("Falta el nombre");
    if (!form.template_type) return alert("Selecciona un tipo de plantilla");
    if (form.model_id && isNaN(Number(form.model_id))) return alert("Modelo inválido");

    // 1) Crear
    createMutate(
      {
        resource: "templates",
        values: {
          name,
          template_type: form.template_type,
          model_id: form.model_id ? Number(form.model_id) : null,
        },
      },
      {
        onSuccess: ({ data: created }) => {
          // 2) Si NO es ENSAMBLE, terminamos aquí
          if (form.template_type !== "ENSAMBLE") {
            alert(`Plantilla "${created.name}" creada`);
            setForm({ name: "", template_type: "MANTENIMIENTO", model_id: "" });
            refetch();
            return;
          }

          // 3) Si SÍ es ENSAMBLE, publicar inmediatamente
          publishMutate(
            {
              url: `/templates/${created.id}/publish`,
              method: "post",
              values: {},
              meta: { headers: { "Content-Type": "application/json" } },
            },
            {
              onSuccess: () => {
                alert(`Plantilla "${created.name}" creada y publicada`);
                setForm({ name: "", template_type: "MANTENIMIENTO", model_id: "" });
                refetch();
              },
              onError: (err) => {
                // La creación ya fue exitosa; si falla la publicación, avisa y deja creada
                alert(`Se creó la plantilla pero falló la publicación: ${String((err as any)?.message || err)}`);
                setForm({ name: "", template_type: "MANTENIMIENTO", model_id: "" });
                refetch();
              },
            }
          );
        },
        onError: (err) => {
          alert(`Error creando plantilla: ${String((err as any)?.message || err)}`);
        },
      }
    );
  };


  const onPublish = (id: number) => {
    publishMutate(
      {
        url: `/templates/${id}/publish`,
        method: "post",
        values: {},
        meta: { headers: { "Content-Type": "application/json" } },
      },
      { onSuccess: () => refetch() }
    );
  };




  const items = React.useMemo(() => {
    const arr = data?.data ?? [];
    let filtered = arr;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = arr.filter(t => t.name.toLowerCase().includes(q));
    }
    return filtered.slice().sort((a, b) => {
      if (a.is_published !== b.is_published) return a.is_published ? -1 : 1;
      return a.name.localeCompare(b.name, "es");
    });
  }, [data?.data, searchQuery]);

  return (
    <div className="card">
      <h2>Templates</h2>
      <p className="muted">Crea nuevas plantillas y publícalas cuando estén listas.</p>

      {/* Crear */}
      <div className="row cols-3" style={{ alignItems: "end" }}>
        <div>
          <label>Nombre</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ej. Mantenimiento preventivo VMC-850"
          />
        </div>
        <div>
          <label>Tipo</label>
          <select
            value={form.template_type}
            onChange={(e) => setForm((f) => ({ ...f, template_type: e.target.value }))}
          >
            <option value="">— seleccionar tipo —</option>
            <option value="MANTENIMIENTO">MANTENIMIENTO</option>
            <option value="INSTALACION">INSTALACION</option>
            <option value="DIAGNOSTICO">DIAGNOSTICO</option>
            <option value="REPARACION">REPARACION</option>
            <option value="ENSAMBLE">ENSAMBLE</option>
          </select>
        </div>
        <div>
          <label>Modelo</label>
          <select
            value={form.model_id}
            onChange={(e) => setForm((f) => ({ ...f, model_id: e.target.value }))}
            disabled={loadingModels}
          >
            <option value="">— seleccionar modelo —</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {loadingModels && <div className="muted" style={{ marginTop: 6 }}>Cargando modelos…</div>}
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={onCreateEnsamble} disabled={creating || loadingModels}>
            {creating ? "Creando…" : "Crear plantilla"}
          </button>
          <button onClick={() => {
            setSearch(prev => {
              if (prev) setSearchQuery(""); // Si se va a desactivar, limpia el query
              return !prev;
            });
          }} style={{ margin: 2 }}><BsSearch></BsSearch></button>
        </div>

        {search && <div style={{ marginTop: 16 }}>
          <input
            type="text"
            placeholder="Buscar por plantilla..."
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={() => {
              setSearch(false);
              setSearchQuery("");
            }} // Cierra el campo de búsqueda al perder el foco
            autoFocus
          />
        </div>}

      </div>

      <br />

      {/* Lista tipo ListTile */}
      {isLoading ? (
        <div className="badge">Cargando…</div>
      ) : (
        <div className="list-tiles">
          {items.map((t) => (
            <div key={t.id} className="list-tile">
              {/* Avatar */}
              <div className="list-tile__leading" onClick={() => setOpenTmpl(t)} style={{ cursor: "pointer" }}>
                <div className="avatar">{t.name.slice(0, 1).toUpperCase()}</div>
              </div>

              {/* Contenido principal */}
              <div
                className="list-tile__content"
                style={{ cursor: editingId === t.id ? "text" : "" }}
  
              >
                {editingId === t.id ? (
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, t)}
                    onBlur={() => {handleSaveEdit(t)}} // Guarda al perder el foco
                    autoFocus
                    style={{
                      fontSize: "1rem",
                      padding: "6px",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      width: "90%",
                    }}
                  />
                ) : (
                  <>
                    <div className="list-tile__title">{t.name}</div>
                    <div className="list-tile__subtitle">
                      {t.model_name || `Modelo #${t.model_id}`} · {t.template_type} · v{t.version}
                    </div>
                  </>
                )}
              </div>

              {/* Botones */}
              <div className="list-tile__trailing" style={{ gap: 6 }}>
                {editingId === t.id ? (
                  <button
                    className="btn btn--primary"
                    onClick={() => handleSaveEdit(t)}
                    disabled={updating}
                    title="Guardar cambios"
                  >
                    <FaSave />
                  </button>
                ) : (
                  <button
                    className="btn"
                    onClick={() => handleStartEdit(t)}
                    title="Editar nombre"
                  >
                    <FaRegEdit />
                  </button>
                )}

                <span className="pill">v{t.version}</span>
                {t.is_published ? (
                  <span className="pill pill--ok">Publicado</span>
                ) : (
                  <button
                    className="btn btn--primary"
                    onClick={() => alert("Publicar (por hacer)")}
                  >
                    Publicar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}


      {/* Drawer */}
      {openTmpl && (
        <TemplateDetailsDrawer
          template={openTmpl}
          onClose={() => setOpenTmpl(null)}
        />
      )}
    </div>
  );
}