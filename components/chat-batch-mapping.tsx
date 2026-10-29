"use client";

export type BatchReview = { fields: Array<{ name: string; type: string; required: boolean; options?: string[] }>; columns: string[]; rowCount: number; mappings: Array<{ field: string; column: string | null }>; template: string; spreadsheet: string; templateType: string };
export function ChatBatchMapping({ review, onChange, onCancel, disabled }: { review: BatchReview; onChange: (mappings: BatchReview["mappings"]) => void; onCancel: () => void; disabled: boolean }) {
  return <section className="chat-batch-mapping" aria-label="Review field mapping">
    <div className="chat-batch-mapping__header"><div><strong>Review field mapping</strong><p>{review.rowCount} records in {review.spreadsheet} · {review.template}</p></div><button type="button" className="btn-ghost btn-ghost--compact" disabled={disabled} onClick={onCancel}>Cancel</button></div>
    <p>Match every template field to a column. Confirm the mapping, then select Generate documents. No AI credits are used for this batch.</p>
    <div className="chat-batch-mapping__fields">{review.fields.map(field => <label key={field.name}><span>{field.name}{field.type !== "text" ? ` (${field.type})` : ""}</span><select disabled={disabled} aria-label={`Column for ${field.name}`} value={review.mappings.find(item => item.field === field.name)?.column ?? ""} onChange={event => onChange(review.mappings.map(item => item.field === field.name ? { ...item, column: event.target.value || null } : item))}><option value="">Select a column</option>{review.columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>)}</div>
  </section>;
}
