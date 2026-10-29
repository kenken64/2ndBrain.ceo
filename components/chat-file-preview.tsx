"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

type Preview =
  | { kind: "image" | "pdf" | "video" | "document"; name: string }
  | { kind: "text"; name: string; text: string; truncated: boolean }
  | { kind: "presentation"; name: string; text: string; truncated: boolean }
  | { kind: "spreadsheet"; name: string; sheets: Array<{ name: string; rows: string[][] }>; truncated: boolean };

type Props = { file: { id: string; name: string }; onClose: () => void };

export function ChatFilePreview({ file, onClose }: Props) {
  const _uiLanguage = useLanguage().language;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const base = `/api/chat/files/${encodeURIComponent(file.id)}`;
  return <dialog ref={dialog} className="chat-file-preview" aria-labelledby="chat-file-preview-title" onClose={onClose}>
    <div className="chat-file-preview__header"><div><span><Localized en={"FILE PREVIEW"} zh={"文件预览"} /></span><h2 id="chat-file-preview-title">{file.name}</h2></div><div className="chat-file-preview__actions"><a href={base} className="chat-file-icon" aria-label={_uiLanguage === "zh" ? `下载 ${file.name}` : `Download ${file.name}`} title={_uiLanguage === "zh" ? "下载" : "Download"}><Download size={18} /></a><button type="button" className="chat-file-icon" aria-label={_uiLanguage === "zh" ? "关闭文件预览" : "Close file preview"} title={_uiLanguage === "zh" ? "关闭" : "Close"} onClick={() => dialog.current?.close()}><X size={19} /></button></div></div>
    <ChatFilePreviewContent file={file} />
  </dialog>;
}

