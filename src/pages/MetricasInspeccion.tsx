import { useState, useMemo, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  Box,
  TextField,
  IconButton,
  CircularProgress,
  Tooltip,
  Card,
  Grid,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import { API10_URL } from "../config/api";
import { apiFetch as fetch } from "../services/apiTransport";

export interface InspectionTimingRecord {
  inspection_order_id: number;
  inspection_template_id: number | null;
  model_id: number | null;
  assigned_tech_email: string | null;
  status: "PENDING" | "IN_PROGRESS" | "FINISHED" | "CANCELED" | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  work_order_id: number;
  estacion: number | string | null;
  inspection_type: string | null;
  machine_serial: string | null;
  folio_sai: string | null;
  operador_produccion: string | null;
  equipo: string | null;
  titulo: string | null;
}

function formatDuration(minutesTotal: number | null): string {
  if (minutesTotal === null || isNaN(minutesTotal) || minutesTotal < 0) return "—";
  const mins = Math.floor(minutesTotal);
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (hours === 0) return `${remainingMins}m`;
  return `${hours}h ${remainingMins}m`;
}

function computeMinutesDiff(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso) return null;
  const start = new Date(fromIso).getTime();
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, (end - start) / (1000 * 60));
}

function formatDate(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export default function MetricasInspeccion() {
  const [records, setRecords] = useState<InspectionTimingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [now, setNow] = useState(Date.now());

  // Actualizador para contadores en vivo cada 30 segundos
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${API10_URL}/quality/inspection/orders_all`);
      if (res.ok) {
        const data: InspectionTimingRecord[] = await res.json();
        setRecords(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error("Error cargando órdenes de inspección:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return records
      .filter((r) => {
        if (filterStatus !== "ALL" && r.status !== filterStatus) return false;
        if (!term) return true;
        const serial = String(r.machine_serial ?? "").toLowerCase();
        const equipo = String(r.equipo ?? "").toLowerCase();
        const operador = String(r.operador_produccion ?? "").toLowerCase();
        const inspector = String(r.assigned_tech_email ?? "").toLowerCase();
        const folio = String(r.folio_sai ?? "").toLowerCase();
        const tipo = String(r.inspection_type ?? "").toLowerCase();
        const estacion = String(r.estacion ?? "").toLowerCase();
        return (
          serial.includes(term) ||
          equipo.includes(term) ||
          operador.includes(term) ||
          inspector.includes(term) ||
          folio.includes(term) ||
          tipo.includes(term) ||
          estacion.includes(term) ||
          String(r.inspection_order_id).includes(term)
        );
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [records, searchTerm, filterStatus]);

  // Cálculos de KPIs
  const stats = useMemo(() => {
    const total = records.length;
    const pending = records.filter((r) => r.status === "PENDING").length;
    const inProgress = records.filter((r) => r.status === "IN_PROGRESS").length;
    const finished = records.filter((r) => r.status === "FINISHED").length;

    // Tiempo de espera para ser atendidas (started_at - created_at)
    const attendTimes = records
      .filter((r) => r.started_at && r.created_at)
      .map((r) => computeMinutesDiff(r.created_at, r.started_at)!)
      .filter((m) => m !== null && m >= 0);

    const avgWaitMinutes =
      attendTimes.length > 0
        ? attendTimes.reduce((acc, val) => acc + val, 0) / attendTimes.length
        : null;

    // Tiempo de inspección (finished_at - started_at)
    const inspectionTimes = records
      .filter((r) => r.status === "FINISHED" && r.finished_at && r.started_at)
      .map((r) => computeMinutesDiff(r.started_at, r.finished_at)!)
      .filter((m) => m !== null && m >= 0);

    const avgInspectionMinutes =
      inspectionTimes.length > 0
        ? inspectionTimes.reduce((acc, val) => acc + val, 0) / inspectionTimes.length
        : null;

    return { total, pending, inProgress, finished, avgWaitMinutes, avgInspectionMinutes };
  }, [records]);

  return (
    <Box sx={{ p: 3, maxWidth: "100%", margin: "0 auto" }}>
      {/* Encabezado */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "text.primary" }}>
            Tiempos de Inspección y Calidad
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Monitoreo en tiempo real de solicitudes de inspección desde piso, tiempos de espera y liberación.
          </Typography>
        </Box>
        <Tooltip title="Actualizar datos">
          <IconButton onClick={loadData} disabled={isLoading} sx={{ color: "primary.main" }}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tarjetas KPI de Tiempos y Estado */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card
            sx={{
              p: 2,
              bgcolor: "#1F1B19",
              border: "1px solid #3A3633",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <PendingActionsIcon sx={{ color: "#F2A65A", fontSize: 36 }} />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                En Espera de Calidad
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: "#F2A65A" }}>
                {stats.pending} órdenes
              </Typography>
            </Box>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card
            sx={{
              p: 2,
              bgcolor: "#1F1B19",
              border: "1px solid #3A3633",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <PlayCircleOutlineIcon sx={{ color: "#FF6B77", fontSize: 36 }} />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                En Proceso de Inspección
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: "#FF6B77" }}>
                {stats.inProgress} órdenes
              </Typography>
            </Box>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card
            sx={{
              p: 2,
              bgcolor: "#1F1B19",
              border: "1px solid #3A3633",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <AccessTimeIcon sx={{ color: "#E63946", fontSize: 36 }} />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Tiempo Promedio Respuesta
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: "#F5F1ED" }}>
                {formatDuration(stats.avgWaitMinutes)}
              </Typography>
            </Box>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card
            sx={{
              p: 2,
              bgcolor: "#1F1B19",
              border: "1px solid #3A3633",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <CheckCircleOutlineIcon sx={{ color: "#5BBF8A", fontSize: 36 }} />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Duración Promedio Inspección
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: "#5BBF8A" }}>
                {formatDuration(stats.avgInspectionMinutes)}
              </Typography>
            </Box>
          </Card>
        </Grid>
      </Grid>

      {/* Barra de Filtros y Búsqueda */}
      <Box sx={{ mb: 2, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          size="small"
          placeholder="Buscar por serie, máquina, técnico, inspector o estación..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ minWidth: 380, flex: 1 }}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: "text.secondary" }} />,
          }}
        />

        <Box sx={{ display: "flex", gap: 1 }}>
          <Chip
            label={`Todas (${records.length})`}
            onClick={() => setFilterStatus("ALL")}
            color={filterStatus === "ALL" ? "primary" : "default"}
            variant={filterStatus === "ALL" ? "filled" : "outlined"}
            sx={{ cursor: "pointer" }}
          />
          <Chip
            label="Pendientes"
            onClick={() => setFilterStatus("PENDING")}
            color={filterStatus === "PENDING" ? "warning" : "default"}
            variant={filterStatus === "PENDING" ? "filled" : "outlined"}
            sx={{ cursor: "pointer" }}
          />
          <Chip
            label="En Proceso"
            onClick={() => setFilterStatus("IN_PROGRESS")}
            color={filterStatus === "IN_PROGRESS" ? "primary" : "default"}
            variant={filterStatus === "IN_PROGRESS" ? "filled" : "outlined"}
            sx={{ cursor: "pointer" }}
          />
          <Chip
            label="Finalizadas"
            onClick={() => setFilterStatus("FINISHED")}
            color={filterStatus === "FINISHED" ? "success" : "default"}
            variant={filterStatus === "FINISHED" ? "filled" : "outlined"}
            sx={{ cursor: "pointer" }}
          />
        </Box>
      </Box>

      {/* Tabla de Tiempos y Registro */}
      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={2} sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><b>Insp. ID</b></TableCell>
                <TableCell><b>Orden WO</b></TableCell>
                <TableCell><b>Máquina / Serie</b></TableCell>
                <TableCell><b>Estación</b></TableCell>
                <TableCell><b>Tipo Inspección</b></TableCell>
                <TableCell><b>Solicitado Por</b></TableCell>
                <TableCell><b>Hora Solicitud</b></TableCell>
                <TableCell><b>Inspector Asignado</b></TableCell>
                <TableCell><b>Tiempo de Espera</b></TableCell>
                <TableCell><b>Tiempo Abierta</b></TableCell>
                <TableCell><b>Estado</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 3, color: "text.secondary" }}>
                    No se encontraron registros de inspección con los filtros actuales.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => {
                  const isFinished = row.status === "FINISHED";
                  const isInProgress = row.status === "IN_PROGRESS";
                  const isPending = row.status === "PENDING";

                  // Tiempo que esperó para ser tomada por un inspector
                  const waitMinutes = row.started_at
                    ? computeMinutesDiff(row.created_at, row.started_at)
                    : computeMinutesDiff(row.created_at, new Date(now).toISOString());

                  // Tiempo total que lleva o llevó abierta
                  const totalOpenMinutes = computeMinutesDiff(
                    row.created_at,
                    row.finished_at ?? new Date(now).toISOString()
                  );

                  return (
                    <TableRow key={row.inspection_order_id} hover>
                      <TableCell>
                        <b>#{row.inspection_order_id}</b>
                      </TableCell>
                      <TableCell>#{row.work_order_id}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {row.equipo ?? "—"}
                        </Typography>
                        {row.machine_serial && (
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            Serie: {row.machine_serial}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={row.estacion ? `Est. ${row.estacion}` : "S/E"}
                          size="small"
                          variant="outlined"
                          sx={{ borderColor: "#3A3633" }}
                        />
                      </TableCell>
                      <TableCell>{row.inspection_type ?? "—"}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.operador_produccion ?? "—"}</Typography>
                      </TableCell>
                      <TableCell>{formatDate(row.created_at)}</TableCell>
                      <TableCell>
                        {row.assigned_tech_email ? (
                          <Typography variant="body2" sx={{ color: "primary.light" }}>
                            {row.assigned_tech_email}
                          </Typography>
                        ) : (
                          <Typography variant="caption" sx={{ color: "#F2A65A", fontStyle: "italic" }}>
                            Sin asignar
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            color:
                              isPending && (waitMinutes ?? 0) > 30
                                ? "#E63946"
                                : isPending
                                ? "#F2A65A"
                                : "#B8B0A9",
                          }}
                        >
                          {formatDuration(waitMinutes)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                            color: isFinished ? "#5BBF8A" : "#F5F1ED",
                          }}
                        >
                          {formatDuration(totalOpenMinutes)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {isFinished ? (
                          <Chip label="Finalizada" color="success" size="small" />
                        ) : isInProgress ? (
                          <Chip label="En Proceso" color="primary" size="small" />
                        ) : (
                          <Chip label="Pendiente" color="warning" size="small" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
