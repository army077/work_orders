import { API10_URL } from "../config/api";
import { apiFetch as fetch } from "../services/apiTransport";
import { getProductionTechnicians } from "../services/productionTechnicians";
import { fetchApi } from "../services/apiResponse";
import { canCompleteProductionTask, completeProductionTask, isQualityRelease, productionErrorMessage } from "../services/productionProgress";
import type { ProductionTask } from "../services/productionProgress";
import CloseIcon from "@mui/icons-material/Close";
import React, { useState, useEffect, useRef } from "react";
import { Alert, Menu, MenuItem, Select, Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, List, ListItem, ListItemText, ListSubheader, Chip, Divider, Table, TableContainer, TableHead, TableBody, TableRow, TableCell, InputAdornment, Card, LinearProgress, Button, TextField, Stack, IconButton, useMediaQuery, useTheme } from "@mui/material";
import { useCustom, useList } from "@refinedev/core";

import { FaEye } from 'react-icons/fa6';
import { IoBuildOutline } from 'react-icons/io5';

import Bonds from "./Bonds";

import LocalAtmOutlinedIcon from '@mui/icons-material/LocalAtmOutlined';
import ProductionHistory from "./ProductionHistory";
import ProductionInspectionRequest from "./components/ProductionInspectionRequest";
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import HistoryIcon from '@mui/icons-material/History';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import './production-list.css';
import './production-detail.css';
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



type WorkOrder = {
    id: number;
    template_id: number | null;
    template_version: number | null;
    model_id: number | null;
    machine_serial: string | null;
    customer_name: string | null;
    site_address: string | null;
    assigned_tech_email: string | null;
    status: "OPEN" | "IN_PROGRESS" | "CLOSED" | "FINISHED" | string;
    scheduled_at: string | null;
    created_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    tech_support?: string | null;
    folio_sai?: string | null;
    initial_status?: string | null;
    comments?: string | null;
    tasks?: ProductionTask[];
    customs?: any[];
};


type Model = {
    id: number;
    name: string;
    family_id: number | null;
    family_name?: string | null;
    manufacturer?: string | null;
};

export type Template = {
    id: number;
    name: string;
    template_type: "MANTENIMIENTO" | "INSTALACION" | string;
    model_id: number | null;
    version: number;
    is_published: boolean;
    model_name?: string | null;
};

type WorkOrderWithTasks = WorkOrder;

const STATUS_LABELS: Record<string, string> = {
    OPEN: "Abierta",
    IN_PROGRESS: "En proceso",
    CLOSED: "Cerrada",
    FINISHED: "Finalizada",
};

const fdt = (iso?: string | null) =>
    iso ? new Date(new Date(iso).getTime() + 6 * 60 * 60 * 1000).toLocaleString() : "—";

const statusClass = (st?: string) => {
    const m: Record<string, string> = {
        OPEN: "status-ok",
        IN_PROGRESS: "status-follow_up",
        CLOSED: "status-na",
    };
    return `status-chip ${m[st || ""] || "status-na"}`;
};




