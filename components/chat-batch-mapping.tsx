"use client";

import {Localized, useLanguage } from "@/components/language-provider";


export type BatchReview = { fields: Array<{ name: string; type: string; required: boolean; options?: string[] }>; columns: string[]; rowCount: number; mappings: Array<{ field: string; column: string | null }>; template: string; spreadsheet: string; templateType: string };
export function ChatBatchMapping({ review, onChange, onCancel, disabled }: { review: BatchReview; onChange: (mappings: BatchReview["mappings"]) => void; onCancel: () => void; disabled: boolean }) {
  const _uiLanguage = useLanguage().language;
  return <section className="chat-batch-mapping" aria-label={_uiLanguage === "zh" ? "检查字段映射" : "Review field mapping"}>
    <div className="chat-batch-mapping__header"><div><strong><Localized en={"Review field mapping"} zh={"检查字段映射"} /></strong><p>{_uiLanguage === "zh" ? `${review.spreadsheet} 中有 ${review.rowCount} 条记录 · ${review.template}` : `${review.rowCount} records in ${review.spreadsheet} · ${review.template}`}</p></div><button type="button" className="btn-ghost btn-ghost--compact" disabled={disabled} onClick={onCancel}><Localized en={"Cancel"} zh={"取消"} /></button></div>
    <p><Localized en={"Match every template field to a column. Confirm the mapping, then select Generate documents. No AI credits are used for this batch."} zh={"将每个模板字段匹配到一个列。确认映射后选择“生成文档”。此批次不消耗 AI 积分。"} /></p>
    <div className="chat-batch-mapping__fields">{review.fields.map(field => <label key={field.name}><span>{field.name}{field.type !== "text" ? ` (${field.type})` : ""}</span><select disabled={disabled} aria-label={_uiLanguage === "zh" ? `${field.name} 对应的列` : `Column for ${field.name}`} value={review.mappings.find(item => item.field === field.name)?.column ?? ""} onChange={event => onChange(review.mappings.map(item => item.field === field.name ? { ...item, column: event.target.value || null } : item))}><option value=""><Localized en={"Select a column"} zh={"选择一列"} /></option>{review.columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>)}</div>
  </section>;
}
