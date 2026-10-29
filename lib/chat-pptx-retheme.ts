import Automizer, { modify } from "pptx-automizer";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { posix } from "node:path";
import { createHash } from "node:crypto";
import { checkOfficeArchive } from "@/lib/chat-attachments";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const PPTX_LIMIT = 20 * 1024 * 1024;

// PowerPoint permits absolute package targets; automizer expects relative ones.
function normalizedPackage(bytes: Buffer): Buffer {
  const zip = new PizZip(bytes);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/i.test(entry.name)) continue;
    let text = entry.asText().replace(/^\uFEFF/, "");
    if (/<!DOCTYPE/i.test(text)) throw new Error("PowerPoint files with XML document types are not supported.");
    if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)) {
      const xml = new DOMParser().parseFromString(text, "text/xml");
      const objects = xml.getElementsByTagNameNS(P, "cNvPr");
      const used = new Set(Array.from({ length: objects.length }, (_, i) => objects.item(i)?.getAttribute("name") ?? ""));
      for (let i = 0; i < objects.length; i++) {
        const item = objects.item(i)!;
        if (!item.getAttribute("name") && item.parentNode?.localName !== "nvGrpSpPr") {
          let name = `2ndbrain-object-${item.getAttribute("id") || i}`;
          while (used.has(name)) name += "-1";
          used.add(name); item.setAttribute("name", name);
        }
      }
      text = new XMLSerializer().serializeToString(xml);
    }
    if (entry.name.endsWith(".rels")) {
      const xml = new DOMParser().parseFromString(text, "text/xml");
      const parentDir = entry.name === "_rels/.rels" ? "" : entry.name.replace(/\/_rels\/[^/]+\.rels$/, "");
      const relations = xml.getElementsByTagNameNS(PR, "Relationship");
      for (let i = 0; i < relations.length; i++) {
        const item = relations.item(i)!;
        if (item.getAttribute("TargetMode")?.toLowerCase() === "external") throw new Error("PowerPoint files with external links or linked media are not supported. Embed the media and remove external links first.");
        const target = item.getAttribute("Target");
        if (target?.startsWith("/")) item.setAttribute("Target", posix.relative(parentDir || ".", target.slice(1)));
      }
      text = new XMLSerializer().serializeToString(xml);
    }
    zip.file(entry.name, text);
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function xmlAt(zip: PizZip, name: string) {
  const file = zip.file(name);
  if (!file) throw new Error("A required PowerPoint file is missing.");
  const text = file.asText().replace(/^\uFEFF/, "");
  if (/<!DOCTYPE/i.test(text)) throw new Error("PowerPoint files with XML document types are not supported.");
  return new DOMParser().parseFromString(text, "text/xml");
}

function slideSize(zip: PizZip): string {
  const node = xmlAt(zip, "ppt/presentation.xml").getElementsByTagNameNS(P, "sldSz").item(0);
  if (!node?.getAttribute("cx") || !node.getAttribute("cy")) throw new Error("The PowerPoint slide size could not be determined.");
  return `${node.getAttribute("cx")},${node.getAttribute("cy")}`;
}

function targetTextColor(zip: PizZip, slideNumber: number): string {
  const xml = xmlAt(zip, `ppt/slides/slide${slideNumber}.xml`);
  const background = xml.getElementsByTagNameNS(P, "bg").item(0);
  const color = background?.getElementsByTagNameNS(A, "srgbClr").item(0)?.getAttribute("val") ?? "FFFFFF";
  if (!/^[0-9a-f]{6}$/i.test(color)) return "1B2938";
  const rgb = [0, 2, 4].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) < 128 ? "FFFFFF" : "1B2938";
}

