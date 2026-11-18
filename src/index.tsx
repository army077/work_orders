import ReactDOM from "react-dom/client";
import { Refine } from "@refinedev/core";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { asiaRoboticaTheme } from "./theme";
import { dataProvider } from "./dataProvider";
import "./style.css";

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
        <div className="layout responsive">
          {/* Sidebar (solo desktop/tablet) */}
          <aside className="sidebar nav-desktop">
            <div style={{ padding: 10 }}>
              <img src={`${import.meta.env.BASE_URL}AR LOGO.png`} alt="Asia Robótica" style={{ height: 50, borderRadius: 2 }} />
            </div>
            <nav className="nav">
              <Link to="/families">Familia de Equipos</Link>
              <Link to="/models">Modelos de máquina</Link>
              <Link to="/templates">Crea tus Plantillas</Link>
              <Link to="/sections-builder">Constructor secciones</Link>
              <Link to="/tasks-builder">Constructor de tareas</Link>
              <Link to="/create-work-order">Crear orden de trabajo</Link>
              <Link to="/plantel-produccion">Panel de Producción</Link>
              <Link to="/plantel-inspeccion">Panel de Inspección</Link>
              <Link to="/incoming">Incomings (Calidad)</Link>
              <Link to="/liberaciones">Procesos de Liberación</Link>
              <Link to="/embarques">Pre-Embarques</Link>
              <Link to="/liberacion-empaque">Liberación de Empaque</Link>
              <Link to="/desviaciones">Desviaciones de Calidad</Link>
              <Link to="/metricas-inspeccion">Tiempos de Inspección</Link>
              <Link to="/entregas">Entregas y Firmas</Link>
            </nav>
          </aside>

          {/* Topbar (solo móvil) */}
          <header className="topbar nav-mobile">
            <div className="brand">
              <img src={`${import.meta.env.BASE_URL}AR LOGO.png`} alt="Asia Robótica" style={{ height: 36, borderRadius: 2 }} />
            </div>
            <nav className="nav-horizontal">
              <Link to="/families">Families</Link>
              <Link to="/models">Models</Link>
              <Link to="/templates">Templates</Link>
              <Link to="/sections-builder">Sections</Link>
              <Link to="/tasks-builder">Tasks</Link>
              <Link to="/create-work-order">Create WO</Link>
              <Link to="/plantel-produccion">Producción</Link>
              <Link to="/plantel-inspeccion">Inspección</Link>
              <Link to="/incoming">Incomings</Link>
              <Link to="/liberaciones">Liberaciones</Link>
              <Link to="/embarques">Embarques</Link>
              <Link to="/liberacion-empaque">Empaque</Link>
              <Link to="/desviaciones">Desviaciones</Link>
              <Link to="/metricas-inspeccion">Tiempos</Link>
              <Link to="/entregas">Entregas</Link>
            </nav>
          </header>

          <main className="content">
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
          </main>
        </div>
      </BrowserRouter>
    </Refine>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
