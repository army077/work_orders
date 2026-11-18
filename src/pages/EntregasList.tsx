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
  Tooltip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import GestureIcon from "@mui/icons-material/Gesture";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";

export interface DeliveryEvidence {
  id: number;
  evidence_type: "PHOTO" | "SIGNATURE";
  external_url: string | null;
  original_filename: string | null;
  mime_type: string | null;
  status: string;
}

export interface EntregaItem {
  id: number;
  client_request_id: string;
  pedido: string;
  equipos: string;
  chofer: string;
  observaciones: string | null;
  instalara: string | null;
  latitude: number | null;
  longitude: number | null;
  app_version: string | null;
  status: "PENDING_EVIDENCE" | "COMPLETED" | "FAILED" | string;
  auth_email: string | null;
  auth_display_name: string | null;
  created_at: string;
  completed_at: string | null;
  completion_latitude: number | null;
  completion_longitude: number | null;
  evidencias: DeliveryEvidence[];
}

export default function EntregasList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEntrega, setSelectedEntrega] = useState<EntregaItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, refetch, isFetching } = useList<EntregaItem>({
    resource: "entregas",
    pagination: { pageSize: 100 },
  });

  const entregas = data?.data ?? [];

  const filtered = entregas.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      (item.pedido && item.pedido.toLowerCase().includes(q)) ||
      (item.equipos && item.equipos.toLowerCase().includes(q)) ||
      (item.chofer && item.chofer.toLowerCase().includes(q)) ||
      (item.instalara && item.instalara.toLowerCase().includes(q)) ||
      (item.auth_display_name && item.auth_display_name.toLowerCase().includes(q)) ||
      (item.auth_email && item.auth_email.toLowerCase().includes(q))
    );
  });

  const handleOpenEvidencias = (item: EntregaItem) => {
    setSelectedEntrega(item);
    setModalOpen(true);
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Chip label="Completada" color="success" size="small" />;
      case "PENDING_EVIDENCE":
        return <Chip label="Pendiente Evidencia" color="warning" size="small" />;
      case "FAILED":
        return <Chip label="Fallida" color="error" size="small" />;
      default:
        return <Chip label={status} size="small" />;
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: "1600px", margin: "0 auto" }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: "bold", color: "#F5F1ED" }}>
            Firma y Entregas de Logística
          </Typography>
          <Typography variant="body2" sx={{ color: "#8E8279", mt: 0.5 }}>
            Registros de entrega de máquinas a clientes con firma digital y evidencias.
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          <TextField
            size="small"
            placeholder="Buscar por pedido, chofer o equipo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: "#8E8279", mr: 1 }} />,
            }}
            sx={{
              width: "320px",
              "& .MuiOutlinedInput-root": {
                backgroundColor: "#1F1B19",
                borderRadius: "8px",
              },
            }}
          />
          <Tooltip title="Actualizar lista">
            <IconButton
              onClick={() => refetch()}
              disabled={isFetching}
              sx={{
                backgroundColor: "#1F1B19",
                color: "#E63946",
                "&:hover": { backgroundColor: "#2D2623" },
              }}
            >
              {isFetching ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Tabla */}
      <TableContainer
        component={Paper}
        sx={{
          backgroundColor: "#14110F",
          borderRadius: "12px",
          border: "1px solid #2D2623",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          overflowX: "auto",
        }}
      >
        <Table sx={{ minWidth: 900 }}>
          <TableHead sx={{ backgroundColor: "#1F1B19" }}>
            <TableRow>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>ID</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>Pedido</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>Equipos Entregados</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>Chofer / Operador</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>¿Quién Instalará?</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>Estado</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>Ubicación</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold" }}>Fecha Entrega</TableCell>
              <TableCell sx={{ color: "#A89F91", fontWeight: "bold", textAlign: "center" }}>
                Evidencias
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                  <CircularProgress color="error" />
                  <Typography variant="body2" sx={{ color: "#8E8279", mt: 2 }}>
                    Cargando entregas...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                  <Typography variant="body1" sx={{ color: "#8E8279" }}>
                    No se encontraron registros de entrega.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const totalEvidencias = item.evidencias ? item.evidencias.length : 0;
                const hasSignature = item.evidencias?.some((e) => e.evidence_type === "SIGNATURE");

                return (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{
                      "&:hover": { backgroundColor: "#1C1816" },
                      borderBottom: "1px solid #241F1C",
                    }}
                  >
                    <TableCell sx={{ color: "#F5F1ED", fontWeight: "bold" }}>#{item.id}</TableCell>
                    <TableCell>
                      <Chip
                        label={item.pedido}
                        size="small"
                        sx={{
                          backgroundColor: "rgba(230, 57, 70, 0.15)",
                          color: "#E63946",
                          fontWeight: "bold",
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: "#F5F1ED", maxWidth: 220 }}>
                      <Typography variant="body2" noWrap title={item.equipos}>
                        {item.equipos}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: "#F5F1ED" }}>
                      <Typography variant="body2" sx={{ fontWeight: "500" }}>
                        {item.chofer}
                      </Typography>
                      {item.auth_email && (
                        <Typography variant="caption" sx={{ color: "#8E8279", display: "block" }}>
                          {item.auth_email}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: "#A89F91" }}>
                      {item.instalara || "No especificado"}
                    </TableCell>
                    <TableCell>{getStatusChip(item.status)}</TableCell>
                    <TableCell sx={{ color: "#A89F91" }}>
                      {item.latitude && item.longitude ? (
                        <Tooltip title={`Lat: ${item.latitude}, Long: ${item.longitude}`}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <LocationOnIcon fontSize="small" color="primary" />
                            <Typography variant="caption">
                              {Number(item.latitude).toFixed(4)}, {Number(item.longitude).toFixed(4)}
                            </Typography>
                          </Box>
                        </Tooltip>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell sx={{ color: "#A89F91", whiteSpace: "nowrap" }}>
                      {new Date(item.created_at).toLocaleString("es-MX", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell align="center">
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => handleOpenEvidencias(item)}
                        sx={{
                          color: "#E63946",
                          borderColor: "rgba(230, 57, 70, 0.5)",
                          "&:hover": {
                            borderColor: "#E63946",
                            backgroundColor: "rgba(230, 57, 70, 0.08)",
                          },
                          textTransform: "none",
                        }}
                      >
                        Ver ({totalEvidencias})
                        {hasSignature && (
                          <GestureIcon sx={{ ml: 0.5, fontSize: "16px", color: "#4CAF50" }} />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Modal de Evidencias y Firmas */}
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: "#1F1B19",
            color: "#F5F1ED",
            borderRadius: "12px",
            border: "1px solid #3A322D",
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: "1px solid #2D2623", pb: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: "bold" }}>
                Evidencias de Entrega - Pedido #{selectedEntrega?.pedido}
              </Typography>
              <Typography variant="caption" sx={{ color: "#8E8279" }}>
                Chofer: {selectedEntrega?.chofer} | Equipo: {selectedEntrega?.equipos}
              </Typography>
            </Box>
            {selectedEntrega && getStatusChip(selectedEntrega.status)}
          </Box>
        </DialogTitle>

        <DialogContent sx={{ mt: 2 }}>
          {selectedEntrega?.observaciones && (
            <Box
              sx={{
                mb: 3,
                p: 2,
                backgroundColor: "#14110F",
                borderRadius: "8px",
                border: "1px solid #2D2623",
              }}
            >
              <Typography variant="caption" sx={{ color: "#8E8279", fontWeight: "bold", display: "block" }}>
                OBSERVACIONES:
              </Typography>
              <Typography variant="body2" sx={{ color: "#F5F1ED", mt: 0.5 }}>
                {selectedEntrega.observaciones}
              </Typography>
            </Box>
          )}

          {(!selectedEntrega?.evidencias || selectedEntrega.evidencias.length === 0) ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body1" sx={{ color: "#8E8279" }}>
                No hay evidencias fotográficas ni firma registradas para esta entrega.
              </Typography>
            </Box>
          ) : (
            <Box>
              {/* Sección de Firma */}
              {selectedEntrega.evidencias.filter((e) => e.evidence_type === "SIGNATURE").length > 0 && (
                <Box sx={{ mb: 4 }}>
                  <Typography
                    variant="subtitle1"
                    sx={{ color: "#F5F1ED", fontWeight: "bold", display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}
                  >
                    <GestureIcon color="success" /> Firma de Conformidad
                  </Typography>
                  <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    {selectedEntrega.evidencias
                      .filter((e) => e.evidence_type === "SIGNATURE")
                      .map((sig) => (
                        <Box
                          key={sig.id}
                          sx={{
                            backgroundColor: "#FFFFFF",
                            p: 2,
                            borderRadius: "8px",
                            border: "2px solid #2D2623",
                            maxWidth: "350px",
                          }}
                        >
                          {sig.external_url ? (
                            <img
                              src={sig.external_url}
                              alt="Firma de entrega"
                              style={{ width: "100%", maxHeight: "160px", objectFit: "contain" }}
                            />
                          ) : (
                            <Typography variant="caption" sx={{ color: "#000" }}>
                              Firma registrada (sin URL pública de Drive)
                            </Typography>
                          )}
                        </Box>
                      ))}
                  </Box>
                </Box>
              )}

              {/* Sección de Fotografías */}
              {selectedEntrega.evidencias.filter((e) => e.evidence_type === "PHOTO").length > 0 && (
                <Box>
                  <Typography
                    variant="subtitle1"
                    sx={{ color: "#F5F1ED", fontWeight: "bold", display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}
                  >
                    <PhotoCameraIcon sx={{ color: "#E63946" }} /> Fotografías de Evidencia (
                    {selectedEntrega.evidencias.filter((e) => e.evidence_type === "PHOTO").length})
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: 2,
                    }}
                  >
                    {selectedEntrega.evidencias
                      .filter((e) => e.evidence_type === "PHOTO")
                      .map((photo) => (
                        <Box
                          key={photo.id}
                          sx={{
                            backgroundColor: "#14110F",
                            borderRadius: "8px",
                            overflow: "hidden",
                            border: "1px solid #2D2623",
                          }}
                        >
                          {photo.external_url ? (
                            <a href={photo.external_url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={photo.external_url}
                                alt={photo.original_filename || "Evidencia"}
                                style={{
                                  width: "100%",
                                  height: "160px",
                                  objectFit: "cover",
                                  display: "block",
                                  cursor: "pointer",
                                }}
                              />
                            </a>
                          ) : (
                            <Box sx={{ p: 2, textAlign: "center" }}>
                              <Typography variant="caption" sx={{ color: "#8E8279" }}>
                                {photo.original_filename || "Foto sin enlace"}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ borderTop: "1px solid #2D2623", p: 2 }}>
          <Button onClick={() => setModalOpen(false)} sx={{ color: "#F5F1ED" }}>
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
