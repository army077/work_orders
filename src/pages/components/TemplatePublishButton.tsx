import { useRef, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import { defaultInspectionTexts, prepareTemplatePublication, publicationErrorMessage,
    publishReviewedTemplate, validatePublicationReview } from "../../services/templatePublication";
import type { PublicationReview, PublicationTemplate } from "../../services/templatePublication";

type Props = { templateId: number; disabled?: boolean; onPublished: (template: PublicationTemplate) => Promise<void> };

export default function TemplatePublishButton({ templateId, disabled = false, onPublished }: Props) {
    const busy = useRef(false);
    const confirmed = useRef(false);
    const [pending, setPending] = useState(false);
    const [review, setReview] = useState<PublicationReview | null>(null);
    const [sectionId, setSectionId] = useState<number | null>(null);
    const [defaultsReviewed, setDefaultsReviewed] = useState(false);
    const [published, setPublished] = useState<PublicationTemplate | null>(null);
    const [feedback, setFeedback] = useState("");

    const showPublished = async (template: PublicationTemplate) => {
        confirmed.current = true;
        setPublished(template);
        setReview(null);
        setFeedback(`Plantilla publicada: ${template.name}, versión ${template.version}.`);
        try { await onPublished(template); }
        catch { setFeedback(`Publicación confirmada, versión ${template.version}. No se pudo actualizar la lista; recarga la página para consultar el estado actual.`); }
    };

    const openReview = async () => {
        if (busy.current || confirmed.current || disabled) return;
        busy.current = true;
        setPending(true);
        setFeedback("");
        setSectionId(null);
        setDefaultsReviewed(false);
        try {
            const current = await prepareTemplatePublication(templateId);
            if (current.template.is_published) await showPublished(current.template);
            else setReview(current);
        } catch (error) { setFeedback(publicationErrorMessage(error)); }
        finally { busy.current = false; setPending(false); }
    };

    const submit = async () => {
        if (busy.current || confirmed.current || disabled || !review) return;
        // Lock before confirmation and before React can render a second click.
        busy.current = true;
        try {
            validatePublicationReview(review, sectionId, defaultsReviewed);
            const section = review.sections.find(s => s.id === sectionId);
            if (!window.confirm(`¿Publicar "${review.template.name}" (ID ${review.template.id})?` +
                (section ? `\nModelo: ${review.modelName}. Sección a utilizar: ${section.title}.` : "") +
                "\nSe publicará la plantilla completa y se incrementará su versión.")) return;
            setPending(true);
            setFeedback("");
            const result = await publishReviewedTemplate(review, sectionId, defaultsReviewed);
            await showPublished(result);
        } catch (error) {
            setFeedback(publicationErrorMessage(error));
            // A fresh review is required before another attempt, including a lost POST response.
            setReview(null);
        } finally { busy.current = false; setPending(false); }
    };

    const defaults = review ? defaultInspectionTexts(review) : [];
    let validation = "";
    if (review) {
        try { validatePublicationReview(review, sectionId, defaultsReviewed); }
        catch (error) { validation = publicationErrorMessage(error); }
    }
    const titleId = `publish-template-${templateId}`;
    return <>
        {published ? <span className="pill pill--ok">Publicado · v{published.version}</span> : (
            <button className="btn btn--primary" onClick={openReview} disabled={disabled || pending || !!review}>
                {pending ? "Verificando…" : "Publicar"}
            </button>
        )}
        {feedback && <span role="status" style={{ maxWidth: 420, whiteSpace: "normal" }}>{feedback}</span>}
        <Dialog open={!!review} onClose={() => { if (!busy.current) setReview(null); }} aria-labelledby={titleId} fullWidth maxWidth="sm">
            <DialogTitle id={titleId}>Revisar publicación</DialogTitle>
            <DialogContent>
                {review && <>
                    <p>{review.template.name} · ID {review.template.id} · v{review.template.version}</p>
                    <p>Se publicará la plantilla completa.</p>
                    {review.template.template_type === "INSPECCION" && <>
                        <p>Modelo verificado: {review.modelName}</p>
                        <label>Sección de inspección que se utilizará
                            <select value={sectionId ?? ""} disabled={pending} onChange={e => {
                                setSectionId(e.target.value ? Number(e.target.value) : null);
                                setDefaultsReviewed(false);
                            }}>
                                <option value="">Selecciona una sección</option>
                                {review.sections.map(section => <option key={section.id} value={section.id}>
                                    {section.title} ({review.points[section.id]?.length ?? 0} puntos)
                                </option>)}
                            </select>
                        </label>
                        {review.sections.filter(section => section.id === sectionId).map(section => (
                            <ul key={section.id}>{review.points[section.id]?.map(point => point.kind === "inspection" && <li key={point.id}>
                                <strong>{point.revision_point}</strong>
                                <div>Especificación: {point.specs || "Sin especificación"}</div>
                                <div>Sugerencia: {point.suggestions || "Sin sugerencia"}</div>
                            </li>)}</ul>
                        ))}
                        {!!defaults.length && <>
                            <p>Hay textos predeterminados guardados en la plantilla. Revísalos con Calidad o corrígelos en el Constructor de tareas:</p>
                            <ul>{defaults.map((text, i) => <li key={i}>{text}</li>)}</ul>
                            <label><input type="checkbox" checked={defaultsReviewed} disabled={pending}
                                onChange={e => setDefaultsReviewed(e.target.checked)} />
                                Calidad revisó y aprobó conservar estos textos predeterminados para esta prueba.
                            </label>
                        </>}
                    </>}
                    {validation && <p role="alert">{validation}</p>}
                </>}
            </DialogContent>
            <DialogActions>
                <button className="btn" disabled={pending} onClick={() => setReview(null)}>Cancelar</button>
                <button className="btn btn--primary" disabled={disabled || pending || !!validation} onClick={submit}>
                    {pending ? "Publicando…" : "Confirmar publicación"}
                </button>
            </DialogActions>
        </Dialog>
    </>;
}
