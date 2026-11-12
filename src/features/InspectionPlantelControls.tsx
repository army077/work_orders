import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";
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

// The page uses the existing dark CSS without a MUI dark theme. Keep these
// overrides local so other pages and the light popup menus retain their styles.
const controlsSx = {
    display: "flex", gap: 2, mb: 2, flexWrap: "wrap", alignItems: "center",
    "& .MuiOutlinedInput-root": {
        color: "#f3f4f6", backgroundColor: "#151821",
        "& fieldset": { borderColor: "#8993a5" },
        "&:hover fieldset": { borderColor: "#e6e9ef" },
        "&.Mui-focused fieldset": { borderColor: "#ffb4ab", borderWidth: 2 },
        "&.Mui-focused": { outline: "2px solid #ffb4ab", outlineOffset: 2 },
    },
    "& .MuiOutlinedInput-input": { color: "#f3f4f6", backgroundColor: "transparent", border: 0, marginBottom: 0 },
    "& .MuiInputLabel-root": { color: "#d5dae3", "&.Mui-focused": { color: "#ffffff" } },
    "& .MuiFormHelperText-root": { color: "#c8d0dd" },
    "& .MuiSelect-icon": { color: "#e6e9ef" },
    "& .MuiButton-root": {
        color: "#ffffff", backgroundColor: "#2a2a2a", border: "1px solid #a0a4ad",
        "&:hover": { backgroundColor: "#444444", borderColor: "#ffffff" },
        "&:focus-visible, &.Mui-focusVisible": { outline: "3px solid #ffb4ab", outlineOffset: 3 },
        "&.Mui-disabled": { color: "#b7bdc8", backgroundColor: "#20232a", borderColor: "#626b7a", opacity: 1 },
    },
} as const;

export function InspectionPlantelControls(props: ControlsProps) {
    return <Box sx={controlsSx}>
        <TextField select label="Buscar por" value={props.scope} onChange={event => props.onScope(event.target.value as SearchScope)} sx={{ minWidth: 210 }}>
            {SEARCH_SCOPES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </TextField>
        <TextField select label="Liberación actual de Producción" value={props.release}
            onChange={event => props.onRelease(event.target.value as ReleaseFilter)} sx={{ minWidth: 290 }}
            helperText="LIB001: ensamble. LIB002: pintura. Estado de la orden de producción.">
            {RELEASE_FILTERS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </TextField>
        <TextField label="Buscar inspecciones" value={props.search} onChange={event => props.onSearch(event.target.value)}
            helperText="IDs exactos; folio SAI, cliente, serie, inspector o título por texto."
            sx={{ minWidth: 250, flex: 1 }} />
        <Button onClick={() => props.onSearch("")} disabled={!props.search}>Limpiar búsqueda</Button>
        <TextField select label="Estado de inspección" value={props.status}
            onChange={event => props.onStatus(event.target.value as InspectionStatus | "")} sx={{ minWidth: 230 }}>
            <MenuItem value="">Todas</MenuItem>
            {INSPECTION_STATUSES.map(status => <MenuItem key={status} value={status}>{STATUS_LABELS[status]}</MenuItem>)}
        </TextField>
        <Button variant="outlined" disabled={props.refreshing} onClick={props.onRefresh}>
            {props.refreshing ? "Actualizando…" : "Actualizar inspecciones"}
        </Button>
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
