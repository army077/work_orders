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
  InputAdornment,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ImageIcon from "@mui/icons-material/Image";
import RefreshIcon from "@mui/icons-material/Refresh";
import "./incoming-list.css";

export interface IncomingInspection {
  id: number;
  correo: string | null;
  usuario: string | null;
  num_serie: string;
  proveedor: string | null;
  stl: string | null;
  equipo: string | null;
  descripcion: string | null;
  clasificacion_defecto: string | null;
  evidencias: string[] | string | null;
  created_at: string;
}

export default function IncomingList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState("");

  const { data, isLoading, refetch, isFetching, error } = useList<IncomingInspection>({
    resource: "incoming",
    pagination: { pageSize: 100 },
  });

  const incomings = data?.data ?? [];

  const filteredIncomings = incomings.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      (item.num_serie && item.num_serie.toLowerCase().includes(q)) ||
      (item.equipo && item.equipo.toLowerCase().includes(q)) ||
      (item.proveedor && item.proveedor.toLowerCase().includes(q)) ||
      (item.usuario && item.usuario.toLowerCase().includes(q)) ||
      (item.clasificacion_defecto && item.clasificacion_defecto.toLowerCase().includes(q))
    );
  });

  const handleOpenImages = (item: IncomingInspection) => {
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
    <Box className="incoming-list">
      <Box component="header" className="incoming-list__header">
        <Box className="incoming-list__identity">
          <Typography className="incoming-list__eyebrow" variant="overline">
            Calidad
          </Typography>
          <Typography component="h1" className="incoming-list__title">
            Registro de Incomings
          </Typography>
          <Typography className="incoming-list__intro" variant="body2">
            Inspecciones de recepción y sus evidencias.
          </Typography>
        </Box>
        <Button className="incoming-list__refresh" onClick={() => refetch()} disabled={isLoading || isFetching}
          color="primary" variant="outlined"
          startIcon={isFetching ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}>
          Actualizar
        </Button>
      </Box>

      <Box className="incoming-list__toolbar">
        <TextField
          className="incoming-list__search"
          size="small"
          label="Buscar registros"
          placeholder="Escribe para buscar…"
          helperText="Serie, equipo, proveedor, usuario o clasificación."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: "text.secondary" }} /></InputAdornment>,
          }}
        />
        <Typography className="incoming-list__count" variant="body2" role="status">
          {isLoading ? "Consultando registros…" : error ? "Consulta no disponible" : `${filteredIncomings.length} de ${incomings.length} registros`}
        </Typography>
      </Box>

      {error && (
        <Alert className="incoming-list__error" severity="error">
          <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>No se pudo consultar Incoming. </Typography>
          {incomings.length > 0 ? "Se muestran los datos de la última consulta disponible. " : "No se puede confirmar si hay registros. "}
          Usa Actualizar para reintentar.
        </Alert>
      )}

      {isLoading ? (
        <Box className="incoming-list__loading" role="status">
          <CircularProgress size={28} aria-label="Cargando registros de incoming" sx={{ color: "#FF6B77" }} />
          <Typography variant="body2" color="text.secondary">Cargando registros de incoming…</Typography>
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={0} tabIndex={0} role="region"
          className="incoming-list__table-container"
          aria-label="Registros de incoming: tabla desplazable" aria-describedby="incoming-table-hint">
          <Table className="incoming-list__table" size="small" aria-label="Registro de Incomings">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 56 }}>ID</TableCell>
                <TableCell sx={{ width: 168 }}>Fecha</TableCell>
                <TableCell sx={{ width: 128 }}>No. Serie</TableCell>
                <TableCell sx={{ width: 144 }}>Equipo</TableCell>
                <TableCell sx={{ width: 120 }}>Proveedor</TableCell>
                <TableCell sx={{ width: 88 }}>STL</TableCell>
                <TableCell sx={{ width: 152 }}>Clasificación de Defecto</TableCell>
                <TableCell sx={{ width: 128 }}>Usuario</TableCell>
                <TableCell sx={{ width: 240 }}>Descripción</TableCell>
                <TableCell align="center" sx={{ width: 128 }}>Evidencias</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredIncomings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} sx={{ color: "text.secondary" }}>
                    <Box sx={{ position: "sticky", left: 16, maxWidth: { xs: 240, sm: 480 }, py: 3 }}>
                      {error ? "No hay datos disponibles mientras la consulta falla." : incomings.length === 0
                        ? "Aún no hay registros de incoming."
                        : "No hay coincidencias. Prueba con otro término de búsqueda."}
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredIncomings.map((row) => {
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
                      <TableCell sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary", whiteSpace: "nowrap" }}>#{row.id}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatDate(row.created_at)}</TableCell>
                      <TableCell sx={{ "& .MuiChip-root": { color: "text.primary", borderColor: "#4A4441", borderRadius: "6px", fontWeight: 600 } }}>
                        <Chip label={row.num_serie} color="primary" variant="outlined" size="small" />
                      </TableCell>
                      <TableCell>{row.equipo ?? "—"}</TableCell>
                      <TableCell>{row.proveedor ?? "—"}</TableCell>
                      <TableCell>{row.stl ?? "—"}</TableCell>
                      <TableCell>
                        {row.clasificacion_defecto ? (
                          <Chip
                            label={row.clasificacion_defecto}
                            color={row.clasificacion_defecto.toLowerCase().includes("dañ") ? "error" : "warning"}
                            size="small"
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{row.usuario ?? row.correo ?? "—"}</TableCell>
                      <TableCell sx={{ whiteSpace: "normal", color: "text.secondary" }}>
                        {row.descripcion || "—"}
                      </TableCell>
                      <TableCell align="center">
                        {imgCount > 0 ? (
                          <Button
                            className="incoming-list__evidence-button"
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

      <Typography id="incoming-table-hint" className="incoming-list__table-hint" variant="caption">
        Desplaza la tabla horizontalmente para consultar todos los datos cuando no quepan en pantalla.
      </Typography>

      {/* Modal visor de evidencias */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="md" fullWidth
        aria-labelledby="incoming-evidence-title" aria-describedby="incoming-evidence-description"
        PaperProps={{ className: "incoming-evidence-dialog", sx: {
          m: { xs: 2, sm: 4 }, width: { xs: "calc(100% - 32px)", sm: "calc(100% - 64px)" },
          maxHeight: { xs: "calc(100dvh - 32px)", sm: "calc(100dvh - 64px)" },
          minWidth: 0, borderRadius: "16px", bgcolor: "background.paper", color: "text.primary",
          "& .MuiButtonBase-root:focus-visible, & a:focus-visible": { outline: "2px solid #F2A65A", outlineOffset: 3 },
          "@media (prefers-reduced-motion: reduce)": { "& *": { transition: "none" } },
        } }}>
        <DialogTitle component="div" className="incoming-evidence-dialog__title">
          <Typography id="incoming-evidence-title" component="h2" variant="h6" className="incoming-evidence-dialog__heading">
            Evidencias de Incoming
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, mt: 0.75 }}>
            <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere", minWidth: 0 }}>
              Serie: <b style={{ color: "#F5F1ED" }}>{selectedSerial}</b>
            </Typography>
            <Chip size="small" label={`${selectedImages.length} foto${selectedImages.length === 1 ? "" : "s"}`}
              sx={{ borderRadius: "6px", bgcolor: "#2A2522", color: "text.secondary" }} />
          </Box>
          <Typography id="incoming-evidence-description" variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Selecciona una fotografía para abrir su enlace original.
          </Typography>
        </DialogTitle>
        <DialogContent className="incoming-evidence-dialog__content" dividers sx={{ minWidth: 0 }}>
          {selectedImages.length === 0 ? (
            <Typography color="text.secondary">No hay imágenes disponibles para este registro.</Typography>
          ) : (
            <Box className="incoming-evidence-dialog__grid">
              {selectedImages.map((url, idx) => (
                <Box
                  key={idx}
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="incoming-evidence-dialog__photo"
                >
                  <img
                    src={url}
                    alt={`Evidencia ${idx + 1}`}
                    style={{ width: "100%", height: 220, objectFit: "contain", display: "block" }}
                  />
                  <Typography variant="caption" className="incoming-evidence-dialog__caption">
                    Foto {idx + 1} (Clic para abrir original)
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions className="incoming-evidence-dialog__actions">
          <Button className="incoming-evidence-dialog__close" onClick={() => setModalOpen(false)} variant="outlined">Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