export function ChatFilePreviewContent({ file }: { file: { id: string; name: string } }) {
  const _uiLanguage = useLanguage().language;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [videoError, setVideoError] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const base = `/api/chat/files/${encodeURIComponent(file.id)}`;
  useEffect(() => {
    const controller = new AbortController();
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
  return <>
    {error ? <p className="chat-file-preview__status" role="alert"><LocalizedMessage text={error} /></p> : !preview ? <p className="chat-file-preview__status" role="status"><Localized en={"Loading preview…"} zh={"正在加载预览…"} /></p> : null}
    {preview?.kind === "image" ? <div className="chat-file-preview__image"><img src={`${base}/preview?inline=1`} alt={_uiLanguage === "zh" ? `${preview.name} 的预览` : `Preview of ${preview.name}`} /></div> : null}
    {preview?.kind === "video" ? <div className="chat-file-preview__video"><video controls playsInline preload="metadata" src={`${base}/preview?inline=1`} aria-label={_uiLanguage === "zh" ? `${preview.name} 的预览` : `Preview of ${preview.name}`} onError={() => setVideoError(true)} />{videoError ? <p role="alert"><Localized en={"The video could not be played in this browser. Try downloading the file."} zh={"无法在此浏览器中播放视频。请尝试下载文件。"} /></p> : null}</div> : null}
    {preview?.kind === "pdf" ? <iframe className="chat-file-preview__pdf" title={_uiLanguage === "zh" ? `${preview.name} 的预览` : `Preview of ${preview.name}`} src={`${base}/preview?inline=1`} /> : null}
    {preview?.kind === "document" ? <FormattedDocx file={file} /> : null}
    {preview?.kind === "presentation" ? <VisualPresentation file={file} text={preview.text} truncated={preview.truncated} /> : null}
    {preview?.kind === "text" ? <div className="chat-file-preview__body"><p><Localized en={"Text preview; original formatting and embedded images may not be shown."} zh={"文本预览可能不显示原始格式和嵌入图片。"} />{preview.truncated ? <Localized en={" Preview is truncated; download the full file."} zh={"预览已截断；请下载完整文件。"} /> : ""}</p><pre>{preview.text || (_uiLanguage === "zh" ? "此文件没有可用文本。" : "No text available in this file.")}</pre></div> : null}
    {preview?.kind === "spreadsheet" ? <div className="chat-file-preview__body"><p><Localized en={"Preview shows up to 100 rows and 50 columns per sheet."} zh={"每个工作表最多预览 100 行和 50 列。"} />{preview.truncated ? <Localized en={" Some content is not shown; download the full file."} zh={"部分内容未显示；请下载完整文件。"} /> : ""}</p>{preview.sheets.length > 1 ? <label><Localized en={"Sheet"} zh={"工作表"} /><select value={sheetIndex} onChange={event => setSheetIndex(Number(event.target.value))}>{preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label> : null}{sheet?.rows.length ? <div className="chat-file-preview__table"><table><tbody>{sheet.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody></table></div> : <p><Localized en={"No spreadsheet rows to preview."} zh={"没有可预览的电子表格行。"} /></p>}</div> : null}
  </>;
}

function VisualPresentation({ file, text, truncated }: { file: { id: string; name: string }; text: string; truncated: boolean }) {
  const _uiLanguage = useLanguage().language;
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<import("pptxviewjs").PPTXViewer | null>(null);
  const [count, setCount] = useState(0), [index, setIndex] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let instance: import("pptxviewjs").PPTXViewer | null = null;
    (async () => {
      try {
        const response = await fetch(`/api/chat/files/${encodeURIComponent(file.id)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const bytes = await response.arrayBuffer(), { PPTXViewer } = await import("pptxviewjs");
        if (controller.signal.aborted || !canvas.current) return;
        instance = new PPTXViewer({ canvas: canvas.current, enableThumbnails: false });
        await instance.loadFile(bytes);
        if (controller.signal.aborted) { instance.destroy(); return; }
        const total = instance.getSlideCount();
        if (!total) throw new Error();
        await instance.renderSlide(0);
        if (!controller.signal.aborted) { viewer.current = instance; setCount(total); setBusy(false); }
      } catch {
        instance?.destroy();
        if (!controller.signal.aborted) { setError("The visual preview is unavailable. You can read the slide text or download the presentation."); setBusy(false); }
      }
    })();
    return () => { controller.abort(); instance?.destroy(); viewer.current = null; };
  }, [file.id]);
  async function goTo(slide: number) {
    if (!viewer.current || busy || slide < 0 || slide >= count) return;
    setBusy(true);
    try { await viewer.current.renderSlide(slide); setIndex(slide); }
    catch { setError("This slide could not be rendered. You can read the slide text or download the presentation."); }
    finally { setBusy(false); }
  }
  return <div className="chat-file-preview__presentation"><p><Localized en={"Visual preview may differ from PowerPoint. Download the file to review the original."} zh={"视觉预览可能与 PowerPoint 不同。请下载文件查看原件。"} /></p>{busy && !count ? <p role="status"><Localized en={"Rendering presentation…"} zh={"正在渲染演示文稿…"} /></p> : null}{error ? <p role="alert"><LocalizedMessage text={error} /></p> : null}<canvas ref={canvas} aria-label={_uiLanguage === "zh" ? `${file.name} 的第 ${index + 1} 张幻灯片，共 ${count} 张` : `Slide ${index + 1} of ${count} in ${file.name}`} />{count ? <div className="chat-file-preview__slide-controls"><button type="button" className="btn-ghost" disabled={busy || index === 0} onClick={() => void goTo(index - 1)}><Localized en={"Previous"} zh={"上一页"} /></button><span><Localized en={"Slide"} zh={"幻灯片"} />{" "}{index + 1} / {count}</span><button type="button" className="btn-ghost" disabled={busy || index + 1 >= count} onClick={() => void goTo(index + 1)}><Localized en={"Next"} zh={"下一页"} /></button></div> : null}<details><summary><Localized en={"Slide text"} zh={"幻灯片文本"} /></summary><pre>{text || (_uiLanguage === "zh" ? "没有可用的幻灯片文本。" : "No slide text available.")}</pre>{truncated ? <p><Localized en={"Text preview is truncated."} zh={"文本预览已截断。"} /></p> : null}</details></div>;
}

function FormattedDocx({ file }: { file: { id: string; name: string } }) {
  const _uiLanguage = useLanguage().language;
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/chat/files/${encodeURIComponent(file.id)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the document.");
        const bytes = await response.arrayBuffer();
        const { parseAsync, renderDocument } = await import("docx-preview");
        const options = { ignoreWidth: true, ignoreHeight: true, ignoreFonts: true, useBase64URL: true, renderAltChunks: false, experimental: false };
        const nodes = await renderDocument(await parseAsync(bytes, options), options);
        const detached = document.implementation.createHTMLDocument("");
        for (const node of nodes) (node.nodeName === "STYLE" ? detached.head : detached.body).appendChild(node);
        // Document-provided links and HTML must never run with the application's privileges.
        detached.querySelectorAll("a").forEach(link => link.removeAttribute("href"));
        if (!controller.signal.aborted) setHtml(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">${detached.head.innerHTML}<style>html,body{margin:0;min-height:100%;} .docx-wrapper{padding:12px!important;background:#eef3f7!important;} .docx-wrapper>section.docx{width:auto!important;min-width:0!important;max-width:100%!important;padding:24px!important;box-sizing:border-box!important;overflow-wrap:anywhere;} img{max-width:100%;height:auto;} table{max-width:100%;}</style></head><body>${detached.body.innerHTML}</body></html>`);
      } catch {
        if (!controller.signal.aborted) setError("Could not render the formatted document. Download it to view it in Word.");
      }
    })();
    return () => controller.abort();
  }, [file.id]);
  if (error) return <p className="chat-file-preview__status" role="alert"><LocalizedMessage text={error} /></p>;
  if (!html) return <p className="chat-file-preview__status" role="status"><Localized en={"Rendering document…"} zh={"正在渲染文档…"} /></p>;
  return <iframe className="chat-file-preview__pdf" title={_uiLanguage === "zh" ? `${file.name} 的预览` : `Preview of ${file.name}`} sandbox="" srcDoc={html} />;
}
