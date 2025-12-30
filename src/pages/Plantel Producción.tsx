import React, { useState, useEffect } from "react";
import { Menu, MenuItem, Select, Dialog, Box, Typography, List, Tab, ListItem, ListItemText, ListSubheader, Chip, Divider, Grid, Card, LinearProgress, Button, TextField, Stack, IconButton } from "@mui/material";
import { useCustom, useList } from "@refinedev/core";
import { MdFilterList } from 'react-icons/md';
import { FaEye } from 'react-icons/fa6';
import { IoBuildOutline } from 'react-icons/io5';
import { BsClockHistory } from 'react-icons/bs';
import Bonds from "./Bonds";
import { MdOutlineDashboardCustomize } from 'react-icons/md';
import LocalAtmOutlinedIcon from '@mui/icons-material/LocalAtmOutlined';
import ProductionHistory from "./ProductionHistory";
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
    tasks?: any[]; // o tu tipo correcto de tarea si lo tienes
    customs?: any[];
};


type Family = { id: number; name: string };
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

type WorkOrderWithTasks = WorkOrder & {
    tasks?: any[]; // o tu tipo correcto de tarea si lo tienes
};

const STATUS_LABELS: Record<string, string> = {
    OPEN: "Abierta",
    IN_PROGRESS: "En proceso",
    CLOSED: "Cerrada",
    FINISHED: "Finalizada",
};

const fdt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString() : "—";

const statusClass = (st?: string) => {
    const m: Record<string, string> = {
        OPEN: "status-ok",
        IN_PROGRESS: "status-follow_up",
        CLOSED: "status-na",
    };
    return `status-chip ${m[st || ""] || "status-na"}`;
};




