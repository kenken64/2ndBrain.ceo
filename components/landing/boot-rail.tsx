"use client";

import { useEffect, useRef } from "react";
import {
  LayoutDashboard,
  LogIn,
  MessageCircle,
  Server,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { Reveal } from "./reveal";

type BootStep = {
  index: string;
  icon: LucideIcon;
  title: string;
  body: string;
};

const STEPS: readonly BootStep[] = [
  {
    index: "01",
    icon: LogIn,
    title: "Sign in with Google",
    body: "Supabase OAuth. No new password to invent."
  },
  {
    index: "02",
    icon: UserRound,
    title: "Set your identity",
    body: "Owner name, avatar name, and avatar setup, so generated pages reference you consistently."
  },
  {
    index: "03",
    icon: Server,
    title: "Provision the runtime",
    body: "A ready-made agent snapshot is restored onto a dedicated Cloud instance. Your own machine, not a shared pool."
  },
  {
    index: "04",
    icon: MessageCircle,
    title: "Pair Telegram",
    body: "Your approval channel. Sensitive agent actions wait here until you say go — with progress shown while they wait."
  },
  {
    index: "05",
    icon: LayoutDashboard,
    title: "Enter the dashboard",
    body: "Wiki, graph, and gateway are live. Start with intent."
  }
];

const RECEIPT_ROWS: readonly string[] = [
  "google sign-in ....... verified",
  "identity ............. owner + avatar set",
  "cloud restore ........ dedicated instance",
  "telegram pairing ..... approved by you"
];

export function BootRail() {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickingRef = useRef(false);

  useEffect(() => {
    const grid = gridRef.current;
    const rail = railRef.current;

    if (!grid || !rail) {
      return;
    }

    const finishAll = () => {
      if (fillRef.current) {
        fillRef.current.style.transform = "scaleY(1)";
      }

      stepRefs.current.forEach((step) => step?.classList.add("is-done"));
      rowRefs.current.forEach((row) => row?.classList.add("is-on"));
      statusRef.current?.classList.add("is-on");
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishAll();
      return;
    }

    const update = () => {
      tickingRef.current = false;
      const rect = grid.getBoundingClientRect();
      const viewport = window.innerHeight;
      const progress = Math.min(1, Math.max(0, (viewport * 0.82 - rect.top) / rect.height));

      if (fillRef.current) {
        fillRef.current.style.transform = `scaleY(${progress.toFixed(4)})`;
      }

      const railRect = rail.getBoundingClientRect();
      const filled = progress * railRect.height;

      stepRefs.current.forEach((step, index) => {
        if (!step) {
          return;
        }

        const done = filled >= step.getBoundingClientRect().top - railRect.top + 22;
        step.classList.toggle("is-done", done);

        if (index < RECEIPT_ROWS.length) {
          rowRefs.current[index]?.classList.toggle("is-on", done);
        }

        if (index === STEPS.length - 1) {
          statusRef.current?.classList.toggle("is-on", done);
        }
      });
    };

    const onScroll = () => {
      if (!tickingRef.current) {
        tickingRef.current = true;
        rafRef.current = requestAnimationFrame(update);
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry) {
          return;
        }

        if (entry.isIntersecting) {
          window.addEventListener("scroll", onScroll, { passive: true });
          window.addEventListener("resize", onScroll);
          update();
        } else {
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll);
        }
      },
      { threshold: 0 }
    );
    io.observe(grid);

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <>
      <Reveal as="header" className="lp-sec-head">
        <p className="lp-kicker">SETUP</p>
        <h2 className="lp-h2" id="lp-h-setup">
          Five gates. Each one visible.
        </h2>
        <p className="lp-lead">
          Onboarding wires identity, approval, and runtime together — in that order, with a
          human checkpoint before anything heavy runs.
        </p>
      </Reveal>
      <div className="lp-setup-grid" ref={gridRef}>
        <div className="lp-rail" ref={railRef}>
          <span aria-hidden="true" className="lp-rail__line">
            <span className="lp-rail__fill" ref={fillRef} />
          </span>
          {STEPS.map((step, index) => {
            const Icon = step.icon;

            return (
              <Reveal delay={index * 100} key={step.index}>
                <article
                  className="lp-step"
                  ref={(el) => {
                    stepRefs.current[index] = el;
                  }}
                >
                  <span aria-hidden="true" className="lp-step__icon">
                    <Icon size={17} strokeWidth={1.8} />
                  </span>
                  <div className="lp-step__copy">
                    <span aria-hidden="true" className="lp-step__index">
                      {step.index}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
        <aside aria-label="Provisioning record" className="lp-receipt">
          <p className="lp-receipt__head">PROVISIONING RECORD</p>
          <ul className="lp-receipt__rows">
            {RECEIPT_ROWS.map((row, index) => (
              <li
                className="lp-receipt__row"
                key={row}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
              >
                <svg
                  aria-hidden="true"
                  className="lp-receipt__check"
                  focusable="false"
                  viewBox="0 0 16 16"
                >
                  <path d="M3 8.5 6.5 12 13 4.5" fill="none" pathLength={1} />
                </svg>
                <span>{row}</span>
              </li>
            ))}
          </ul>
          <p className="lp-receipt__status" ref={statusRef}>
            STATUS: YOUR AGENT IS AWAKE
          </p>
        </aside>
      </div>
    </>
  );
}
