import React, { useEffect, useMemo, useState } from "react";
import {
    Box,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Button,
    Paper,
    Modal,
    IconButton,
    CircularProgress,
    Snackbar,
    Alert,
    Tab,
    Card,
    Divider,
} from "@mui/material";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { Search, AddCircle, Visibility, BorderColor } from "@mui/icons-material";
import dayjs, { Dayjs } from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import axios from "axios";

dayjs.extend(weekOfYear);
import { IoBuildOutline } from "react-icons/io5";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    PieChart,
    Pie,
    Cell,
    ComposedChart,
    Line,
} from "recharts";
// -------------------- Tipos --------------------
type Nullable<T> = T | null | undefined;

export interface DetalleBonoRow {
    id: number;
    assigned_tech_email: Nullable<string>;
    tech_support: Nullable<string>;
    status: Nullable<string>;
    finished_local: Nullable<string>;
    machine_serial: Nullable<string>;
    customer_name: Nullable<string>;
    site_address: Nullable<string>;
    titulo: Nullable<string>;
    modelo: Nullable<string>;
    bono_equipo: number;
    bono_operador_2: number;
    dias_estandar: number;
    dias_usados_laborales: number;
    eficiencia: number; // 7.0000, etc.
    suma_puntos_customs: number; // promedio por tu query: SUM(...) / COUNT(wo.id)
    suma_puntos_extra: number;
    folio_sai: Nullable<string>;
    suma_puntos_eficiencia: number;
    status_inicial: Nullable<string>;
}

interface ApiDetalleResponse {
    periodo: { inicio: Nullable<string>; fin: Nullable<string> };
    total_ordenes: number;
    resultados: DetalleBonoRow[];
}

// -------------------- Colores --------------------
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

