import { API10_URL, IS_TEST } from "../config/api";
import { apiFetch as fetch } from "../services/apiTransport";
import { useList } from "@refinedev/core";
import {
    Card,
    Typography,
    Grid,
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
    Menu,
    MenuItem
} from "@mui/material";
import React, { useState } from "react";
import { FaEye } from 'react-icons/fa6';
import { MdFilterList } from "react-icons/md";

type InspectionOrder = {
    id: number;
    inspection_order_id: number;
    inspection_template_id: number;
    model_id: number | null;
    assigned_tech_email: string | null;
    status: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    work_order_id: number | null;
    estacion: number | null;
    comments: string | null;
    evidencias?: string[];
    inspection_type: string | null;

    // work order data
    machine_serial: string | null;
    customer_name: string | null;
    site_address: string | null;
    scheduled_at: string | null;

    // template info
    equipo: string | null;
    titulo: string | null;

    tasks?: {
        id: number;
        status: string;
        revision_point: string;
        section_title: string | null;
    }[];
};

const STATUS_LABELS: Record<string, string> = {
    OPEN: "Abierta",
    IN_PROGRESS: "En proceso",
    PENDING: "Pendiente",
    CLOSED: "Cerrada",
    FINISHED: "Finalizada",
};


const INSPECTORS = [
    { name: "Miguel Casillas", email: "miguel.casillas@asiarobotica.com" },
    { name: "Iván Cobián", email: "ivan.cobian@asiarobotica.com" },
    { name: "Carlos Rodriguez", email: "carlos.rodriguez@asiarobotica.com" },
    { name: "Paulina Correa", email: "paulina.correa@asiarobotica.com" },
    { name: "Carlos Mercado", email: "carlos.mercado@asiarobotica.com" },
];

const COLORS = {
    red: "#8B0000",
    redSoft: "#B22222",
    black: "#121212",
    gray900: "#1f1f1f",
    gray700: "#2a2a2a",
    gray500: "#7a7a7a",
    gray200: "#e6e6e6",
    white: "#ffffff",
};

