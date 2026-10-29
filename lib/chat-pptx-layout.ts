export type Rect = { x: number; y: number; w: number; h: number };
export type LayoutCandidate = { slideNumber: number; obstacles: Rect[] };
export type SlideLayoutPlan = { slideNumber: number; positions: Rect[]; scale: number };

function right(rect: Rect) { return rect.x + rect.w; }
function bottom(rect: Rect) { return rect.y + rect.h; }
export function rectanglesOverlap(a: Rect, b: Rect) { return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y; }
function contains(a: Rect, b: Rect) { return a.x <= b.x && a.y <= b.y && right(a) >= right(b) && bottom(a) >= bottom(b); }
function valid(rect: Rect) { return [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0; }

// Conservatively partition the usable slide around every retained design element.
function freeRectangles(width: number, height: number, obstacles: Rect[]): Rect[] {
  const marginX = width * 0.04, marginY = height * 0.04, padding = Math.min(width, height) * 0.015;
  let free: Rect[] = [{ x: marginX, y: marginY, w: width - marginX * 2, h: height - marginY * 2 }];
  for (const item of obstacles) {
    const obstacle = { x: item.x - padding, y: item.y - padding, w: item.w + padding * 2, h: item.h + padding * 2 };
    const next: Rect[] = [];
    for (const rect of free) {
      if (!rectanglesOverlap(rect, obstacle)) { next.push(rect); continue; }
      const left = Math.max(rect.x, obstacle.x), rightEdge = Math.min(right(rect), right(obstacle));
      const top = Math.max(rect.y, obstacle.y), bottomEdge = Math.min(bottom(rect), bottom(obstacle));
      next.push({ x: rect.x, y: rect.y, w: left - rect.x, h: rect.h }, { x: rightEdge, y: rect.y, w: right(rect) - rightEdge, h: rect.h }, { x: rect.x, y: rect.y, w: rect.w, h: top - rect.y }, { x: rect.x, y: bottomEdge, w: rect.w, h: bottom(rect) - bottomEdge });
    }
    const options = next.filter(valid).sort((a, b) => b.w * b.h - a.w * a.h);
    const reduced: Rect[] = [];
    for (const rect of options) {
      if (!reduced.some(other => contains(other, rect))) reduced.push(rect);
      if (reduced.length >= 64) break;
    }
    free = reduced;
  }
  return free;
}

export function planSlideLayout(width: number, height: number, source: Rect[], candidates: LayoutCandidate[]): SlideLayoutPlan {
  if (!(width > 0 && height > 0) || source.some(rect => !valid(rect) || rect.x < 0 || rect.y < 0 || right(rect) > width || bottom(rect) > height)) throw new Error("A source slide contains an object outside the slide or without a usable position.");
  if (!source.length) {
    const candidate = candidates.find(item => item.obstacles.every(valid));
    if (!candidate) throw new Error("No template slide has enough clear space to place this slide without overlaps. Choose a simpler layout or reduce the content.");
    return { slideNumber: candidate.slideNumber, positions: [], scale: 1 };
  }
  const gap = Math.min(width, height) * 0.005;
  for (let i = 0; i < source.length; i++) for (let j = i + 1; j < source.length; j++) {
    const expanded = { x: source[i].x - gap, y: source[i].y - gap, w: source[i].w + gap * 2, h: source[i].h + gap * 2 };
    if (rectanglesOverlap(expanded, source[j])) throw new Error("Source slide objects overlap or are too close together. Simplify the slide or separate those objects before transferring it.");
  }
  const x = Math.min(...source.map(rect => rect.x)), y = Math.min(...source.map(rect => rect.y));
  const w = Math.max(...source.map(right)) - x, h = Math.max(...source.map(bottom)) - y;
  let best: { candidate: LayoutCandidate; area: Rect; scale: number } | undefined;
  for (const candidate of candidates) {
    if (candidate.obstacles.some(rect => !valid(rect))) continue;
    for (const area of freeRectangles(width, height, candidate.obstacles)) {
      const scale = Math.min(1, area.w / w, area.h / h);
      if (scale < 0.65) continue;
      if (!best || scale > best.scale + 0.000001 || (Math.abs(scale - best.scale) < 0.000001 && area.w * area.h > best.area.w * best.area.h)) best = { candidate, area, scale };
    }
  }
  if (!best) throw new Error("No template slide has enough clear space to place this slide without overlaps. Choose a simpler layout or reduce the content.");
  const originX = best.area.x + (best.area.w - w * best.scale) / 2, originY = best.area.y + (best.area.h - h * best.scale) / 2;
  const positions = source.map(rect => ({ x: originX + (rect.x - x) * best!.scale, y: originY + (rect.y - y) * best!.scale, w: rect.w * best!.scale, h: rect.h * best!.scale }));
  if (positions.some(position => best!.candidate.obstacles.some(obstacle => rectanglesOverlap(position, obstacle)))) throw new Error("The selected template cannot be used without overlap.");
  return { slideNumber: best.candidate.slideNumber, positions, scale: best.scale };
}
