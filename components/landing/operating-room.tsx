"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RECORD } from "./record";

type Phase = "idle" | "running" | "waiting" | "approved" | "rejected";

type TimelineStep = {
  at: number;
  fn: () => void;
};

const NODE_POS = new Map(
  [...RECORD.graphNodes, RECORD.graphNewNode].map((node) => [node.id, node])
);

function nodeXY(id: string) {
  const node = NODE_POS.get(id);
  return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

function isSemanticEdge(from: string, to: string) {
  return Boolean(NODE_POS.get(from)?.label) && Boolean(NODE_POS.get(to)?.label);
}

function consoleLineClass(line: string) {
  if (line.startsWith("$")) {
    return "lp-console__line lp-console__cmd";
  }

  if (line.startsWith("[ok]")) {
    return "lp-console__line lp-console__ok";
  }

  if (line.startsWith("[..]")) {
    return "lp-console__line lp-console__wait";
  }

  if (line.startsWith("[!]")) {
    return "lp-console__line lp-console__err";
  }

  return "lp-console__line";
}

function indexStyle(index: number) {
  return { "--lp-i": index } as CSSProperties;
}

export function OperatingRoom() {
  const [phase, setPhase] = useState<Phase>("idle");

  const bentoRef = useRef<HTMLDivElement | null>(null);
  const ingestCellRef = useRef<HTMLElement | null>(null);
  const editorCellRef = useRef<HTMLElement | null>(null);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
  const treeCellRef = useRef<HTMLElement | null>(null);
  const graphCellRef = useRef<HTMLElement | null>(null);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);

  const editorLineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const editorTextRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const caretRef = useRef<HTMLSpanElement | null>(null);

  const runLineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const autoLineRef = useRef<HTMLSpanElement | null>(null);
  const approvedLineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const rejectedLineRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const consoleAnchorRef = useRef<HTMLSpanElement | null>(null);
  const gateAnchorRef = useRef<HTMLSpanElement | null>(null);
  const tracePathRef = useRef<SVGPathElement | null>(null);
  const padARef = useRef<SVGCircleElement | null>(null);
  const padBRef = useRef<SVGCircleElement | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const prmRef = useRef(false);
  const inViewRef = useRef(false);
  const startedRef = useRef(false);

  const stepsRef = useRef<TimelineStep[]>([]);
  const stepIndexRef = useRef(0);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const typingRef = useRef({
    started: false,
    done: false,
    line: 0,
    chars: 0,
    carry: 0,
    lastT: null as number | null,
    raf: null as number | null
  });

  const setPhaseBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  };

  /* reveal timers belong to one gate outcome; a new outcome cancels the old sequence */
  const laterReveal = (ms: number, fn: () => void) => {
    const id = setTimeout(fn, ms);
    revealTimersRef.current.push(id);
  };

  const clearRevealTimers = () => {
    revealTimersRef.current.forEach((id) => clearTimeout(id));
    revealTimersRef.current = [];
  };

  const revealConsoleLine = (el: HTMLSpanElement | null) => {
    if (!el) {
      return;
    }

    el.classList.add("is-on");
    const body = consoleBodyRef.current;

    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  };

  const hideConsoleLines = (els: (HTMLSpanElement | null)[]) => {
    els.forEach((el) => el?.classList.remove("is-on"));
  };

  const clearAutoTimer = () => {
    if (autoTimerRef.current !== null) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  };

  const armAutoApprove = () => {
    clearAutoTimer();
    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null;
      runApprove(true);
    }, 7000);
  };

  /* ---- trace geometry ---- */

  const traceActive = () =>
    (phaseRef.current === "waiting" || phaseRef.current === "approved") &&
    window.matchMedia("(min-width: 960px)").matches;

  const placeTrace = () => {
    const bento = bentoRef.current;
    const a = consoleAnchorRef.current;
    const b = gateAnchorRef.current;
    const path = tracePathRef.current;

    if (!bento || !a || !b || !path || a.offsetParent === null) {
      return false;
    }

    const br = bento.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const gr = b.getBoundingClientRect();
    const ax = ar.left + ar.width / 2 - br.left + 10;
    const ay = ar.top + ar.height / 2 - br.top;
    const bx = gr.left + gr.width / 2 - br.left;
    const by = gr.top + gr.height / 2 - br.top;

    path.setAttribute("d", `M ${ax.toFixed(1)} ${ay.toFixed(1)} H ${bx.toFixed(1)} V ${by.toFixed(1)}`);
    padARef.current?.setAttribute("cx", ax.toFixed(1));
    padARef.current?.setAttribute("cy", ay.toFixed(1));
    padBRef.current?.setAttribute("cx", bx.toFixed(1));
    padBRef.current?.setAttribute("cy", by.toFixed(1));

    return true;
  };

  const clearTraceInline = () => {
    const path = tracePathRef.current;

    if (!path) {
      return;
    }

    path.style.transition = "";
    path.style.strokeDasharray = "";
    path.style.strokeDashoffset = "";
  };

  const snapTrace = () => {
    if (!traceActive()) {
      return;
    }

    clearTraceInline();
    placeTrace();
  };

  const drawTrace = () => {
    if (!traceActive() || !placeTrace()) {
      return;
    }

    const path = tracePathRef.current;

    if (!path) {
      return;
    }

    let length = 0;

    try {
      length = path.getTotalLength();
    } catch {
      length = 0;
    }

    if (length <= 0) {
      return;
    }

    const pattern: number[] = [];
    let covered = 0;

    while (covered < length) {
      pattern.push(6, 4);
      covered += 10;
    }

    pattern.push(0, Math.ceil(length));
    path.style.transition = "none";
    path.style.strokeDasharray = pattern.join(" ");
    path.style.strokeDashoffset = String(Math.ceil(length));
    void path.getBoundingClientRect();
    path.style.transition = "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)";
    path.style.strokeDashoffset = "0";
    later(640, clearTraceInline);
  };

  /* ---- typing ---- */

  const moveCaret = (lineIndex: number) => {
    const line = editorLineRefs.current[lineIndex];
    const caret = caretRef.current;

    if (line && caret) {
      line.appendChild(caret);
    }
  };

  const typingTick = (now: number) => {
    const t = typingRef.current;
    t.raf = null;

    if (t.lastT === null) {
      t.lastT = now;
    }

    t.carry += (now - t.lastT) / 22;
    t.lastT = now;
    const texts = RECORD.editorLines;

    while (t.carry >= 1 && t.line < texts.length) {
      t.carry -= 1;
      const text = texts[t.line];

      if (t.chars < text.length) {
        t.chars += 1;
        const el = editorTextRefs.current[t.line];

        if (el) {
          el.textContent = text.slice(0, t.chars);
        }
      } else {
        t.line += 1;
        t.chars = 0;

        if (t.line < texts.length) {
          moveCaret(t.line);
        }
      }
    }

    if (t.line >= texts.length) {
      t.done = true;

      if (caretRef.current) {
        caretRef.current.style.display = "none";
      }

      return;
    }

    t.raf = requestAnimationFrame(typingTick);
  };

  const startTyping = () => {
    const cell = editorCellRef.current;

    if (!cell) {
      return;
    }

    if (window.matchMedia("(max-width: 640px)").matches) {
      cell.classList.add("is-run");
      return;
    }

    const t = typingRef.current;

    if (t.started) {
      return;
    }

    t.started = true;
    editorTextRefs.current.forEach((el) => {
      if (el) {
        el.textContent = "";
      }
    });
    cell.classList.add("is-typing");
    moveCaret(0);
    t.raf = requestAnimationFrame(typingTick);
  };

  const pauseTyping = () => {
    const t = typingRef.current;

    if (t.raf !== null) {
      cancelAnimationFrame(t.raf);
      t.raf = null;
    }

    t.lastT = null;
  };

  const resumeTyping = () => {
    const t = typingRef.current;

    if (t.started && !t.done && t.raf === null) {
      t.raf = requestAnimationFrame(typingTick);
    }
  };

  /* ---- timeline ---- */

  const scheduleNext = () => {
    const steps = stepsRef.current;
    const index = stepIndexRef.current;

    if (index >= steps.length || stepTimerRef.current !== null) {
      return;
    }

    const previousAt = index === 0 ? 0 : steps[index - 1].at;

    stepTimerRef.current = setTimeout(() => {
      stepTimerRef.current = null;
      steps[index].fn();
      stepIndexRef.current = index + 1;
      scheduleNext();
    }, steps[index].at - previousAt);
  };

  const enterWaiting = () => {
    revealConsoleLine(runLineRefs.current[3] ?? null);
    setPhaseBoth("waiting");
    drawTrace();
    armAutoApprove();
  };

  const buildTimeline = () => {
    stepsRef.current = [
      { at: 0, fn: () => setPhaseBoth("running") },
      { at: 0, fn: () => ingestCellRef.current?.classList.add("is-run") },
      { at: 600, fn: startTyping },
      { at: 1000, fn: () => treeCellRef.current?.classList.add("is-run") },
      { at: 1600, fn: () => graphCellRef.current?.classList.add("is-run") },
      { at: 2200, fn: () => revealConsoleLine(runLineRefs.current[0] ?? null) },
      { at: 2900, fn: () => revealConsoleLine(runLineRefs.current[1] ?? null) },
      { at: 3600, fn: () => revealConsoleLine(runLineRefs.current[2] ?? null) },
      { at: 4300, fn: enterWaiting }
    ];
    stepIndexRef.current = 0;
  };

  const pauseAll = () => {
    if (stepTimerRef.current !== null) {
      clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }

    pauseTyping();
    clearAutoTimer();
  };

  const resumeAll = () => {
    if (!inViewRef.current || document.hidden || prmRef.current) {
      return;
    }

    if (startedRef.current) {
      scheduleNext();
      resumeTyping();

      if (phaseRef.current === "waiting" && autoTimerRef.current === null) {
        armAutoApprove();
      }
    }
  };

  /* ---- gate actions ---- */

  const runApprove = (auto: boolean) => {
    if (phaseRef.current === "approved") {
      return;
    }

    clearAutoTimer();
    clearRevealTimers();
    hideConsoleLines(rejectedLineRefs.current);

    if (prmRef.current) {
      if (auto) {
        revealConsoleLine(autoLineRef.current);
      }

      approvedLineRefs.current.forEach((el) => revealConsoleLine(el));
      setPhaseBoth("approved");
      snapTrace();
      return;
    }

    clearTraceInline();
    setPhaseBoth("approved");
    const sequence: (HTMLSpanElement | null)[] = [];

    if (auto) {
      sequence.push(autoLineRef.current);
    }

    sequence.push(...approvedLineRefs.current);
    sequence.forEach((el, index) => {
      laterReveal(600 * (index + 1), () => revealConsoleLine(el));
    });
  };

  const runReject = () => {
    if (phaseRef.current === "rejected") {
      return;
    }

    clearAutoTimer();
    clearRevealTimers();

    if (prmRef.current) {
      hideConsoleLines([autoLineRef.current, ...approvedLineRefs.current]);
      rejectedLineRefs.current.forEach((el) => revealConsoleLine(el));
      setPhaseBoth("rejected");
      return;
    }

    if (phaseRef.current !== "waiting") {
      return;
    }

    clearTraceInline();
    setPhaseBoth("rejected");
    rejectedLineRefs.current.forEach((el, index) => {
      laterReveal(450 * (index + 1), () => revealConsoleLine(el));
    });
  };

  const handleApprove = () => {
    if (prmRef.current) {
      runApprove(false);
      return;
    }

    if (phaseRef.current !== "waiting") {
      return;
    }

    runApprove(false);
  };

  const handleReject = () => {
    runReject();
  };

  const handleRunAgain = () => {
    clearAutoTimer();
    clearRevealTimers();
    hideConsoleLines(rejectedLineRefs.current);
    setPhaseBoth("waiting");

    if (prmRef.current) {
      snapTrace();
    } else {
      drawTrace();
    }

    armAutoApprove();
  };

  /* ---- lifecycle ---- */

  useEffect(() => {
    const bento = bentoRef.current;

    if (!bento) {
      return;
    }

    prmRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* cross-highlight: editor heading hover lights the matching graph node */
    const nodeMap = new Map<string, SVGGElement>();
    bento.querySelectorAll<SVGGElement>("g.lp-node[data-node]").forEach((g) => {
      const id = g.getAttribute("data-node");

      if (id) {
        nodeMap.set(id, g);
      }
    });

    const toggleLit = (target: EventTarget | null, on: boolean) => {
      if (!window.matchMedia("(pointer: fine) and (min-width: 960px)").matches) {
        return;
      }

      const el = target instanceof Element ? target.closest("[data-node]") : null;
      const id = el?.getAttribute("data-node");

      if (id) {
        nodeMap.get(id)?.classList.toggle("is-lit", on);
      }
    };

    const onOver = (event: MouseEvent) => toggleLit(event.target, true);
    const onOut = (event: MouseEvent) => toggleLit(event.target, false);
    const editorBody = editorBodyRef.current;
    editorBody?.addEventListener("mouseover", onOver);
    editorBody?.addEventListener("mouseout", onOut);

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => snapTrace()) : null;
    resizeObserver?.observe(bento);

    if (prmRef.current) {
      /* reduced motion: render the approved end-frame, keep buttons live */
      bento.classList.add("is-static");
      [ingestCellRef, editorCellRef, treeCellRef, graphCellRef].forEach((ref) =>
        ref.current?.classList.add("is-run")
      );
      runLineRefs.current.forEach((el) => el?.classList.add("is-on"));
      approvedLineRefs.current.forEach((el) => el?.classList.add("is-on"));
      setPhaseBoth("approved");
      requestAnimationFrame(() => snapTrace());

      return () => {
        editorBody?.removeEventListener("mouseover", onOver);
        editorBody?.removeEventListener("mouseout", onOut);
        resizeObserver?.disconnect();
        clearAutoTimer();
        clearRevealTimers();
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry) {
          return;
        }

        inViewRef.current = entry.isIntersecting;

        if (entry.isIntersecting) {
          bento.classList.add("is-live");

          if (!startedRef.current) {
            startedRef.current = true;
            buildTimeline();
            scheduleNext();
          } else {
            resumeAll();
          }
        } else {
          bento.classList.remove("is-live");
          pauseAll();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.2 }
    );
    io.observe(bento);

    const onVisibility = () => {
      if (document.hidden) {
        pauseAll();
      } else {
        resumeAll();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      editorBody?.removeEventListener("mouseover", onOver);
      editorBody?.removeEventListener("mouseout", onOut);
      pauseAll();
      clearRevealTimers();
      timeoutsRef.current.forEach((id) => clearTimeout(id));
      timeoutsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gateSettled = phase === "approved" || phase === "rejected";

  return (
    <div className="lp-bento" data-phase={phase} ref={bentoRef}>
      {/* 01 · INTENT */}
      <article className="lp-cell lp-cell--intent">
        <span aria-hidden="true" className="lp-cell__tag">01 · INTENT</span>
        <h3 className="lp-cell__title">One prompt. One owned project.</h3>
        <p className="lp-cell__sub">
          Every wiki project gets its own ID, its own workspace folder, and a Ready state —
          like these three, each generated from a single prompt.
        </p>
        <div className="lp-deck">
          <div className="lp-deck__card lp-deck__card--back2">
            <img
              alt="Generated wiki project card for a Singapore property agent profile"
              height={900}
              loading="lazy"
              src="/landing/3.png"
              width={830}
            />
          </div>
          <div className="lp-deck__card lp-deck__card--back1">
            <img
              alt="Generated wiki project card for an academic lecturer profile"
              height={900}
              loading="lazy"
              src="/landing/2.png"
              width={830}
            />
          </div>
          <div className="lp-deck__card lp-deck__card--front">
            <img
              alt="Generated wiki project card for a senior DevSecOps engineer profile"
              height={900}
              loading="lazy"
              src="/landing/1.png"
              width={830}
            />
          </div>
        </div>
        <p className="lp-fig">fig. 01 — three real wiki projects, generated from single prompts.</p>
      </article>

      {/* 02 · INGEST */}
      <article className="lp-cell lp-cell--ingest" ref={ingestCellRef}>
        <span aria-hidden="true" className="lp-cell__tag">02 · INGEST</span>
        <h3 className="lp-cell__title">Feed it real sources.</h3>
        <div aria-hidden="true" className="lp-drop">
          {RECORD.files.map((file, index) => (
            <span className="lp-chip-file" key={file.name} style={indexStyle(index)}>
              {file.name} <small>{file.size}</small>
            </span>
          ))}
          <span className="lp-convert-arrow">
            <svg aria-hidden="true" focusable="false" viewBox="0 0 60 10">
              <path d="M1 5 H52 M47 1.5 L53 5 L47 8.5" fill="none" pathLength={1} />
            </svg>
            converted to markdown
          </span>
        </div>
        <p className="lp-cell__sub">
          PDF, DOCX, TXT, Markdown, images — converted into pages you can read, not embeddings
          you can&rsquo;t.
        </p>
        <p className="lp-fig">fig. 02 — sources become pages.</p>
      </article>

      {/* 03 · WIKI */}
      <article className="lp-cell lp-cell--editor" ref={editorCellRef}>
        <span aria-hidden="true" className="lp-cell__tag">03 · WIKI</span>
        <h3 className="lp-cell__title">Get a wiki, not a vibe.</h3>
        <div aria-hidden="true" className="lp-editor" ref={editorBodyRef}>
          <div className="lp-editor__tab">{RECORD.editorTab}</div>
          <div className="lp-editor__body">
            {RECORD.editorLines.map((line, index) => {
              const node = RECORD.editorLineNodes[index];

              return (
                <span
                  className="lp-editor__line"
                  data-node={node ?? undefined}
                  key={line}
                  ref={(el) => {
                    editorLineRefs.current[index] = el;
                  }}
                  style={indexStyle(index)}
                >
                  <span
                    className="lp-editor__text"
                    ref={(el) => {
                      editorTextRefs.current[index] = el;
                    }}
                  >
                    {line}
                  </span>
                </span>
              );
            })}
            <span className="lp-caret" ref={caretRef} />
          </div>
        </div>
        <p className="lp-fig">fig. 03 — markdown you can correct. demo replay.</p>
      </article>

      {/* 04 · TREE */}
      <article className="lp-cell lp-cell--tree" ref={treeCellRef}>
        <span aria-hidden="true" className="lp-cell__tag">04 · TREE</span>
        <h3 className="lp-cell__title">Every page, accounted for.</h3>
        <div aria-hidden="true" className="lp-tree">
          {RECORD.treeRows.map((row, index) => (
            <span className="lp-tree__row" key={row} style={indexStyle(index)}>
              {row}
            </span>
          ))}
          {phase === "approved" ? (
            <span className="lp-tree__row lp-tree__new">{`   └─ ${RECORD.treeInsert}`}</span>
          ) : null}
        </div>
        <p aria-hidden="true" className="lp-tree__count">
          {phase === "approved"
            ? `${RECORD.pagesAfter} pages (+1)`
            : `${RECORD.pagesBefore} pages indexed`}
        </p>
        <p className="lp-fig">fig. 04 — the project tree grows.</p>
      </article>

      {/* 05 · GRAPH */}
      <article className="lp-cell lp-cell--graph" ref={graphCellRef}>
        <span aria-hidden="true" className="lp-cell__tag">05 · GRAPH</span>
        <h3 className="lp-cell__title">Pages become a map.</h3>
        <svg
          aria-hidden="true"
          className="lp-micrograph"
          focusable="false"
          viewBox="0 0 400 170"
        >
          {RECORD.graphEdges.map(([from, to], index) => {
            const a = nodeXY(from);
            const b = nodeXY(to);

            return (
              <line
                className={`lp-edge${isSemanticEdge(from, to) ? " lp-edge--semantic" : ""}`}
                key={`${from}-${to}`}
                pathLength={1}
                style={indexStyle(index)}
                x1={a.x}
                x2={b.x}
                y1={a.y}
                y2={b.y}
              />
            );
          })}
          {RECORD.graphNewEdges.map(([from, to], index) => {
            const a = nodeXY(from);
            const b = nodeXY(to);

            return (
              <line
                className="lp-edge lp-edge--new"
                key={`${from}-${to}`}
                pathLength={1}
                style={indexStyle(index)}
                x1={a.x}
                x2={b.x}
                y1={a.y}
                y2={b.y}
              />
            );
          })}
          {RECORD.graphNodes.map((node, index) => (
            <g
              className="lp-node"
              data-node={node.label ? node.id : undefined}
              key={node.id}
              style={indexStyle(index)}
            >
              <circle cx={node.x} cy={node.y} r={node.label ? 5 : 4} />
              {node.label ? (
                <text x={node.x} y={node.y - 10}>
                  {node.label}
                </text>
              ) : null}
            </g>
          ))}
          <g className="lp-node lp-node--new" data-node={RECORD.graphNewNode.id}>
            <circle cx={RECORD.graphNewNode.x} cy={RECORD.graphNewNode.y} r={5} />
            <text x={RECORD.graphNewNode.x} y={RECORD.graphNewNode.y - 10}>
              {RECORD.graphNewNode.label}
            </text>
          </g>
        </svg>
        <p className="lp-cell__sub">
          Wiki pages sync into a per-project knowledge graph — draggable nodes, semantic edges,
          scoped so it stays fast.
        </p>
        <p className="lp-fig">fig. 05 — one graph per project. demo replay.</p>
      </article>

      {/* 06 · RUN */}
      <article className="lp-cell lp-cell--console">
        <span aria-hidden="true" className="lp-cell__tag">06 · RUN</span>
        <h3 className="lp-cell__title">The run, in the open.</h3>
        <div aria-hidden="true" className="lp-console" ref={consoleBodyRef}>
          {RECORD.consoleRun.map((line, index) => (
            <span
              className={consoleLineClass(line)}
              key={line}
              ref={(el) => {
                runLineRefs.current[index] = el;
              }}
            >
              {line}
              {index === 3 ? (
                <>
                  <span className="lp-dot-amber" />
                  <span className="lp-anchor lp-anchor--console" ref={consoleAnchorRef} />
                </>
              ) : null}
            </span>
          ))}
          <span
            className={`${consoleLineClass(RECORD.consoleAutoApproved)} lp-console__alt`}
            ref={autoLineRef}
          >
            {RECORD.consoleAutoApproved}
          </span>
          {RECORD.consoleApproved.map((line, index) => (
            <span
              className={`${consoleLineClass(line)} lp-console__alt`}
              key={`ok-${line}-${index}`}
              ref={(el) => {
                approvedLineRefs.current[index] = el;
              }}
            >
              {line}
            </span>
          ))}
          {RECORD.consoleRejected.map((line, index) => (
            <span
              className={`${consoleLineClass(line)} lp-console__alt`}
              key={`no-${line}-${index}`}
              ref={(el) => {
                rejectedLineRefs.current[index] = el;
              }}
            >
              {line}
            </span>
          ))}
        </div>
        <p className="lp-fig">fig. 06 — provisioning, replayed from the real flow.</p>
      </article>

      {/* 07 · APPROVE */}
      <article className="lp-cell lp-cell--telegram">
        <span aria-hidden="true" className="lp-cell__tag">07 · APPROVE</span>
        <h3 className="lp-cell__title">Nothing sensitive ships without you.</h3>
        <div className="lp-tg">
          <p aria-hidden="true" className="lp-tg__head">2ndBrain Agent · 09:42</p>
          <p aria-hidden="true" className="lp-tg__msg">
            Requesting approval: restore the workspace snapshot in the Cloud. Reply to
            continue.
          </p>
          <span aria-hidden="true" className="lp-anchor lp-anchor--gate" ref={gateAnchorRef} />
          <div className="lp-tg__actions">
            <button
              aria-describedby="lp-fig-approve"
              aria-disabled={gateSettled}
              className="lp-tg__btn lp-tg__btn--approve"
              onClick={handleApprove}
              type="button"
            >
              Approve
            </button>
            <button
              aria-describedby="lp-fig-approve"
              aria-disabled={gateSettled}
              className="lp-tg__btn lp-tg__btn--reject"
              onClick={handleReject}
              type="button"
            >
              Reject
            </button>
          </div>
          {phase === "approved" ? (
            <p aria-hidden="true" className="lp-tg__result lp-tg__result--ok">
              ✓ Approved · 09:42
            </p>
          ) : null}
          {phase === "rejected" ? (
            <>
              <p aria-hidden="true" className="lp-tg__result lp-tg__result--no">
                ✗ Rejected — halted.
              </p>
              <button className="lp-replay-btn" onClick={handleRunAgain} type="button">
                Run it again
              </button>
            </>
          ) : null}
        </div>
        <p className="lp-fig" id="lp-fig-approve">
          fig. 07 — human-in-the-loop, by design. demo replay — the real gate arrives in your
          Telegram.
        </p>
      </article>

      <svg aria-hidden="true" className="lp-trace-svg" focusable="false">
        <path className="lp-trace-path" d="M0 0" ref={tracePathRef} />
        <circle className="lp-pad" r={4} ref={padARef} />
        <circle className="lp-pad" r={4} ref={padBRef} />
      </svg>

      <p className="lp-vh">
        Demo replay: the agent restores a workspace snapshot in the Cloud, converts five
        source files into 14 markdown wiki pages, syncs them into a knowledge graph, then pauses
        at a Telegram approval gate. Approving adds one page and one graph node; rejecting halts
        the run with nothing executed.
      </p>
      <p aria-live="polite" className="lp-vh" role="status">
        {phase === "waiting"
          ? "Demo gate armed: the run is waiting for approval."
          : phase === "approved"
            ? "Demo approved: one page and one graph node were added."
            : phase === "rejected"
              ? "Demo rejected: the run halted and nothing executed."
              : ""}
      </p>
    </div>
  );
}