export const PlantelInspeccion = () => {
    const [search] = React.useState("");
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
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const filterOpen = Boolean(filterAnchorEl);


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
        React.useState<"" | "OPEN" | "IN_PROGRESS" | "CLOSED" | "FINISHED">("");

    const { data, isLoading, refetch } = useList<InspectionOrder>({
        resource: "quality/inspection/orders_all?include=tasks",
    });

    const inspections = data?.data ?? [];

    // 🔎 FILTRO + ORDENAMIENTO
    const filtered = React.useMemo(() => {
        let list = [...inspections];

        if (filterStatus) {
            list = list.filter((i) => i.status === filterStatus);
        }

        if (search.trim()) {
            const needle = search.toLowerCase();
            list = list.filter((i) => {
                const text = [
                    i.customer_name,
                    i.assigned_tech_email,
                    i.machine_serial,
                    i.titulo,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return text.includes(needle);
            });
        }

        // ordenar por fecha
        return list.sort((b, a) =>
            (a.created_at || "").localeCompare(b.created_at || "")
        );
    }, [inspections, search, filterStatus]);

    if (isLoading) {
        return (
            <Typography sx={{ color: COLORS.gray500 }}>
                Cargando inspecciones…
            </Typography>
        );
    }

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
            <Grid item sx={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={o.id}>
                <Card
                    sx={{
                        p: 2,
                        height: '100%',
                        transition: 'box-shadow 0.2s, transform 0.2s',
                        maxWidth: 350,
                        cursor: 'pointer',
                        bgcolor: '#e0e0e0ff',
                        border: '5px double #1e39d1ff',
                        '&:hover': {
                            boxShadow: 6,
                            transform: 'translateY(-4px) scale(1.02)',
                            bgcolor: '#a5a5a5ff',
                        },
                    }}
                    onClick={() => handleOpen(o)}
                >
                    <Typography
                        variant="h6"
                        sx={{ fontWeight: 4000, color: COLORS.black, mb: 1 }}
                    >
                        {o.inspection_type && o.equipo ? (
                            <>
                                {o.inspection_type} para <u>{o.equipo}</u>
                            </>
                        ) : (
                            `Inspección #${o.id}`
                        )}
                        {o.estacion !== null && (
                            <span style={{ color: COLORS.gray700, fontWeight: 400, marginLeft: 8 }}>
                                | Estación: <strong>{o.estacion}</strong>
                            </span>
                        )}
                    </Typography>

                    <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                        Inspector Asignado: <strong>{o.assigned_tech_email ?? "Sin asignar"}</strong>
                    </Typography>
                    <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                        Equipo: <strong>{o.equipo ?? "N/A"}</strong>
                    </Typography>
                    <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                        Solicitada el: <strong>{new Date(new Date(o.created_at).getTime() + 6 * 60 * 60 * 1000).toLocaleString() ?? "N/A"}</strong>
                    </Typography>
                    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", mt: 1 }}>
                        <Chip
                            label={STATUS_LABELS[o.status] || o.status}
                            sx={{
                                backgroundColor:
                                    o.status === "OPEN"
                                        ? "#1e39d1ff"
                                        : o.status === "IN_PROGRESS"
                                            ? "#ff9800"
                                            : o.status === "CLOSED"
                                                ? COLORS.gray700
                                                : o.status === "PENDING"

                                                    ? COLORS.redSoft
                                                    : COLORS.gray700,
                                color: COLORS.white,
                                alignItems: "center",
                                fontWeight: 700,
                                fontSize: 12,
                            }}

                        />

                    </Box>

                    <Box sx={{ mt: 2, position: "relative" }}>
                        <LinearProgress
                            variant="determinate"
                            value={avance}
                            sx={{
                                height: 16,
                                borderRadius: 2,
                                background: COLORS.gray200,
                                "& .MuiLinearProgress-bar": {
                                    background: `linear-gradient(90deg,${COLORS.red} , #00a708ff)`,
                                },
                            }}
                        />
                        <Typography
                            variant="body2"
                            sx={{
                                position: "absolute",
                                top: 2,
                                left: "50%",
                                transform: "translateX(-50%)",
                                fontWeight: 700,
                                color: COLORS.black,
                                lineHeight: "12px",
                            }}
                        >
                            Progreso: {avance}%
                        </Typography>
                    </Box>
                </Card>
            </Grid>
        );
    };

    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                <Typography variant="h4" sx={{ mb: 2, color: COLORS.white }}>
                    Plantel de Inspección
                </Typography>

                <Box sx={{ position: "relative" }}>
                    <IconButton
                        sx={{
                            color: COLORS.white,
                            transition: 'color 0.3s, transform 0.3s',
                            "&:hover": { color: COLORS.red, transform: 'scale(1.5)' },
                        }}
                        onClick={(e) => setFilterAnchorEl(e.currentTarget)}
                    >
                        <MdFilterList />
                    </IconButton>
                </Box>

                <Menu
                    anchorEl={filterAnchorEl}
                    open={filterOpen}
                    onClose={() => setFilterAnchorEl(null)}
                    anchorOrigin={{
                        vertical: "bottom",
                        horizontal: "right",
                    }}
                    transformOrigin={{
                        vertical: "top",
                        horizontal: "right",
                    }}
                    PaperProps={{
                        sx: {
                            borderRadius: 2,
                            minWidth: 200,
                            boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
                        },
                    }}
                >
                    <MenuItem
                        selected={filterStatus === ""}
                        onClick={() => {
                            setFilterStatus("");
                            setFilterAnchorEl(null);
                        }}
                    >
                        Todas
                    </MenuItem>

                    {["OPEN", "PENDING", "CLOSED", "FINISHED"].map((status) => (
                        <MenuItem
                            key={status}
                            selected={filterStatus === status}
                            onClick={() => {
                                setFilterStatus(status as any);
                                setFilterAnchorEl(null);
                            }}
                        >
                            {STATUS_LABELS[status]}
                        </MenuItem>
                    ))}
                </Menu>

                {filterStatus && (
                    <Chip
                        size="small"
                        label={`Estado: ${STATUS_LABELS[filterStatus]}`}
                        sx={{
                            bgcolor: COLORS.gray200,
                            fontWeight: 600,
                        }}
                    />
                )}
            </Box>
            <Grid container spacing={2}>
                {filtered.map(renderCard)}
            </Grid>
            <Dialog
                open={open}
                onClose={handleClose}
                maxWidth="lg"
                fullWidth
                PaperProps={{
                    sx: {
                        borderRadius: 3,
                        overflow: "hidden",
                        bgcolor: COLORS.white,
                        border: `2px solid ${COLORS.gray200}`,
                    },
                }}
            >
                {!selectedOrder ? (
                    <Box sx={{ p: 4 }}>
                        <Typography>Cargando…</Typography>
                    </Box>
                ) : (
                    <Box sx={{ display: "flex", height: 650, minWidth: 900 }}>

                        {/* COL IZQUIERDA — INFO GENERAL */}
                        <Box
                            sx={{
                                width: 300,
                                display: "flex",
                                flexDirection: "column",
                                borderRight: `1px solid ${COLORS.gray200}`,
                                bgcolor: "#f7f7f7",
                            }}
                        >
                            {/* HEADER */}
                            <Box
                                sx={{
                                    p: 3,
                                    background: `linear-gradient(135deg, ${COLORS.gray200}, #1e39d1ff)`,
                                    color: COLORS.gray900,
                                }}
                            >
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                    {selectedOrder.titulo || `Inspección #${selectedOrder.id}`}
                                </Typography>
                                <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
                                    Estación: <b>{selectedOrder.estacion ?? "N/A"}</b>
                                </Typography>

                                <Box sx={{ mt: 1, display: "flex", gap: 1 }}>
                                    <Chip
                                        label={selectedOrder.status}
                                        sx={{
                                            bgcolor: COLORS.gray200,
                                            color: "#1e39d1ff",
                                            fontWeight: 700,

                                        }}
                                    />
                                </Box>
                            </Box>

                            {/* DETALLES */}
                            <Box sx={{ p: 3, overflowY: "auto", flex: 1 }}>

                                <Box sx={{ mt: 2 }}>

                                    {(
                                        <>
                                            <Typography
                                                variant="subtitle2"
                                                sx={{ color: COLORS.red, fontWeight: 700, mb: 1 }}
                                            >
                                                Asignar inspector
                                            </Typography>

                                            <Box
                                                component="select"
                                                value={INSPECTORS.find((inspector) => inspector.email === selectedOrder.assigned_tech_email)?.email ?? ""}
                                                onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                                                    const email = e.target.value;
                                                    if (!email) return;

                                                    try {
                                                        console.log("Asignando inspector:", email, "a orden", selectedOrder.id);
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
                                                style={{
                                                    width: "100%",
                                                    padding: "10px",
                                                    borderRadius: "8px",
                                                    border: `1px solid ${COLORS.gray200}`,
                                                    backgroundColor: COLORS.gray200,
                                                    color: COLORS.black,
                                                    fontSize: "14px",
                                                    fontWeight: 600,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <option value="">Selecciona un inspector...</option>
                                                {INSPECTORS.map((inspector) => (
                                                    <option key={inspector.email} value={inspector.email}>
                                                        {inspector.name}
                                                    </option>
                                                ))}
                                            </Box>
                                            {selectedOrder.assigned_tech_email && (
                                                <Typography variant="body2" sx={{ mt: 1, color: COLORS.black }}>
                                                    Inspector asignado: <b>{selectedOrder.assigned_tech_email}</b>
                                                </Typography>
                                            )}
                                        </>
                                    )}
                                </Box>

                                <Typography variant="subtitle2">Equipo</Typography>
                                <Typography variant="body2" sx={{ mb: 2 }}>
                                    {selectedOrder.equipo || "—"}
                                </Typography>

                                <Typography variant="subtitle2">Número de serie</Typography>
                                <Typography variant="body2" sx={{ mb: 2 }}>
                                    {selectedOrder.machine_serial || "—"}
                                </Typography>

                                <Typography variant="subtitle2">Solicitada el</Typography>
                                <Typography variant="body2" sx={{ mb: 2 }}>
                                    {new Date(new Date(selectedOrder.created_at).getTime() + 6 * 60 * 60 * 1000).toLocaleString()}
                                </Typography>

                                {selectedOrder.comments && (
                                    <>
                                        <Typography variant="subtitle2">Comentarios:</Typography>
                                        <Card sx={{ p: 1, bgcolor: COLORS.gray200, mb: 2 }}>
                                            <Typography variant="body2">
                                                {selectedOrder.comments}
                                            </Typography>
                                        </Card>
                                    </>
                                )}
                                <Box sx={{ mt: 4, justifyContent: 'center', alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
                                    <Button variant='contained'
                                        onClick={() => setEditMode(!editMode)}
                                        sx={{ backgroundColor: editMode! ? ("#1e39d1ff") : (COLORS.gray500), color: COLORS.white, alignItems: 'center' }}
                                    >
                                        {editMode! ? (`Editar información`) : (`Cancelar edición`)}
                                    </Button>

                                    <Button variant='contained' sx={{ backgroundColor: COLORS.redSoft, color: COLORS.white, alignItems: 'center', mt: 2 }} onClick={cancelOrderFunction(selectedOrder.inspection_order_id)}>
                                        {`Cancelar la orden #${selectedOrder.inspection_order_id}`}
                                    </Button>

                                    {(() => {
                                        const tasks = selectedOrder.tasks ?? [];
                                        const pending = tasks.filter((t) => t.status !== "DONE").length;
                                        const closed = ["FINISHED", "CANCELED"].includes(selectedOrder.status);
                                        const blocked = closed || closing !== null || tasks.length === 0 || pending > 0;
                                        return (
                                            <Box sx={{ mt: 2, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                                {!closed && pending > 0 && (
                                                    <Typography variant="body2" sx={{ color: COLORS.gray500 }}>
                                                        Faltan {pending} punto(s) por completar.
                                                    </Typography>
                                                )}
                                                <Button variant="contained" disabled={blocked || !selectedOrder.work_order_id}
                                                    onClick={() => closeInspection(selectedOrder, "release")}>
                                                    {closing === "release" ? "Liberando…" : "1. Liberar sección"}
                                                </Button>
                                                <Button variant="contained" disabled={blocked}
                                                    onClick={() => closeInspection(selectedOrder, "finish")}>
                                                    {closing === "finish" ? "Finalizando…" : "2. Finalizar inspección"}
                                                </Button>
                                                {closeFeedback && (
                                                    <Typography role="status" variant="body2"
                                                        sx={{ color: closeFeedback.ok ? "#028f02ff" : COLORS.red, textAlign: "center" }}>
                                                        {closeFeedback.text}
                                                    </Typography>
                                                )}
                                            </Box>
                                        );
                                    })()}

                                </Box>
                            </Box>

                        </Box>

                        {/* COL DERECHA — TAREAS */}
                        {/* COLUMNA DERECHA: ACTIVIDADES AGRUPADAS */}
                        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", bgcolor: COLORS.white }}>

                            {/* Header */}
                            <Box
                                sx={{
                                    p: 3,
                                    borderBottom: `1px solid ${COLORS.gray200}`,
                                    bgcolor: COLORS.white,
                                    textAlign: "center",

                                }}
                            >
                                <Typography variant="h6" sx={{ fontWeight: 700, color: COLORS.black }}>
                                    Actividades por sección
                                </Typography>
                                <Tooltip title="Ver evidencias de la orden" arrow>
                                    <IconButton sx={{ position: "absolute", top: 16, right: 16 }} onClick={() => setShowEvidencePanel(!showEvidencePanel)}>
                                        <FaEye size={20} color={COLORS.gray500} />
                                    </IconButton>
                                </Tooltip>
                            </Box>

                            {/* Panel de evidencias */}
                            {showEvidencePanel && (
                                <Box
                                    sx={{
                                        position: "absolute",
                                        top: 0,
                                        right: 0,
                                        width: "60%",
                                        height: "100%",
                                        bgcolor: COLORS.white,
                                        boxShadow: "-4px 0 12px rgba(0,0,0,0.15)",
                                        zIndex: 50,
                                        p: 3,
                                        overflowY: "auto",
                                        animation: "slideIn 0.25s ease",
                                    }}
                                >
                                    {/* HEADER */}
                                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                            Evidencias de la orden
                                        </Typography>
                                        <IconButton onClick={() => setShowEvidencePanel(false)}>
                                            <FaEye size={20} color={COLORS.gray500} />
                                        </IconButton>
                                    </Box>

                                    {/* SIN EVIDENCIAS */}
                                    {!selectedOrder?.evidencias || selectedOrder.evidencias.length === 0 ? (
                                        <Typography sx={{ color: COLORS.gray500, textAlign: "center", mt: 4 }}>
                                            No hay evidencias registradas.
                                        </Typography>
                                    ) : (
                                        <Box
                                            sx={{
                                                display: "grid",
                                                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                                                gap: 2,
                                            }}
                                        >
                                            {IS_TEST && <Typography>Evidencias externas deshabilitadas en TEST.</Typography>}
                                            {(IS_TEST ? [] : selectedOrder.evidencias).map((url: string, i: number) => (
                                                <Card
                                                    key={i}
                                                    sx={{
                                                        cursor: "pointer",
                                                        borderRadius: 2,
                                                        overflow: "hidden",
                                                        boxShadow: "0 3px 10px rgba(0,0,0,0.12)",
                                                        transition: "0.2s",
                                                        "&:hover": { transform: "scale(1.03)" },
                                                    }}
                                                    onClick={() => window.open(url, "_blank")}
                                                >
                                                    <img
                                                        src={url}
                                                        style={{
                                                            width: "100%",
                                                            height: 140,
                                                            objectFit: "cover",
                                                        }}
                                                    />
                                                </Card>
                                            ))}
                                        </Box>
                                    )}
                                </Box>
                            )}


                            {/* Listado scrollable */}
                            <Box sx={{ flex: 1, overflow: "auto" }}>
                                {(() => {
                                    // Agrupar tareas por sección
                                    const grouped: Record<string, any[]> = {};
                                    for (const t of (selectedOrder.tasks ?? [])) {
                                        const key = t.section_title || "Sin sección";
                                        if (!grouped[key]) grouped[key] = [];
                                        grouped[key]!.push(t);
                                    }

                                    const entries = Object.entries(grouped);

                                    if (entries.length === 0) {
                                        return (
                                            <Box sx={{ p: 3 }}>
                                                <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                    No hay actividades disponibles.
                                                </Typography>
                                            </Box>
                                        );
                                    }

                                    return (
                                        <List disablePadding sx={{ width: "100%", bgcolor: COLORS.white }}>
                                            {entries.map(([section, tasks]) => (
                                                <Box key={section} component="li">

                                                    {/* Nombre del grupo */}
                                                    <ListSubheader
                                                        disableSticky={false}
                                                        sx={{
                                                            position: "sticky",
                                                            top: 0,
                                                            zIndex: 2,
                                                            bgcolor: COLORS.white,
                                                            borderBottom: `1px solid ${COLORS.gray200}`,
                                                            px: 3,
                                                            py: 1.5,
                                                            fontSize: 14,
                                                            fontWeight: 700,
                                                            color: COLORS.black,
                                                        }}
                                                    >
                                                        {section}
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
                                                                    sx={{
                                                                        px: 3,
                                                                        py: 1.5,
                                                                        cursor: "pointer",
                                                                        "&:hover": { bgcolor: "#f5f5f5" }
                                                                    }}
                                                                >
                                                                    <Box
                                                                        sx={{
                                                                            width: "100%",
                                                                            p: 1.5,
                                                                            borderRadius: 2,
                                                                            border: `1px solid ${COLORS.gray200}`,
                                                                            bgcolor: COLORS.white,
                                                                            boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                                                                            display: "flex",
                                                                            alignItems: "center",
                                                                            gap: 2,
                                                                        }}
                                                                    >
                                                                        {/* Barrita lateral */}
                                                                        <Box
                                                                            sx={{
                                                                                width: 6,
                                                                                alignSelf: "stretch",
                                                                                borderRadius: "8px",
                                                                                bgcolor:
                                                                                    task.status === "DONE"
                                                                                        ? "#1e39d1ff"
                                                                                        : COLORS.gray200,
                                                                            }}
                                                                        />

                                                                        {/* Información compacta */}
                                                                        <Box sx={{ flex: 1 }}>
                                                                            <ListItemText
                                                                                primaryTypographyProps={{
                                                                                    sx: {
                                                                                        fontWeight: 600,
                                                                                        color: COLORS.black,
                                                                                        whiteSpace: "nowrap",
                                                                                        textOverflow: "ellipsis",
                                                                                        overflow: "hidden"
                                                                                    },
                                                                                }}
                                                                                secondaryTypographyProps={{
                                                                                    sx: { color: COLORS.gray500, mt: 0.5 },
                                                                                }}
                                                                                primary={task.revision_point}
                                                                                secondary={
                                                                                    task.status === "DONE"
                                                                                        ? `Finalizado: ${task.finished_at?.slice(0, 16).replace("T", " ")}`
                                                                                        : "En proceso"
                                                                                }
                                                                            />
                                                                        </Box>

                                                                        <Chip
                                                                            label={task.status === "DONE" ? "Completado" : "En progreso"}
                                                                            size="small"
                                                                            sx={{
                                                                                bgcolor: task.status === "DONE" ? "#028f02ff" : COLORS.gray200,
                                                                                color: task.status === "DONE" ? COLORS.white : COLORS.black,
                                                                                fontWeight: 600,
                                                                            }}
                                                                        />
                                                                    </Box>
                                                                </ListItem>

                                                                {/* PANEL EXPANDIDO */}
                                                                {isOpen && (
                                                                    <Box
                                                                        sx={{
                                                                            px: 4,
                                                                            py: 2,
                                                                            bgcolor: "#fafafa",
                                                                            borderBottom: `1px solid ${COLORS.gray200}`
                                                                        }}
                                                                    >
                                                                        {/* ----- Info del punto ----- */}
                                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                                                                            Detalles del punto
                                                                        </Typography>

                                                                        <Typography variant="body2" sx={{ mb: 1 }}>
                                                                            <b>Descripción:</b> {task.revision_point}
                                                                        </Typography>

                                                                        <Typography variant="body2" sx={{ mb: 2 }}>
                                                                            <b>Categoría:</b> {task.category || "—"}
                                                                        </Typography>

                                                                        {/* ----- Resultado ----- */}
                                                                        <Box sx={{ mb: 2 }}>
                                                                            {task.status === "DONE" ? (
                                                                                <Typography variant="body2" sx={{ color: "#028f02ff", fontWeight: 600 }}>
                                                                                    Resultado registrado: completado
                                                                                </Typography>
                                                                            ) : (
                                                                                <Button
                                                                                    variant="contained"
                                                                                    size="small"
                                                                                    disabled={savingTaskId === task.id || ["CANCELED", "FINISHED"].includes(selectedOrder.status)}
                                                                                    onClick={() => completeTask(selectedOrder, task)}
                                                                                >
                                                                                    {savingTaskId === task.id ? "Guardando…" : "Marcar como completado"}
                                                                                </Button>
                                                                            )}
                                                                            {taskFeedback && taskFeedback.taskId === task.id && (
                                                                                <Typography
                                                                                    role="status"
                                                                                    variant="body2"
                                                                                    sx={{ mt: 1, color: taskFeedback.ok ? "#028f02ff" : COLORS.red }}
                                                                                >
                                                                                    {taskFeedback.text}
                                                                                </Typography>
                                                                            )}
                                                                        </Box>

                                                                        {/* ----- Desviaciones ----- */}
                                                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                                                                            Desviaciones
                                                                        </Typography>

                                                                        {loadingDev ? (
                                                                            <Typography variant="body2">Cargando desviaciones…</Typography>
                                                                        ) : deviations.length === 0 ? (
                                                                            <Typography variant="body2" sx={{ color: COLORS.gray500 }}>
                                                                                No hay desviaciones registradas.
                                                                            </Typography>
                                                                        ) : (
                                                                            deviations.map((d, idx) => (
                                                                                <Card
                                                                                    key={idx}
                                                                                    sx={{
                                                                                        p: 2,
                                                                                        mb: 2,
                                                                                        borderLeft: `4px solid ${COLORS.red}`
                                                                                    }}
                                                                                >
                                                                                    <Typography variant="body2" sx={{ mb: 1 }}>
                                                                                        <b>Parte afectada:</b> {d.parte_afectada}
                                                                                    </Typography>
                                                                                    <Typography variant="body2" sx={{ mb: 1 }}>
                                                                                        <b>Clasificación:</b> {d.clasificacion_defecto}
                                                                                    </Typography>
                                                                                    <Typography variant="body2" sx={{ mb: 1 }}>
                                                                                        <b>Defecto:</b> {d.clasificacion_defectivo}
                                                                                    </Typography>
                                                                                    <Typography variant="body2" sx={{ mb: 1 }}>
                                                                                        <b>Causa raíz:</b> {d.causa_raiz}
                                                                                    </Typography>
                                                                                    <Typography variant="body2" sx={{ mb: 1 }}>
                                                                                        <b>Comentarios:</b> {d.comentarios}
                                                                                    </Typography>

                                                                                    {/* Evidencias */}
                                                                                    {d.evidencias?.length > 0 && (
                                                                                        <>
                                                                                            <Typography variant="body2" sx={{ mt: 1, mb: 1 }}>
                                                                                                <b>Evidencias:</b>
                                                                                            </Typography>

                                                                                            <Box
                                                                                                sx={{
                                                                                                    display: "flex",
                                                                                                    gap: 2,
                                                                                                    flexWrap: "wrap"
                                                                                                }}
                                                                                            >
                                                                                                {IS_TEST && <Typography>Evidencias externas deshabilitadas en TEST.</Typography>}
                                                                                                {(IS_TEST ? [] : d.evidencias).map((img: string, i: number) => (
                                                                                                    <img
                                                                                                        key={i}
                                                                                                        src={img}
                                                                                                        style={{
                                                                                                            width: 120,
                                                                                                            height: 120,
                                                                                                            objectFit: "cover",
                                                                                                            borderRadius: 6,
                                                                                                            border: `1px solid ${COLORS.gray200}`
                                                                                                        }}
                                                                                                    />
                                                                                                ))}
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
