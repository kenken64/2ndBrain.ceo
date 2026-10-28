"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

type Preview =
  | { kind: "image" | "pdf"; name: string }
  | { kind: "text"; name: string; text: string; truncated: boolean }
  | { kind: "spreadsheet"; name: string; sheets: Array<{ name: string; rows: string[][] }>; truncated: boolean };

type Props = { file: { id: string; name: string }; onClose: () => void };

export function ChatFilePreview({ file, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);
  const base = `/api/chat/files/${encodeURIComponent(file.id)}`;
  useEffect(() => {
    const controller = new AbortController();
    dialog.current?.showModal();
    (async () => {
      try {
        const response = await fetch(`${base}/preview`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Could not preview this file.");
        if (!controller.signal.aborted) setPreview(data as Preview);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not preview this file.");
      }
    })();
    return () => controller.abort();
  }, [base]);
  const sheet = preview?.kind === "spreadsheet" ? preview.sheets[sheetIndex] : null;
  return <dialog ref={dialog} className="chat-file-preview" aria-labelledby="chat-file-preview-title" onClose={onClose}>
    <div className="chat-file-preview__header"><div><span>FILE PREVIEW</span><h2 id="chat-file-preview-title">{preview?.name ?? file.name}</h2></div><div className="chat-file-preview__actions"><a href={base} className="chat-file-icon" aria-label={`Download ${file.name}`} title="Download"><Download size={18} /></a><button type="button" className="chat-file-icon" aria-label="Close file preview" title="Close" onClick={() => dialog.current?.close()}><X size={19} /></button></div></div>
    {error ? <p className="chat-file-preview__status" role="alert">{error}</p> : !preview ? <p className="chat-file-preview__status" role="status">Loading preview…</p> : null}
    {preview?.kind === "image" ? <div className="chat-file-preview__image"><img src={`${base}/preview?inline=1`} alt={`Preview of ${preview.name}`} /></div> : null}
    {preview?.kind === "pdf" ? <iframe className="chat-file-preview__pdf" title={`Preview of ${preview.name}`} src={`${base}/preview?inline=1`} /> : null}
    {preview?.kind === "text" ? <div className="chat-file-preview__body"><p>Text preview; original formatting and embedded images may not be shown.{preview.truncated ? " Preview is truncated; download the full file." : ""}</p><pre>{preview.text || "No text available in this file."}</pre></div> : null}
    {preview?.kind === "spreadsheet" ? <div className="chat-file-preview__body"><p>Preview shows up to 100 rows and 50 columns per sheet.{preview.truncated ? " Some content is not shown; download the full file." : ""}</p>{preview.sheets.length > 1 ? <label>Sheet <select value={sheetIndex} onChange={event => setSheetIndex(Number(event.target.value))}>{preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label> : null}{sheet?.rows.length ? <div className="chat-file-preview__table"><table><tbody>{sheet.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody></table></div> : <p>No spreadsheet rows to preview.</p>}</div> : null}
  </dialog>;
}
