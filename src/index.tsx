import React from "react";
import ReactDOM from "react-dom/client";
import { Refine } from "@refinedev/core";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { dataProvider } from "./dataProvider";
import "./style.css";

import SectionsBuilder from "./pages/SectionsBuilder";
import TemplateTasksBuilder from "./pages/TemplateTasksBuilder";
import CreateWorkOrderFromTemplate from "./pages/CreateWorkOrderFromTemplate";
import WorkOrderRun from "./pages/WorkOrderRun";
import Templates from "./pages/Templates";
import Families from "./pages/Families";
import Models from "./pages/Models";
import WorkOrdersList from "./pages/WorkOrdersList";

function App() {
  return (
    <Refine
      dataProvider={dataProvider}
      resources={[
        { name: "machine-families" },
        { name: "machine-models" },
        { name: "templates" },
        { name: "sections" },
        { name: "tasks" },
        { name: "work-orders" },
      ]}
    >
      <BrowserRouter>
        <div className="layout responsive">
          {/* Sidebar (solo desktop/tablet) */}
          <aside className="sidebar nav-desktop">
            <div style={{ padding: 10 }}>
              <img src="/logo_asiarob.jpg" alt="Asia Robótica" style={{ height: 50, borderRadius: 2 }} />
            </div>
            <nav className="nav">
              <Link to="/families">Machine Families</Link>
              <Link to="/models">Machine Models</Link>
              <Link to="/templates">Templates</Link>
              <Link to="/sections-builder">Sections Builder</Link>
              <Link to="/tasks-builder">Template Tasks Builder</Link>
              <Link to="/create-work-order">Create Work Order</Link>
              <Link to="/work-orders">Work Orders</Link>
              <Link to="/run-work-order/1">Run Work Order</Link>
            </nav>
          </aside>

          {/* Topbar (solo móvil) */}
          <header className="topbar nav-mobile">
            <div className="brand">
              <img src="/logo_asiarob.jpg" alt="Asia Robótica" style={{ height: 36, borderRadius: 2 }} />
            </div>
            <nav className="nav-horizontal">
              <Link to="/families">Families</Link>
              <Link to="/models">Models</Link>
              <Link to="/templates">Templates</Link>
              <Link to="/sections-builder">Sections</Link>
              <Link to="/tasks-builder">Tasks</Link>
              <Link to="/create-work-order">Create WO</Link>
              <Link to="/work-orders">Work Orders</Link>
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
              <Route path="/work-orders" element={<WorkOrdersList />} />
              <Route path="/run-work-order/:id" element={<WorkOrderRun />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </Refine>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);