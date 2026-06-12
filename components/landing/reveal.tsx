"use client";

import { createElement, useCallback, type CSSProperties, type ReactNode } from "react";

type RevealTag = "div" | "section" | "article" | "header" | "p" | "h2" | "li";

type RevealProps = {
  as?: RevealTag;
  className?: string;
  delay?: number;
  children: ReactNode;
};

let sharedObserver: IntersectionObserver | null = null;
const pending = new WeakMap<Element, () => void>();

function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
    return null;
  }

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          const fire = pending.get(entry.target);

          if (fire) {
            fire();
            pending.delete(entry.target);
          }

          sharedObserver?.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.18 }
    );
  }

  return sharedObserver;
}

export function Reveal({ as = "div", className, delay = 0, children }: RevealProps) {
  const register = useCallback((node: HTMLElement | null) => {
    if (!node) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.classList.add("is-in");
      return;
    }

    const observer = getObserver();

    if (!observer) {
      node.classList.add("is-in");
      return;
    }

    pending.set(node, () => node.classList.add("is-in"));
    observer.observe(node);

    return () => {
      pending.delete(node);
      observer.unobserve(node);
    };
  }, []);

  const style = delay
    ? ({ "--lp-delay": `${delay}ms` } as CSSProperties)
    : undefined;

  return createElement(
    as,
    {
      ref: register,
      className,
      "data-lp-reveal": "",
      style
    },
    children
  );
}
