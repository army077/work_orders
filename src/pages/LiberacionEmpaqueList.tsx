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
import "./liberacion-empaque-list.css";

export interface LiberacionEmpaqueItem {
  id: number;
  correo: string | null;
  usuario: string | null;
  num_serie: string;
  equipo: string | null;
  accesorio: string | null;
  estacion: string | null;
  responsable: string | null;
  evidencias: string[] | string | null;
  created_at: string;
}

export default function LiberacionEmpaqueList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState("");

  const { data, isLoading, refetch, isFetching } = useList<LiberacionEmpaqueItem>({
    resource: "liberacion-empaque",
    pagination: { pageSize: 100 },
  });

  const empaques = data?.data ?? [];

  const filtered = empaques.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      (item.num_serie && item.num_serie.toLowerCase().includes(q)) ||
      (item.equipo && item.equipo.toLowerCase().includes(q)) ||
      (item.responsable && item.responsable.toLowerCase().includes(q)) ||
      (item.usuario && item.usuario.toLowerCase().includes(q)) ||
      (item.estacion && item.estacion.toLowerCase().includes(q))
    );
  });

  const handleOpenImages = (item: LiberacionEmpaqueItem) => {
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
    setSelectedSerial(item.num_serie);
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
    <Box className="packing-list">
      <Box component="header" className="packing-list__header">
        <Box>
          <Typography className="packing-list__eyebrow">Calidad</Typography>
          <Typography component="h1" className="packing-list__title">
            📦 Liberaciones de Empaque
          </Typography>
          <Typography className="packing-list__intro">
            Consulta las liberaciones de empaque y sus evidencias.
          </Typography>
        </Box>
        <Tooltip title="Actualizar lista">
          <span>
            <IconButton aria-label="Actualizar lista" className="packing-list__refresh" onClick={() => refetch()} disabled={isLoading || isFetching} color="primary">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box className="packing-list__toolbar">
        <TextField
          className="packing-list__search"
          size="small"
          label="Buscar registros"
          placeholder="Buscar por serie, equipo, responsable o estación..."
          helperText="Serie, equipo, responsable, usuario o estación."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
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
        <TableContainer component={Paper} elevation={0} className="packing-list__table-container" tabIndex={0} aria-label="Tabla de liberaciones de empaque">
          <Table size="small" className="packing-list__table">
            <TableHead>
              <TableRow>
                <TableCell><b>ID</b></TableCell>
                <TableCell><b>Fecha</b></TableCell>
                <TableCell><b>No. Serie</b></TableCell>
                <TableCell><b>Equipo</b></TableCell>
                <TableCell><b>Accesorio</b></TableCell>
                <TableCell><b>Estación</b></TableCell>
                <TableCell><b>Responsable</b></TableCell>
                <TableCell><b>Usuario</b></TableCell>
                <TableCell align="center"><b>Evidencias</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 3, color: "text.secondary" }}>
                    No se encontraron registros de liberación de empaque.
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
                        <Chip label={row.num_serie} color="primary" variant="outlined" size="small" />
                      </TableCell>
                      <TableCell>{row.equipo ?? "—"}</TableCell>
                      <TableCell>{row.accesorio ?? "—"}</TableCell>
                      <TableCell>{row.estacion ?? "—"}</TableCell>
                      <TableCell>{row.responsable ?? "—"}</TableCell>
                      <TableCell>{row.usuario ?? row.correo ?? "—"}</TableCell>
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
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="md" fullWidth PaperProps={{ className: "packing-evidence-dialog" }}>
        <DialogTitle>
          📸 Evidencias de Empaque — Serie: <b>{selectedSerial}</b> ({selectedImages.length})
        </DialogTitle>
        <DialogContent dividers>
          {selectedImages.length === 0 ? (
            <Typography color="text.secondary">No hay imágenes disponibles para este registro.</Typography>
          ) : (
            <Box className="packing-evidence-dialog__grid">
              {selectedImages.map((url, idx) => (
                <Box
                  key={idx}
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="packing-evidence-dialog__photo"
                >
                  <img
                    src={url}
                    alt={`Evidencia ${idx + 1}`}
                  />
                  <Typography variant="caption" className="packing-evidence-dialog__caption">
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
