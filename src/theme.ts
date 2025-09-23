// theme.ts
import { createTheme } from "@mui/material/styles";

export const asiaRoboticaTheme = createTheme({
  palette: {
    primary: {
      main: "#8B0000", // rojo Asia Robótica
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#1A1A1A", // negro
    },
    background: {
      default: "#FFFFFF",
      paper: "#F5F5F5",
    },
    text: {
      primary: "#1A1A1A",
      secondary: "#333333",
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "#8B0000",
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: "#F5F5F5",
        },
      },
    },
  },
  typography: {
    fontFamily: "Roboto, sans-serif",
  },
});