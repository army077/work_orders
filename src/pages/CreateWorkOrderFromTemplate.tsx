import React, { useMemo, useState, useEffect } from "react";
import { useList, useCreate } from "@refinedev/core";
import { Dialog, FormControl, InputLabel, Select, MenuItem, IconButton } from "@mui/material";
import { FaEye } from 'react-icons/fa6';
import axios from "axios";
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/firebase-config'

type Template = { id: number; name: string; version: number; model_id: number; is_published: boolean; template_type: string; };

type Technician = {
  id: number;
  estatus: string;
  sucursal: string;
  nombre_tecnico: string;
  correo_tecnico: string;
  telefono: string;
  puesto: string;
  nombre_bonos: string;
};

type Customization = {
  id: number;
  custom_title: string;
  custom_value: number;
};

// helpers
const isoToDateInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const dateToIsoAt1600Z = (yyyyMmDd: string) =>
  yyyyMmDd ? new Date(`${yyyyMmDd}T16:00:00Z`).toISOString() : "";

export default function CreateWorkOrderFromTemplate() {
  const { data: tpls } = useList<Template>({ resource: "templates", pagination: { pageSize: 500 } });
  const published = useMemo(() => (tpls?.data ?? []).filter(t => t.is_published), [tpls?.data]);

  // fecha default: hoy a las 16:00Z
  const today = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const todayStr = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;

  const [form, setForm] = useState({
    template_id: "",
    machine_serial: "",
    customer_name: "",
    site_address: "",
    assigned_tech_email: "",
    scheduled_at: dateToIsoAt1600Z(todayStr),
    template_type: "",
    tech_support: "",
    folio_sai: "",
    initial_status: "",
    comments: ""
  });

  //firebase
  const operadoresCollection = collection(db, 'operadores');
  const [newTecForm, setNewTec] = useState({
    estatus: "Activo",
    sucursal: "",
    nombre_tecnico: "",
    correo_tecnico: "",
    telefono: "",
    puesto: "",
    nombre_bonos: "",
  });
  // --- técnicos (API externa) ---
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loadingTechs, setLoadingTechs] = useState(false);
  const [techsError, setTechsError] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState(false);
  const [contraseña, setContraseña] = useState("");

  //--- dialog nuevo técnico (manual) ---
  const [openDialogNewTec, setOpenDialogNewTec] = useState(false);
  const handleOpenDialogNewTec = () => setOpenDialogNewTec(true);
  const handleCloseDialogNewTec = () => {
    setNewTec({
      estatus: "",
      sucursal: "",
      nombre_tecnico: "",
      correo_tecnico: "",
      telefono: "",
      puesto: "",
      nombre_bonos: ""
    });
    setOpenDialogNewTec(false);
  };
  const [operadores, setOperadores] = useState<any[]>([]);

  // --- dialog nueva customización (manual) ---
  const [openDialogNewCustom, setOpenDialogNewCustom] = useState(false);
  const [selectedCustoms, setSelectedCustoms] = useState<Customization[]>([]);
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]); // títulos seleccionados
  const handleOpenDialogNewCustom = async () => {
    await fetchCustoms();
    setOpenDialogNewCustom(true)
  };
  const handleCloseDialogNewCustom = () => setOpenDialogNewCustom(false);
  const [customs, setCustoms] = useState<Customization[]>([])
  const [newCustomTitle, setNewCustomTitle] = useState("");
  const [newCustomValue, setNewCustomValue] = useState<number | "">("");
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [newCustomState, setNewCustomState] = useState(false);


  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoadingTechs(true);
        setTechsError(null);
        const res = await fetch("https://desarrollotecnologicoar.com/api5/tecnicos");
        const data: Technician[] = await res.json();
        if (!cancel) setTechs(data.filter(t => (t.estatus || "").toLowerCase() === "activo"));
        await fetchUsuarios();
      } catch (e: any) {
        if (!cancel) setTechsError(e?.message || "No se pudieron cargar los técnicos");
      } finally {
        if (!cancel) setLoadingTechs(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const fetchUsuarios = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'operadores'));
      const usuariosData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setOperadores(usuariosData);
      console.log('Usuarios obtenidos:', usuariosData);
    } catch (error) {
      console.error('Error al obtener usuarios:', error);
    }
  };

  const fetchCustoms = async () => {
    try {
      const res = await fetch("https://desarrollotecnologicoar.com/api10/customs/template_custom");
      if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
      const data: Customization[] = await res.json();
      setCustoms(data); // 👈 correcto
      console.log("✅ Customizaciones obtenidas:", data);
    } catch (error) {
      console.log('error obteniendo las customs', error)
    }
  }

  const { mutate, isLoading } = useCreate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.template_id) return;

    if (!confirm("¿Estás seguro que la información es correcta?")) return;
    mutate(
      {
        resource: "work-orders",
        values: {
          fromTemplate: true,
          payload: {
            template_id: Number(form.template_id),
            machine_serial: form.machine_serial || null,
            customer_name: form.customer_name || null,
            site_address: form.site_address || null,
            assigned_tech_email: form.assigned_tech_email || null,
            scheduled_at: form.scheduled_at || null,
            tech_support: form.tech_support || null,
            folio_sai: form.folio_sai || null,
            initial_status: form.initial_status || null,
            comments: form.comments || null,
          },
        },
      },
      {
        onSuccess: async ({ data }) => {
          const workOrderId = Number(data?.id);

          if (selectedCustoms.length > 0) {
            for (const custom of selectedCustoms) {
              try {
                await fetch("https://desarrollotecnologicoar.com/api10/customs/custom_wo", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    work_order_id: workOrderId,
                    custom_title: custom.custom_title,
                    custom_value: custom.custom_value, // 👈 ya funciona
                  }),
                });
              } catch (e) {
                console.error("❌ Error guardando customización:", e);
              }
            }
          }

          console.log("Work order creada:", data);

          alert(`Work order creada: ID ${workOrderId} ✅\n\nCustomizaciones agregadas: ${selectedCustoms.length}`);
          setForm({
            template_id: "",
            machine_serial: "",
            customer_name: "",
            site_address: "",
            assigned_tech_email: "",
            scheduled_at: dateToIsoAt1600Z(todayStr),
            template_type: "",
            tech_support: "",
            folio_sai: "",
            initial_status: "",
            comments: ""
          });
          setSelectedCustoms([]);


          // Notificación de nuevas actividades
          if (form.template_type === "ENSAMBLE") {
            const notif = {
              correoTecnico: form.assigned_tech_email,
              ordenNumero: form.folio_sai
            }
            await mandarNotificacion(notif)
          }
        },
        onError: (err) => {
          alert(`Error: ${String((err as any)?.message || err)}`);
        },
      }
    );
  };

  const isoToDateTimeInput = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => `${n}`.padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const onChange =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const onChangeNewTec =
    (k: keyof typeof newTecForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setNewTec((f) => ({ ...f, [k]: e.target.value }));

  const guardarTecnico = async () => {
    if (!confirm("¿Estás seguro que la información es correcta?")) return;

    if (!newTecForm.nombre_tecnico || !newTecForm.correo_tecnico) {
      alert("El nombre y correo del técnico son obligatorios");
      return;
    }
    try {
      const res = await fetch("https://desarrollotecnologicoar.com/api5/agregar_tecnico", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTecForm),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Error guardando técnico");

      }

      const saved: Technician = await res.json();
      setTechs((t) => [...t, saved]);
      setForm((f) => ({ ...f, assigned_tech_email: saved.correo_tecnico }));
      setNewTec({
        estatus: "",
        sucursal: "",
        nombre_tecnico: "",
        correo_tecnico: "",
        telefono: "",
        puesto: "",
        nombre_bonos: "",
      });
      setManualEmail(false);
      await handleAddOperador();
      alert(`Técnico guardado con éxito,ahora puedes asignarlo para la orden de trabajo`);
    } catch (e: any) {
      alert(`Error: ${String(e?.message || e)}`);
    }
  };

  const mandarNotificacion = async (notif: any) => {
    try {
      console.log("Enviando notificación:", notif);
      const res = await axios.post("https://desarrollotecnologicoar.com/api5/enviarNotificacion/", notif);
      console.log("Respuesta del servidor:", res.data);
    } catch (e) {
      console.error("Error al enviar las actividades:", e);
    }
  };

  const handleAddCustom = async () => {
    if (!newCustomTitle || newCustomValue === "") {
      alert("Completa ambos campos");
      return;
    }
    setIsSavingCustom(true);
    setNewCustomState(false);
    try {
      const res = await fetch("https://desarrollotecnologicoar.com/api10/customs/template_custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custom_title: newCustomTitle,
          custom_value: Number(newCustomValue),
        }),
      });
      if (!res.ok) throw new Error("Error creando customización");
      await fetchCustoms(); // recargar lista
      setNewCustomTitle("");
      setNewCustomValue("");
    } catch (err) {
      console.error("❌ Error al crear custom:", err);
      alert("Error al crear la customización");
    } finally {
      setIsSavingCustom(false);
    }
  };

  const handleDeleteCustom = async (id: number) => {
    if (!confirm("¿Seguro que deseas eliminar esta customización?")) return;
    try {
      const res = await fetch(`https://desarrollotecnologicoar.com/api10/customs/${id}/template_custom`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Error eliminando custom");
      await fetchCustoms(); // refrescar
    } catch (err) {
      console.error("❌ Error al eliminar custom:", err);
      alert("Error al eliminar customización");
    }
  };

  const handleAddOperador = async () => {
    if (newTecForm.nombre_tecnico && newTecForm.correo_tecnico && contraseña) {
      try {
        // Registrar el usuario en Firebase Authentication
        const apiKey = 'AIzaSyBGB6jHNXRKIif9vUSR6ogtDIcCJpnqCrU'; // Tu API Key de Firebase
        const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: newTecForm.correo_tecnico,
            password: contraseña, // Usamos el token como contraseña
            returnSecureToken: true // No autenticar automáticamente
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Error al registrar el usuario:', errorData.error.message);
          alert('Error al registrar el usuario: ' + errorData.error.message);
          return;
        }

        // Guardar el operador en Firestore
        await addDoc(operadoresCollection, { nombre: newTecForm.nombre_tecnico, correo: newTecForm.correo_tecnico, token: contraseña });

      } catch (error) {
        console.error('Error al agregar el operador:', error);
        alert('Error al agregar el operador.');
      }
    } else {
      alert('Por favor completa todos los campos.');
    }
  };

  return (
    <div className="card">
      <h2>Crea una orden de trabajo desde la plantilla</h2>
      <p className="muted">
        Publica tu plantilla y luego crea una orden materializada (snapshot de secciones y tareas).
      </p>

      <form className="row" onSubmit={onSubmit}>
        <div className="row cols-3">
          <div>
            <label>Elige tu plantilla</label>
            <select
              value={form.template_id}
              onChange={(e) => setForm((f) => ({ ...f, template_id: e.target.value, template_type: (published.find(t => t.id === Number(e.target.value))?.template_type) || "" }))}
            >
              <option value="">— seleccionar —</option>
              {published.map(t => (
                <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>
              ))}
            </select>
          </div>

          <div>
            <label>Número de serie de la máquina</label>
            <input value={form.machine_serial} onChange={onChange("machine_serial")} />
          </div>
          <label>Fecha programada</label>
          <input
            type="datetime-local"
            value={isoToDateTimeInput(form.scheduled_at)}
            onChange={(e) => {
              const val = e.target.value;
              if (!val || val === "0") {
                // evitar crash y resetear
                setForm((f) => ({ ...f, scheduled_at: "" }));
              } else {
                const d = new Date(val);
                if (!isNaN(d.getTime())) {
                  setForm((f) => ({ ...f, scheduled_at: d.toISOString() })); // UTC
                }
              }
            }}
          />
        </div>

        <div className="row cols-3">
          {form.template_type !== "ENSAMBLE" && (
            <div>
              <label>Nombre del cliente (solo si aplica)</label>
              <input value={form.customer_name} onChange={onChange("customer_name")} />

              <label>Domicilio del sitio (solo si aplica)</label>
              <input value={form.site_address} onChange={onChange("site_address")} />
            </div>)}

          {/* ====== Assigned Tech (select con API) ====== */}
          <div>
            <label>Técnico asignado</label>

            {!manualEmail ? (
              <select
                value={form.assigned_tech_email}
                onChange={onChange("assigned_tech_email")}
                disabled={loadingTechs || !!techsError}
              >
                <option value="">{loadingTechs ? "Cargando técnicos…" : "— seleccionar técnico —"}</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.correo_tecnico}>
                    {t.nombre_tecnico} · {t.sucursal} · {t.correo_tecnico}
                  </option>
                ))}
                <option value="__manual__">Escribir manualmente…</option>
              </select>
            ) : (
              <input
                type="email"
                placeholder="correo@ejemplo.com"
                value={form.assigned_tech_email}
                onChange={onChange("assigned_tech_email")}
              />
            )}

            {form.template_type === "ENSAMBLE" && (
              <div>
                <label>Operador de soporte</label>
                <select
                  value={form.tech_support}
                  onChange={onChange("tech_support")}
                  disabled={loadingTechs || !!techsError}
                >
                  <option value="">{loadingTechs ? "Cargando técnicos…" : "— seleccionar técnico —"}</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.correo_tecnico}>
                      {t.nombre_tecnico} · {t.sucursal} · {t.correo_tecnico}
                    </option>
                  ))}
                  <option value="__manual__">Escribir manualmente…</option>
                </select>

                <label>Folio de SAI</label>
                <input value={form.folio_sai} onChange={onChange("folio_sai")} />

                <select value={form.initial_status} onChange={onChange("initial_status")}>
                  <option value="">— Estado inicial —</option>
                  <option value="New Product">Equipo Nuevo</option>
                  <option value="Refurbished">Equipo Remanufacturado</option>
                </select>

                <label>Comentarios adicionales</label>
                <input value={form.comments} onChange={onChange("comments")} style={{ minHeight: 150 }} />
              </div>

            )}

            {/* toggle */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>

              <button
                type="button"
                className="btn--clone"
                onClick={handleOpenDialogNewTec}
              >
                + Agregar técnico
              </button>

              {form.template_type === "ENSAMBLE" && (
                <button
                  type="button"
                  className="btn--custom"
                  onClick={handleOpenDialogNewCustom}
                >
                  + Agregar customización
                </button>)}
              {
                selectedCustoms.length > 0 && (
                  <IconButton>
                    <FaEye title="Visualizar customizaciones seleccionadas" onClick={handleOpenDialogNewCustom} style={{ cursor: 'pointer', color: '#d11e1e' }} />
                  </IconButton>)

              }
            </div>

            {techsError && <div className="badge fail" style={{ marginTop: 6 }}>Error: {techsError}</div>}

          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className='btn--ok' type="submit" disabled={isLoading}>
            {isLoading ? "Creando…" : "Crear orden de trabajo"}
          </button>
          <button
            type="button"
            className="btn--warning"
            onClick={() => setForm({
              template_id: "",
              machine_serial: "",
              customer_name: "",
              site_address: "",
              assigned_tech_email: "",
              scheduled_at: dateToIsoAt1600Z(todayStr),
              template_type: "",
              tech_support: "",
              folio_sai: "",
              initial_status: "",
              comments: ""
            })}
          >
            Reset
          </button>
        </div>
      </form>
      <Dialog open={openDialogNewTec} onClose={handleCloseDialogNewTec} keepMounted>
        <div style={{ padding: 20, minWidth: 320 }}>
          <h2>Agregar técnico manualmente</h2>
          <p className="muted">Completa los datos para registrar un nuevo técnico y asignarlo.</p>
          <label style={{ fontWeight: 500 }}>Puesto</label>
          <select
            value={newTecForm.puesto}
            onChange={(e) => setNewTec((f) => ({ ...f, puesto: e.target.value }))}
            style={{ width: "100%", marginBottom: 16 }}
          >
            <option value="">— Puesto del técnico —</option>
            <option value="Asesor Técnico">Asesor Técnico</option>
            <option value="Técnico de Campo">Técnico de Campo</option>
            <option value="Soporte Interno">Soporte Interno</option>
            <option value="Operador de producción">Operador de Producción</option>
          </select>
          <label style={{ fontWeight: 500 }}>Sucursal</label>
          <select
            value={newTecForm.sucursal}
            onChange={(e) => setNewTec((f) => ({ ...f, sucursal: e.target.value }))}
            style={{ width: "100%", marginBottom: 12 }}
          >
            <option value="">— Selecciona sucursal —</option>
            <option value="Españoles">Españoles</option>
            <option value="CDMX">CDMX</option>
            <option value="Guadalajara">Guadalajara</option>
            <option value="Ocotlán">Ocotlán</option>
            <option value="Monterrey">Monterrey</option>
            <option value="San Luis Potosí">San Luis Potosí</option>
          </select>

          <label style={{ fontWeight: 500 }}>Nombre del técnico</label>
          <input
            type="text"
            placeholder="Nombre del técnico"
            value={newTecForm.nombre_tecnico}
            onChange={onChangeNewTec("nombre_tecnico")}
            style={{ width: "100%", marginBottom: 12 }}
          />

          <label style={{ fontWeight: 500 }}>Correo electrónico</label>
          <input
            type="email"
            placeholder="correo@ejemplo.com"
            value={newTecForm.correo_tecnico}
            onChange={onChangeNewTec("correo_tecnico")}
            style={{ width: "100%", marginBottom: 12 }}
          />

          {newTecForm.puesto === "Operador de producción" && (
            <div>
              <label style={{ fontWeight: 500 }}>Ingresa contraseña de acceso (token para que acceda a la app)</label>
              <input
                type="text"
                placeholder="Ingresa token de acceso (contraseña)"
                value={contraseña}
                onChange={(e) => setContraseña(e.target.value)}
                style={{ width: "100%", marginBottom: 12 }}
              />

            </div>)}

          <label style={{ fontWeight: 500 }}>Teléfono (opcional)</label>
          <input
            type="tel"
            placeholder="Teléfono (opcional)"
            value={newTecForm.telefono}
            onChange={onChangeNewTec("telefono")}
            style={{ width: "100%", marginBottom: 12 }}
          />

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              className="btn--ok"
              onClick={async () => {
                const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newTecForm.correo_tecnico);

                if (!newTecForm.nombre_tecnico || !newTecForm.correo_tecnico) {
                  alert("El nombre y correo del técnico son obligatorios");
                  return;
                }

                if (!isValidEmail) {
                  alert("Correo electrónico inválido");
                  return;
                }

                await guardarTecnico(); // <- este ya guarda y actualiza estados
                handleCloseDialogNewTec();
              }}
            >
              Confirmar
            </button>
            <button onClick={handleCloseDialogNewTec}>Cancelar</button>
          </div>
        </div>
      </Dialog>

      <Dialog open={openDialogNewCustom} onClose={handleCloseDialogNewCustom} keepMounted>
        <div style={{ padding: 20, minWidth: 400 }}>
          <h3>Customizaciones</h3>
          <p className="muted" style={{ marginTop: -6 }}>
            Selecciona, agrega o elimina opciones personalizadas.
          </p>

          {/* 🧩 Sección de selección múltiple */}
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="select-custom-label">Seleccionar</InputLabel>
            <Select
              multiple
              labelId="select-custom-label"
              value={selectedTitles}
              onChange={(e) => {
                const val = e.target.value as string[];
                setSelectedTitles(val);
                const selectedObjects = customs.filter(c => val.includes(c.custom_title));
                setSelectedCustoms(selectedObjects);
              }}
              label="Seleccionar"
              renderValue={(selected) => (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(selected as string[]).map((v) => {
                    const match = customs.find(c => c.custom_title === v);
                    return (
                      <span key={v} className="pill">
                        {v} {match ? `(${match.custom_value})` : ""}
                      </span>
                    );
                  })}
                </div>
              )}
            >
              {customs.map((opt) => (
                <MenuItem
                  key={opt.id}
                  value={opt.custom_title}
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>{opt.custom_title} ({opt.custom_value})</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCustom(opt.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#d11e1e",
                      cursor: "pointer",
                    }}
                  >
                    🗑️
                  </button>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {newCustomState ? (
            <div style={{ marginTop: 16 }}>
              <h4>Agregar nueva customización</h4>
              <input
                type="text"
                placeholder="Título"
                value={newCustomTitle}
                onChange={(e) => setNewCustomTitle(e.target.value)}
                style={{ width: "100%", marginBottom: 8 }}
              />
              <input
                type="number"
                placeholder="Valor"
                value={newCustomValue}
                onChange={(e) => setNewCustomValue(e.target.value === "" ? "" : Number(e.target.value))}
                style={{ width: "100%", marginBottom: 8 }}
              />
              <button
                className="btn--clone"
                onClick={handleAddCustom}
                disabled={isSavingCustom}
              >
                {isSavingCustom ? "Guardando..." : "Agregar"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="btn--clone"
                onClick={() => setNewCustomState(prev => !prev)}>
                Agregar Customización
              </button>
              <button
                className="btn--ok"
                onClick={() => {
                  if (selectedCustoms.length === 0) {
                    alert("Selecciona al menos una customización.");
                    return;
                  }
                  handleCloseDialogNewCustom();
                }}
              >
                Confirmar
              </button>
              <button onClick={handleCloseDialogNewCustom}>Cancelar</button>
            </div>
          )}
        </div>



      </Dialog>

    </div>

  );
}