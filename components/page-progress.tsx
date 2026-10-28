"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SHOW_DELAY_MS = 180;
const MAX_WAIT_MS = 30_000;

export function PageProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clear() {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      showTimer.current = null;
      resetTimer.current = null;
      setVisible(false);
    }
    clear();
    return clear;
  }, [pathname, search]);

  useEffect(() => {
    function clear() {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      showTimer.current = null;
      resetTimer.current = null;
      setVisible(false);
    }
    function start() {
      if (showTimer.current || resetTimer.current) return;
      showTimer.current = setTimeout(() => { showTimer.current = null; setVisible(true); }, SHOW_DELAY_MS);
      resetTimer.current = setTimeout(clear, MAX_WAIT_MS);
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target.toLowerCase() !== "_self")) return;
      let url: URL;
      try { url = new URL(link.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol) || url.pathname.startsWith("/api/")) return;
      if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    }
    document.addEventListener("click", onClick);
    window.addEventListener("pageshow", clear);
    window.addEventListener("aicuber:page-navigation", start);
    return () => { document.removeEventListener("click", onClick); window.removeEventListener("pageshow", clear); window.removeEventListener("aicuber:page-navigation", start); clear(); };
  }, []);

  return visible ? <div className="page-progress" role="status" aria-live="polite"><span className="page-progress__track" aria-hidden="true" /><span className="page-progress__label">Loading page…</span></div> : null;
}
