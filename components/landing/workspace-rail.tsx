"use client";

import { useEffect, useRef } from "react";
import { Reveal } from "./reveal";

type RoomPanel = {
  id: string;
  nav: string;
  title: string;
  lead: string;
  body: string;
  checks: readonly string[];
  path: string;
};

const PANELS: readonly RoomPanel[] = [
  {
    id: "wiki",
    nav: "01 WIKI",
    title: "LLM Wiki",
    lead: "The memory, as markdown.",
    body: "Generate a wiki project from an intent prompt and optional source files. Then open the markdown and change it — your edits are the source of truth, not a chat transcript.",
    checks: [
      "edit, save, and export any generated page",
      "search and paginate across every project",
      "delete a project and its workspace folder with it"
    ],
    path: "/dashboard/wiki"
  },
  {
    id: "graph",
    nav: "02 GRAPH",
    title: "Knowledge Graph",
    lead: "The memory, as a map.",
    body: "Wiki pages sync into graph tables scoped per project, so big wikis stay fast. Explore concepts and page links as a living map.",
    checks: [
      "draggable nodes, semantic edges",
      "one graph per project, re-runnable on demand",
      "built on cytoscape with the fcose layout"
    ],
    path: "/dashboard/graph"
  },
  {
    id: "gateway",
    nav: "03 GATEWAY",
    title: "AI Agent Gateway",
    lead: "The runtime, in the open.",
    body: "Your agent is a real machine you can inspect. Check gateway status, refresh URLs, reconnect the model — or drop into the authenticated SSH console.",
    checks: [
      "gateway status + reconnect controls",
      "authenticated SSH console, in the dashboard",
      "destroy the workspace whenever you choose"
    ],
    path: "/dashboard/openclaw"
  }
];

function Vignette({ id }: { id: string }) {
  if (id === "wiki") {
    return (
      <svg aria-hidden="true" className="lp-vignette" focusable="false" viewBox="0 0 220 84">
        <rect className="lp-vignette__frame" height="80" rx="8" width="216" x="2" y="2" />
        <rect className="lp-vignette__accent" height="7" rx="3.5" width="92" x="16" y="16" />
        <rect className="lp-vignette__bar" height="5" rx="2.5" width="160" x="16" y="33" />
        <rect className="lp-vignette__bar" height="5" rx="2.5" width="178" x="16" y="46" />
        <rect className="lp-vignette__bar" height="5" rx="2.5" width="124" x="16" y="59" />
      </svg>
    );
  }

  if (id === "graph") {
    return (
      <svg aria-hidden="true" className="lp-vignette" focusable="false" viewBox="0 0 220 84">
        <rect className="lp-vignette__frame" height="80" rx="8" width="216" x="2" y="2" />
        <line className="lp-vignette__edge" x1="52" x2="110" y1="48" y2="24" />
        <line className="lp-vignette__edge" x1="110" x2="168" y1="24" y2="52" />
        <line className="lp-vignette__edge" x1="52" x2="120" y1="48" y2="64" />
        <line className="lp-vignette__edge" x1="168" x2="120" y1="52" y2="64" />
        <circle className="lp-vignette__node" cx="52" cy="48" r="6" />
        <circle className="lp-vignette__node lp-vignette__node--alt" cx="110" cy="24" r="5" />
        <circle className="lp-vignette__node" cx="168" cy="52" r="6" />
        <circle className="lp-vignette__node lp-vignette__node--alt" cx="120" cy="64" r="4" />
      </svg>
    );
  }

  return (
    <div aria-hidden="true" className="lp-vignette lp-vignette--console">
      <span className="lp-vignette__line">$ gateway status</span>
      <span className="lp-vignette__line">[ok] gateway online · url fresh</span>
      <span className="lp-vignette__line">[ok] ssh console ready</span>
    </div>
  );
}

export function WorkspaceRail() {
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const container = panelsRef.current;
    const nav = navRef.current;

    if (!container || !nav) {
      return;
    }

    const panels = Array.from(container.querySelectorAll<HTMLElement>(".lp-room-panel"));
    const items = Array.from(nav.querySelectorAll<HTMLElement>(".lp-room-nav__item"));

    const activate = (index: number) => {
      items.forEach((item, itemIndex) => {
        item.classList.toggle("is-active", itemIndex === index);
      });

      const target = items[index];

      if (barRef.current && target) {
        barRef.current.style.transform = `translateY(${target.offsetTop}px)`;
        barRef.current.style.height = `${target.offsetHeight}px`;
      }
    };

    activate(0);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          const index = panels.indexOf(entry.target as HTMLElement);

          if (index >= 0) {
            activate(index);
          }
        }
      },
      { threshold: 0.55 }
    );

    panels.forEach((panel) => io.observe(panel));

    return () => {
      io.disconnect();
    };
  }, []);

  return (
    <div className="lp-ws-grid">
      <div className="lp-ws-side">
        <Reveal as="header" className="lp-sec-head lp-sec-head--side">
          <p className="lp-kicker">WORKSPACE</p>
          <h2 className="lp-h2" id="lp-h-workspace">
            Three rooms. One memory.
          </h2>
        </Reveal>
        <div aria-hidden="true" className="lp-room-nav" ref={navRef}>
          <span className="lp-room-nav__bar" ref={barRef} />
          {PANELS.map((panel) => (
            <span className="lp-room-nav__item" key={panel.id}>
              {panel.nav}
            </span>
          ))}
        </div>
      </div>
      <div className="lp-ws-panels" ref={panelsRef}>
        {PANELS.map((panel, index) => (
          <Reveal className="lp-room-panel-wrap" delay={index * 60} key={panel.id}>
            <article className="lp-room-panel">
              <p className="lp-room-panel__lead">{panel.lead}</p>
              <h3>{panel.title}</h3>
              <p className="lp-room-panel__body">{panel.body}</p>
              <Vignette id={panel.id} />
              <ul className="lp-check-list">
                {panel.checks.map((check) => (
                  <li className="lp-check" key={check}>
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                      <path d="M3 8.5 6.5 12 13 4.5" fill="none" />
                    </svg>
                    {check}
                  </li>
                ))}
              </ul>
              <code className="lp-path-chip">{panel.path}</code>
            </article>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
