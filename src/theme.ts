// src/theme.ts
import { createTheme } from "@mui/material/styles";

/**
 * Paleta oficial de Asia Robótica (espejo de app_theme.dart de Flutter):
 * - Primario: #E63946 (Rojo del Dragón AR)
 * - Primario Profundo: #5B1A1F (Badges / Estados hover)
 * - Secundario / Ámbar: #F2A65A
 * - Fondo Principal: #14110F
 * - Superficie: #1F1B19
 * - Contenedor: #2A2522
 * - Contenedor Alto: #34302D
 * - Bordes: #3A3633 / #4A4441
 * - Texto Principal: #F5F1ED
 * - Texto Secundario: #B8B0A9
 * - Éxito: #5BBF8A
 */
export const asiaRoboticaTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#E63946",
      dark: "#5B1A1F",
      light: "#FF6B77",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#F2A65A",
      dark: "#B97A3A",
      contrastText: "#1A1715",
    },
    success: {
      main: "#5BBF8A",
      contrastText: "#FFFFFF",
    },
    warning: {
      main: "#F2B04A",
      contrastText: "#1A1715",
    },
    error: {
      main: "#E63946",
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#14110F",
      paper: "#1F1B19",
    },
    text: {
      primary: "#F5F1ED",
      secondary: "#B8B0A9",
    },
    divider: "#3A3633",
  },
  typography: {
    fontFamily: [
      "Inter",
      "ui-sans-serif",
      "system-ui",
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      "Roboto",
      "sans-serif",
    ].join(","),
    h5: {
      fontWeight: 700,
      letterSpacing: "-0.01em",
    },
    h6: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 14,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#14110F",
          color: "#F5F1ED",
          scrollbarColor: "#3A3633 #14110F",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: "#1F1B19",
          backgroundImage: "none",
          border: "1px solid #3A3633",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 12,
        },
        containedPrimary: {
          backgroundColor: "#E63946",
          "&:hover": {
            backgroundColor: "#CF2E3B",
          },
        },
        outlinedPrimary: {
          borderColor: "#E63946",
          color: "#E63946",
          "&:hover": {
            borderColor: "#FF6B77",
            backgroundColor: "rgba(230, 57, 70, 0.08)",
          },
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: "#2A2522",
          "& .MuiTableCell-head": {
            color: "#F5F1ED",
            fontWeight: 700,
            borderBottom: "1px solid #3A3633",
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: "1px solid #2A2522",
          color: "#F5F1ED",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: "rgba(230, 57, 70, 0.04) !important",
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            backgroundColor: "#2A2522",
            borderRadius: 12,
            "& fieldset": {
              borderColor: "#3A3633",
            },
            "&:hover fieldset": {
              borderColor: "#4A4441",
            },
            "&.Mui-focused fieldset": {
              borderColor: "#E63946",
            },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: "#1F1B19",
          border: "1px solid #3A3633",
          borderRadius: 16,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 8,
        },
      },
    },
  },
});
