import { useRef, useState } from "react";
import { useList } from "@refinedev/core";
import { Alert, Box, Button, Typography } from "@mui/material";
import { findActiveAssemblyInspection, isInspectionSummaryList, requestAssemblyInspection } from "../../services/inspectionRequest";
import type { InspectionSummary, RequestedInspection } from "../../services/inspectionRequest";

type Props = { workOrderId: number; disabled?: boolean };
type Feedback = { severity: "success" | "warning" | "error"; text: string };

export default function ProductionInspectionRequest({ workOrderId, disabled = false }: Props) {
    // Same resource/key as the Quality panel: its cached list is refreshed after a request.
    const { data, isLoading, isFetching, isError, refetch } = useList<InspectionSummary>({
        resource: "quality/inspection/orders_all?include=tasks",
    });
    const submitting = useRef(false);
    const [pending, setPending] = useState(false);
    const [created, setCreated] = useState<RequestedInspection | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const rows = isInspectionSummaryList(data?.data) ? data.data : null;
    const active = rows ? findActiveAssemblyInspection(rows, workOrderId) : undefined;
    const blocked = disabled || pending || isLoading || isFetching || isError || !rows || !!active || !!created;

    const submit = async () => {
        if (submitting.current || blocked) return;
        submitting.current = true;
        setPending(true);
        setFeedback(null);
        try {
            const inspection = await requestAssemblyInspection(workOrderId);
            setCreated(inspection);
            setFeedback({ severity: "success", text: `Inspección de ensamble #${inspection.id} solicitada para la orden #${workOrderId}.` });
            try {
                const result = await refetch();
                if (result.isError) throw result.error;
            } catch {
                setFeedback({ severity: "warning", text: `Inspección #${inspection.id} solicitada. No se pudo actualizar la lista; vuelve a abrir el panel para consultar su estado.` });
            }
        } catch (error) {
            setFeedback({ severity: "error", text: error && typeof error === "object" && "message" in error
                ? String(error.message) : "No se pudo solicitar la inspección." });
            // A 409 or a lost response may correspond to an inspection already persisted.
            // Refresh only reads; never retry the POST automatically.
            await refetch().catch(() => undefined);
        } finally {
            submitting.current = false;
            setPending(false);
        }
    };

    return (
        <Box sx={{ mt: 2 }}>
            <Button variant="outlined" disabled={blocked} onClick={submit}>
                {pending ? "Solicitando inspección…" : "Solicitar inspección de ensamble"}
            </Button>
            {active && !created && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                    Ya existe la inspección de ensamble activa #{active.inspection_order_id} para esta orden.
                </Typography>
            )}
            {(isLoading || isFetching) && <Typography variant="body2" sx={{ mt: 1 }}>Consultando inspecciones existentes…</Typography>}
            {(isError || (!isLoading && !isFetching && !rows)) && (
                <Alert severity="error" sx={{ mt: 1 }}>
                    No se pudieron verificar las inspecciones existentes.
                    <Button size="small" disabled={pending || isFetching} onClick={() => void refetch().catch(() => undefined)}>Actualizar lista</Button>
                </Alert>
            )}
            {feedback && <Alert severity={feedback.severity} sx={{ mt: 1 }}>{feedback.text}</Alert>}
        </Box>
    );
}
