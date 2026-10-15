import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  engineeringRequest, safePdfLink, statusLabels,
} from "../services/engineering";
import type {
  DocumentDetail, DocumentStatus, EngineeringDocument, EngineeringEvent, EngineeringVersion, NormalizedMachine,
} from "../services/engineering";
import "./EngineeringDocuments.css";

const eventLabels: Record<string, string> = {
  MAQUINA_CREADA: "Máquina creada",
  MAQUINA_ACTUALIZADA: "Máquina actualizada",
  DOCUMENTO_CREADO: "Documento creado",
  DOCUMENTO_ACTUALIZADO: "Ficha actualizada",
  VERSION_CREADA: "Borrador registrado",
  BORRADOR_ACTUALIZADO: "Borrador actualizado",
  VERSION_PUBLICADA: "Revisión publicada",
  VERSION_OBSOLETA: "Revisión sustituida",
  VERSION_RETIRADA: "Revisión dada de baja",
};

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("es-MX") : "—";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación";
}

function EventHistory({ events }: { events: EngineeringEvent[] }) {
  return (
    <div className="engineering-events">
      {events.length === 0 && <p className="muted">No hay movimientos.</p>}
      {events.map((event) => (
        <article key={event.id} className="engineering-event">
          <strong>{eventLabels[event.action] || event.action}</strong>
          <p>{event.actor} · {date(event.created_at)}</p>
          {event.reason && <p>{event.reason}</p>}
          <details>
            <summary>Ver datos del movimiento</summary>
            <pre>{JSON.stringify({ antes: event.before_data, después: event.after_data }, null, 2)}</pre>
          </details>
        </article>
      ))}
    </div>
  );
}

