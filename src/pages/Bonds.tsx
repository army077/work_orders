import React, { useEffect, useState, useMemo } from "react";
import {
    Box,
    Card,
    CardContent,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    TextField,
    Button,
    Grid,
    CircularProgress,
} from "@mui/material";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import axios from "axios";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

type BonoResumen = {
    nombre_tecnico: string;
    correo_tecnico: string;
    conteo_ordenes: number;
    suma_puntos_maquina: number;
    suma_puntos_customs: number;
    puntos_secundario: number;
    puntos_extra: number;
};

const COLORS = {
    red: "#8B0000",
    gray200: "#e6e6e6",
};

export default function BondsDashboard() {
    const [data, setData] = useState<BonoResumen[]>([]);
    const [loading, setLoading] = useState(false);
    const [inicio, setInicio] = useState("");
    const [fin, setFin] = useState("");

    const fetchBonos = async () => {
        setLoading(true);
        try {
            const url = new URL("https://desarrollotecnologicoar.com/api10/bonds/visualizar");
            if (inicio) url.searchParams.append("inicio", inicio);
            if (fin) url.searchParams.append("fin", fin);

            const res = await axios.get(url.toString());
            const resumen: BonoResumen[] = res.data.resumen || [];
            setData(resumen);
        } catch (error) {
            console.error("❌ Error al obtener bonos:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBonos();
    }, []);

    const totalBonos = useMemo(() => {
        return data.reduce(
            (acc, t) => acc + Number(t.suma_puntos_maquina) + Number(t.suma_puntos_customs) + Number(t.puntos_secundario),
            0
        );
    }, [data]);

    const graficaData = useMemo(
        () =>
            data.map((t) => ({
                name: t.nombre_tecnico,
                Bono: (Number(t.suma_puntos_maquina) + Number(t.suma_puntos_customs) + Number(t.puntos_secundario)) * 100,
            })),
        [data]
    );

    // 🔹 Función para exportar a Excel
    const exportToExcel = () => {
        if (data.length === 0) {
            alert("No hay datos para exportar.");
            return;
        }

        // Formatear datos para Excel
        const sheetData = data.map((t) => ({
            "Nombre Técnico": t.nombre_tecnico,
            "Correo Técnico": t.correo_tecnico,
            "Órdenes Completadas": t.conteo_ordenes,
            "Puntos Máquina": Number(t.suma_puntos_maquina).toFixed(2),
            "Puntos Custom": Number(t.suma_puntos_customs).toFixed(2),
            "Puntos Op. Secundario": Number(t.puntos_secundario).toFixed(2),
            "Total Bono ($)": ((Number(t.suma_puntos_maquina) + Number(t.suma_puntos_customs) + Number(t.puntos_secundario)) * 100).toFixed(2),
        }));

        const worksheet = XLSX.utils.json_to_sheet(sheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Bonos Técnicos");

        const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([excelBuffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        const fecha = new Date().toISOString().split("T")[0];
        saveAs(blob, `BonosProduccion_${fecha}.xlsx`);
    };

    return (
        <Box sx={{ p: 3, backgroundColor: COLORS.gray200, minHeight: "100vh", borderRadius: 10 }}>
            <Typography variant="h4" sx={{ mb: 2, color: "#8B0000", fontWeight: 700 }}>
                Dashboard de Bonos Técnicos
            </Typography>

            {/* FILTROS */}
            <Card sx={{ mb: 3, p: 2 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    Filtros
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            label="Fecha inicio"
                            type="date"
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            value={inicio}
                            onChange={(e) => setInicio(e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            label="Fecha fin"
                            type="date"
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            value={fin}
                            onChange={(e) => setFin(e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4} display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                        <Button
                            variant="contained"
                            onClick={fetchBonos}
                            sx={{
                                bgcolor: "#8B0000",
                                "&:hover": { bgcolor: "#a10000" },
                                minWidth: 120,
                            }}
                        >
                            Buscar
                        </Button>
                        <Button
                            variant="outlined"
                            color="success"
                            onClick={exportToExcel}
                            sx={{ minWidth: 150 }}
                        >
                            Descargar Excel
                        </Button>
                    </Grid>
                </Grid>
            </Card>

            {/* RESUMEN */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={4}>
                    <Card sx={{ bgcolor: "#8B0000", color: "#fff" }}>
                        <CardContent>
                            <Typography variant="h6">Técnicos con bonos</Typography>
                            <Typography variant="h4">{data.length}</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                    <Card sx={{ bgcolor: "#333", color: "#fff" }}>
                        <CardContent>
                            <Typography variant="h6">Total de puntos</Typography>
                            <Typography variant="h4">{totalBonos.toFixed(1)}</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                    <Card sx={{ bgcolor: "#666", color: "#fff" }}>
                        <CardContent>
                            <Typography variant="h6">Órdenes analizadas</Typography>
                            <Typography variant="h4">
                                {data.reduce((acc, t) => acc + Number(t.conteo_ordenes), 0)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* GRÁFICA */}
            <Card sx={{ mb: 3, p: 2 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                    Puntos por Técnico
                </Typography>
                {loading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height={200}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={graficaData}>
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="Bono" fill="#d9534f" />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </Card>

            {/* TABLA */}
            <Card>
                <CardContent>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                        Detalle de órdenes por técnico
                    </Typography>
                    {loading ? (
                        <Box display="flex" justifyContent="center" alignItems="center" height={200}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <TableContainer component={Paper}>
                            <Table>
                                <TableHead sx={{ bgcolor: "#eee" }}>
                                    <TableRow>
                                        <TableCell><b>Técnico</b></TableCell>
                                        <TableCell><b>Correo</b></TableCell>
                                        <TableCell><b>Órdenes</b></TableCell>
                                        <TableCell><b>Puntos Máquina</b></TableCell>
                                        <TableCell><b>Puntos Custom</b></TableCell>
                                        <TableCell><b>Puntos Operador Secundario</b></TableCell>
                                        <TableCell><b>Puntos Extra</b></TableCell>
                                        <TableCell><b>Total Bono ($)</b></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {data.map((t) => (
                                        <TableRow key={t.correo_tecnico}>
                                            <TableCell align="center">{t.nombre_tecnico}</TableCell>
                                            <TableCell align="center">{t.correo_tecnico}</TableCell>
                                            <TableCell align="center">{t.conteo_ordenes}</TableCell>
                                            <TableCell align="center">
                                                {Number(t.suma_puntos_maquina).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">
                                                {Number(t.suma_puntos_customs).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">
                                                {Number(t.puntos_secundario).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">
                                                {Number(t.puntos_extra).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">
                                                {(
                                                    (Number(t.suma_puntos_maquina) +
                                                        Number(t.suma_puntos_customs) +
                                                           Number(t.puntos_secundario) +
                                                              Number(t.puntos_extra)) *
                                                    100
                                                ).toFixed(2)}{" "}
                                                $
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {data.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} align="center">
                                                No se encontraron registros.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </CardContent>
            </Card>
        </Box>
    );
}