// -------------------- Componente --------------------
export default function ProductionHistory() {
    const [rows, setRows] = useState<DetalleBonoRow[]>([]);
    const [search, setSearch] = useState<string>("");
    const [inicio, setInicio] = useState<Dayjs | null>(null);
    const [fin, setFin] = useState<Dayjs | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [selectedRow, setSelectedRow] = useState<DetalleBonoRow | null>(null);
    const [customModalOpen, setCustomModalOpen] = useState<boolean>(false);
    const [extraModalOpen, setExtraModalOpen] = useState<boolean>(false);
    const [extraPoints, setExtraPoints] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [customs, setCustoms] = useState<any[]>([]);

    // Cargar datos desde API
    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (inicio) params.append("inicio", dayjs(inicio).format("YYYY-MM-DD"));
            if (fin) params.append("fin", dayjs(fin).format("YYYY-MM-DD"));

            const res = await fetch(
                `https://desarrollotecnologicoar.com/api10/bonds/detalle?${params.toString()}`
            );
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data: ApiDetalleResponse = await res.json();
            setRows(Array.isArray(data.resultados) ? data.resultados : []);
        } catch (err: any) {
            console.error("Error al cargar datos:", err);
            setError("Error al cargar datos");
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // carga inicial
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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



    // Filtro por texto
    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => {
            const a = r.assigned_tech_email?.toLowerCase() || "";
            const t = r.tech_support?.toLowerCase() || "";
            const ti = r.titulo?.toLowerCase() || "";
            const mo = r.modelo?.toLowerCase() || "";
            const sn = r.machine_serial?.toLowerCase() || "";
            return (
                a.includes(q) ||
                t.includes(q) ||
                ti.includes(q) ||
                mo.includes(q) ||
                sn.includes(q)
            );
        });
    }, [rows, search]);

    // Guardar puntos extra (placeholder)
    const handleExtraPoints = async () => {
        console.log("Guardar puntos extra:", selectedRow, extraPoints);
        if (!selectedRow) return;
        try {
            await axios.put(`https://desarrollotecnologicoar.com/api10/work-orders/agregar_puntos_extra`, {
                work_order_id: selectedRow?.id,
                extra_points: Number(extraPoints),
            });

            setExtraModalOpen(false);
            setExtraPoints("");
            alert("Puntos extra guardados correctamente");
            // refresh si aplica
            // await fetchData();
        } catch (e) {
            setError("No se pudieron guardar los puntos extra");
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Box sx={{ bgcolor: COLORS.gray200, minHeight: "100vh", p: 3, color: COLORS.white, borderRadius: 10 }}>
                <Typography variant="h4" sx={{ mb: 2, color: "#8B0000", fontWeight: 700 }}>
                    Historial de Bonos de Producción
                </Typography>

                {/* FILTROS */}
                <Box
                    sx={{
                        display: "flex",
                        gap: 2,
                        flexWrap: "wrap",
                        alignItems: "center",
                        mb: 3,
                        bgcolor: COLORS.white,
                        p: 2,
                        borderRadius: 2,
                    }}
                >
                    <DatePicker
                        label="Fecha inicio"
                        value={inicio}
                        onChange={(v) => setInicio(v)}
                        slotProps={{
                            textField: {
                                variant: "outlined",
                                sx: { input: { color: COLORS.white }, minWidth: 180 },
                            },
                        }}
                    />
                    <DatePicker
                        label="Fecha fin"
                        value={fin}
                        onChange={(v) => setFin(v)}
                        slotProps={{
                            textField: {
                                variant: "outlined",
                                sx: { input: { color: COLORS.white }, minWidth: 180 },
                            },
                        }}
                    />
                    <Button
                        variant="contained"
                        sx={{ bgcolor: COLORS.redSoft, "&:hover": { bgcolor: COLORS.red } }}
                        onClick={fetchData}
                        disabled={loading}
                    >
                        {loading ? "Filtrando..." : "Filtrar"}
                    </Button>
                    <TextField
                        placeholder="Buscar técnico, modelo o serie..."
                        variant="outlined"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        sx={{
                            flexGrow: 1,
                            minWidth: 240,
                            bgcolor: COLORS.gray500,
                            input: { color: COLORS.white },
                            "& .MuiOutlinedInput-root": { borderRadius: 2 },
                        }}
                        InputProps={{
                            startAdornment: <Search sx={{ color: COLORS.gray500, mr: 1 }} />,
                        }}
                    />
                </Box>

                {/* TABLA */}
                <TableContainer component={Paper} sx={{ bgcolor: COLORS.gray200 }}>
                    <Table>
                        <TableHead>
                            <TableRow sx={{ bgcolor: COLORS.red }}>
                                <TableCell sx={{ color: COLORS.white }}>Fecha Final</TableCell>
                                <TableCell sx={{ color: COLORS.white }}>Técnico Principal</TableCell>
                                <TableCell sx={{ color: COLORS.white }}>Técnico Soporte</TableCell>
                                <TableCell sx={{ color: COLORS.white }}>Folio SAI</TableCell>
                                <TableCell sx={{ color: COLORS.white }}>Numero de serie</TableCell>
                                <TableCell sx={{ color: COLORS.white }}>Modelo</TableCell>
                                <TableCell sx={{ color: COLORS.white }}>Título</TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Bono Equipo
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Bono Operador 2
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Bono customs
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Bono extra
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Eficiencia
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Bono Eficiencia
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="right">
                                    Bono Total
                                </TableCell>
                                <TableCell sx={{ color: COLORS.white }} align="center">
                                    Acciones
                                </TableCell>
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={10} align="center" sx={{ py: 6 }}>
                                        <CircularProgress />
                                    </TableCell>
                                </TableRow>
                            ) : filteredRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={10} align="center" sx={{ color: COLORS.gray200, py: 6 }}>
                                        Sin resultados
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredRows.map((row) => (
                                    row.status_inicial === "New Product" || row.status_inicial === null ? (
                                        <TableRow
                                            key={row.id}
                                            sx={{
                                                "&:hover": { bgcolor: COLORS.gray500 },
                                            }}
                                        >
                                            <TableCell>{row.finished_local ? dayjs(row.finished_local).format("DD/MM/YYYY") : "-"}</TableCell>
                                            <TableCell>{row.assigned_tech_email || "-"}</TableCell>
                                            <TableCell>{row.tech_support || "-"}</TableCell>
                                            <TableCell>{row.folio_sai || "-"}</TableCell>
                                            <TableCell>{row.machine_serial || "-"}</TableCell>
                                            <TableCell>{row.modelo || "-"}</TableCell>
                                            <TableCell>{row.titulo || "-"}</TableCell>
                                            <TableCell align="right">{row.bono_equipo ?? 0}</TableCell>
                                            <TableCell align="right">{row.bono_operador_2 ?? 0}</TableCell>
                                            <TableCell align="right">{Number(row.suma_puntos_customs).toFixed(2) ?? 0}</TableCell>
                                            <TableCell align="right">{row.suma_puntos_extra ?? 0} </TableCell>
                                            <TableCell align="right">{`${row.eficiencia > 1 ? (100) : (row.eficiencia * 100).toFixed(2)}%`}</TableCell>
                                            <TableCell align="right">{Number(row.suma_puntos_eficiencia).toFixed(2) ?? 0}</TableCell>
                                            <TableCell align="right">
                                                {(Number(row.bono_equipo ?? 0) + Number(row.bono_operador_2 ?? 0) + Number(row.suma_puntos_customs) + Number(row.suma_puntos_extra) + Number(row.suma_puntos_eficiencia)).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">
                                                <IconButton
                                                    sx={{ color: COLORS.redSoft }}
                                                    onClick={() => {
                                                        setSelectedRow(row);
                                                        setExtraModalOpen(true);
                                                    }}
                                                >
                                                    <AddCircle />
                                                </IconButton>
                                                <IconButton
                                                    sx={{ color: COLORS.black }}
                                                    onClick={() => {
                                                        setSelectedRow(row);
                                                        fetchCustoms(row.id);
                                                        setCustomModalOpen(true);
                                                    }}
                                                >
                                                    <Visibility />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>

                                    ) : (
                                        <TableRow
                                            key={row.id}
                                            sx={{
                                                "&:hover": { bgcolor: COLORS.gray500 },
                                                bgcolor: "#ffe6e6", // fondo diferente
                                                borderLeft: `6px solid ${COLORS.redSoft}`, // acento lateral   
                                            }}
                                        >
                                            <TableCell>{row.finished_local ? dayjs(row.finished_local).format("DD/MM/YYYY") : "-"}</TableCell>
                                            <TableCell>{row.assigned_tech_email || "-"}</TableCell>
                                            <TableCell>{row.tech_support || "-"}</TableCell>
                                            <TableCell>{row.folio_sai || "-"}</TableCell>
                                            <TableCell>{row.machine_serial || "-"}</TableCell>
                                            <TableCell>{row.modelo || "-"}</TableCell>
                                            <TableCell>{row.titulo || "-"}</TableCell>
                                            <TableCell align="right">{row.bono_equipo ?? 0}</TableCell>
                                            <TableCell align="right">{row.bono_operador_2 ?? 0}</TableCell>
                                            <TableCell align="right">{Number(row.suma_puntos_customs).toFixed(2) ?? 0}</TableCell>
                                            <TableCell align="right">{row.suma_puntos_extra ?? 0} </TableCell>
                                            <TableCell align="right">{`${row.eficiencia > 1 ? (100) : (row.eficiencia * 100).toFixed(2)}%`}</TableCell>
                                            <TableCell align="right">{Number(row.suma_puntos_eficiencia).toFixed(2) ?? 0}</TableCell>
                                            <TableCell align="right">
                                                {(Number(row.bono_equipo ?? 0) + Number(row.bono_operador_2 ?? 0) + Number(row.suma_puntos_customs) + Number(row.suma_puntos_extra) + Number(row.suma_puntos_eficiencia)).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">
                                                <IconButton
                                                    sx={{ color: COLORS.redSoft }}
                                                    onClick={() => {
                                                        setSelectedRow(row);
                                                        setExtraModalOpen(true);
                                                    }}
                                                >
                                                    <AddCircle />
                                                </IconButton>
                                                <IconButton
                                                    sx={{ color: COLORS.black }}
                                                    onClick={() => {
                                                        setSelectedRow(row);
                                                        fetchCustoms(row.id);
                                                        setCustomModalOpen(true);
                                                    }}
                                                >
                                                    <Visibility />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>

                                    )

                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
                {/* ==================== GRÁFICOS ==================== */}
                <Box
                    sx={{
                        display: "grid",
                        gridTemplateColumns: "2fr 1fr",
                        gap: 3,
                        mt: 6,
                    }}
                >
                    {/* --- 1️⃣ Gráfico de barras por semana --- */}
                    <Paper sx={{ p: 2, bgcolor: COLORS.white, borderRadius: 3 }}>
                        <Typography variant="h6" sx={{ mb: 2, color: COLORS.black, fontWeight: 700 }}>
                            Equipos finalizados por semana
                        </Typography>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart
                                data={rows.reduce((acc: any[], row) => {
                                    if (!row.finished_local) return acc;
                                    const week = dayjs(row.finished_local).week();
                                    const existing = acc.find((a) => a.week === week);
                                    if (existing) existing.count += 1;
                                    else acc.push({ week, count: 1 });
                                    return acc;
                                }, [])}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray200} />
                                <XAxis dataKey="week" stroke={COLORS.black} />
                                <YAxis stroke={COLORS.black} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="count" fill={COLORS.gray500} color={COLORS.red} name="Órdenes completadas" />
                            </BarChart>
                        </ResponsiveContainer>
                    </Paper>

                    {/* --- 2️⃣ Gráfico de pastel por modelo --- */}
                    <Paper sx={{ p: 2, bgcolor: COLORS.white, borderRadius: 3 }}>
                        <Typography variant="h6" sx={{ mb: 2, color: COLORS.black, fontWeight: 700 }}>
                            Ponderación por modelo
                        </Typography>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={Object.values(
                                        rows.reduce((acc: Record<string, any>, row) => {
                                            if (!row.modelo) return acc;
                                            if (!acc[row.modelo]) acc[row.modelo] = { name: row.modelo, value: 0 };
                                            acc[row.modelo].value += 1;
                                            return acc;
                                        }, {})
                                    )}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    fill={COLORS.redSoft}
                                    dataKey="value"
                                    label
                                >
                                    {rows.map((_, idx) => (
                                        <Cell
                                            key={`cell-${idx}`}
                                            fill={["#8B0000", "#B22222", "#7a7a7a", "#2a2a2a", "#1f1f1f"][idx % 5]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </Paper>
                </Box>

                {/* --- 3️⃣ Gráfico combinado: equipos y eficiencia por técnico --- */}
                <Paper sx={{ p: 2, bgcolor: COLORS.white, borderRadius: 3, mt: 4 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: COLORS.black, fontWeight: 700 }}>
                        Desempeño por técnico
                    </Typography>
                    <ResponsiveContainer width="100%" height={350}>
                        <ComposedChart
                            data={Object.values(
                                rows.reduce((acc: Record<string, any>, row) => {
                                    const tech = row.assigned_tech_email || "Sin asignar";
                                    if (!acc[tech]) acc[tech] = { name: tech, count: 0, eficienciaSum: 0, eficienciaN: 0 };

                                    // Conteo de órdenes por técnico (barras)
                                    acc[tech].count += 1;

                                    // Eficiencia: usa la propiedad correcta 'eficiencia' y limita a 1 (100%)
                                    const num = Number(row.eficiencia);
                                    if (Number.isFinite(num)) {
                                        const capped = Math.min(num, 1);
                                        acc[tech].eficienciaSum += capped;
                                        acc[tech].eficienciaN += 1;
                                    }
                                    return acc;
                                }, {})
                            ).map((t) => ({
                                name: t.name,
                                count: t.count,
                                // promedio en %, sólo con filas válidas
                                eficiencia: t.eficienciaN > 0 ? Number(((t.eficienciaSum / t.eficienciaN) * 100).toFixed(1)) : 0,
                            }))}

                        >
                            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray500} />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} stroke={COLORS.black} />
                            <YAxis
                                yAxisId="left"
                                orientation="left"
                                stroke={COLORS.redSoft}
                                label={{
                                    value: "Órdenes",
                                    angle: -90,
                                    position: "insideLeft",
                                    style: { fill: COLORS.redSoft },
                                }}
                            />
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                stroke={COLORS.gray700}
                                label={{
                                    value: "Eficiencia (%)",
                                    angle: 90,
                                    position: "insideRight",
                                    style: { fill: COLORS.gray700 },
                                }}
                            />
                            <Tooltip />
                            <Legend />
                            <Bar yAxisId="left" dataKey="count" barSize={40} fill={COLORS.redSoft} name="Órdenes" />
                            <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="eficiencia"
                                stroke={COLORS.black}
                                strokeWidth={2}
                                name="Eficiencia"
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Paper>


                {/* MODAL: Puntos extra */}
                <Modal open={extraModalOpen} onClose={() => setExtraModalOpen(false)}>
                    <Box
                        sx={{
                            bgcolor: COLORS.gray700,
                            color: COLORS.white,
                            p: 4,
                            borderRadius: 3,
                            width: 420,
                            mx: "auto",
                            mt: "15%",
                            boxShadow: 24,
                        }}
                    >
                        <Typography variant="h6" sx={{ mb: 2, color: COLORS.redSoft }}>
                            Agregar puntos extra
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            Orden ID: {selectedRow?.id ?? "-"}
                        </Typography>
                        <TextField
                            fullWidth
                            type="number"
                            label="Puntos extra"
                            value={extraPoints}
                            onChange={(e) => setExtraPoints(e.target.value)}
                            sx={{
                                mt: 1,
                                input: { color: COLORS.white },
                                "& .MuiInputLabel-root": { color: COLORS.gray500 },
                            }}
                        />
                        <Button
                            fullWidth
                            variant="contained"
                            sx={{ mt: 3, bgcolor: COLORS.redSoft, "&:hover": { bgcolor: COLORS.red } }}
                            onClick={handleExtraPoints}
                        >
                            Guardar
                        </Button>
                    </Box>
                </Modal>

                {/* MODAL: Ver customizaciones */}
                {/* MODAL: Ver customizaciones */}
                <Modal
                    open={customModalOpen}
                    onClose={() => setCustomModalOpen(false)}
                    aria-labelledby="modal-title"
                >
                    <Box
                        sx={{
                            bgcolor: COLORS.gray900,
                            color: COLORS.white,
                            p: 4,
                            borderRadius: 4,
                            width: "90%",
                            maxWidth: 700,
                            mx: "auto",
                            mt: "6%",
                            boxShadow: "0 0 40px rgba(0,0,0,0.6)",
                            maxHeight: "80vh",
                            overflowY: "auto",
                            position: "relative",
                        }}
                    >
                        <Typography
                            id="modal-title"
                            variant="h5"
                            sx={{ mb: 3, color: COLORS.redSoft, fontWeight: 700 }}
                        >
                            🧩 Detalles de Customizaciones
                        </Typography>

                        {selectedRow && (
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="body2" sx={{ color: COLORS.gray200 }}>
                                    <b>Orden:</b> {selectedRow.id} &nbsp; | &nbsp;
                                    <b>Modelo:</b> {selectedRow.modelo ?? "—"} &nbsp; | &nbsp;
                                    <b>Técnico:</b> {selectedRow.assigned_tech_email ?? "—"}
                                </Typography>
                            </Box>
                        )}

                        {customs && customs.length > 0 ? (
                            customs.map((custom: any, idx: number) => (
                                <Card
                                    key={custom.id || idx}
                                    sx={{
                                        bgcolor: COLORS.gray700,
                                        mb: 2,
                                        borderRadius: 3,
                                        p: 2,
                                        boxShadow: "0 0 10px rgba(0,0,0,0.3)",
                                        transition: "transform 0.2s ease",
                                        "&:hover": { transform: "scale(1.01)" },
                                    }}
                                >
                                    <Typography variant="h6" sx={{ color: COLORS.redSoft, mb: 1 }}>
                                        <IoBuildOutline
                                            style={{ marginRight: 6, verticalAlign: "middle" }}
                                        />
                                        {custom.custom_title || `Customización #${idx + 1}`}
                                    </Typography>

                                    <Typography
                                        variant="body2"
                                        sx={{ color: COLORS.gray200, lineHeight: 1.6 }}
                                    >
                                        {custom.descripcion
                                            ? custom.descripcion
                                            : "Sin descripción disponible."}
                                    </Typography>

                                    <Divider sx={{ my: 1.5, borderColor: COLORS.gray500 }} />

                                    <Box
                                        sx={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 2,
                                            justifyContent: "space-between",
                                        }}
                                    >
                                        {custom.autor && (
                                            <Typography variant="body2">
                                                👷 <b>Autor:</b> {custom.autor}
                                            </Typography>
                                        )}
                                        {custom.horas && (
                                            <Typography variant="body2">
                                                ⏱️ <b>Horas:</b> {custom.horas}
                                            </Typography>
                                        )}
                                        {custom.fecha && (
                                            <Typography variant="body2">
                                                📅 <b>Fecha:</b>{" "}
                                                {dayjs(custom.fecha).format("DD/MM/YYYY HH:mm")}
                                            </Typography>
                                        )}
                                        {custom.status && (
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    color:
                                                        custom.status === "Completado"
                                                            ? "lightgreen"
                                                            : custom.status === "En proceso"
                                                                ? "#FFD700"
                                                                : COLORS.gray200,
                                                }}
                                            >
                                                ⚙️ <b>Status:</b> {custom.status}
                                            </Typography>
                                        )}
                                    </Box>
                                </Card>
                            ))
                        ) : (
                            <Typography
                                variant="body2"
                                sx={{
                                    textAlign: "center",
                                    mt: 4,
                                    color: COLORS.gray200,
                                    fontStyle: "italic",
                                }}
                            >
                                No se encontraron customizaciones registradas.
                            </Typography>
                        )}

                        <Box textAlign="center" mt={4}>
                            <Button
                                variant="contained"
                                onClick={() => setCustomModalOpen(false)}
                                sx={{
                                    bgcolor: COLORS.redSoft,
                                    "&:hover": { bgcolor: COLORS.red },
                                    borderRadius: 2,
                                    px: 4,
                                    py: 1,
                                    fontWeight: 600,
                                }}
                            >
                                Cerrar
                            </Button>
                        </Box>
                    </Box>
                </Modal>


                <Snackbar
                    open={!!error}
                    autoHideDuration={4000}
                    onClose={() => setError(null)}
                    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                >
                    <Alert severity="error" variant="filled" onClose={() => setError(null)}>
                        {error}
                    </Alert>
                </Snackbar>
            </Box>
        </LocalizationProvider>
    );
}