export default function EngineeringDocuments() {
  const [machines, setMachines] = useState<NormalizedMachine[]>([]);
  const [documents, setDocuments] = useState<EngineeringDocument[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [machineName, setMachineName] = useState("");
  const [machineDescription, setMachineDescription] = useState("");
  const [editingMachine, setEditingMachine] = useState<NormalizedMachine | null>(null);
  const [machineActive, setMachineActive] = useState(true);
  const [machineEvents, setMachineEvents] = useState<EngineeringEvent[] | null>(null);
  const [machineHistoryId, setMachineHistoryId] = useState<number | null>(null);
  const [newMachineId, setNewMachineId] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [metadata, setMetadata] = useState<{ code: string; title: string; updated_at: string } | null>(null);
  const [editingVersion, setEditingVersion] = useState<EngineeringVersion | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [retiringVersion, setRetiringVersion] = useState<EngineeringVersion | null>(null);
  const [retirementReason, setRetirementReason] = useState("");
  const [viewVersionId, setViewVersionId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      engineeringRequest<NormalizedMachine[]>("/machines", { signal: controller.signal }),
      engineeringRequest<EngineeringDocument[]>("/documents", { signal: controller.signal }),
      selectedId === null ? Promise.resolve(null) :
        engineeringRequest<DocumentDetail>(`/documents/${selectedId}`, { signal: controller.signal }),
      machineHistoryId === null ? Promise.resolve(null) :
        engineeringRequest<EngineeringEvent[]>(`/machines/${machineHistoryId}/events`, { signal: controller.signal }),
    ]).then(([nextMachines, nextDocuments, nextDetail, nextEvents]) => {
      if (controller.signal.aborted) return;
      setMachines(nextMachines);
      setDocuments(nextDocuments);
      setDetail(nextDetail);
      setMachineEvents(nextEvents);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(message(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [selectedId, refresh, machineHistoryId]);

  const disabled = loading || busy || Boolean(error);
  const canWrite = !disabled && Boolean(actor.trim());
  const selected = detail?.id === selectedId ? detail : null;
  const viewed = selected?.versions.find((version) => version.id === viewVersionId);
  const viewerUrl = viewed ? safePdfLink(viewed.pdf_url) : null;
  const filtered = documents.filter((doc) =>
    (!machineFilter || doc.maquina_id === Number(machineFilter)) &&
    (!statusFilter || (statusFilter === "SIN_VIGENTE"
      ? !doc.versions.some((v) => v.status === "VIGENTE")
      : doc.versions.some((v) => v.status === statusFilter))) &&
    `${doc.code} ${doc.title} ${doc.machine_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const missingManual = machines.filter((machine) => machine.is_active &&
    !documents.some((doc) => doc.maquina_id === machine.id && doc.versions.some((v) => v.status === "VIGENTE")));

  async function mutate(work: () => Promise<unknown>, success: string, after?: () => void) {
    if (!actor.trim()) {
      setNotice("Escribe el nombre o correo del responsable antes de administrar documentos.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await work();
      after?.();
      setNotice(success);
      setRefresh((value) => value + 1);
    } catch (failure) {
      setNotice(`No se guardó: ${message(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  function selectDocument(documentId: number) {
    setSelectedId(documentId);
    setMetadata(null);
    setEditingVersion(null);
    setPdfUrl("");
    setChangeSummary("");
    setRetiringVersion(null);
    setViewVersionId(null);
  }

  function resetMachine() {
    setEditingMachine(null);
    setMachineName("");
    setMachineDescription("");
    setMachineActive(true);
  }

  function reload() {
    if ((editingMachine || metadata || editingVersion || retiringVersion || pdfUrl || changeSummary) &&
        !window.confirm("¿Recargar y descartar las ediciones pendientes?")) return;
    resetMachine();
    setMetadata(null);
    setEditingVersion(null);
    setPdfUrl("");
    setChangeSummary("");
    setRetiringVersion(null);
    setRetirementReason("");
    setRefresh((value) => value + 1);
  }

  function saveMachine(event: FormEvent) {
    event.preventDefault();
    void mutate(() => engineeringRequest(
      editingMachine ? `/machines/${editingMachine.id}` : "/machines",
      {
        method: editingMachine ? "PUT" : "POST",
        body: { name: machineName, description: machineDescription, actor,
          ...(editingMachine ? { is_active: machineActive, updated_at: editingMachine.updated_at } : {}) },
      }
    ), "Catálogo actualizado.", resetMachine);
  }

  function createDocument(event: FormEvent) {
    event.preventDefault();
    void mutate(async () => {
      const created = await engineeringRequest<{ id: number }>("/documents", {
        method: "POST", body: { maquina_id: Number(newMachineId), code: newCode, title: newTitle, actor },
      });
      selectDocument(created.id);
    }, "Documento creado. Registra su primera revisión.", () => {
      setNewCode("");
      setNewTitle("");
      setNewMachineId("");
    });
  }

  function saveVersion(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    void mutate(() => engineeringRequest(
      editingVersion ? `/versions/${editingVersion.id}` : `/documents/${selected.id}/versions`,
      { method: editingVersion ? "PUT" : "POST", body: {
        actor, pdf_url: pdfUrl, change_summary: changeSummary,
        ...(editingVersion ? { updated_at: editingVersion.updated_at } : {}),
      } }
    ), "Borrador guardado.", () => {
      setEditingVersion(null);
      setPdfUrl("");
      setChangeSummary("");
    });
  }

  function publish(version: EngineeringVersion) {
    if (!window.confirm(`¿Publicar la revisión ${version.revision}? La vigente anterior quedará obsoleta.`)) return;
    void mutate(() => engineeringRequest(`/versions/${version.id}/publish`, {
      method: "POST", body: { actor, updated_at: version.updated_at },
    }), "Revisión publicada.");
  }

  function retire(event: FormEvent) {
    event.preventDefault();
    if (!retiringVersion) return;
    void mutate(() => engineeringRequest(`/versions/${retiringVersion.id}/retire`, {
      method: "POST", body: { actor, reason: retirementReason, updated_at: retiringVersion.updated_at },
    }), "Revisión retirada. El PDF y el historial se conservan.", () => {
      setRetiringVersion(null);
      setRetirementReason("");
    });
  }

  return (
    <div className="engineering-page">
      <header>
        <h1>Documentación de Ingeniería</h1>
        <p className="muted">Manuales de instalación exitosa · Catálogo independiente de máquinas normalizadas</p>
      </header>
      <aside className="engineering-warning" role="note">
        <strong>Permisos de Ingeniería pendientes.</strong> Este módulo no restringe el acceso todavía.
        El responsable se registra como dato declarado, no como identidad autenticada.
        Solo se guardan enlaces: el archivo externo y sus permisos no los controla este sistema.
        Para conservar cada revisión, utiliza un enlace distinto a un PDF que no se sobrescriba.
      </aside>
      <div className="card engineering-toolbar">
        <label htmlFor="engineering-actor">Responsable de los movimientos (nombre o correo)
          <input id="engineering-actor" value={actor} maxLength={200} onChange={(e) => setActor(e.target.value)} placeholder="Nombre o correo de Ingeniería" />
        </label>
        <button disabled={busy || loading} onClick={reload}>Recargar</button>
      </div>
      {notice && <div role="status" className="engineering-warning">{notice}</div>}
      {error && <div role="alert" className="engineering-warning">No se pudo cargar la información: {error}</div>}
      {loading && <p role="status">Cargando documentación…</p>}

      <details className="card">
        <summary>Catálogo de máquinas normalizadas ({machines.length})</summary>
        <div className="engineering-columns">
          <form onSubmit={saveMachine}>
            <h3>{editingMachine ? "Editar máquina" : "Nueva máquina"}</h3>
            <label>Nombre
              <input required maxLength={200} value={machineName} onChange={(e) => setMachineName(e.target.value)} />
            </label>
            <label>Descripción
              <textarea maxLength={2000} value={machineDescription} onChange={(e) => setMachineDescription(e.target.value)} />
            </label>
            {editingMachine && <label className="engineering-checkbox">
              <input type="checkbox" checked={machineActive} onChange={(e) => setMachineActive(e.target.checked)} />Activa
            </label>}
            <div className="engineering-actions">
              <button disabled={!canWrite}>{editingMachine ? "Guardar máquina" : "Crear máquina"}</button>
              {editingMachine && <button type="button" onClick={resetMachine} disabled={busy}>Cancelar</button>}
            </div>
          </form>
          <div className="engineering-machine-list">
            {machines.length === 0 && <p>No hay máquinas. Registra una para comenzar.</p>}
            {machines.map((machine) => (
              <article key={machine.id}>
                <strong>{machine.name}</strong> <span className="badge">{machine.is_active ? "Activa" : "Inactiva"}</span>
                <p className="muted">{machine.description}</p>
                <div className="engineering-actions">
                  <button disabled={!canWrite} onClick={() => {
                    setEditingMachine(machine);
                    setMachineName(machine.name);
                    setMachineDescription(machine.description);
                    setMachineActive(machine.is_active);
                  }}>Editar</button>
                  <button disabled={disabled} onClick={() => {
                    setMachineEvents(null);
                    setMachineHistoryId(machine.id);
                  }}>Historial</button>
                </div>
              </article>
            ))}
          </div>
        </div>
        {machineHistoryId !== null && <section>
          <h3>Movimientos de {machines.find((m) => m.id === machineHistoryId)?.name}</h3>
          <button onClick={() => setMachineHistoryId(null)}>Cerrar historial</button>
          {machineEvents && <EventHistory events={machineEvents} />}
        </section>}
      </details>

      {!loading && !error && missingManual.length > 0 && <div className="engineering-warning">
        <strong>Máquinas sin manual vigente ({missingManual.length}): </strong>
        {missingManual.map((machine) => machine.name).join(", ")}
      </div>}

      <details className="card">
        <summary>Registrar manual de instalación exitosa</summary>
        <form onSubmit={createDocument} className="engineering-fields">
          <label>Máquina
            <select required value={newMachineId} onChange={(e) => setNewMachineId(e.target.value)}>
              <option value="">Seleccionar máquina</option>
              {machines.filter((m) => m.is_active && !documents.some((d) => d.maquina_id === m.id))
                .map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
            </select>
          </label>
          <label>Código documental
            <input required maxLength={80} value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Ej. MIE-SHOP-PRO" />
          </label>
          <label>Título
            <input required maxLength={250} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </label>
          <button disabled={!canWrite}>Crear documento</button>
        </form>
        <p className="muted">Un manual por máquina; sus actualizaciones se registran como nuevas revisiones.</p>
      </details>

      <section className="card">
        <h2>Manuales</h2>
        <div className="engineering-fields">
          <label>Buscar
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Máquina, código o título" />
          </label>
          <label>Máquina
            <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
              <option value="">Todas</option>
              {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
            </select>
          </label>
          <label>Estado de revisiones
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              {(Object.keys(statusLabels) as DocumentStatus[]).map((status) =>
                <option key={status} value={status}>{statusLabels[status]}</option>)}
              <option value="SIN_VIGENTE">Sin vigente</option>
            </select>
          </label>
        </div>
        <div className="engineering-table-wrap">
          <table className="table">
            <thead><tr><th>Máquina / código</th><th>Manual</th><th>Revisiones</th><th>Vigencia</th><th>Acciones</th></tr></thead>
            <tbody>
              {filtered.map((doc) => {
                const current = doc.versions.find((v) => v.status === "VIGENTE");
                return <tr key={doc.id}>
                  <td>{doc.machine_name}<br /><span className="muted">{doc.code}</span></td>
                  <td>{doc.title}{!doc.machine_active && <p className="badge">Máquina inactiva</p>}</td>
                  <td>{doc.versions.length}</td>
                  <td>{current ? <span className="badge ok">Vigente · Rev. {current.revision}</span> : <span className="badge warn">Sin manual vigente</span>}</td>
                  <td><button disabled={disabled} onClick={() => selectDocument(doc.id)}>Ver manual e historial</button></td>
                </tr>;
              })}
              {!loading && filtered.length === 0 && <tr><td colSpan={5}>No hay manuales que coincidan.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && <section className="card" aria-label="Detalle del manual">
        <div className="engineering-toolbar">
          <div><h2>{selected.title}</h2><p>{selected.machine_name} · {selected.code}</p></div>
          <button disabled={busy} onClick={() => {
            setSelectedId(null);
            setMetadata(null);
            setViewVersionId(null);
          }}>Cerrar manual</button>
        </div>
        <button disabled={!canWrite} onClick={() => setMetadata({
          code: selected.code, title: selected.title, updated_at: selected.updated_at,
        })}>Editar ficha</button>
        {metadata && <form className="engineering-fields" onSubmit={(event) => {
          event.preventDefault();
          void mutate(() => engineeringRequest(`/documents/${selected.id}`, {
            method: "PUT", body: { ...metadata, actor },
          }), "Ficha actualizada.", () => setMetadata(null));
        }}>
          <label>Código<input required maxLength={80} value={metadata.code} onChange={(e) => setMetadata({ ...metadata, code: e.target.value })} /></label>
          <label>Título<input required maxLength={250} value={metadata.title} onChange={(e) => setMetadata({ ...metadata, title: e.target.value })} /></label>
          <div className="engineering-actions">
            <button disabled={!canWrite}>Guardar ficha</button>
            <button type="button" disabled={busy} onClick={() => setMetadata(null)}>Cancelar</button>
          </div>
        </form>}
        {!selected.versions.some((v) => v.status === "VIGENTE") &&
          <p className="engineering-warning">Sin manual vigente. Las revisiones históricas no deben usarse como sustituto automático.</p>}
        <h3>Revisiones</h3>
        <div className="engineering-versions">
          {selected.versions.length === 0 && <p>No hay revisiones. Registra el primer enlace PDF.</p>}
          {selected.versions.map((version) => {
            const link = safePdfLink(version.pdf_url);
            return <article key={version.id} className="engineering-version">
              <h4>Rev. {version.revision} <span className={`badge ${version.status === "VIGENTE" ? "ok" : "warn"}`}>{statusLabels[version.status]}</span></h4>
              <p>{version.change_summary}</p>
              <p className="muted">Registrada por {version.created_by} · {date(version.created_at)}</p>
              {version.published_at && <p className="muted">Publicada por {version.published_by} · {date(version.published_at)}</p>}
              {version.retirement_reason && <p>Motivo de baja: {version.retirement_reason} · {version.retired_by} · {date(version.retired_at)}</p>}
              <div className="engineering-actions">
                {link ? <>
                  <button disabled={disabled} onClick={() => setViewVersionId(version.id)}>Visualizar PDF</button>
                  <a className="btn" href={link} target="_blank" rel="noopener noreferrer">Abrir enlace PDF</a>
                </> : <span role="alert">Enlace inválido; no se puede abrir.</span>}
                {version.status === "BORRADOR" && <>
                  <button disabled={!canWrite || !selected.machine_active} onClick={() => {
                    setEditingVersion(version);
                    setPdfUrl(version.pdf_url);
                    setChangeSummary(version.change_summary);
                  }}>Editar borrador</button>
                  <button className="btn--ok" disabled={!canWrite || !selected.machine_active} onClick={() => publish(version)}>Publicar</button>
                </>}
                {version.status !== "RETIRADO" && <button className="btn--danger" disabled={!canWrite} onClick={() => {
                  setRetiringVersion(version);
                  setRetirementReason("");
                }}>Dar de baja</button>}
              </div>
            </article>;
          })}
        </div>
        {retiringVersion && <form onSubmit={retire} className="engineering-version">
          <h3>Dar de baja la revisión {retiringVersion.revision}</h3>
          <p>Se conserva el historial. Si es la vigente, el documento quedará sin manual vigente.</p>
          <label>Motivo de baja
            <textarea required maxLength={2000} value={retirementReason} onChange={(e) => setRetirementReason(e.target.value)} />
          </label>
          <div className="engineering-actions">
            <button className="btn--danger" disabled={!canWrite}>Confirmar baja</button>
            <button type="button" disabled={busy} onClick={() => setRetiringVersion(null)}>Cancelar</button>
          </div>
        </form>}
        <form onSubmit={saveVersion} className="engineering-version">
          <h3>{editingVersion ? `Editar borrador · Rev. ${editingVersion.revision}` : "Registrar nueva revisión (borrador)"}</h3>
          <label>Enlace al PDF
            <input type="url" required maxLength={2048} value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="https://… (archivo PDF individual, no carpeta)" />
          </label>
          <label>Resumen de cambios
            <textarea required maxLength={4000} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
          </label>
          <div className="engineering-actions">
            <button disabled={!canWrite || !selected.machine_active}>{editingVersion ? "Guardar borrador" : "Registrar borrador"}</button>
            {editingVersion && <button type="button" disabled={busy} onClick={() => {
              setEditingVersion(null); setPdfUrl(""); setChangeSummary("");
            }}>Cancelar edición</button>}
          </div>
        </form>
        {viewed && <section className="engineering-preview">
          <div className="engineering-toolbar">
            <h3>PDF · Rev. {viewed.revision} · {statusLabels[viewed.status]}</h3>
            <button onClick={() => setViewVersionId(null)}>Cerrar visor</button>
          </div>
          {viewed.status !== "VIGENTE" && <p className="engineering-warning">Esta revisión no está vigente.</p>}
          <p className="muted">Si el proveedor bloquea la vista integrada o requiere sesión, utiliza “Abrir enlace PDF”. No se verifica el contenido del archivo externo.</p>
          {viewerUrl ? <iframe title={`Manual ${selected.code}, revisión ${viewed.revision}`}
            src={viewerUrl}
            referrerPolicy="no-referrer" /> : <p role="alert">El enlace del PDF no es válido.</p>}
        </section>}
        <details>
          <summary>Bitácora del documento ({selected.events.length})</summary>
          <EventHistory events={selected.events} />
        </details>
      </section>}
    </div>
  );
}
