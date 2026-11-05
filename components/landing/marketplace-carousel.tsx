"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function MarketplaceCarousel({ children, count, locale }: { children: ReactNode; count: number; locale: "en" | "zh" }) {
  const track = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const hintId = useId();
  const zh = locale === "zh";
  const [position, setPosition] = useState({ first: 1, last: Math.min(count, 3), back: false, next: count > 3 });

  const updatePosition = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    const cardWidth = element.firstElementChild?.getBoundingClientRect().width ?? element.clientWidth;
    const step = cardWidth + gap;
    if (step <= 0) return;
    const visible = Math.max(1, Math.round((element.clientWidth + gap) / step));
    const first = Math.max(1, Math.min(count, Math.round(element.scrollLeft / step) + 1));
    setPosition({ first, last: Math.min(count, first + visible - 1), back: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 });
  }, [count]);

  useEffect(() => {
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, [updatePosition]);

  function scrollPage(direction: number) {
    const element = track.current;
    if (!element) return;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    element.scrollBy({ left: direction * (element.clientWidth + gap), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      scrollPage(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      track.current?.scrollTo({ left: event.key === "Home" ? 0 : track.current.scrollWidth, behavior: "instant" });
    }
  }

  return <div className="lp-marketplace__carousel" role="region" aria-roledescription={zh ? "轮播" : "carousel"} aria-label={zh ? "工具市场" : "Marketplace tools"}>
    <div className="lp-marketplace__controls">
      <span className="lp-marketplace__position" aria-live="polite" aria-atomic="true">{zh ? `${position.first}–${position.last} / ${count} 个工具` : `${position.first}–${position.last} of ${count} tools`}</span>
      <div className="lp-marketplace__arrows">
        <button type="button" disabled={!position.back} aria-label={zh ? "上一组工具" : "Previous tools"} aria-controls={trackId} onClick={() => scrollPage(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" disabled={!position.next} aria-label={zh ? "下一组工具" : "Next tools"} aria-controls={trackId} onClick={() => scrollPage(1)}><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
    </div>
    <div ref={track} id={trackId} className="lp-marketplace__track" role="group" aria-label={zh ? "浏览工具" : "Browse tools"} aria-describedby={hintId} tabIndex={0} onScroll={updatePosition} onKeyDown={onKeyDown}>{children}</div>
    <p id={hintId} className="lp-marketplace__hint">{zh ? "左右滑动、使用箭头按钮，或聚焦此区域后使用键盘方向键浏览。" : "Swipe, use the arrow buttons, or focus the cards and use your keyboard arrow keys to browse."}</p>
  </div>;
}
