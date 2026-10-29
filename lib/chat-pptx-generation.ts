import PptxGenJS from "pptxgenjs";

export type PresentationContent = { title: string; slides: Array<{ title: string; bullets: string[] }> };

export async function renderChatPresentation(value: unknown): Promise<Buffer> {
  if (!value || typeof value !== "object") throw new Error("Invalid presentation content.");
  const content = value as PresentationContent;
  const validText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (!validText(content.title, 500) || !Array.isArray(content.slides) || content.slides.length < 1 || content.slides.length > 50 || content.slides.some(slide => !slide || !validText(slide.title, 500) || !Array.isArray(slide.bullets) || slide.bullets.length < 1 || slide.bullets.length > 50 || slide.bullets.some(bullet => !validText(bullet, 4000)))) throw new Error("The slide content is invalid or exceeds the presentation limits.");
  if (content.title.length + content.slides.reduce((sum, slide) => sum + slide.title.length + slide.bullets.reduce((n, bullet) => n + bullet.length, 0), 0) > 30_000) throw new Error("The slide content exceeds the presentation limits.");
  // Preserve long model responses by splitting bullets and continuing onto additional slides.
  const slides: PresentationContent["slides"] = [];
  for (const slide of content.slides) {
    const bullets: string[] = [];
    for (const bullet of slide.bullets) {
      let remaining = bullet.trim();
      while (remaining.length > 180) {
        let cut = remaining.lastIndexOf(" ", 180);
        if (cut < 90) cut = 180;
        if (cut > 0 && /[\uD800-\uDBFF]/.test(remaining[cut - 1]) && /[\uDC00-\uDFFF]/.test(remaining[cut])) cut--;
        bullets.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) bullets.push(remaining);
    }
    for (let start = 0; start < bullets.length; start += 5) {
      slides.push({ title: start ? `${slide.title} (continued)` : slide.title, bullets: bullets.slice(start, start + 5) });
    }
  }
  if (slides.length > 100) throw new Error("The slide content exceeds the presentation limits.");
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
  for (const [index, item] of slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(item.title, { x: 0.8, y: 0.55, w: 11.8, h: 0.85, fontSize: 29, bold: true, color: "183451", fit: "shrink", margin: 0 });
    item.bullets.forEach((bullet, i) => slide.addText(bullet, { x: 1.0, y: 1.7 + i * 0.84, w: 11.15, h: 0.72, fontSize: 20, color: "30455A", breakLine: false, fit: "shrink", bullet: { indent: 20 }, margin: 0.05 }));
    slide.addText(String(index + 2), { x: 12, y: 7.1, w: 0.5, h: 0.2, fontSize: 9, color: "6C7F90", align: "right", margin: 0 });
  }
  return Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
}