function imageHashes(zip: PizZip): Set<string> {
  const hashes = new Set<string>();
  for (const entry of Object.values(zip.files)) if (!entry.dir && /^ppt\/media\//i.test(entry.name)) hashes.add(createHash("sha256").update(entry.asNodeBuffer()).digest("hex"));
  return hashes;
}

function orderedSlides(zip: PizZip): string[] {
  const rels = xmlAt(zip, "ppt/_rels/presentation.xml.rels").getElementsByTagNameNS(PR, "Relationship");
  const targets = new Map<string, string>();
  for (let i = 0; i < rels.length; i++) {
    const rel = rels.item(i)!;
    const id = rel.getAttribute("Id"), target = rel.getAttribute("Target");
    if (id && target && rel.getAttribute("Type")?.endsWith("/slide")) targets.set(id, posix.normalize(posix.join("ppt", target)));
  }
  const ids = xmlAt(zip, "ppt/presentation.xml").getElementsByTagNameNS(P, "sldId");
  return Array.from({ length: ids.length }, (_, index) => {
    const path = targets.get(ids.item(index)!.getAttributeNS(R, "id") ?? "");
    if (!path || !/^ppt\/slides\/slide\d+\.xml$/.test(path)) throw new Error("The PowerPoint slide order could not be verified.");
    return path;
  });
}

function textCounts(zip: PizZip, path: string): Map<string, number> {
  const nodes = xmlAt(zip, path).getElementsByTagNameNS(A, "t"), result = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const value = nodes.item(i)?.textContent ?? "";
    if (value.trim()) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

function removeUnusedSlidesAndNotes(zip: PizZip, activeSlides: string[]) {
  const active = new Set(activeSlides), removed = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    const slide = name.match(/^ppt\/slides\/(slide\d+\.xml)$/);
    const slideRels = name.match(/^ppt\/slides\/_rels\/(slide\d+\.xml)\.rels$/);
    if ((slide && !active.has(name)) || (slideRels && !active.has(`ppt/slides/${slideRels[1]}`)) || /^ppt\/notesSlides\//.test(name)) {
      zip.remove(name); removed.add(name);
    }
  }
  for (const slide of activeSlides) {
    const relPath = slide.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    if (!zip.file(relPath)) continue;
    const xml = xmlAt(zip, relPath), relations = xml.getElementsByTagNameNS(PR, "Relationship");
    for (let i = relations.length - 1; i >= 0; i--) {
      const rel = relations.item(i)!;
      if (rel.getAttribute("Type")?.endsWith("/notesSlide")) rel.parentNode?.removeChild(rel);
    }
    zip.file(relPath, new XMLSerializer().serializeToString(xml));
  }
  const contentTypes = xmlAt(zip, "[Content_Types].xml");
  const overrides = contentTypes.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types", "Override");
  for (let i = overrides.length - 1; i >= 0; i--) {
    const item = overrides.item(i)!;
    if (removed.has((item.getAttribute("PartName") ?? "").replace(/^\//, ""))) item.parentNode?.removeChild(item);
  }
  zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(contentTypes));
}

function verifyPartRelationships(zip: PizZip, partPath: string) {
  const directory = posix.dirname(partPath), relPath = `${directory}/_rels/${posix.basename(partPath)}.rels`;
  if (!zip.file(relPath)) return;
  const relations = xmlAt(zip, relPath).getElementsByTagNameNS(PR, "Relationship");
  for (let i = 0; i < relations.length; i++) {
    const rel = relations.item(i)!, target = rel.getAttribute("Target");
    if (!target || rel.getAttribute("TargetMode")?.toLowerCase() === "external") continue;
    const file = target.startsWith("/") ? posix.normalize(target.slice(1)) : posix.normalize(posix.join(directory, target));
    let decoded = file;
    try { decoded = decodeURIComponent(file); } catch { /* invalid escape is handled by the normal lookup */ }
    if (!zip.file(file) && !zip.file(decoded)) throw new Error("A slide image or chart could not be transferred safely.");
  }
}

export async function restyleChatPresentation(sourceBytes: Buffer, templateBytes: Buffer) {
  if (!sourceBytes.length || sourceBytes.length > PPTX_LIMIT || !templateBytes.length || templateBytes.length > PPTX_LIMIT) throw new Error("Each PowerPoint must be between 1 byte and 20 MB.");
  await Promise.all([checkOfficeArchive(sourceBytes, "PPTX"), checkOfficeArchive(templateBytes, "PPTX")]);
  const source = normalizedPackage(sourceBytes), template = normalizedPackage(templateBytes);
  const sourceZip = new PizZip(source), templateZip = new PizZip(template);
  if (slideSize(sourceZip) !== slideSize(templateZip)) throw new Error("The two presentations have different slide sizes. Make them the same size in PowerPoint and try again.");
  const automizer = new Automizer({ removeExistingSlides: true, cleanupPlaceholders: false, verbosity: 0, continueOnError: false })
    .loadRoot(template).load(template, "design").load(source, "source");
  const info = await automizer.getInfo();
  const slides = info.slidesByTemplate("source"), designs = info.slidesByTemplate("design");
  if (!slides.length || !designs.length) throw new Error("Both presentations must contain at least one slide.");
  if (slides.length > 30 || designs.length > 30 || slides.some(slide => slide.elements.length > 100) || designs.some(slide => slide.elements.length > 100)) throw new Error("Use presentations with at most 30 slides and 100 objects per slide.");
  let containsNotesOrAnimations = false;
  const sourceChartCounts: number[] = [];
  for (const slide of slides) {
    const xml = xmlAt(sourceZip, `ppt/slides/slide${slide.number}.xml`);
    if (xml.getElementsByTagNameNS(P, "grpSp").length || xml.getElementsByTagNameNS(P, "oleObj").length || xml.getElementsByTagNameNS(P, "contentPart").length) throw new Error("Grouped objects, embedded files and SmartArt are not supported yet. Ungroup or simplify those objects and try again.");
    let chartCount = 0;
    for (const node of Array.from(xml.getElementsByTagNameNS(A, "graphicData"))) {
      const uri = node.getAttribute("uri") ?? "";
      if (!uri.endsWith("/chart") && !uri.endsWith("/table")) throw new Error("This presentation contains an unsupported diagram or embedded object.");
      if (uri.endsWith("/chart")) chartCount++;
    }
    sourceChartCounts.push(chartCount);
    const relPath = `ppt/slides/_rels/slide${slide.number}.xml.rels`;
    const hasNotes = sourceZip.file(relPath) && Array.from(xmlAt(sourceZip, relPath).getElementsByTagNameNS(PR, "Relationship")).some(rel => rel.getAttribute("Type")?.endsWith("/notesSlide"));
    if (xml.getElementsByTagNameNS(P, "timing").length || xml.getElementsByTagNameNS(P, "transition").length || hasNotes) containsNotesOrAnimations = true;
    if (slide.elements.some(element => !element.name)) throw new Error("A slide has an unnamed object that cannot be transferred safely.");
  }
  for (let index = 0; index < slides.length; index++) {
    const sourceSlide = slides[index], design = designs[Math.min(index, designs.length - 1)];
    const textColor = targetTextColor(templateZip, design.number);
    automizer.addSlide("design", design.number, slide => {
      for (const element of design.elements.filter(item => item.hasTextBody)) slide.modifyElement({ name: element.name, nameIdx: element.nameIdx }, modify.setText(""));
      for (const element of sourceSlide.elements) {
        slide.addElement("source", sourceSlide.number, { name: element.name, nameIdx: element.nameIdx }, (shape: any) => {
          // Give unfilled source text the template's contrast; filled boxes keep their own formatting.
          const properties = shape.getElementsByTagNameNS(P, "spPr").item(0);
          const hasFill = properties && (Array.from(properties.childNodes) as any[]).some(node => ["solidFill", "gradFill", "pattFill", "blipFill"].includes(node.localName));
          if (!element.hasTextBody || hasFill) return;
          for (const tag of ["rPr", "defRPr", "endParaRPr"]) {
            for (const run of Array.from(shape.getElementsByTagNameNS(A, tag)) as any[]) {
              for (const child of Array.from(run.childNodes) as any[]) if (child.localName === "solidFill") run.removeChild(child);
              const fill = run.ownerDocument!.createElementNS(A, "a:solidFill"), color = run.ownerDocument!.createElementNS(A, "a:srgbClr");
              color.setAttribute("val", textColor); fill.appendChild(color); run.appendChild(fill);
            }
          }
        });
      }
    });
  }
  const outputZip = await automizer.getJSZip();
  const initialOutput = await outputZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  if (!initialOutput.length || initialOutput.length > PPTX_LIMIT) throw new Error("The resulting PowerPoint exceeds 20 MB.");
  const result = new PizZip(initialOutput);
  const resultSlides = orderedSlides(result);
  if (resultSlides.length !== slides.length) throw new Error("The transferred slide count could not be verified.");
  removeUnusedSlidesAndNotes(result, resultSlides);
  for (let index = 0; index < slides.length; index++) {
    const expected = textCounts(sourceZip, `ppt/slides/slide${slides[index].number}.xml`), actual = textCounts(result, resultSlides[index]);
    if ([...expected].some(([value, count]) => (actual.get(value) ?? 0) < count)) throw new Error(`Some text on slide ${index + 1} could not be transferred safely.`);
    const chartNodes = xmlAt(result, resultSlides[index]).getElementsByTagNameNS(A, "graphicData");
    if (Array.from(chartNodes).filter(node => node.getAttribute("uri")?.endsWith("/chart")).length < sourceChartCounts[index]) throw new Error(`Some charts on slide ${index + 1} could not be transferred safely.`);
    verifyPartRelationships(result, resultSlides[index]);
  }
  for (const name of Object.keys(result.files).filter(name => /^ppt\/charts\/chart\d+\.xml$/.test(name))) verifyPartRelationships(result, name);
  const outputHashes = imageHashes(result);
  const originalHashes = imageHashes(sourceZip);
  if ([...originalHashes].some(hash => !outputHashes.has(hash))) throw new Error("Some source images could not be transferred safely. Simplify the presentation and try again.");
  const output = result.generate({ type: "nodebuffer", compression: "DEFLATE" });
  await checkOfficeArchive(output, "PPTX");
  return { data: output, slideCount: slides.length, containsNotesOrAnimations };
}
