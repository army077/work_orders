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
import "./embarques-list.css";

export interface PreEmbarqueItem {
  id: number;
  correo: string | null;
  usuario: string | null;
  num_serie: string;
  equipo: string | null;
  accesorio: string | null;
  num_pedido: string | null;
  cliente: string | null;
  num_serie_asignado: string | null;
  num_serie_modulo: string | null;
  descripcion: string | null;
  desviacion: string | null;
  evidencias: string[] | string | null;
  created_at: string;
}

export default function EmbarquesList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState("");

  const { data, isLoading, refetch, isFetching } = useList<PreEmbarqueItem>({
    resource: "embarques",
    pagination: { pageSize: 100 },
  });

  const embarques = data?.data ?? [];

  const filtered = embarques.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      (item.num_serie && item.num_serie.toLowerCase().includes(q)) ||
      (item.equipo && item.equipo.toLowerCase().includes(q)) ||
      (item.cliente && item.cliente.toLowerCase().includes(q)) ||
      (item.num_pedido && item.num_pedido.toLowerCase().includes(q)) ||
      (item.usuario && item.usuario.toLowerCase().includes(q)) ||
      (item.num_serie_asignado && item.num_serie_asignado.toLowerCase().includes(q))
    );
  });

  const handleOpenImages = (item: PreEmbarqueItem) => {
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
    <Box className="shipment-list">
      <Box component="header" className="shipment-list__header">
        <Box>
          <Typography className="shipment-list__eyebrow">Logística</Typography>
          <Typography component="h1" className="shipment-list__title">
            Pre-Embarques y Embarques
          </Typography>
          <Typography className="shipment-list__intro">
            Consulta los registros de embarque y sus evidencias.
          </Typography>
        </Box>
        <Tooltip title="Actualizar lista">
          <span>
            <IconButton aria-label="Actualizar lista" className="shipment-list__refresh" onClick={() => refetch()} disabled={isLoading || isFetching} color="primary">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box className="shipment-list__toolbar">
        <TextField
          className="shipment-list__search"
          size="small"
          label="Buscar registros"
          placeholder="Buscar por serie, equipo, cliente, pedido o usuario..."
          helperText="Serie, equipo, cliente, pedido, usuario o serie asignada."
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
        <TableContainer component={Paper} elevation={0} className="shipment-list__table-container" tabIndex={0} aria-label="Tabla de pre-embarques y embarques">
          <Table size="small" className="shipment-list__table">
            <TableHead>
              <TableRow>
                <TableCell><b>ID</b></TableCell>
                <TableCell><b>Fecha</b></TableCell>
                <TableCell><b>No. Serie</b></TableCell>
                <TableCell><b>Equipo</b></TableCell>
                <TableCell><b>Cliente</b></TableCell>
                <TableCell><b>Pedido</b></TableCell>
                <TableCell><b>Serie Asignado</b></TableCell>
                <TableCell><b>Módulo</b></TableCell>
                <TableCell><b>Desviación</b></TableCell>
                <TableCell><b>Usuario</b></TableCell>
                <TableCell><b>Descripción</b></TableCell>
                <TableCell align="center"><b>Evidencias</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 3, color: "text.secondary" }}>
                    No se encontraron registros de pre-embarque.
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

                  const tieneDesviacion = row.desviacion && row.desviacion.toLowerCase() === "si";

                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>#{row.id}</TableCell>
                      <TableCell>{formatDate(row.created_at)}</TableCell>
                      <TableCell>
                        <Chip label={row.num_serie} color="primary" variant="outlined" size="small" />
                      </TableCell>
                      <TableCell>{row.equipo ?? "—"}</TableCell>
                      <TableCell>{row.cliente ?? "—"}</TableCell>
                      <TableCell>{row.num_pedido ?? "—"}</TableCell>
                      <TableCell>{row.num_serie_asignado ?? "—"}</TableCell>
                      <TableCell>{row.num_serie_modulo ?? "—"}</TableCell>
                      <TableCell>
                        {tieneDesviacion ? (
                          <Chip label="Sí" color="warning" size="small" />
                        ) : (
                          <Chip label="No" color="success" size="small" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell>{row.usuario ?? row.correo ?? "—"}</TableCell>
                      <TableCell>
                        {row.descripcion || "—"}
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
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="md" fullWidth PaperProps={{ className: "shipment-evidence-dialog" }}>
        <DialogTitle>
          Evidencias de Pre-Embarque — Serie: <b>{selectedSerial}</b> ({selectedImages.length})
        </DialogTitle>
        <DialogContent dividers>
          {selectedImages.length === 0 ? (
            <Typography color="text.secondary">No hay imágenes disponibles para este registro.</Typography>
          ) : (
            <Box className="shipment-evidence-dialog__grid">
              {selectedImages.map((url, idx) => (
                <Box
                  key={idx}
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shipment-evidence-dialog__photo"
                >
                  <img
                    src={url}
                    alt={`Evidencia ${idx + 1}`}
                  />
                  <Typography variant="caption" className="shipment-evidence-dialog__caption">
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
