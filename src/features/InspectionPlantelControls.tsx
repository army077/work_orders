import { Alert, Box, Button, InputAdornment, MenuItem, TextField, Typography } from "@mui/material";
import { MdSearch as SearchIcon, MdRefresh as RefreshIcon } from "react-icons/md";
import {
    INSPECTION_STATUSES, SEARCH_SCOPES, STATUS_LABELS, productionOrderId, requesterLabel, cancellationProposalReady,
    RELEASE_FILTERS, RELEASE_LABELS, productionReleaseState,
} from "./inspectionPlantel";
import type { CancellationConfirmation, InspectionOrder, InspectionStatus, SearchScope, ReleaseFilter, ReleaseCode, ProductionReleases } from "./inspectionPlantel";

type ControlsProps = {
    search: string;
    scope: SearchScope;
    status: InspectionStatus | "";
    release: ReleaseFilter;
    refreshing: boolean;
    onSearch: (value: string) => void;
    onScope: (value: SearchScope) => void;
    onStatus: (value: InspectionStatus | "") => void;
    onRelease: (value: ReleaseFilter) => void;
    onRefresh: () => void;
};

export function InspectionPlantelControls(props: ControlsProps) {
    return <Box className="inspection-controls">
        <Box className="inspection-controls__main">
            <TextField className="inspection-controls__search" size="small" label="Buscar inspecciones" InputLabelProps={{ shrink: true }} value={props.search} onChange={event => props.onSearch(event.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon size={18} aria-hidden="true" /></InputAdornment> }}
                inputProps={{ "aria-describedby": "inspection-search-help" }} />
            <Box className="inspection-controls__actions">
                <Button className="inspection-controls__clear" onClick={() => props.onSearch("")} disabled={!props.search}>Limpiar búsqueda</Button>
                <Button className="inspection-controls__refresh" variant="outlined" startIcon={<RefreshIcon size={18} aria-hidden="true" />} disabled={props.refreshing} onClick={props.onRefresh}>
                    {props.refreshing ? "Actualizando…" : "Actualizar inspecciones"}
                </Button>
            </Box>
        </Box>
        <Box className="inspection-controls__filters">
            <TextField className="inspection-controls__scope" size="small" select label="Buscar por" InputLabelProps={{ shrink: true }} SelectProps={{ autoWidth: true, MenuProps: { PaperProps: { className: "inspection-filter-menu" } } }} value={props.scope} onChange={event => props.onScope(event.target.value as SearchScope)}>
                {SEARCH_SCOPES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </TextField>
            <TextField className="inspection-controls__release" size="small" select label="Liberación actual de Producción" InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true, autoWidth: true, MenuProps: { PaperProps: { className: "inspection-filter-menu" } } }} value={props.release}
                onChange={event => props.onRelease(event.target.value as ReleaseFilter)} inputProps={{ "aria-describedby": "inspection-release-help" }}>
                {RELEASE_FILTERS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </TextField>
            <TextField className="inspection-controls__status" size="small" select label="Estado de inspección" InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true, autoWidth: true, MenuProps: { PaperProps: { className: "inspection-filter-menu" } } }} value={props.status}
                onChange={event => props.onStatus(event.target.value as InspectionStatus | "")}>
                <MenuItem value="">Todas</MenuItem>
                {INSPECTION_STATUSES.map(status => <MenuItem key={status} value={status}>{STATUS_LABELS[status]}</MenuItem>)}
            </TextField>
        </Box>
        <Box className="inspection-controls__notes">
            <Typography id="inspection-search-help">IDs exactos; folio SAI, cliente, serie, inspector o título por texto.</Typography>
            <Typography id="inspection-release-help">LIB001: ensamble. LIB002: pintura. Estado de la orden de producción.</Typography>
        </Box>
    </Box>;
}

/** Registered requester presentation is ready; current API10 adapter passes none. */
export function InspectionPeople({ order, registeredRequesterEmail }: {
    order: InspectionOrder; registeredRequesterEmail?: string | null;
}) {
    return <Box>
        <Typography variant="body2">Solicitante: <strong>{requesterLabel(registeredRequesterEmail)}</strong></Typography>
        <Typography variant="body2">Operador de Producción: <strong>{order.operador_produccion?.trim() || "Sin asignar"}</strong></Typography>
        <Typography variant="body2">Inspector asignado: <strong>{order.assigned_tech_email?.trim() || "Sin asignar"}</strong></Typography>
    </Box>;
}

export function InspectionIdentity({ order }: { order: InspectionOrder }) {
    return <Box>
        <Typography variant="body2">ID de inspección: <strong>{order.inspection_order_id}</strong></Typography>
        <Typography variant="body2">Orden de producción: <strong>{productionOrderId(order) ?? "No registrada"}</strong></Typography>
        {order.folio_sai && <Typography variant="body2">Folio SAI de producción: <strong>{order.folio_sai}</strong></Typography>}
    </Box>;
}

export function InspectionReleaseSummary({ order, releases, code }: { order: InspectionOrder; releases: ProductionReleases; code: ReleaseCode }) {
    const state = productionReleaseState(order, releases, code);
    return <Typography variant="body2">Liberación actual de Producción · {code}: <strong>{state ? RELEASE_LABELS[state] : "Sin información verificable"}</strong></Typography>;
}

export function InspectionListFeedback({ loading, failed, total, matched, releaseFailed = false }: {
    loading: boolean; failed: boolean; total: number; matched: number; releaseFailed?: boolean;
}) {
    if (loading) return <Typography role="status" sx={{ color: "#e6e9ef" }}>Cargando inspecciones…</Typography>;
    if (failed) return <Alert severity="error" sx={{ color: "#ffffff", backgroundColor: "#521b1b", border: "1px solid #ffb4ab", "& .MuiAlert-icon": { color: "#ffb4ab" } }}>{releaseFailed ? "No se pudieron consultar las liberaciones de Producción." : "No se pudieron actualizar las inspecciones."} Usa Actualizar inspecciones para reintentar.</Alert>;
    if (total === 0) return <Typography role="status" sx={{ color: "#e6e9ef" }}>No hay inspecciones registradas.</Typography>;
    if (matched === 0) return <Typography role="status" sx={{ color: "#e6e9ef" }}>No hay inspecciones que coincidan con la búsqueda y el estado.</Typography>;
    return <Typography sx={{ mb: 2, color: "#e6e9ef" }}>{matched} de {total} inspecciones</Typography>;
}

/** Reviewable proposal only: not mounted in Plantel and no HTTP handler provided. */
export function InspectionCancellationProposal({ confirmation }: { confirmation?: CancellationConfirmation }) {
    const ready = cancellationProposalReady(confirmation);
    return <Box>
        {ready ? <Button disabled>Cancelar inspección (propuesta sin conectar)</Button>
            : <Typography>Cancelación no disponible sin confirmar permiso, estado y efectos de liberación.</Typography>}
    </Box>;
}
