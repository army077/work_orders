import { API10_URL, IS_TEST } from "../config/api";
import { apiFetch as fetch } from "../services/apiTransport";
import { useList } from "@refinedev/core";
import {
    Card,
    Typography,
    Box,
    LinearProgress,
    Chip,
    Dialog,
    List,
    ListItem,
    ListItemText,
    ListSubheader,
    Button,
    IconButton,
    Tooltip,
    DialogTitle,
    useMediaQuery,
    useTheme
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import "./inspection-list.css";
import "./inspection-detail.css";
import React, { useState, useEffect } from "react";
import { FaEye } from 'react-icons/fa6';

import { createInspectionRefresh, filterInspectionOrders, LEGACY_INSPECTION_LIST_RESOURCE, LEGACY_RELEASE_RESOURCE } from "../features/inspectionPlantel";
import type { InspectionOrder, InspectionStatus, SearchScope, ReleaseFilter, ReleaseCode, ProductionReleaseOrder } from "../features/inspectionPlantel";
import { productionOrderId, STATUS_LABELS } from "../features/inspectionPlantel";
import { InspectionPlantelControls, InspectionIdentity, InspectionPeople, InspectionListFeedback, InspectionReleaseSummary } from "../features/InspectionPlantelControls";

const INSPECTORS = [
    { name: "Miguel Casillas", email: "miguel.casillas@asiarobotica.com" },
    { name: "Iván Cobián", email: "ivan.cobian@asiarobotica.com" },
    { name: "Carlos Rodriguez", email: "carlos.rodriguez@asiarobotica.com" },
    { name: "Paulina Correa", email: "paulina.correa@asiarobotica.com" },
    { name: "Carlos Mercado", email: "carlos.mercado@asiarobotica.com" },
];


export const PlantelInspeccion = () => {
    const compactDetail = useMediaQuery(useTheme().breakpoints.down("md"));
    const [search, setSearch] = React.useState("");
    const [open, setOpen] = React.useState(false);
    const [selectedOrder, setSelectedOrder] = React.useState<InspectionOrder | null>(null);
    const [openTaskId, setOpenTaskId] = React.useState<number | null>(null);
    const [deviations, setDeviations] = React.useState<any[]>([]);
    const [loadingDev, setLoadingDev] = React.useState(false);
    const [editMode, setEditMode] = useState(false);
    const [savingTaskId, setSavingTaskId] = useState<number | null>(null);
    const [closing, setClosing] = useState<"release" | "finish" | null>(null);
    const [closeFeedback, setCloseFeedback] = useState<{ ok: boolean; text: string } | null>(null);
    const [taskFeedback, setTaskFeedback] = useState<{ taskId: number; ok: boolean; text: string } | null>(null);
    const [showEvidencePanel, setShowEvidencePanel] = useState(false);
    const [searchScope, setSearchScope] = useState<SearchScope>("all");
    const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("");


    const handleOpen = (order: InspectionOrder) => {
        setSelectedOrder(order);
        setCloseFeedback(null);
        setOpen(true);
    };
    const handleClose = () => {
        setOpen(false);
        setSelectedOrder(null);
    };
    const [filterStatus, setFilterStatus] =
        React.useState<InspectionStatus | "">("");

    const { data, isLoading, isFetching, error, refetch } = useList<InspectionOrder>({
        resource: LEGACY_INSPECTION_LIST_RESOURCE,
        queryOptions: { retry: false },
    });
    const releasesEnabled = releaseFilter !== "";
    const releaseQuery = useList<ProductionReleaseOrder>({
        resource: LEGACY_RELEASE_RESOURCE,
        queryOptions: { enabled: releasesEnabled, retry: false, refetchOnWindowFocus: false },
    });
    const releaseRefetch = releaseQuery.refetch;
    const refreshInspections = React.useMemo(() => createInspectionRefresh(async () => {
        await Promise.all([refetch(), ...(releasesEnabled ? [releaseRefetch()] : [])]);
    }), [refetch, releaseRefetch, releasesEnabled]);
    const releases = React.useMemo(() => releaseQuery.data ? new Map(releaseQuery.data.data.map(order => [order.id, order])) : undefined, [releaseQuery.data]);
    const releaseLoading = releasesEnabled && (releaseQuery.isLoading || releaseQuery.isFetching);
    const releaseFailed = releasesEnabled && Boolean(releaseQuery.error);
    const refreshing = isFetching || releaseLoading;

    const inspections = React.useMemo(() => data?.data ?? [], [data]);

    const filtered = React.useMemo(() => filterInspectionOrders(inspections,
        { search, status: filterStatus, scope: searchScope, release: releaseFilter, releases }), [inspections, search, filterStatus, searchScope, releaseFilter, releases]);

    // Refresh an open detail from the same inspection identity, never generic id.
    useEffect(() => {
        if (!open || !data || isFetching || error) return;
        const current = inspections.find(order => order.inspection_order_id === selectedOrder?.inspection_order_id);
        if (current) setSelectedOrder(current);
        else { setSelectedOrder(null); setOpen(false); }
    }, [data, inspections, isFetching, error, open, selectedOrder?.inspection_order_id]);

    const fetchDeviations = async (taskId: number) => {
        try {
            setLoadingDev(true);
            const res = await fetch(
                `${API10_URL}/quality/desviaciones/${taskId}`
            );
            const json = await res.json();
            setDeviations(Array.isArray(json) ? json : []);
        } catch (err) {
            console.error("Error fetching deviations:", err);
            setDeviations([]);
        } finally {
            setLoadingDev(false);
        }
    };

    const cancelOrderFunction = (inspection_order_id: number) => async () => {
        const confirm = window.confirm(`¿Estás seguro de que deseas cancelar la orden de inspección #${inspection_order_id}? Esta acción no se puede deshacer.`);
        if (!confirm) return;
        try {
            const res = await fetch(
                `${API10_URL}/quality/${inspection_order_id}/insp_cancel`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                }
            );
            if (!res.ok) throw new Error("Error cancelling inspection order");
            alert(`La orden de inspección #${inspection_order_id} ha sido cancelada correctamente.`);
            window.location.reload();
        } catch (err) {
            console.error(err);
            alert("No se pudo cancelar la orden, intenta de nuevo.");
        }
    }


    const refreshSelectedOrder = async (inspectionOrderId: number) => {
        const result = await refetch();
        const fresh = result.data?.data?.find((i) => i.inspection_order_id === inspectionOrderId);
        if (fresh) setSelectedOrder(fresh);
        if (releasesEnabled) await releaseRefetch();
    };

    const completeTask = async (order: InspectionOrder, task: any) => {
        setSavingTaskId(task.id);
        setTaskFeedback(null);
        try {
            const nowIso = new Date().toISOString();
            // started_at se envía solo si el punto no tiene inicio; el backend conserva el existente.
            const body: Record<string, unknown> = { status: "DONE", finished_at: nowIso };
            if (!task.started_at) body.started_at = nowIso;
            const res = await fetch(`${API10_URL}/quality/${task.id}/stavance`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || `HTTP ${res.status}`);
            }
            await refreshSelectedOrder(order.inspection_order_id);
            setTaskFeedback({ taskId: task.id, ok: true, text: "Punto marcado como completado y guardado." });
        } catch (err: any) {
            console.error(err);
            setTaskFeedback({ taskId: task.id, ok: false, text: `No se pudo guardar el resultado: ${err?.message || "error desconocido"}` });
        } finally {
            setSavingTaskId(null);
        }
    };

    const closeInspection = async (order: InspectionOrder, action: "release" | "finish") => {
        const pending = (order.tasks ?? []).filter((t) => t.status !== "DONE").length;
        if ((order.tasks ?? []).length === 0 || pending > 0) {
            setCloseFeedback({ ok: false, text: "Todos los puntos de inspección deben estar completados antes de continuar." });
            return;
        }
        if (action === "release" && !order.work_order_id) {
            setCloseFeedback({ ok: false, text: "La inspección no tiene una orden de trabajo asociada." });
            return;
        }
        const message = action === "release"
            ? `¿Liberar la sección "${order.inspection_type}" en la orden de trabajo #${order.work_order_id}?`
            : `¿Finalizar la inspección #${order.inspection_order_id}? Esta acción no se puede deshacer.`;
        if (!window.confirm(message)) return;

        setClosing(action);
        setCloseFeedback(null);
        try {
            const url = action === "release"
                ? `${API10_URL}/quality/liberar_orden/${order.work_order_id}`
                : `${API10_URL}/quality/${order.inspection_order_id}/insp_end`;
            const body = action === "release"
                ? { inspection_order_id: order.inspection_order_id, section_title: order.inspection_type, finished_at: new Date().toISOString() }
                : undefined;
            const res = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || `HTTP ${res.status}`);
            }
            await refreshSelectedOrder(order.inspection_order_id);
            setCloseFeedback({
                ok: true,
                text: action === "release"
                    ? "Sección liberada correctamente. Ya puedes finalizar la inspección."
                    : "Inspección finalizada correctamente.",
            });
        } catch (err: any) {
            console.error(err);
            setCloseFeedback({ ok: false, text: `No se pudo completar la operación: ${err?.message || "error desconocido"}` });
        } finally {
            setClosing(null);
        }
    };

    const renderCard = (o: InspectionOrder) => {
        const total = o.tasks?.length ?? 0;
        const done = o.tasks?.filter((t) => t.status === "DONE").length ?? 0;
        const avance = total > 0 ? Math.round((done / total) * 100) : 0;

        return (
            <Box component="li" key={o.inspection_order_id} className="inspection-record" data-inspection-order={o.inspection_order_id}>
                <Box className="inspection-record__heading">
                    <Box className="inspection-record__identity">
                        <Typography component="h2">Inspección #{o.inspection_order_id}</Typography>
                        <Typography className="inspection-record__production">Orden de producción: <strong>{productionOrderId(o) ?? "No registrada"}</strong>
                            {o.folio_sai && <span> · Folio SAI de producción: <strong>{o.folio_sai}</strong></span>}
                        </Typography>
                    </Box>
                    <Chip
                            className="inspection-record__state" data-inspection-status={o.status}
                            label={STATUS_LABELS[o.status] || o.status}
                            sx={{
                                backgroundColor:
                                    o.status === "OPEN"
                                        ? "#5B1A1F"
                                        : o.status === "IN_PROGRESS"
                                            ? "#F2B04A"
                                            : o.status === "CLOSED"
                                                ? "#34302D"
                                                : o.status === "PENDING"

                                                    ? "#5B1A1F"
                                                    : "#34302D",
                                color: o.status === "IN_PROGRESS" ? "#14110F" : "#F5F1ED",
                                alignItems: "center",
                                fontWeight: 700,
                                fontSize: 12,
                            }}

                        />
                </Box>
                <Box className="inspection-record__body">
                    <Box className="inspection-record__equipment">
                        <Typography className="inspection-record__label">Equipo</Typography>
                        <Typography className="inspection-record__machine">{o.equipo ?? "N/A"}</Typography>
                        <Typography className="inspection-record__type">{o.inspection_type || "Tipo de inspección no registrado"}</Typography>
                        <Box className="inspection-record__context">
                        {o.estacion !== null && <Typography>Estación: <strong>{o.estacion ?? "—"}</strong></Typography>}
                        <Typography>Serie: <strong>{o.machine_serial || "—"}</strong></Typography>
                        </Box>
                        <Box className="inspection-record__date">
                            <Typography className="inspection-record__label">Solicitada el</Typography>
                            <Typography>{new Date(new Date(o.created_at).getTime() + 6 * 60 * 60 * 1000).toLocaleString() ?? "N/A"}</Typography>
                        </Box>
                    </Box>
                    <Box className="inspection-record__people">
                        <Typography className="inspection-record__label">Responsables</Typography>
                        <InspectionPeople order={o} />
                    </Box>
                    <Box className="inspection-record__progress">
                        <Box className="inspection-record__progress-label"><span>Progreso de puntos</span><strong>{avance}% · {done}/{total}</strong></Box>
                        <LinearProgress variant="determinate" value={avance} aria-label={`Progreso de puntos de inspección ${o.inspection_order_id}`} />
                        <Button variant="outlined" className="inspection-record__open" data-open-inspection={o.inspection_order_id}
                            aria-label={`Ver detalle de inspección ${o.inspection_order_id}`} onClick={() => handleOpen(o)} endIcon={<FaEye aria-hidden="true" />}>Ver detalle</Button>
                    </Box>
                </Box>
                {releaseFilter && releases && !releaseFailed && <Box className="inspection-record__release"><InspectionReleaseSummary order={o} releases={releases} code={releaseFilter.split(":")[0] as ReleaseCode} /></Box>}
            </Box>
        );
    };

    return (
        <Box className="inspection-list">
            <Box component="header" className="inspection-list__header"><Typography component="h1">Plantel de Inspección</Typography><Typography>Consulta inspecciones, responsables y avance de puntos. Abre un registro para revisar sus actividades.</Typography></Box>
            <InspectionPlantelControls search={search} scope={searchScope} status={filterStatus}
                release={releaseFilter} onRelease={setReleaseFilter}
                refreshing={refreshing} onSearch={setSearch} onScope={setSearchScope} onStatus={setFilterStatus}
                onRefresh={() => { void refreshInspections().catch(() => undefined); }} />
            <InspectionListFeedback loading={isLoading || releaseLoading} failed={Boolean(error) || releaseFailed} releaseFailed={releaseFailed} total={inspections.length} matched={filtered.length} />
            {!isLoading && !releaseLoading && !error && !releaseFailed && <Box component="ul" className="inspection-list__records" aria-label="Listado de inspecciones">{filtered.map(renderCard)}</Box>}
            <Dialog
                open={open}
                onClose={handleClose}
                fullScreen={compactDetail}
                aria-labelledby="inspection-detail-title"
                maxWidth="lg"
                fullWidth
                PaperProps={{ className: "inspection-detail" }}
            >
                <DialogTitle id="inspection-detail-title" component="div" className="inspection-detail__header">
                    <Box className="inspection-detail__identity">
                        <Typography className="inspection-detail__eyebrow">
                            Calidad · Detalle de inspección
                        </Typography>
                        <Box className="inspection-detail__heading">
                            <Typography component="h2" variant="h6">
                                {selectedOrder ? `Inspección #${selectedOrder.inspection_order_id}` : "Inspección"}
                            </Typography>
                            {selectedOrder && (
                                <Chip
                                    label={selectedOrder.status}
                                    className="inspection-detail__state"
                                    data-inspection-status={selectedOrder.status}
                                />
                            )}
                        </Box>
                        {selectedOrder && (
                            <Box className="inspection-detail__references">
                                <InspectionIdentity order={selectedOrder} />
                                <Typography>{selectedOrder.equipo || "—"}</Typography>
                            </Box>
                        )}
                    </Box>
                    {selectedOrder &&
                        (() => {
                            const total = selectedOrder.tasks?.length ?? 0;
                            const done = selectedOrder.tasks?.filter((t) => t.status === "DONE").length ?? 0;
                            const avance = total > 0 ? Math.round((done / total) * 100) : 0;
                            return (
                                <Box className="inspection-detail__progress">
                                    <Typography>
                                        <strong>{avance}%</strong> puntos
                                    </Typography>
                                    <LinearProgress
                                        variant="determinate"
                                        value={avance}
                                        aria-label={`Progreso de puntos de inspección ${selectedOrder.inspection_order_id}`}
                                    />
                                    <Typography>
                                        {done}/{total} completados · estado independiente
                                    </Typography>
                                </Box>
                            );
                        })()}
                    <IconButton
                        aria-label="Cerrar detalle de inspección"
                        onClick={handleClose}
                        className="inspection-detail__close"
                    >
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                {!selectedOrder ? (
                    <Box>
                        <Typography>Cargando…</Typography>
                    </Box>
                ) : (
                    <Box className="inspection-detail__body">
                        {/* COL IZQUIERDA — INFO GENERAL */}
                        <Box className="inspection-detail__information">
                            {/* HEADER */}
                            <Box className="inspection-detail__template">
                                <Typography variant="h6">
                                    {selectedOrder.titulo || `Inspección #${selectedOrder.inspection_order_id}`}
                                </Typography>
                                <Typography variant="body2">
                                    Estación: <b>{selectedOrder.estacion ?? "N/A"}</b>
                                </Typography>

                                <Box></Box>
                            </Box>

                            <Typography className="inspection-detail__type">
                                {selectedOrder.inspection_type || "Tipo de inspección no registrado"}
                            </Typography>
                            {/* DETALLES */}
                            <Box className="inspection-detail__fields">
                                <Button
                                    disabled={refreshing}
                                    onClick={() => {
                                        void refreshInspections().catch(() => undefined);
                                    }}
                                    className="inspection-detail__refresh"
                                >
                                    Actualizar esta inspección
                                </Button>
                                {(error || releaseFailed) && (
                                    <InspectionListFeedback
                                        loading={false}
                                        failed
                                        releaseFailed={releaseFailed}
                                        total={inspections.length}
                                        matched={filtered.length}
                                    />
                                )}

                                <Box className="inspection-detail__people">
                                    <Typography component="h3">Responsables</Typography>
                                    <InspectionPeople order={selectedOrder} />
                                </Box>

                                <Box className="inspection-detail__assignment">
                                    {
                                        <>
                                            <Typography variant="subtitle2">Asignar inspector</Typography>

                                            <Box
                                                component="select"
                                                value={
                                                    INSPECTORS.find(
                                                        (inspector) =>
                                                            inspector.email === selectedOrder.assigned_tech_email
                                                    )?.email ?? ""
                                                }
                                                onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                                                    const email = e.target.value;
                                                    if (!email) return;

                                                    try {
                                                        console.log(
                                                            "Asignando inspector:",
                                                            email,
                                                            "a orden",
                                                            selectedOrder.inspection_order_id
                                                        );
                                                        const res = await fetch(
                                                            `${API10_URL}/quality/inspection/assign_inspector`,
                                                            {
                                                                method: "POST",
                                                                headers: { "Content-Type": "application/json" },
                                                                body: JSON.stringify({
                                                                    id: selectedOrder.inspection_order_id,
                                                                    assigned_tech_email: email,
                                                                }),
                                                            }
                                                        );

                                                        if (!res.ok) throw new Error("Error assigning");

                                                        setSelectedOrder((prev) =>
                                                            prev ? { ...prev, assigned_tech_email: email } : prev
                                                        );

                                                        alert("Inspector asignado correctamente.");
                                                        await refreshSelectedOrder(selectedOrder.inspection_order_id);
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert("No se pudo asignar, intenta de nuevo.");
                                                    }
                                                }}
                                                className="inspection-detail__assignment-select"
                                                aria-label="Asignar inspector"
                                            >
                                                <option value="">Selecciona un inspector...</option>
                                                {INSPECTORS.map((inspector) => (
                                                    <option key={inspector.email} value={inspector.email}>
                                                        {inspector.name}
                                                    </option>
                                                ))}
                                            </Box>
                                            {selectedOrder.assigned_tech_email && (
                                                <Typography variant="body2">
                                                    Inspector asignado: <b>{selectedOrder.assigned_tech_email}</b>
                                                </Typography>
                                            )}
                                        </>
                                    }
                                </Box>

                                <Box className="inspection-detail__field inspection-detail__field--wide">
                                    <Typography variant="subtitle2">Equipo</Typography>
                                    <Typography variant="body2">{selectedOrder.equipo || "—"}</Typography>
                                </Box>

                                <Box className="inspection-detail__field">
                                    <Typography variant="subtitle2">Número de serie</Typography>
                                    <Typography variant="body2">{selectedOrder.machine_serial || "—"}</Typography>
                                </Box>

                                <Box className="inspection-detail__field">
                                    <Typography variant="subtitle2">Solicitada el</Typography>
                                    <Typography variant="body2">
                                        {new Date(
                                            new Date(selectedOrder.created_at).getTime() + 6 * 60 * 60 * 1000
                                        ).toLocaleString()}
                                    </Typography>
                                </Box>

                                {selectedOrder.model_id != null && (
                                    <Box className="inspection-detail__field">
                                        <Typography variant="subtitle2">Modelo (ID)</Typography>
                                        <Typography variant="body2">{selectedOrder.model_id}</Typography>
                                    </Box>
                                )}
                                {selectedOrder.started_at && (
                                    <Box className="inspection-detail__field">
                                        <Typography variant="subtitle2">Inicio registrado</Typography>
                                        <Typography variant="body2">{selectedOrder.started_at}</Typography>
                                    </Box>
                                )}
                                {selectedOrder.finished_at && (
                                    <Box className="inspection-detail__field">
                                        <Typography variant="subtitle2">Finalización registrada</Typography>
                                        <Typography variant="body2">{selectedOrder.finished_at}</Typography>
                                    </Box>
                                )}
                                {selectedOrder.comments && (
                                    <Box className="inspection-detail__comments-field">
                                        <Typography variant="subtitle2">Comentarios:</Typography>
                                        <Card className="inspection-detail__comments">
                                            <Typography variant="body2">{selectedOrder.comments}</Typography>
                                        </Card>
                                    </Box>
                                )}
                            </Box>
                        </Box>

                        {/* COL DERECHA — TAREAS */}
                        {/* COLUMNA DERECHA: ACTIVIDADES AGRUPADAS */}
                        <Box className="inspection-detail__activities">
                            {/* Header */}
                            <Box className="inspection-detail__activity-header">
                                <Typography variant="h6">Actividades por sección</Typography>
                                <Tooltip title="Ver evidencias de la orden" arrow>
                                    <IconButton
                                        onClick={() => setShowEvidencePanel(!showEvidencePanel)}
                                        className="inspection-detail__evidence-open"
                                        aria-label="Ver evidencias de la orden"
                                    >
                                        <FaEye size={20} color="#B8B0A9" />
                                    </IconButton>
                                </Tooltip>
                            </Box>

                            <Box className="inspection-detail__quality-actions">
                                <Button
                                    variant="contained"
                                    onClick={() => setEditMode(!editMode)}
                                    className="inspection-detail__edit"
                                >
                                    {editMode! ? `Editar información` : `Cancelar edición`}
                                </Button>

                                <Button
                                    variant="contained"
                                    onClick={cancelOrderFunction(selectedOrder.inspection_order_id)}
                                    className="inspection-detail__cancel"
                                >
                                    {`Cancelar la orden #${selectedOrder.inspection_order_id}`}
                                </Button>

                                {(() => {
                                    const tasks = selectedOrder.tasks ?? [];
                                    const pending = tasks.filter((t) => t.status !== "DONE").length;
                                    const closed = ["FINISHED", "CANCELED"].includes(selectedOrder.status);
                                    const blocked = closed || closing !== null || tasks.length === 0 || pending > 0;
                                    return (
                                        <Box className="inspection-detail__closing-actions">
                                            {!closed && pending > 0 && (
                                                <Typography variant="body2">
                                                    Faltan {pending} punto(s) por completar.
                                                </Typography>
                                            )}
                                            <Button
                                                variant="contained"
                                                disabled={blocked || !selectedOrder.work_order_id}
                                                onClick={() => closeInspection(selectedOrder, "release")}
                                                className="inspection-detail__release"
                                            >
                                                {closing === "release" ? "Liberando…" : "1. Liberar sección"}
                                            </Button>
                                            <Button
                                                variant="contained"
                                                disabled={blocked}
                                                onClick={() => closeInspection(selectedOrder, "finish")}
                                                className="inspection-detail__finish"
                                            >
                                                {closing === "finish" ? "Finalizando…" : "2. Finalizar inspección"}
                                            </Button>
                                            {closeFeedback && (
                                                <Typography
                                                    role="status"
                                                    variant="body2"
                                                    className="inspection-detail__feedback"
                                                    data-feedback-ok={closeFeedback.ok}
                                                >
                                                    {closeFeedback.text}
                                                </Typography>
                                            )}
                                        </Box>
                                    );
                                })()}
                            </Box>
                            {/* Panel de evidencias */}
                            {showEvidencePanel && (
                                <Box className="inspection-detail__evidence">
                                    {/* HEADER */}
                                    <Box className="inspection-detail__evidence-header">
                                        <Typography variant="h6">Evidencias de la orden</Typography>
                                        <IconButton
                                            onClick={() => setShowEvidencePanel(false)}
                                            className="inspection-detail__evidence-close"
                                            aria-label="Cerrar evidencias de la orden"
                                        >
                                            <FaEye size={20} color="#B8B0A9" />
                                        </IconButton>
                                    </Box>

                                    {/* SIN EVIDENCIAS */}
                                    {!selectedOrder?.evidencias || selectedOrder.evidencias.length === 0 ? (
                                        <Typography>No hay evidencias registradas.</Typography>
                                    ) : (
                                        <Box>
                                            {IS_TEST && (
                                                <Typography>Evidencias externas deshabilitadas en TEST.</Typography>
                                            )}
                                            {(IS_TEST ? [] : selectedOrder.evidencias).map(
                                                (url: string, i: number) => (
                                                    <Card
                                                        key={i}
                                                        onClick={() => window.open(url, "_blank")}
                                                        className="inspection-detail__evidence-item"
                                                    >
                                                        <img src={url} />
                                                    </Card>
                                                )
                                            )}
                                        </Box>
                                    )}
                                </Box>
                            )}

                            {/* Listado scrollable */}
                            <Box className="inspection-detail__task-scroll">
                                {(() => {
                                    // Agrupar tareas por sección
                                    const grouped: Record<string, any[]> = {};
                                    for (const t of selectedOrder.tasks ?? []) {
                                        const key = t.section_title || "Sin sección";
                                        if (!grouped[key]) grouped[key] = [];
                                        grouped[key]!.push(t);
                                    }

                                    const entries = Object.entries(grouped);

                                    if (entries.length === 0) {
                                        return (
                                            <Box>
                                                <Typography variant="body2">
                                                    No hay actividades disponibles.
                                                </Typography>
                                            </Box>
                                        );
                                    }

                                    return (
                                        <List disablePadding className="inspection-detail__sections">
                                            {entries.map(([section, tasks]) => (
                                                <Box key={section} component="li">
                                                    {/* Nombre del grupo */}
                                                    <ListSubheader
                                                        disableSticky={false}
                                                        className="inspection-detail__section"
                                                    >
                                                        <span>{section}</span>
                                                        <span>
                                                            {tasks.filter((task) => task.status === "DONE").length}/
                                                            {tasks.length} puntos
                                                        </span>
                                                    </ListSubheader>

                                                    {/* Tareas */}
                                                    {tasks!.map((task: any) => {
                                                        const isOpen = openTaskId === task.id;

                                                        return (
                                                            <Box key={task.id}>
                                                                {/* CARD PRINCIPAL */}
                                                                <ListItem
                                                                    disableGutters
                                                                    onClick={() => {
                                                                        if (isOpen) {
                                                                            setOpenTaskId(null);
                                                                        } else {
                                                                            setOpenTaskId(task.id);
                                                                            fetchDeviations(task.id);
                                                                        }
                                                                    }}
                                                                    className="inspection-detail__task"
                                                                    data-task-id={task.id}
                                                                    data-task-status={task.status}
                                                                    data-expanded={isOpen}
                                                                >
                                                                    <Box className="inspection-detail__task-content">
                                                                        {/* Barrita lateral */}
                                                                        <Box className="inspection-detail__task-accent" />

                                                                        {/* Información compacta */}
                                                                        <Box className="inspection-detail__task-copy">
                                                                            <ListItemText
                                                                                primary={task.revision_point}
                                                                                secondary={
                                                                                    <>
                                                                                        <span>
                                                                                            Punto #{task.id}
                                                                                            {task.code
                                                                                                ? ` · ${task.code}`
                                                                                                : ""}{" "}
                                                                                            · {task.status}
                                                                                        </span>
                                                                                        {task.status === "DONE" && (
                                                                                            <span>
                                                                                                Finalizado:{" "}
                                                                                                {task.finished_at
                                                                                                    ?.slice(0, 16)
                                                                                                    .replace(
                                                                                                        "T",
                                                                                                        " "
                                                                                                    ) ||
                                                                                                    "Fecha no registrada"}
                                                                                            </span>
                                                                                        )}
                                                                                    </>
                                                                                }
                                                                                className="inspection-detail__task-text"
                                                                            />
                                                                        </Box>

                                                                        <Chip
                                                                            label={
                                                                                task.status === "DONE"
                                                                                    ? "Completado"
                                                                                    : task.status === "PENDING"
                                                                                    ? "Pendiente"
                                                                                    : task.status === "IN_PROGRESS"
                                                                                    ? "En proceso"
                                                                                    : task.status
                                                                            }
                                                                            size="small"
                                                                            className="inspection-detail__task-state"
                                                                        />
                                                                    </Box>
                                                                </ListItem>

                                                                {/* PANEL EXPANDIDO */}
                                                                {isOpen && (
                                                                    <Box
                                                                        className="inspection-detail__expanded"
                                                                        id={`inspection-point-${task.id}`}
                                                                    >
                                                                        {/* ----- Info del punto ----- */}
                                                                        <Typography variant="subtitle2">
                                                                            Detalles del punto
                                                                        </Typography>

                                                                        <Typography variant="body2">
                                                                            <b>Descripción:</b> {task.revision_point}
                                                                        </Typography>

                                                                        <Typography variant="body2">
                                                                            <b>Categoría:</b> {task.category || "—"}
                                                                        </Typography>

                                                                        {/* ----- Resultado ----- */}
                                                                        <Box>
                                                                            {task.status === "DONE" ? (
                                                                                <Typography
                                                                                    variant="body2"
                                                                                    className="inspection-detail__result"
                                                                                >
                                                                                    Resultado registrado: completado
                                                                                </Typography>
                                                                            ) : (
                                                                                <Button
                                                                                    variant="contained"
                                                                                    size="small"
                                                                                    disabled={
                                                                                        savingTaskId === task.id ||
                                                                                        [
                                                                                            "CANCELED",
                                                                                            "FINISHED",
                                                                                        ].includes(
                                                                                            selectedOrder.status
                                                                                        )
                                                                                    }
                                                                                    onClick={() =>
                                                                                        completeTask(
                                                                                            selectedOrder,
                                                                                            task
                                                                                        )
                                                                                    }
                                                                                    className="inspection-detail__complete"
                                                                                >
                                                                                    {savingTaskId === task.id
                                                                                        ? "Guardando…"
                                                                                        : "Marcar como completado"}
                                                                                </Button>
                                                                            )}
                                                                            {taskFeedback &&
                                                                                taskFeedback.taskId === task.id && (
                                                                                    <Typography
                                                                                        role="status"
                                                                                        variant="body2"
                                                                                        className="inspection-detail__feedback"
                                                                                        data-feedback-ok={
                                                                                            taskFeedback.ok
                                                                                        }
                                                                                    >
                                                                                        {taskFeedback.text}
                                                                                    </Typography>
                                                                                )}
                                                                        </Box>

                                                                        {/* ----- Desviaciones ----- */}
                                                                        <Typography variant="subtitle2">
                                                                            Desviaciones
                                                                        </Typography>

                                                                        {loadingDev ? (
                                                                            <Typography variant="body2">
                                                                                Cargando desviaciones…
                                                                            </Typography>
                                                                        ) : deviations.length === 0 ? (
                                                                            <Typography variant="body2">
                                                                                No hay desviaciones registradas.
                                                                            </Typography>
                                                                        ) : (
                                                                            deviations.map((d, idx) => (
                                                                                <Card
                                                                                    key={idx}
                                                                                    className="inspection-detail__deviation"
                                                                                >
                                                                                    <Typography variant="body2">
                                                                                        <b>Parte afectada:</b>{" "}
                                                                                        {d.parte_afectada}
                                                                                    </Typography>
                                                                                    <Typography variant="body2">
                                                                                        <b>Clasificación:</b>{" "}
                                                                                        {d.clasificacion_defecto}
                                                                                    </Typography>
                                                                                    <Typography variant="body2">
                                                                                        <b>Defecto:</b>{" "}
                                                                                        {d.clasificacion_defectivo}
                                                                                    </Typography>
                                                                                    <Typography variant="body2">
                                                                                        <b>Causa raíz:</b>{" "}
                                                                                        {d.causa_raiz}
                                                                                    </Typography>
                                                                                    <Typography variant="body2">
                                                                                        <b>Comentarios:</b>{" "}
                                                                                        {d.comentarios}
                                                                                    </Typography>

                                                                                    {/* Evidencias */}
                                                                                    {d.evidencias?.length > 0 && (
                                                                                        <>
                                                                                            <Typography variant="body2">
                                                                                                <b>Evidencias:</b>
                                                                                            </Typography>

                                                                                            <Box>
                                                                                                {IS_TEST && (
                                                                                                    <Typography>
                                                                                                        Evidencias
                                                                                                        externas
                                                                                                        deshabilitadas
                                                                                                        en TEST.
                                                                                                    </Typography>
                                                                                                )}
                                                                                                {(IS_TEST
                                                                                                    ? []
                                                                                                    : d.evidencias
                                                                                                ).map(
                                                                                                    (
                                                                                                        img: string,
                                                                                                        i: number
                                                                                                    ) => (
                                                                                                        <img
                                                                                                            key={i}
                                                                                                            src={img}
                                                                                                        />
                                                                                                    )
                                                                                                )}
                                                                                            </Box>
                                                                                        </>
                                                                                    )}
                                                                                </Card>
                                                                            ))
                                                                        )}
                                                                    </Box>
                                                                )}
                                                            </Box>
                                                        );
                                                    })}
                                                </Box>
                                            ))}
                                        </List>
                                    );
                                })()}
                            </Box>
                        </Box>
                    </Box>
                )}
            </Dialog>

        </Box>


    );
};