export default function PlantelProduccion() {
    const compactDetail = useMediaQuery(useTheme().breakpoints.down("md"));

    const [q, setQ] = React.useState("");

    const [woID, setWoID] = useState<WorkOrderWithTasks | null>(null);
    const selectedOrderId = useRef<number | null>(null);
    const savingProgress = useRef(false);
    const [savingTaskId, setSavingTaskId] = useState<number | null>(null);
    const [completionTask, setCompletionTask] = useState<ProductionTask | null>(null);
    const [minutes, setMinutes] = useState("");
    const [detailError, setDetailError] = useState<string | null>(null);
    const [progressFeedback, setProgressFeedback] = useState<{ severity: "success" | "warning" | "error"; text: string } | null>(null);
    const [open, setOpen] = useState(false);
    const [template, setTemplate] = useState<Template | null>(null);
    const [model, setModel] = useState<Model | null>(null);
    const [techs, setTechs] = useState<Technician[]>([]);
    const [loadingTechs, setLoadingTechs] = useState(false);
    const [techsError, setTechsError] = useState<string | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editForm, setEditForm] = useState({
        template_name: "",
        scheduled_at_local: "",
        assigned_tech_email: "",
        machine_serial: "",
        tech_support: "",
        folio_sai: "",
        comments: "",
        initial_status: "",
    });
    const [customSee, setCustomSee] = useState(false);
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [customs, setCustoms] = useState<any[]>([]);
    const [view, setView] = useState<"plantel" | "historial" | "bonos">("plantel");
    const [filterStatus, setFilterStatus] =
        React.useState<"" | "OPEN" | "IN_PROGRESS" | "CLOSED" | "FINISHED">("OPEN");
    const filterOpen = Boolean(filterAnchorEl);


    const handleOpenDialog = (id: number) => {
        selectedOrderId.current = id;
        setWoID(null);
        setTemplate(null);
        setModel(null);
        setEditMode(false);
        setCompletionTask(null);
        setProgressFeedback(null);
        setDetailError(null);
        void fetchWO(id).catch(error => {
            if (selectedOrderId.current === id) setDetailError(productionErrorMessage(error));
        });
        fetchCustoms(id);
        setOpen(true);


    }
    const handleCloseDialog = () => {
        if (savingProgress.current) return;
        selectedOrderId.current = null;
        setOpen(false);
    };

    const { data, refetch } = useCustom<WorkOrder[]>({
        url: "/work-orders?include=tasks",
        method: "get",
    });

    useEffect(() => {
        let cancel = false;
        (async () => {
            try {
                setLoadingTechs(true);
                setTechsError(null);
                const data = await getProductionTechnicians<Technician>();
                if (!cancel) setTechs(data.filter(t => (t.estatus || "").toLowerCase() === "activo"));
            } catch (e: any) {
                if (!cancel) setTechsError(e?.message || "No se pudieron cargar los técnicos");
            } finally {
                if (!cancel) setLoadingTechs(false);
            }
        })();
        return () => { cancel = true; };
    }, []);



    const { data: templatesData } = useList<Template>({
        resource: "templates",
        pagination: { pageSize: 500 }, // o lo que necesites
    });

    const { data: modelsData } = useList<Model>({
        resource: "machine-models",
        pagination: { pageSize: 500 },
    });
    const items = React.useMemo(() => {
        const arr = (data?.data ?? []).slice().sort((a, b) => {
            return (a.created_at || "").localeCompare(b.created_at || "");
        });

        const needle = q.trim().toLowerCase();

        return arr.filter((w) => {
            const passStatus = filterStatus ? w.status === filterStatus : true;

            const template = w.template_id
                ? (templatesData?.data ?? []).find(t => t.id === w.template_id)
                : null;

            const tecnico = w.assigned_tech_email
                ? techs.find(t => t.correo_tecnico === w.assigned_tech_email)
                : null;

            const passTemplateType =
                template?.template_type === 'ENSAMBLE' &&
                tecnico?.puesto === 'Operador de producción';

            if (!passTemplateType) return false;

            if (!needle) return passStatus;

            const hay = [
                w.customer_name,
                w.machine_serial,
                w.site_address,
                w.assigned_tech_email,
                String(w.id),
            ].filter(Boolean).join(" ").toLowerCase();

            return passStatus && hay.includes(needle);
        });
    }, [data?.data, q, filterStatus, templatesData?.data, techs]);


    const templateMap = React.useMemo(() => {
        const map = new Map<number, Template>();
        (templatesData?.data ?? []).forEach(t => map.set(t.id, t));
        return map;
    }, [templatesData?.data]);

    const modelMap = React.useMemo(() => {
        const map = new Map<number, Model>();
        (modelsData?.data ?? []).forEach(m => map.set(m.id, m));
        return map;
    }, [modelsData?.data]);


    const fetchWO = async (id: number) => {
        const res = await fetchApi(`${API10_URL}/work-orders/${id}?include=tasks`);
        const dataWO: WorkOrderWithTasks = await res.json();
        if (dataWO.id !== id || !Array.isArray(dataWO.tasks)) {
            throw new Error("No se pudo verificar la orden y sus actividades.");
        }
        if (selectedOrderId.current !== id) return;
        setTemplate(dataWO.template_id ? templateMap.get(dataWO.template_id) ?? null : null);
        setModel(dataWO.model_id ? modelMap.get(dataWO.model_id) ?? null : null);
        setWoID(dataWO);
    };

    const saveProductionProgress = async () => {
        if (savingProgress.current || !woID || !template || !completionTask) return;
        savingProgress.current = true;
        setSavingTaskId(completionTask.id);
        setProgressFeedback(null);
        try {
            const task = await completeProductionTask(woID, completionTask.id, template.template_type,
                minutes.trim() === "" ? undefined : Number(minutes));
            // Keep a confirmed DONE locally even if the following refresh fails.
            setWoID(current => current?.id === woID.id
                ? { ...current, tasks: current.tasks?.map(item => item.id === task.id ? task : item) }
                : current);
            setCompletionTask(null);
            const results = await Promise.allSettled([fetchWO(woID.id), (async () => {
                const result = await refetch();
                if (result.isError) throw result.error;
            })()]);
            const refreshFailed = results.some(result => result.status === "rejected");
            setProgressFeedback(refreshFailed
                ? { severity: "warning", text: "Actividad guardada. No se pudieron actualizar todos los datos; vuelve a abrir la orden para consultar el estado actual." }
                : { severity: "success", text: "Actividad completada y datos actualizados." });
        } catch (error) {
            setProgressFeedback({ severity: "error", text: productionErrorMessage(error) });
        } finally {
            savingProgress.current = false;
            setSavingTaskId(null);
        }
    };

    const toLocalDateTimeInput = (iso?: string | null) => {
        if (!iso) return "";
        const d = new Date(iso);
        const pad = (n: number) => `${n}`.padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const fromLocalDateTimeInput = (val: string) => (val ? new Date(val).toISOString() : null);

    const handleErase = async (id: number) => {
        if (!confirm("¿Estás seguro de que deseas eliminar esta orden de trabajo? Esta acción no se puede deshacer.")) {
            return;
        }
        try {
            const res = await fetch(`${API10_URL}/work-orders/delete/${id}`, {
                method: "DELETE",
            });
            if (!res.ok) {
                throw new Error(`Error deleting work order: ${res.statusText}`);
            }
            alert("Orden de trabajo eliminada exitosamente.");
            setOpen(false);
            // Refrescar la lista de órdenes de trabajo
            window.location.reload();
        } catch (error) {
            console.error("Error deleting work order:", error);
            alert("Error deleting work order. Please try again.");
        }
    };

    const fetchCustoms = async (woid: number) => {
        try {
            const res = await fetch(`${API10_URL}/customs/workorder/${woid}`, {
                method: "GET",
            });
            const json = await res.json();

            console.log("Customs recibidas:", json);

            // El endpoint devuelve directamente un array, no un objeto con data
            setCustoms(Array.isArray(json) ? json : []);
        } catch (error) {
            console.error("Error fetching customs:", error);
            setCustoms([]);
            alert("Error fetching customs. Please try again.");
        }
    };


    return (
        <Box className="production-list">
            <Box className="production-heading">
                <Box>
                    <Typography className="production-eyebrow">Operación / Ensamble</Typography>
                    <Typography component="h1" className="production-title">Plantel de Producción</Typography>
                    <Typography className="production-intro">Órdenes, responsables y avance de actividades en un mismo lugar.</Typography>
                </Box>
                <Button className="production-refresh" variant="outlined" startIcon={<RefreshIcon />}
                    aria-label="Actualizar órdenes de producción" onClick={() => void refetch()}>Actualizar</Button>
            </Box>
            <Box className="production-views" role="group" aria-label="Vistas de Producción">
                <Button className="production-view-button" data-production-view="plantel" aria-pressed={view === "plantel"}
                    startIcon={<PrecisionManufacturingOutlinedIcon />} onClick={() => setView("plantel")}>Plantel</Button>
                <Button className="production-view-button" data-production-view="historial" aria-pressed={view === "historial"}
                    startIcon={<HistoryIcon />} onClick={() => setView("historial")}>Historial</Button>
                <Button className="production-view-button" data-production-view="bonos" aria-pressed={view === "bonos"}
                    startIcon={<LocalAtmOutlinedIcon />} onClick={() => setView("bonos")}>Bonos</Button>
            </Box>
            <Box className="production-toolbar">
                <TextField className="production-search" size="small" label="Buscar orden" placeholder="Buscar orden..."
                    value={q} onChange={e => setQ(e.target.value)}
                    helperText="Serie, ID, cliente, sitio o correo del técnico."
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
                <Box className="production-filter">
                    <Button variant="outlined" startIcon={<FilterListIcon />} aria-label="Filtrar por estado operativo"
                        aria-describedby="production-filter-helper"
                        aria-haspopup="menu" aria-expanded={filterOpen}
                        onClick={e => { setFilterAnchorEl(e.currentTarget); }}>
                        {filterStatus ? (STATUS_LABELS[filterStatus] || filterStatus) : "Todas"}
                    </Button>
                    <Typography id="production-filter-helper" component="span" className="production-filter-label">Estado operativo</Typography>
                </Box>
                <Menu anchorEl={filterAnchorEl} open={filterOpen} onClose={() => setFilterAnchorEl(null)}
                    anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                    transformOrigin={{ vertical: "top", horizontal: "left" }}
                    PaperProps={{ sx: { borderRadius: "8px", minWidth: 200, bgcolor: "#2C2926", color: "#F7F3EF", border: "1px solid #5C534C" } }}>
                    {["OPEN", "PENDING", "CLOSED", "FINISHED"].map((status) => (
                        <MenuItem key={status} selected={filterStatus === status}
                            onClick={() => { setFilterStatus(status as any); setFilterAnchorEl(null); }}>
                            {STATUS_LABELS[status] || status}
                        </MenuItem>
                    ))}
                    <MenuItem selected={filterStatus === ""} onClick={() => { setFilterStatus(""); setFilterAnchorEl(null); }}>Todas</MenuItem>
                </Menu>
            </Box>

            {view === "plantel" && (
                <Box>
                    <Box className="production-surface">
                        <TableContainer data-production-scroll tabIndex={0} role="region"
                            aria-label="Órdenes de producción: tabla desplazable" aria-describedby="production-progress-note">
                            <Table className="production-table" size="small" aria-label="Órdenes de producción">
                                <colgroup>
                                    <col style={{ width: "13%" }} /><col style={{ width: "20%" }} /><col style={{ width: "14%" }} />
                                    <col style={{ width: "10%" }} /><col style={{ width: "14%" }} /><col style={{ width: "11%" }} />
                                    <col style={{ width: "10%" }} /><col style={{ width: "8%" }} />
                                </colgroup>
                                <TableHead><TableRow>
                                    {["Orden / Folio SAI", "Equipo / Plantilla", "Técnico asignado", "Estado operativo", "Actividades", "Programación", "Creación", "Detalle"].map(label => <TableCell key={label} scope="col">{label}</TableCell>)}
                                </TableRow></TableHead>
                                <TableBody>
                                    {items.map((wo) => {
                                        const template = wo.template_id ? templateMap.get(wo.template_id) : null;
                                        const tecnico = wo.assigned_tech_email ? techs.find(t => t.correo_tecnico === wo.assigned_tech_email) : null;
                                        const model = wo.model_id ? modelMap.get(wo.model_id) : null;
                                        const avance = wo.tasks?.filter(t => t.status === "DONE").length;
                                        const total = wo.tasks?.length;
                                        const orden = {
                                            ...wo,
                                            avance: total && avance ? Math.round((avance / total) * 100) : 0,
                                        };
                                        return <TableRow key={wo.id} data-production-order={wo.id}>
                                            <TableCell component="th" scope="row">
                                                <span className="production-order-id">#{wo.id}</span>
                                                <span className="production-secondary">{wo.folio_sai || "—"}</span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="production-serial">{wo.machine_serial || "—"}</span>
                                                <span className="production-secondary">{model?.name || "—"}</span>
                                                <span className="production-secondary">{template?.name || "—"}</span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="production-primary">{tecnico?.nombre_tecnico || "—"}</span>
                                                <span className="production-secondary">{wo.assigned_tech_email || "—"}</span>
                                            </TableCell>
                                            <TableCell>
                                                <Chip size="small" className={`production-state ${statusClass(wo.status)}`} data-production-state={wo.status}
                                                    label={STATUS_LABELS[wo.status] || "—"} />
                                            </TableCell>
                                            <TableCell>
                                                <Box className="production-progress-label"><span>{Math.round(Number(orden.avance))} %</span><span>{avance ?? 0} / {total ?? 0}</span></Box>
                                                <LinearProgress variant="determinate" value={orden.avance ? orden.avance : 0}
                                                    aria-label={`Avance de actividades de orden ${wo.id}`}
                                                    sx={{ height: 4, borderRadius: "2px", bgcolor: "#63564C", my: 1,
                                                        "& .MuiLinearProgress-bar": { bgcolor: Number(orden.avance) >= 100 ? "#5BBF8A" : "#E63946" } }} />
                                                <span className="production-secondary">actividades completadas</span>
                                            </TableCell>
                                            <TableCell><span className="production-date">{fdt(wo.scheduled_at)}</span></TableCell>
                                            <TableCell><span className="production-date">{fdt(wo.created_at)}</span></TableCell>
                                            <TableCell><Button className="production-detail-button" variant="outlined" data-open-production={wo.id}
                                                aria-label={`Ver detalle de orden ${wo.id}`} endIcon={<ArrowForwardIcon />}
                                                onClick={() => handleOpenDialog(wo.id)}>Ver</Button></TableCell>
                                        </TableRow>;
                                    })}
                                    {items.length === 0 && <TableRow><TableCell colSpan={8} className="production-empty">No se muestran órdenes con los criterios actuales.</TableCell></TableRow>}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Box className="production-table-footer"><span>{items.length} {items.length === 1 ? "orden" : "órdenes"} · {filterStatus ? (STATUS_LABELS[filterStatus] || filterStatus) : "Todos los estados"}</span><span>Desplaza la tabla para consultar todas las columnas cuando no quepan.</span></Box>
                    </Box>
                    <Typography id="production-progress-note" className="production-progress-note">El avance de actividades y el estado operativo son distintos. Una orden al 100 % puede seguir Abierta (OPEN).</Typography>
                    <Dialog
                        open={open}
                        onClose={handleCloseDialog}
                        fullScreen={compactDetail}
                        aria-labelledby="production-detail-title"
                        maxWidth="lg"
                        fullWidth
                        PaperProps={{ className: "production-detail" }}
                    >
                        <DialogTitle id="production-detail-title" component="div" className="production-detail__header">
                            <Box className="production-detail__identity">
                                <Typography component="span" className="production-detail__eyebrow">Producción · Detalle de orden</Typography>
                                <Box className="production-detail__heading">
                                    <Typography component="h2" variant="h6">{woID ? `Orden de trabajo #${woID.id}` : "Orden de trabajo"}</Typography>
                                    {woID && <Chip size="small" className="production-detail__state" data-order-status={woID.status} label={String(woID.status)} />}
                                </Box>
                                {woID && <Box className="production-detail__references">
                                    <span><span>Folio SAI</span> {woID.folio_sai || "—"}</span>
                                    <span><span>Serie</span> {woID.machine_serial || "—"}</span>
                                    <span><span>Modelo</span> {model?.name || "—"}</span>
                                </Box>}
                            </Box>
                            {woID && (() => {
                                const total = woID.tasks?.length || 0;
                                const done = woID.tasks?.filter(task => task.status === "DONE").length || 0;
                                const avance = total > 0 ? Math.round((done / total) * 100) : 0;
                                return <Box className="production-detail__progress" data-progress-complete={avance >= 100}>
                                    <Typography component="span"><strong>{avance} %</strong> actividades</Typography>
                                    <LinearProgress variant="determinate" value={avance} aria-label="Avance de actividades de la orden" />
                                    <Typography component="span">{done}/{total} completadas · estado independiente</Typography>
                                </Box>;
                            })()}
                            <IconButton aria-label="Cerrar detalle de producción" onClick={handleCloseDialog}
                                className="production-detail__close"><CloseIcon /></IconButton>
                        </DialogTitle>
                        {(woID && template) ? (
                            <Box className="production-detail__body">
                                <Box className="production-detail__information">
                                    <Box className="production-detail__template">
                                        <Typography component="h3">Información de la orden</Typography>
                                        <Typography className="production-detail__eyebrow">Plantilla · Versión {woID.template_version ?? "—"}</Typography>
                                        <Typography className="production-detail__template-name">{template.name}</Typography>
                                    </Box>

                                    {/* Datos generales o formulario de edición */}
                                    {!editMode ? (
                                        <Box className="production-detail__fields">
                                            <Box className="production-detail__field">
                                                <Typography component="span">Modelo</Typography>
                                                <Typography>{model?.name || "—"}</Typography>
                                            </Box>
                                            <Button variant="outlined" size="small" className="production-detail__customs-toggle"
                                                onClick={() => setCustomSee(prev => !prev)}>
                                                <FaEye style={{ marginRight: 4 }} />customs
                                            </Button>
                                            {customSee && (
                                                <Box className="production-detail__customs">
                                                    <Card>
                                                        {(customs ?? []).map((custom: any, idx: number) => (
                                                            <Box key={custom.id || idx}>
                                                                    <Typography variant="subtitle2"><IoBuildOutline /> <b>{custom.custom_title || `Custom ${idx + 1}`}</b></Typography>
                                                            </Box>
                                                        ))}
                                                    </Card>
                                                </Box>
                                            )}
                                            <Box className="production-detail__field">
                                                <Typography component="span">Técnico asignado</Typography>
                                                <Typography>{techs.find(t => t.correo_tecnico === woID.assigned_tech_email)?.nombre_tecnico || "—"}</Typography>
                                                <Typography className="production-detail__email">{woID.assigned_tech_email || "—"}</Typography>
                                            </Box>
                                            {woID.tech_support && (
                                                <Box className="production-detail__field">
                                                    <Typography component="span">Técnico de soporte asignado</Typography>
                                                    <Typography>{woID.tech_support || "—"}</Typography>
                                                </Box>
                                            )}
                                            <Box className="production-detail__field"><Typography component="span">Programada para</Typography><Typography>{fdt(woID.scheduled_at)}</Typography></Box>
                                            <Box className="production-detail__field"><Typography component="span">Creada el</Typography><Typography>{fdt(woID.created_at)}</Typography></Box>
                                            <Box className="production-detail__field"><Typography component="span">Folio SAI</Typography><Typography>{woID.folio_sai || "—"}</Typography></Box>
                                            <Box className="production-detail__field"><Typography component="span">Número de serie</Typography><Typography>{woID.machine_serial || "—"}</Typography></Box>
                                            {woID.comments && (
                                                <Box className="production-detail__field production-detail__comments">
                                                    <Typography component="span">Comentarios</Typography>
                                                    <Card><Typography>{woID.comments}</Typography></Card>
                                                </Box>
                                            )}
                                            <Box className="production-detail__field"><Typography component="span">Estado inicial de la máquina</Typography><Typography>{woID.initial_status || "—"}</Typography></Box>
                                        </Box>
                                    ) : (
                                        <Box component="form" className="production-detail__edit" sx={{ p: { xs: 2, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}
                                            onSubmit={async (e) => {
                                                e.preventDefault();
                                                try {
                                                    const res = await fetch(`${API10_URL}/work-orders/edit_prod/${woID.id}`, {
                                                        method: "PUT",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({
                                                            tech_support: editForm.tech_support,
                                                            scheduled_at: fromLocalDateTimeInput(editForm.scheduled_at_local),
                                                            folio_sai: editForm.folio_sai,
                                                            comments: editForm.comments,
                                                            initial_status: editForm.initial_status,
                                                            machine_serial: editForm.machine_serial,
                                                            assigned_tech_email: editForm.assigned_tech_email,
                                                        }),
                                                    });
                                                    if (!res.ok) throw new Error("Error actualizando la orden");
                                                    alert("Orden actualizada");
                                                    console.log("Nuevos datos:", editForm);
                                                    setEditMode(false);
                                                    await fetchWO(woID.id);
                                                } catch (err) {
                                                    alert("Error actualizando la orden");
                                                }
                                            }}
                                        >
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9' }}><b>Modelo</b></Typography>
                                            <TextField size="small" value={model?.name || ""} disabled fullWidth />
                                            <Divider sx={{ my: 1, borderColor: '#2A2522' }} />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9' }}><b>Técnico asignado</b></Typography>
                                            <Select
                                                size="small"
                                                value={editForm.assigned_tech_email}
                                                onChange={e => setEditForm(f => ({ ...f, assigned_tech_email: e.target.value }))}
                                                fullWidth
                                                disabled={loadingTechs || !!techsError}
                                            >
                                                {techs.map(t => (
                                                    <MenuItem key={t.id} value={t.correo_tecnico}>
                                                        {t.nombre_tecnico} ({t.correo_tecnico})
                                                    </MenuItem>
                                                ))}
                                            </Select>

                                            {woID.tech_support !== undefined && (
                                                <>
                                                    <Typography variant="subtitle2" sx={{ color: '#B8B0A9' }}><b>Técnico de soporte asignado</b></Typography>
                                                    <Select
                                                        size="small"
                                                        value={editForm.tech_support}
                                                        onChange={e => setEditForm(f => ({ ...f, tech_support: e.target.value }))}
                                                        fullWidth
                                                        disabled={loadingTechs || !!techsError}

                                                    >

                                                        {techs.map(t => (
                                                            <MenuItem key={t.id} value={t.correo_tecnico}>
                                                                {t.nombre_tecnico} ({t.correo_tecnico})
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </>
                                            )}
                                            <Divider sx={{ my: 1, borderColor: '#2A2522' }} />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9' }}><b>Programada para:</b></Typography>
                                            <TextField
                                                size="small"
                                                type="datetime-local"
                                                value={editForm.scheduled_at_local}
                                                onChange={e => setEditForm(f => ({ ...f, scheduled_at_local: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9', mt: 1 }}><b>Creada el:</b></Typography>
                                            <TextField size="small" value={fdt(woID.created_at)} disabled fullWidth />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9', mt: 1 }}><b>Folio SAI:</b></Typography>
                                            <TextField
                                                size="small"
                                                value={editForm.folio_sai || ""}
                                                onChange={e => setEditForm(f => ({ ...f, folio_sai: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9', mt: 1 }}><b>Numero de serie:</b></Typography>
                                            <TextField
                                                size="small"
                                                value={editForm.machine_serial || ""}
                                                onChange={e => setEditForm(f => ({ ...f, machine_serial: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9', mt: 1 }}><b>Comentarios:</b></Typography>
                                            <TextField
                                                size="small"
                                                multiline
                                                minRows={2}
                                                value={editForm.comments || ""}
                                                onChange={e => setEditForm(f => ({ ...f, comments: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9', mt: 1 }}><b>Estado inicial de la máquina:</b></Typography>
                                            <Select
                                                size="small"
                                                value={editForm.initial_status || ""}
                                                onChange={e => setEditForm(f => ({ ...f, initial_status: e.target.value }))}
                                                fullWidth
                                            >
                                                <MenuItem value="">— Ninguno —</MenuItem>
                                                <MenuItem value="New Product">Equipo nuevo</MenuItem>
                                                <MenuItem value="Refurbished">Equipo remanufacturado</MenuItem>
                                            </Select>
                                            <Typography variant="subtitle2" sx={{ color: '#B8B0A9', mt: 1 }}><b>Número de serie de la máquina:</b></Typography>
                                            <TextField
                                                size="small"
                                                value={editForm.machine_serial}
                                                onChange={e => setEditForm(f => ({ ...f, machine_serial: e.target.value }))}
                                                fullWidth
                                            />
                                            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                                                <Button type="submit" variant="contained" sx={{ bgcolor: '#E63946', color: '#FFFFFF' }}>Guardar</Button>
                                                <Button variant="outlined" sx={{ color: '#B8B0A9', borderColor: '#3A3633' }} onClick={() => setEditMode(false)}>Cancelar</Button>
                                            </Stack>
                                        </Box>
                                    )}
                                    {!editMode && (
                                        <Box className="production-detail__actions">
                                            <Button variant='contained' disabled={savingTaskId !== null} className="production-detail__delete" onClick={() => handleErase(woID.id)}>
                                                Eliminar orden
                                            </Button>
                                            <Button
                                                variant='outlined'
                                                disabled={savingTaskId !== null}
                                                className="production-detail__edit-toggle"
                                                onClick={() => {
                                                    setEditMode(!editMode);
                                                    setEditForm({
                                                        template_name: template.name,
                                                        scheduled_at_local: toLocalDateTimeInput(woID.scheduled_at),
                                                        assigned_tech_email: woID.assigned_tech_email || "",
                                                        machine_serial: woID.machine_serial || "",
                                                        tech_support: woID.tech_support || "",
                                                        folio_sai: woID.folio_sai || "",
                                                        comments: woID.comments || "",
                                                        initial_status: woID.initial_status || "",
                                                    });
                                                }}
                                            >
                                                {editMode ? "Cancelar edición" : "Editar orden"}
                                            </Button>
                                        </Box>
                                    )}

                                </Box>

                                <Box className="production-detail__activities">
                                    <Box className="production-detail__activity-header">
                                        <Typography component="h3" variant="h6">Actividades por sección</Typography>
                                        {progressFeedback && (
                                            <Alert severity={progressFeedback.severity} sx={{ mt: 2 }}>
                                                {progressFeedback.text}
                                            </Alert>
                                        )}
                                        {template.template_type === "ENSAMBLE" && (
                                            <ProductionInspectionRequest key={woID.id} workOrderId={woID.id} disabled={savingTaskId !== null} />
                                        )}
                                    </Box>
                                    <Box className="production-detail__task-scroll">
                                        {(() => {
                                            const grouped: Record<string, WorkOrderWithTasks["tasks"]> = {};
                                            for (const t of (woID.tasks ?? [])) {
                                                const key = t.section_title || "Sin sección";
                                                if (!grouped[key]) grouped[key] = [];
                                                grouped[key]!.push(t);
                                            }
                                            const entries = Object.entries(grouped);

                                            if (entries.length === 0) {
                                                return (
                                                    <Box sx={{ p: 3 }}>
                                                        <Typography variant="body2" sx={{ color: COLORS.white }}>
                                                            No hay actividades disponibles.
                                                        </Typography>
                                                    </Box>
                                                );
                                            }

                                            return (
                                                <List disablePadding className="production-detail__sections">
                                                    {entries.map(([section, tasks]) => (
                                                        <Box key={section} component="li" className="production-detail__section">
                                                            <ListSubheader component="div" disableSticky={false} className="production-detail__section-title">
                                                                <span>{section}</span>
                                                                <span>{tasks!.filter(task => task.status === "DONE").length}/{tasks!.length} completadas</span>
                                                            </ListSubheader>
                                                            <List disablePadding>
                                                                {tasks!.map(task => (
                                                                    <ListItem key={task.id} disableGutters className="production-detail__task" data-task-status={task.status}>
                                                                        <Box className="production-detail__task-content">
                                                                            <ListItemText primary={task.task_title || "Actividad"}
                                                                                secondary={
                                                                                    `Tarea #${task.id} · ${task.code || "Sin código"} · ` +
                                                                                    (task.status === "DONE"
                                                                                        ? `Finalizado: ${task.finished_at ? new Date(task.finished_at).toLocaleString() : "Sin fecha registrada"}`
                                                                                        : (task.status || "Sin estado"))
                                                                                }
                                                                            />
                                                                            <Box className="production-detail__task-actions">
                                                                                <Chip label={task.status === "DONE" ? "Completado" : (task.status || "Sin estado")}
                                                                                    size="small" className="production-detail__task-state" />
                                                                                {isQualityRelease(task) ? (
                                                                                    <Typography variant="caption" className="production-detail__quality">Liberación por Calidad</Typography>
                                                                                ) : template.template_type === "ENSAMBLE" && canCompleteProductionTask(task) && (
                                                                                    <Button size="small" variant="contained"
                                                                                        disabled={savingTaskId !== null || task.work_order_id !== woID.id}
                                                                                        onClick={() => {
                                                                                            setCompletionTask(task);
                                                                                            setMinutes(task.actual_minutes == null ? "" : String(task.actual_minutes));
                                                                                            setProgressFeedback(null);
                                                                                        }}
                                                                                        className="production-detail__complete">
                                                                                        Marcar como completada
                                                                                    </Button>
                                                                                )}
                                                                            </Box>
                                                                        </Box>
                                                                    </ListItem>
                                                                ))}
                                                            </List>
                                                        </Box>
                                                    ))}
                                                </List>
                                            );
                                        })()}
                                    </Box>
                                </Box>
                            </Box>
                        ) : (
                            <Box sx={{ p: 3 }}>
                                {detailError ? <Alert severity="error">{detailError}</Alert> : (
                                    <Typography variant="body2" sx={{ color: COLORS.white }}>Cargando…</Typography>
                                )}
                            </Box>
                        )}
                    </Dialog>
                    <Dialog open={completionTask !== null} onClose={() => {
                        if (!savingProgress.current) setCompletionTask(null);
                    }} fullWidth maxWidth="sm" PaperProps={{ className: "production-completion" }}>
                        <DialogTitle sx={{ color: '#F5F1ED' }}>Completar actividad productiva</DialogTitle>
                        <DialogContent>
                            <Typography sx={{ mb: 2, color: '#F5F1ED' }}>
                                Orden #{woID?.id} · Tarea #{completionTask?.id}: {completionTask?.task_title}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 2, color: '#B8B0A9' }}>
                                Se registrará la finalización ahora. Si no existe una fecha de inicio, se registrará también ahora.
                            </Typography>
                            <TextField fullWidth label="Minutos reales (opcional)" type="number" value={minutes}
                                disabled={savingTaskId !== null}
                                inputProps={{ min: 0, max: 2147483647, step: 1 }}
                                helperText="Introduce minutos enteros. Si lo dejas vacío, se conserva el valor registrado."
                                onChange={event => setMinutes(event.target.value)} />
                            {progressFeedback?.severity === "error" && (
                                <Alert severity="error" sx={{ mt: 2 }}>{progressFeedback.text}</Alert>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button disabled={savingTaskId !== null} onClick={() => setCompletionTask(null)} sx={{ color: '#B8B0A9' }}>Cancelar</Button>
                            <Button variant="contained" disabled={savingTaskId !== null} onClick={saveProductionProgress} sx={{ bgcolor: '#E63946', color: '#FFFFFF' }}>
                                {savingTaskId !== null ? "Guardando…" : "Confirmar actividad completada"}
                            </Button>
                        </DialogActions>
                    </Dialog>

                </Box>
            )}
            {view === "bonos" && (
                <Box>
                    <Bonds />
                </Box>)}
            {view === "historial" && (
                <Box>
                    <ProductionHistory />
                </Box>)}



        </Box>


    );
}
