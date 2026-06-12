"use client";

import { useEffect, useRef } from "react";

const CHIPS = ["overview.md", "runbook.md", "pricing.md"] as const;

export function ExportProof() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("is-in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry?.isIntersecting) {
          root.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(root);

    return () => {
      io.disconnect();
    };
  }, []);

  return (
    <div className="lp-proof" ref={rootRef}>
      <div aria-hidden="true" className="lp-proof__stage">
        <svg className="lp-proof__folder" focusable="false" viewBox="0 0 96 76">
          <path
            d="M6 16 a6 6 0 0 1 6 -6 h22 l8 8 h36 a6 6 0 0 1 6 6 v40 a6 6 0 0 1 -6 6 h-66 a6 6 0 0 1 -6 -6 Z"
            fill="none"
          />
        </svg>
        <div className="lp-proof__flow">
          <svg className="lp-proof__paths" focusable="false" preserveAspectRatio="none" viewBox="0 0 100 100">
            <line pathLength={1} x1="2" x2="96" y1="20" y2="20" />
            <line pathLength={1} x1="2" x2="96" y1="50" y2="50" />
            <line pathLength={1} x1="2" x2="96" y1="80" y2="80" />
          </svg>
          {CHIPS.map((chip, index) => (
            <span
              className="lp-proof__chip"
              key={chip}
              style={{ top: `${11 + index * 30}%`, "--lp-i": index } as React.CSSProperties}
            >
              {chip}
            </span>
          ))}
        </div>
        <div className="lp-proof__boundary">
          <span>your disk</span>
        </div>
      </div>
      <p className="lp-proof__caption">markdown in, markdown out</p>
    </div>
  );
}
