import { useState } from "react";
import { useList } from "@refinedev/core";
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Tooltip
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ImageIcon from "@mui/icons-material/Image";
import RefreshIcon from "@mui/icons-material/Refresh";

export interface DesviacionItem {
  id: number;
  id_actividad: number;
  work_order_id: number | null;
  correo: string | null;
  usuario: string | null;
  serial_number: string | null;
  afected_machine: string | null;
  num_revision: number | null;
  nombre_tecnico: string | null;
  parte_afectada: string | null;
  causa_raiz: string | null;
  clasificacion_defecto: string | null;
  tipo_defectivo: string | null;
  clasificacion_defectivo: string | null;
  comentarios: string | null;
  evidencias: string[] | string | null;
  created_at: string;
}

export default function DesviacionesList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState("");

  const { data, isLoading, refetch, isFetching } = useList<DesviacionItem>({
    resource: "quality/desviaciones",
    pagination: { pageSize: 100 },
  });

  const desviaciones = data?.data ?? [];

  const filtered = desviaciones.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      (item.serial_number && item.serial_number.toLowerCase().includes(q)) ||
      (item.afected_machine && item.afected_machine.toLowerCase().includes(q)) ||
      (item.nombre_tecnico && item.nombre_tecnico.toLowerCase().includes(q)) ||
      (item.parte_afectada && item.parte_afectada.toLowerCase().includes(q)) ||
      (item.causa_raiz && item.causa_raiz.toLowerCase().includes(q)) ||
      (item.clasificacion_defecto && item.clasificacion_defecto.toLowerCase().includes(q))
    );
  });

  const handleOpenImages = (item: DesviacionItem) => {
    let urls: string[] = [];
    if (Array.isArray(item.evidencias)) {
      urls = item.evidencias;
    } else if (typeof item.evidencias === "string") {
      try {
        urls = JSON.parse(item.evidencias);
      } catch {
        urls = [];
      }
    }
    setSelectedImages(urls);
    setSelectedSerial(item.serial_number ?? `#${item.id}`);
    setModalOpen(true);
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h5" component="h1" fontWeight="bold">
          ⚠️ Desviaciones de Calidad
        </Typography>
        <Tooltip title="Actualizar lista">
          <span>
            <IconButton onClick={() => refetch()} disabled={isLoading || isFetching} color="primary">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ mb: 2, display: "flex", gap: 2 }}>
        <TextField
          size="small"
          placeholder="Buscar por serie, máquina, técnico, parte afectada o causa raíz..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ minWidth: 400 }}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: "text.secondary" }} />,
          }}
        />
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={2} sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead sx={{ backgroundColor: "#f5f5f5" }}>
              <TableRow>
                <TableCell><b>ID</b></TableCell>
                <TableCell><b>Fecha</b></TableCell>
                <TableCell><b>No. Serie</b></TableCell>
                <TableCell><b>Máquina</b></TableCell>
                <TableCell><b>Parte Afectada</b></TableCell>
                <TableCell><b>Causa Raíz</b></TableCell>
                <TableCell><b>Clasificación Defecto</b></TableCell>
                <TableCell><b>Tipo Defectivo</b></TableCell>
                <TableCell><b>Técnico Inspector</b></TableCell>
                <TableCell><b>Comentarios</b></TableCell>
                <TableCell align="center"><b>Evidencias</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 3, color: "text.secondary" }}>
                    No se encontraron registros de desviaciones de calidad.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => {
                  let imgCount = 0;
                  if (Array.isArray(row.evidencias)) {
                    imgCount = row.evidencias.length;
                  } else if (typeof row.evidencias === "string") {
                    try {
                      imgCount = JSON.parse(row.evidencias).length;
                    } catch {
                      imgCount = 0;
                    }
                  }

                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>#{row.id}</TableCell>
                      <TableCell>{formatDate(row.created_at)}</TableCell>
                      <TableCell>
                        <Chip label={row.serial_number ?? "—"} color="error" variant="outlined" size="small" />
                      </TableCell>
                      <TableCell>{row.afected_machine ?? "—"}</TableCell>
                      <TableCell><b>{row.parte_afectada ?? "—"}</b></TableCell>
                      <TableCell>{row.causa_raiz ?? "—"}</TableCell>
                      <TableCell>
                        {row.clasificacion_defecto ? (
                          <Chip label={row.clasificacion_defecto} color="warning" size="small" />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{row.tipo_defectivo ?? "—"}</TableCell>
                      <TableCell>{row.nombre_tecnico ?? row.usuario ?? "—"}</TableCell>
                      <TableCell sx={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {row.comentarios || "—"}
                      </TableCell>
                      <TableCell align="center">
                        {imgCount > 0 ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<ImageIcon />}
                            onClick={() => handleOpenImages(row)}
                          >
                            {imgCount} foto{imgCount > 1 ? "s" : ""}
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            Sin fotos
                          </Typography>
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

      {/* Modal visor de evidencias */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          📸 Evidencias de Desviación — Serie: <b>{selectedSerial}</b> ({selectedImages.length})
        </DialogTitle>
        <DialogContent dividers>
          {selectedImages.length === 0 ? (
            <Typography color="text.secondary">No hay imágenes disponibles para este registro.</Typography>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 2,
                p: 1,
              }}
            >
              {selectedImages.map((url, idx) => (
                <Box
                  key={idx}
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: "block",
                    borderRadius: 1,
                    overflow: "hidden",
                    border: "1px solid #ddd",
                    transition: "transform 0.2s",
                    "&:hover": { transform: "scale(1.02)", boxShadow: 3 },
                  }}
                >
                  <img
                    src={url}
                    alt={`Evidencia ${idx + 1}`}
                    style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
                  />
                  <Typography variant="caption" sx={{ display: "block", p: 0.5, textAlign: "center", bgcolor: "#fafafa" }}>
                    Foto {idx + 1} (Clic para abrir original)
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
