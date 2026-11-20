import ReactDOM from "react-dom/client";
import { Refine } from "@refinedev/core";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { asiaRoboticaTheme } from "./theme";
import { dataProvider } from "./dataProvider";
import "./style.css";
import ApplicationShell from "./layout/ApplicationShell";

import SectionsBuilder from "./pages/SectionsBuilder";
import TemplateTasksBuilder from "./pages/TemplateTasksBuilder";
import CreateWorkOrderFromTemplate from "./pages/CreateWorkOrderFromTemplate";
import Templates from "./pages/Templates";
import Families from "./pages/Families";
import Models from "./pages/Models";
import PlantelProduccion from "./pages/Plantel Producción";
import { PlantelInspeccion } from "./pages/Plantel Inspeccion";
import IncomingList from "./pages/IncomingList";
import LiberacionesList from "./pages/LiberacionesList";
import EmbarquesList from "./pages/EmbarquesList";
import LiberacionEmpaqueList from "./pages/LiberacionEmpaqueList";
import DesviacionesList from "./pages/DesviacionesList";
import MetricasInspeccion from "./pages/MetricasInspeccion";
import EntregasList from "./pages/EntregasList";

function App() {
  return (
    <ThemeProvider theme={asiaRoboticaTheme}>
      <CssBaseline />
      <Refine
      dataProvider={dataProvider}
      resources={[
        { name: "machine-families" },
        { name: "machine-models" },
        { name: "templates" },
        { name: "sections" },
        { name: "tasks" },
        { name: "work-orders" },
        { name: "incoming" },
        { name: "liberaciones" },
        { name: "embarques" },
        { name: "liberacion-empaque" },
        { name: "quality/desviaciones" },
        { name: "entregas" },
      ]}
    >
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ApplicationShell>
            <Routes>
              <Route path="/" element={<Navigate to="/templates" />} />
              <Route path="/families" element={<Families />} />
              <Route path="/models" element={<Models />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/sections-builder" element={<SectionsBuilder />} />
              <Route path="/tasks-builder" element={<TemplateTasksBuilder />} />
              <Route path="/create-work-order" element={<CreateWorkOrderFromTemplate />} />
              <Route path="/plantel-produccion" element={<PlantelProduccion />} />
              <Route path="/plantel-inspeccion" element={<PlantelInspeccion />} />
              <Route path="/incoming" element={<IncomingList />} />
              <Route path="/liberaciones" element={<LiberacionesList />} />
              <Route path="/embarques" element={<EmbarquesList />} />
              <Route path="/liberacion-empaque" element={<LiberacionEmpaqueList />} />
              <Route path="/desviaciones" element={<DesviacionesList />} />
              <Route path="/metricas-inspeccion" element={<MetricasInspeccion />} />
              <Route path="/entregas" element={<EntregasList />} />
            </Routes>
        </ApplicationShell>
      </BrowserRouter>
    </Refine>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