export default function PlantelProduccion() {

    const [q, setQ] = React.useState("");

    const [woID, setWoID] = useState<WorkOrderWithTasks | null>(null);
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
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [customs, setCustoms] = useState<any[]>([]);
    const [view, setView] = useState<"plantel" | "historial" | "bonos">("plantel");
    const [filterStatus, setFilterStatus] =
        React.useState<"" | "OPEN" | "IN_PROGRESS" | "CLOSED" | "FINISHED">("OPEN");
    const filterOpen = Boolean(filterAnchorEl);


    const handleOpenDialog = (id: number) => {
        fetchWO(id);
        fetchCustoms(id);
        setOpen(true);


    }
    const handleCloseDialog = () => setOpen(false);

    const { data, isLoading } = useCustom<WorkOrder[]>({
        url: "/work-orders?include=tasks",
        method: "get",
    });

    useEffect(() => {
        let cancel = false;
        (async () => {
            try {
                setLoadingTechs(true);
                setTechsError(null);
                const res = await fetch("https://desarrollotecnologicoar.com/api5/tecnicos");
                const data: Technician[] = await res.json();
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
        try {
            const res = await fetch(`https://desarrollotecnologicoar.com/api10/work-orders/${id}?include=tasks`);
            const dataWO = await res.json();

            const template = dataWO.template_id ? templateMap.get(dataWO.template_id) ?? null : null;
            const model = dataWO.model_id ? modelMap.get(dataWO.model_id) ?? null : null;


            setTemplate(template);
            setModel(model);

            setWoID(dataWO);
        } catch (error) {
            console.error("Error fetching work order:", error);
            alert("Error fetching work order details.");
        }
    }

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
            const res = await fetch(`https://desarrollotecnologicoar.com/api10/work-orders/delete/${id}`, {
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
            const res = await fetch(`https://desarrollotecnologicoar.com/api10/customs/workorder/${woid}`, {
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
        <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                <Typography variant="h4" gutterBottom sx={{ flexShrink: 0 }}>
                    Plantel de Producción
                </Typography>
                <Box sx={{ position: "relative" }}>
                    {/* Botón filtro (igual que antes) */}
                    <IconButton
                        sx={{
                            color: COLORS.white,
                            transition: 'color 0.3s, transform 0.3s',
                            "&:hover": { color: COLORS.red, transform: 'scale(1.5)' },
                        }}
                        onClick={e => {
                            setFilterAnchorEl(e.currentTarget);
                            setFilterMenuOpen(true);
                        }}
                    >
                        <MdFilterList />
                    </IconButton>

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

                        <MenuItem
                            selected={filterStatus === ""}
                            onClick={() => {
                                setFilterStatus("");
                                setFilterAnchorEl(null);
                            }}
                        >
                            Todas
                        </MenuItem>
                    </Menu>


                    {/* DASHBOARD → PLANTEL */}
                    <IconButton
                        sx={{
                            color: COLORS.white,
                            transition: 'color 0.3s, transform 0.3s',
                            "&:hover": { color: COLORS.red, transform: 'scale(1.5)' },
                        }}
                        onClick={() => setView("plantel")}
                    >
                        <MdOutlineDashboardCustomize />
                    </IconButton>

                    {/* HISTORIAL → WorkOrdersHistory */}
                    <IconButton
                        sx={{
                            color: COLORS.white,
                            transition: 'color 0.3s, transform 0.3s',
                            "&:hover": { color: COLORS.red, transform: 'scale(1.5)' },
                        }}
                        onClick={() => setView("historial")}
                    >
                        <BsClockHistory />
                    </IconButton>

                    {/* BONOS → Bonds */}
                    <IconButton
                        sx={{
                            color: COLORS.white,
                            transition: 'color 0.3s, transform 0.3s',
                            "&:hover": { color: COLORS.red, transform: 'scale(1.5)' },
                        }}
                        onClick={() => setView("bonos")}
                    >
                        <LocalAtmOutlinedIcon />
                    </IconButton>
                </Box>

                <TextField
                    size="small"
                    placeholder="Buscar orden..."
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    sx={{ minWidth: 220, bgcolor: COLORS.gray200, borderRadius: 1 }}
                />
            </Box>

            {view === "plantel" && (
                <Box>
                    <Grid container spacing={2}>
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

                            return (
                                <Grid item sx={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={wo.id}>
                                    <Card
                                        sx={{
                                            p: 2,
                                            height: '100%',
                                            transition: 'box-shadow 0.2s, transform 0.2s',
                                            maxWidth: 350,
                                            cursor: 'pointer',
                                            bgcolor: '#e0e0e0ff',
                                            border: '5px double #d11e1e',
                                            '&:hover': {
                                                boxShadow: 6,
                                                transform: 'translateY(-4px) scale(1.02)',
                                                bgcolor: '#a5a5a5ff',
                                            },
                                        }}
                                        onClick={() => handleOpenDialog(wo.id)}
                                    >
                                        <Typography variant="h6" gutterBottom>
                                            {template?.name}
                                        </Typography>
                                        <Typography variant="body2"><strong>Técnico Asignado:</strong> {tecnico?.nombre_tecnico || "—"}</Typography>
                                        <Typography variant="body2"><strong>Modelo:</strong> {model?.name || "—"}</Typography>
                                        <Typography variant="body2"><strong>Estado de la orden:</strong> <span className={statusClass(wo.status)}>{STATUS_LABELS[wo.status] || "—"}</span></Typography>
                                        <Typography variant="body2"><strong>Fecha de programación:</strong> {fdt(wo.scheduled_at)}</Typography>
                                        <Typography variant="body2"><strong>Creada el:</strong> {fdt(wo.created_at)}</Typography>
                                        <Box sx={{ position: "relative", width: "100%", mt: 1 }}>
                                            <LinearProgress
                                                variant="determinate"
                                                value={orden.avance ? orden.avance : 0}
                                                sx={{
                                                    height: 20,
                                                    borderRadius: 10,
                                                    backgroundColor: COLORS.gray200,
                                                    "& .MuiLinearProgress-bar": {
                                                        backgroundColor: COLORS.red, // rojo oscuro
                                                        borderRadius: 10,
                                                    },
                                                }}
                                            />
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: "50%",
                                                    transform: "translateX(-50%)",
                                                    lineHeight: "20px",
                                                    fontWeight: 600,
                                                    color: COLORS.gray900,

                                                }}
                                            >
                                                Progreso {`${Math.round(Number(orden.avance))}%`}
                                            </Typography>
                                        </Box>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>
                    <Dialog
                        open={open}
                        onClose={handleCloseDialog}
                        maxWidth="lg"
                        fullWidth
                        PaperProps={{
                            sx: {
                                overflow: "hidden",
                                borderRadius: 3,
                                border: `1px solid ${COLORS.gray200}`,
                                boxShadow: `0 10px 30px rgba(0,0,0,0.25)`,
                                bgcolor: COLORS.white,
                            },
                        }}
                    >
                        {(woID && template) ? (
                            <Box sx={{ display: "flex", minWidth: 720, height: 640 }}>
                                {/* Columna izquierda: encabezado + info general */}
                                <Box
                                    sx={{
                                        width: 280,
                                        borderRight: `1px solid ${COLORS.gray200}`,
                                        display: "flex",
                                        flexDirection: "column",
                                        bgcolor: "#fafafa",
                                    }}
                                >
                                    {/* Header con gradiente */}
                                    <Box
                                        sx={{
                                            p: 3,
                                            bgcolor: `linear-gradient(135deg, ${COLORS.red} 0%, ${COLORS.redSoft} 80%)`,
                                            color: COLORS.white,
                                        }}
                                    >
                                        <Typography variant="overline" sx={{ opacity: 0.8, color: COLORS.gray900 }}>
                                            Orden de trabajo
                                        </Typography>
                                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1, color: COLORS.red }}>
                                            {template.name}
                                        </Typography>
                                        <Box sx={{ mt: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
                                            <Chip size="small" label={`#${woID.id}`} sx={{ bgcolor: "rgba(255,255,255,0.15)", color: COLORS.black }} />
                                            <Chip
                                                size="small"
                                                label={String(woID.status)}
                                                sx={{
                                                    bgcolor: "rgba(255,255,255,0.15)",
                                                    color: COLORS.black,
                                                    textTransform: "capitalize",
                                                }}
                                            />
                                        </Box>
                                    </Box>

                                    {/* Datos generales o formulario de edición */}
                                    {!editMode ? (
                                        <Box sx={{ p: 3, display: "Grid", rowGap: 1.25, overflowY: "scroll", overflowX: "hidden", flex: 1 }}>
                                            <Box sx={{ display: 'flex' }}>
                                                <Box sx={{ mr: 4 }}>
                                                    <Typography variant="h6" sx={{ color: COLORS.black }}>
                                                        <b>Modelo:</b>
                                                    </Typography>

                                                    <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                        {model?.name || "—"}
                                                    </Typography>
                                                </Box>
                                                <Button variant='contained'
                                                    size='small'
                                                    onClick={() => setCustomSee(prev => !prev)}
                                                    sx={{ bgcolor: COLORS.gray200, color: COLORS.gray500 }}>
                                                    <FaEye style={{ marginRight: 2 }}></FaEye>
                                                    customs

                                                </Button>

                                            </Box>

                                            <Divider sx={{ my: 1.5 }} />

                                            {customSee && (
                                                <Box>
                                                    <Card sx={{ bgcolor: COLORS.gray200 }}>
                                                        {(customs ?? []).map((custom: any, idx: number) => (
                                                            <Box key={custom.id || idx} sx={{ mb: 1, p: 1 }}>
                                                                <Typography variant="subtitle2" sx={{ color: COLORS.black }}>
                                                                    <IoBuildOutline />
                                                                    <b>{custom.custom_title || `Custom ${idx + 1}`}</b>
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Card>
                                                    <Divider sx={{ my: 1.5 }} />
                                                </Box>
                                            )}

                                            <Typography variant="subtitle2" sx={{ color: COLORS.black }}>
                                                <b>Técnico asignado</b>
                                            </Typography>
                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                {woID.assigned_tech_email || "—"}
                                            </Typography>


                                            {
                                                woID.tech_support && (
                                                    <Box>
                                                        <Typography variant="subtitle2" sx={{ color: COLORS.black }}>
                                                            <b>Técnico de soporte asignado</b>
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                            {woID.tech_support || "—"}
                                                        </Typography>

                                                    </Box>

                                                )
                                            }

                                            <Divider sx={{ my: 1.5 }} />

                                            <Typography variant="subtitle2" sx={{ color: COLORS.black }}>
                                                <b>Programada para:</b>
                                            </Typography>
                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                {fdt(woID.scheduled_at)}
                                            </Typography>

                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}>
                                                <b>Creada el:</b>
                                            </Typography>
                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                {fdt(woID.created_at)}
                                            </Typography>

                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}>
                                                <b>Folio SAI:</b>
                                            </Typography>
                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                {woID.folio_sai || "—"}
                                            </Typography>

                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}>
                                                <b> Numero de serie:</b>
                                            </Typography>
                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                {woID.machine_serial || "—"}
                                            </Typography>
                                            {
                                                woID.comments && (
                                                    <Box>
                                                        <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}>
                                                            <b>Comentarios:</b>
                                                        </Typography>
                                                        <Card sx={{ p: 1, bgcolor: COLORS.gray200, minHeight: 60 }}>
                                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                                {woID.comments}
                                                            </Typography>
                                                        </Card>
                                                    </Box>
                                                )
                                            }


                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}>
                                                <b>Estado inicial de la máquina:</b>
                                            </Typography>
                                            <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                {woID.initial_status || "—"}
                                            </Typography>
                                        </Box>
                                    ) : (
                                        <Box component="form" sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", flex: 1 }}
                                            onSubmit={async (e) => {
                                                e.preventDefault();
                                                try {
                                                    const res = await fetch(`https://desarrollotecnologicoar.com/api10/work-orders/edit_prod/${woID.id}`, {
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
                                                    fetchWO(woID.id);
                                                } catch (err) {
                                                    alert("Error actualizando la orden");
                                                }
                                            }}
                                        >
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black }}><b>Modelo</b></Typography>
                                            <TextField size="small" value={model?.name || ""} disabled fullWidth />
                                            <Divider sx={{ my: 1.5 }} />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black }}><b>Técnico asignado</b></Typography>
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
                                                    <Typography variant="subtitle2" sx={{ color: COLORS.black }}><b>Técnico de soporte asignado</b></Typography>
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
                                            <Divider sx={{ my: 1.5 }} />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black }}><b>Programada para:</b></Typography>
                                            <TextField
                                                size="small"
                                                type="datetime-local"
                                                value={editForm.scheduled_at_local}
                                                onChange={e => setEditForm(f => ({ ...f, scheduled_at_local: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}><b>Creada el:</b></Typography>
                                            <TextField size="small" value={fdt(woID.created_at)} disabled fullWidth />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}><b>Folio SAI:</b></Typography>
                                            <TextField
                                                size="small"
                                                value={editForm.folio_sai || ""}
                                                onChange={e => setEditForm(f => ({ ...f, folio_sai: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}><b>Numero de serie:</b></Typography>
                                            <TextField
                                                size="small"
                                                value={editForm.machine_serial || ""}
                                                onChange={e => setEditForm(f => ({ ...f, machine_serial: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}><b>Comentarios:</b></Typography>
                                            <TextField
                                                size="small"
                                                multiline
                                                minRows={2}
                                                value={editForm.comments || ""}
                                                onChange={e => setEditForm(f => ({ ...f, comments: e.target.value }))}
                                                fullWidth
                                            />
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}><b>Estado inicial de la máquina:</b></Typography>
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
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black, mt: 1 }}><b>Número de serie de la máquina:</b></Typography>
                                            <TextField
                                                size="small"
                                                value={editForm.machine_serial}
                                                onChange={e => setEditForm(f => ({ ...f, machine_serial: e.target.value }))}
                                                fullWidth
                                            />
                                            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                                                <Button type="submit" variant="contained" sx={{ bgcolor: COLORS.gray700, color: COLORS.white }}>Guardar</Button>
                                                <Button variant="outlined" sx={{ color: COLORS.red, borderColor: COLORS.red }} onClick={() => setEditMode(false)}>Cancelar</Button>
                                            </Stack>
                                        </Box>
                                    )}
                                    {!editMode && (
                                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                            <Button variant='contained' sx={{ bgcolor: COLORS.redSoft, ml: 3, mr: 3, mb: 1, mt: 1 }} onClick={() => handleErase(woID.id)}>
                                                Eliminar orden
                                            </Button>
                                            <Button
                                                variant='contained'
                                                sx={{ bgcolor: COLORS.gray500, ml: 3, mr: 3, mb: 1 }}
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

                                {/* Columna derecha: Actividades agrupadas */}
                                <Box sx={{ flex: 1, display: "flex", flexDirection: "column", bgcolor: COLORS.white }}>
                                    {/* Título de columna */}
                                    <Box sx={{ p: 3, borderBottom: `1px solid ${COLORS.gray200}`, bgcolor: COLORS.white }}>
                                        <Typography variant="h6" sx={{ fontWeight: 700, color: COLORS.black, textAlign: "center" }}>
                                            Actividades por sección
                                        </Typography>
                                    </Box>

                                    {/* Contenido scrollable */}
                                    <Box sx={{ flex: 1, overflow: "auto" }}>
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
                                                        <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                                            No hay actividades disponibles.
                                                        </Typography>
                                                    </Box>
                                                );
                                            }

                                            return (
                                                <List
                                                    disablePadding
                                                    sx={{
                                                        width: "100%",
                                                        bgcolor: COLORS.white,
                                                    }}
                                                >
                                                    {entries.map(([section, tasks]) => (
                                                        <Box key={section} component="li">
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
                                                                    letterSpacing: 0.3,
                                                                }}
                                                            >
                                                                {section}
                                                            </ListSubheader>

                                                            {tasks!.map((task: any) => (
                                                                <ListItem
                                                                    key={task.id}
                                                                    disableGutters
                                                                    sx={{
                                                                        px: 3,
                                                                        py: 1.25,
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
                                                                        {/* Acento rojo lateral */}
                                                                        <Box
                                                                            sx={{
                                                                                width: 6,
                                                                                alignSelf: "stretch",
                                                                                borderRadius: "8px",
                                                                                bgcolor: task.status === "DONE" ? COLORS.red : COLORS.gray200,
                                                                            }}
                                                                        />
                                                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                                                            <ListItemText
                                                                                primaryTypographyProps={{
                                                                                    sx: {
                                                                                        fontWeight: 600,
                                                                                        color: COLORS.black,
                                                                                        overflow: "hidden",
                                                                                        textOverflow: "ellipsis",
                                                                                        whiteSpace: "nowrap",
                                                                                    },
                                                                                }}
                                                                                secondaryTypographyProps={{
                                                                                    sx: { color: COLORS.gray500, mt: 0.25 },
                                                                                }}
                                                                                primary={task.task_title || task.title || "Actividad"}
                                                                                secondary={
                                                                                    task.status === "DONE"
                                                                                        ? `Finalizado el: ${task.finished_at.replace("T", " ").slice(0, 16).replaceAll("-", "/")}`
                                                                                        : "En proceso"
                                                                                }
                                                                            />
                                                                        </Box>

                                                                        <Chip
                                                                            label={task.status === "DONE" ? "Completado" : "En progreso"}
                                                                            size="small"
                                                                            sx={{
                                                                                bgcolor: task.status === "DONE" ? COLORS.red : COLORS.gray200,
                                                                                color: task.status === "DONE" ? COLORS.white : COLORS.black,
                                                                                fontWeight: 600,
                                                                            }}
                                                                        />
                                                                    </Box>
                                                                </ListItem>
                                                            ))}
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
                                <Typography variant="body2" sx={{ color: COLORS.gray700 }}>
                                    Cargando…
                                </Typography>
                            </Box>
                        )}
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