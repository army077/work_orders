import { useList } from "@refinedev/core";
import {
    Card,
    CardContent,
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
} from "@mui/material";
import React from "react";

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
    const [search, setSearch] = React.useState("");
    const [customs, setCustoms] = React.useState<any[]>([]);
    const [open, setOpen] = React.useState(false);
    const [selectedOrder, setSelectedOrder] = React.useState<InspectionOrder | null>(null);
    const [openTaskId, setOpenTaskId] = React.useState<number | null>(null);
    const [deviations, setDeviations] = React.useState<any[]>([]);
    const [loadingDev, setLoadingDev] = React.useState(false);

    const handleOpen = (order: InspectionOrder) => {
        setSelectedOrder(order);
        setOpen(true);
    };
    const handleClose = () => {
        setOpen(false);
        setSelectedOrder(null);
    };
    const [filterStatus, setFilterStatus] =
        React.useState<"" | "OPEN" | "IN_PROGRESS" | "CLOSED" | "FINISHED">("");

    const { data, isLoading } = useList<InspectionOrder>({
        resource: "quality/inspection/orders_all?include=tasks",
    });

    const inspections = data?.data ?? [];
    const fdt = (iso?: string | null) =>
        iso ? new Date(iso).toLocaleString() : "—";

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
        return list.sort((a, b) =>
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


    const fetchDeviations = async (taskId: number) => {
        try {
            setLoadingDev(true);
            const res = await fetch(
                `https://desarrollotecnologicoar.com/api10/quality/desviaciones/${taskId}`
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
                        {o.titulo ? o.titulo : `Inspección #${o.id}`}
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
                        Solicitada el: <strong>{fdt(o.created_at) ?? "N/A"}</strong>
                    </Typography>
                    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", mt: 1 }}>
                        <Chip
                            label={o.status}
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
            <Typography variant="h4" sx={{ mb: 2, color: COLORS.white }}>
                Plantel de Inspección
            </Typography>

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

                                    {selectedOrder.assigned_tech_email === null || selectedOrder.assigned_tech_email === "" ? (
                                        <>
                                            <Typography
                                                variant="subtitle2"
                                                sx={{ color: COLORS.red, fontWeight: 700, mb: 1 }}
                                            >
                                                Asignar inspector
                                            </Typography>

                                            <Box
                                                component="select"
                                                onChange={async (e) => {
                                                    const email = e.target.value;
                                                    if (!email) return;

                                                    try {
                                                        console.log("Asignando inspector:", email, "a orden", selectedOrder.id);
                                                        const res = await fetch(
                                                            "https://desarrollotecnologicoar.com/api10/quality/inspection/assign_inspector",
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
                                                        window.location.reload();
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
                                                <option value="">Selecciona un inspector…</option>
                                                <option value="fernando.reyes@asiarobotica.com">
                                                    Fernando Reyes Gallegos
                                                </option>
                                                <option value="sergio.rodriguez@asiarobotica.com">
                                                    Sergio Rodríguez
                                                </option>
                                                <option value="jose.hernandez@asiarobotica.com">
                                                    José Hernandez Jiménez
                                                </option>
                                            </Box>
                                        </>
                                    ) : (
                                        <>
                                            <Typography variant="subtitle2" sx={{ color: COLORS.black }}>
                                                Inspector asignado
                                            </Typography>
                                            <Chip
                                                label={selectedOrder.assigned_tech_email}
                                                sx={{
                                                    mt: 1,
                                                    bgcolor: COLORS.gray200,
                                                    color: COLORS.black,
                                                    fontWeight: 700,
                                                }}
                                            />
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
                                    {new Date(selectedOrder.created_at).toLocaleString()}
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
                                    textAlign: "center"
                                }}
                            >
                                <Typography variant="h6" sx={{ fontWeight: 700, color: COLORS.black }}>
                                    Actividades por sección
                                </Typography>
                            </Box>

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
                                                                                                {d.evidencias.map((img: string, i: number) => (
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
