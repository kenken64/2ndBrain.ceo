import PptxGenJS from "pptxgenjs";

export type PresentationContent = { title: string; slides: Array<{ title: string; bullets: string[] }> };

export async function renderChatPresentation(value: unknown): Promise<Buffer> {
  if (!value || typeof value !== "object") throw new Error("Invalid presentation content.");
  const content = value as PresentationContent;
  const validText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (!validText(content.title, 100) || !Array.isArray(content.slides) || content.slides.length < 1 || content.slides.length > 10 || content.slides.some(slide => !slide || !validText(slide.title, 100) || !Array.isArray(slide.bullets) || slide.bullets.length < 1 || slide.bullets.length > 5 || slide.bullets.some(bullet => !validText(bullet, 180)))) throw new Error("The slide content is too long or incomplete. Try a shorter request.");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "2ndBrain";
  pptx.subject = "AI-generated presentation";
  pptx.title = content.title;
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  const cover = pptx.addSlide();
  cover.background = { color: "183451" };
  cover.addText(content.title, { x: 0.9, y: 2.25, w: 11.5, h: 1.35, fontFace: "Arial", fontSize: 36, bold: true, color: "FFFFFF", breakLine: false, fit: "shrink", margin: 0 });
  cover.addText("PRESENTATION", { x: 0.9, y: 1.5, w: 5, h: 0.3, fontSize: 12, bold: true, color: "A3DAD6", charSpacing: 2, margin: 0 });
  for (const [index, item] of content.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(item.title, { x: 0.8, y: 0.55, w: 11.8, h: 0.85, fontSize: 29, bold: true, color: "183451", fit: "shrink", margin: 0 });
    item.bullets.forEach((bullet, i) => slide.addText(bullet, { x: 1.0, y: 1.7 + i * 0.84, w: 11.15, h: 0.72, fontSize: 20, color: "30455A", breakLine: false, fit: "shrink", bullet: { indent: 20 }, margin: 0.05 }));
    slide.addText(String(index + 2), { x: 12, y: 7.1, w: 0.5, h: 0.2, fontSize: 9, color: "6C7F90", align: "right", margin: 0 });
  }
  return Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
}
