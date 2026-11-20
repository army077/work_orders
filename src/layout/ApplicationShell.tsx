import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Drawer, IconButton, useMediaQuery } from "@mui/material";
import { NavLink, useLocation } from "react-router-dom";
import PrecisionManufacturingOutlined from "@mui/icons-material/PrecisionManufacturingOutlined";
import AddCircleOutline from "@mui/icons-material/AddCircleOutline";
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined";
import MoveToInboxOutlined from "@mui/icons-material/MoveToInboxOutlined";
import ReportProblemOutlined from "@mui/icons-material/ReportProblemOutlined";
import VerifiedOutlined from "@mui/icons-material/VerifiedOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import QueryStatsOutlined from "@mui/icons-material/QueryStatsOutlined";
import LocalShippingOutlined from "@mui/icons-material/LocalShippingOutlined";
import DrawOutlined from "@mui/icons-material/DrawOutlined";
import CategoryOutlined from "@mui/icons-material/CategoryOutlined";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import ViewAgendaOutlined from "@mui/icons-material/ViewAgendaOutlined";
import ChecklistOutlined from "@mui/icons-material/ChecklistOutlined";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import "./application-shell.css";

const navigationGroups = [
  { id: "operation", label: "Operación", items: [
    { path: "/plantel-produccion", label: "Panel de Producción", icon: PrecisionManufacturingOutlined },
    { path: "/create-work-order", label: "Crear orden de trabajo", icon: AddCircleOutline },
  ] },
  { id: "quality", label: "Calidad", items: [
    { path: "/plantel-inspeccion", label: "Panel de Inspección", icon: FactCheckOutlined },
    { path: "/incoming", label: "Incoming", icon: MoveToInboxOutlined },
    { path: "/desviaciones", label: "Desviaciones", icon: ReportProblemOutlined },
    { path: "/liberaciones", label: "Procesos de Liberación", icon: VerifiedOutlined },
    { path: "/liberacion-empaque", label: "Liberación de Empaque", icon: Inventory2Outlined },
    { path: "/metricas-inspeccion", label: "Tiempos de Inspección", icon: QueryStatsOutlined },
  ] },
  { id: "logistics", label: "Logística", items: [
    { path: "/embarques", label: "Pre-Embarques", icon: LocalShippingOutlined },
    { path: "/entregas", label: "Entregas y Firmas", icon: DrawOutlined },
  ] },
  { id: "engineering", label: "Ingeniería y catálogos", items: [
    { path: "/families", label: "Familias", icon: CategoryOutlined },
    { path: "/models", label: "Modelos", icon: MemoryOutlined },
    { path: "/templates", label: "Plantillas", icon: DescriptionOutlined },
    { path: "/sections-builder", label: "Constructor de secciones", icon: ViewAgendaOutlined },
    { path: "/tasks-builder", label: "Constructor de tareas", icon: ChecklistOutlined },
  ] },
];

function Brand() {
  return <div className="wo-shell__brand">
    <img src={`${import.meta.env.BASE_URL}AR LOGO.png`} alt="Asia Robótica" />
    <span>Work Orders</span>
  </div>;
}

function Navigation({ id, onNavigate }: { id: string; onNavigate?: () => void }) {
  return <nav className="wo-shell__navigation" aria-label="Áreas de Work Orders">
    {navigationGroups.map(group => <section className="wo-shell__group" key={group.id} aria-labelledby={`${id}-${group.id}`}>
      <h2 id={`${id}-${group.id}`}>{group.label}</h2>
      {group.items.map(({ path, label, icon: Icon }) => <NavLink
        key={path} to={path} end
        className="wo-shell__link"
        onClick={event => {
          if (!event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) onNavigate?.();
        }}
      >
        <Icon aria-hidden="true" /><span>{label}</span>
      </NavLink>)}
    </section>)}
  </nav>;
}

export default function ApplicationShell({ children }: { children: ReactNode }) {
  const desktop = useMediaQuery("(min-width:1200px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const group = navigationGroups.find(entry => entry.items.some(item => item.path === path));
  const current = group?.items.find(item => item.path === path);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => { if (desktop) setMenuOpen(false); }, [desktop]);

  return <div className="wo-shell">
    <a className="wo-shell__skip" href="#work-orders-content">Ir al contenido</a>
    <aside className="wo-shell__sidebar" aria-label="Navegación de Work Orders">
      <Brand /><Navigation id="wo-desktop" />
    </aside>
    <div className="wo-shell__workspace">
      <header className="wo-shell__header">
        <IconButton ref={menuButton} className="wo-shell__menu-button" aria-label="Abrir navegación"
          aria-expanded={menuOpen && !desktop} aria-controls={menuOpen ? "wo-navigation-drawer" : undefined}
          aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
          <MenuOutlined />
        </IconButton>
        <img className="wo-shell__compact-logo" src={`${import.meta.env.BASE_URL}AR LOGO.png`} alt="Asia Robótica" />
        <div className="wo-shell__context" aria-label="Ubicación actual">
          <span className="wo-shell__context-area">{group?.label ?? "Work Orders"}</span>
          <span className="wo-shell__context-divider" aria-hidden="true">/</span>
          <span className="wo-shell__context-title">{current?.label ?? "Work Orders"}</span>
        </div>
      </header>
      <main id="work-orders-content" className="wo-shell__content" tabIndex={-1}>
        <div className="wo-shell__page">{children}</div>
      </main>
    </div>
    <Drawer className="wo-shell-drawer" variant="temporary" anchor="left"
      open={menuOpen && !desktop} onClose={() => setMenuOpen(false)}
      slotProps={{
        paper: { id: "wo-navigation-drawer", role: "dialog", "aria-modal": true, "aria-label": "Navegación de Work Orders" },
        transition: { onExited: () => { if (!desktop) menuButton.current?.focus(); } },
      }}>
      <div className="wo-shell__drawer-header"><span>Navegación</span>
        <IconButton aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)}><CloseOutlined /></IconButton>
      </div>
      <Brand /><Navigation id="wo-compact" onNavigate={() => setMenuOpen(false)} />
    </Drawer>
  </div>;
}
