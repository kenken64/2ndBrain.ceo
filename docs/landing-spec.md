# 2ndBrain.ceo Landing Page — Final Implementation Spec

**Concept: THE OPERATING ROOM** (winning concept, 3-judge panel) with grafts from FIELD RECORD No. 0001 and THE LIVING GRAPH.

The landing page is a miniature, running replay of the product. The centerpiece is the **Gated Bento** at `#how-it-works`: seven cells showing the real surfaces (intent projects, file ingest, markdown editor, wiki tree, knowledge graph, provisioning console, Telegram approval) wired to ONE simulated run that freezes at "waiting for telegram approval" until the visitor clicks Approve — with an honest auto-approve fallback so non-clickers still see the payoff. Every claim maps to a README fact. Every demo number reconciles across the page ("we keep our books").

---

## 0. Judge-criticism resolution ledger

Every criticism of the winner, and where this spec resolves it:

| # | Criticism (judge) | Resolution (spec section) |
|---|---|---|
| 1 | Bento desktop layout scrambles 01→06 narrative order (J2) | Re-mapped grid: row-major reading order = 01…07 exactly; the human gate is the final cell (§4.1) |
| 2 | Everything animates simultaneously (J2) | Single sequenced timeline in narrative order with exact timestamps (§4.4) |
| 3 | Requires a click most visitors never make; "page won't finish" reads hostile (J2, J3) | Auto-approve fallback at +7 s with the honest console line `[ok] demo auto-approved — your real agent keeps waiting`; Reject path keeps its payoff and offers replay (§4.5) |
| 4 | Cross-cell SVG trace unspecced across remaps/resize — hardest implementation problem (J3) | Gate cells are now adjacent in row 3; trace is a short routed elbow between two anchor refs, recomputed via one ResizeObserver, rendered ≥ 960 px only; border-pulse fallback below (§4.6) |
| 5 | Jargon leaks into CEO copy (`clawmacdo ls-restore-fast`, `OPENCLAW RUNTIME` eyebrow) (J2) | The CLI command appears only inside the console cell (terminal context = integrity, per J3); hero kicker and all section copy are plain English (§1) |
| 6 | Hero placeholder invites attaching files into a GET-mode ChatInput that renders no attach button (J3 — verified `supportsAttachments = method === "post"`, components/chat-input.tsx:71) | Placeholder is a quoted sample brief, no attach invitation; file-type facts ("PDF · DOCX · TXT · MD · images — up to 8 files, 12 MB each") sit beside the `#start` CTA that links to `/intent`, where the POST form actually accepts them (§1.1, §1.7) |
| 7 | Typography least ambitious; centered safe stack; gradient text is a cliché (J1) | Left-aligned asymmetric 12-col hero, H1 `clamp(44px, 7.5vw, 92px)` at −0.03 em, mono kicker, one `vertical-rl` margin annotation; gradient text replaced by a hand-drawn SVG underline that draws in; Manrope actually loaded via `next/font/google` (§1.1, §2.2) |
| 8 | Fast scroller hits a frozen "waiting" grid (J3) | Replay reaches the gate in ~4.3 s, starts early via `rootMargin`, and the gate self-resolves at +7 s (§4.4–4.5) |
| 9 | Outside the signature section the page is ordinary (J1) | Grafts: provisioning-receipt panel in `#setup`, "fig. 0X" lab captions on every bento cell, markdown-hover-lights-graph-node cross-highlight, dashed-until-approved trace, reconciling-numbers ledger at `#start`, blunt mono footlines (§1, §4.7) |
| 10 | Performance hygiene under-specced (J1/J3) | All loops cancel on IntersectionObserver exit AND `visibilitychange`; typing mutates refs, never React state; ≤ 640 px drops typing/trace entirely; one master reduced-motion block (§3.1, §4.8, §7) |
| 11 | Replay numbers can drift after copy edits (J1/J3) | Every demo string and number lives in one shared const module `components/landing/record.ts` (§2.3) |

---

## 1. Final section order and copy

Page order (ids exactly as required by MarketingNav — `#how-it-works`, `#setup`, `#workspace` all present):

1. Hero (no id; `<main id="main-content">` wraps everything)
2. `#how-it-works` — The Operating Room (Gated Bento, signature)
3. `#setup` — Boot Sequence + Provisioning Receipt
4. `#workspace` — Three Rooms
5. `#ownership` — Exit Is a Feature
6. `#integrations` — Wired In
7. `#start` — Final CTA
8. `<Footer />` (existing component, untouched)

Every `id`'d section gets `scroll-margin-top: 96px` on `.lp-section` (load-bearing: `html { scroll-behavior: smooth }` is global at globals.css:62, sticky nav is 76 px).

All copy below is FINAL. Mono strings are shown in `code`.

### 1.1 Hero — The Intent Console

- **Kicker** (mono pill, 12 px, letterspaced): `YOUR OWN AGENT · YOUR OWN MACHINE · YOUR APPROVAL`
- **H1** (the page's only `h1`, two lines, left-aligned):
  **"Everything your agent knows."**
  **"In a wiki you own."**
  — "wiki you own" is wrapped in `.lp-underline-wrap` with an inline SVG underline (single hand-drawn path, stroke `var(--brand-blue)`, 5 px) that draws in. No gradient text anywhere on the page.
- **Vertical margin annotation** (mono 11 px, `writing-mode: vertical-rl`, right edge, ≥ 960 px only, aria-hidden): `MEMORY: MARKDOWN · RUNTIME: AWS LIGHTSAIL · GATE: TELEGRAM`
- **Subhead** (max 620 px, `var(--fg-secondary)`): "2ndBrain.ceo provisions a dedicated AI agent on AWS Lightsail, then writes everything it learns into editable markdown — wiki pages, a per-project knowledge graph, and a Telegram approval gate you hold. Read it. Edit it. Export it. It's yours."
- **ChatInput** (existing component, untouched): `<ChatInput action="/intent" method="get" className="lp-hero-chat" placeholder="Brief your agent: 'Build an operating wiki for our vendor contracts and flag every renewal date…'" />`
  — No attach invitation in the placeholder (GET mode renders no attach button).
- **Caption under chat** (13 px, `var(--fg-secondary)`): "Your prompt becomes a wiki project — markdown pages you can read, edit, and export, plus a knowledge graph you can drag around. Source files attach on the next screen."
- **Agent status line** (mono 12 px): `agent: idle — awaiting intent ▍` (block cursor blinks; paid off at `#start`)
- **Runs-on strip** (label + uppercase 11 px letterspaced spans): "Runs on" → `AWS LIGHTSAIL · SUPABASE · TELEGRAM · GOOGLE WORKSPACE · SOLANA`
- **Decorative circuit traces**: one inline SVG (aria-hidden) of 3 thin traces with node dots running from beneath the H1 into the chat frame corners, stroke `var(--brand-blue)` at 0.35 opacity. Hidden < 640 px.

### 1.2 `#how-it-works` — The Operating Room

- **Kicker**: `HOW IT WORKS`
- **H2**: "No black box. This is the machine."
- **Lead** (max 720 px): "One intent becomes a wiki, a graph, and a gated action — replayed in miniature below, including the part where nothing runs until someone says go. These are the real surfaces you'll use."

Seven bento cells, each with a mono cell tag (top-left) and a mono "fig." caption (below the cell). Final copy:

| Cell | Tag | H3 | Body / content | fig. caption |
|---|---|---|---|---|
| A | `01 · INTENT` | "One prompt. One owned project." | "Every wiki project gets its own ID, its own workspace folder, and a Ready state — like these three, each generated from a single prompt." + fanned deck of `/landing/1.png` `/landing/2.png` `/landing/3.png` | `fig. 01 — three real wiki projects, generated from single prompts.` |
| B | `02 · INGEST` | "Feed it real sources." | Dropzone outline cycling file chips: `board-deck.pdf 2.1 MB` → `pricing-notes.docx 840 KB` → `standup.txt 12 KB` → `spec.md 6 KB` → `whiteboard.png 3.4 MB`, then mono `⟶ converted to markdown`. Sub: "PDF, DOCX, TXT, Markdown, images — converted into pages you can read, not embeddings you can't." | `fig. 02 — sources become pages.` |
| C | `03 · WIKI` | "Get a wiki, not a vibe." | Faux editor: file tab `operations/incident-runbook.md`; typed body: `# Incident Runbook` / `Generated from 3 sources. Edited by you.` / `## Escalation` / `1. Page the on-call lead` / `2. Open the gateway console` | `fig. 03 — markdown you can correct. demo replay.` |
| D | `04 · TREE` | "Every page, accounted for." | Mono tree: `wiki-1748212996/` / `├─ overview.md` / `├─ sources/` / `│  ├─ q3-board-deck.md` / `│  └─ pricing-notes.md` / `└─ operations/`. Footer count: `14 pages indexed` → flips to `15 pages (+1)` on approval, when `incident-runbook.md` inserts under `operations/` with a green flash. | `fig. 04 — the project tree grows.` |
| E | `05 · GRAPH` | "Pages become a map." | Inline-SVG micro-graph: 11 nodes (6 labeled: `Pricing`, `Q3 Deck`, `Escalation`, `On-call`, `Gateway`, `Vendors`; 5 unlabeled dots), 12 edges. Sub: "Wiki pages sync into a per-project knowledge graph — draggable nodes, semantic edges, scoped so it stays fast." On approval: node `Runbook` pops in with 2 new edges (→ Escalation, → Gateway). | `fig. 05 — one graph per project. demo replay.` |
| G | `06 · RUN` | "The run, in the open." | Dark console card (the page's single dark surface). Lines: `$ clawmacdo ls-restore-fast` / `[ok] snapshot found: openclaw-base` / `[ok] runtime restored on lightsail` / `[..] telegram pairing: waiting for approval` — then per outcome, see §4.5. | `fig. 06 — provisioning, replayed from the real flow.` |
| F | `07 · APPROVE` | "Nothing sensitive ships without you." | Telegram-style message card: header `2ndBrain Agent · 09:42`; message: "Requesting approval: restore the workspace snapshot on AWS Lightsail. Reply to continue." Buttons **[Approve] [Reject]** (real buttons). After approve, appended row: `✓ Approved · 09:42`. After reject: `✗ Rejected — halted.` + mono **Run it again** button. | `fig. 07 — human-in-the-loop, by design. demo replay — the real gate arrives in your Telegram.` |

The CLI command `clawmacdo ls-restore-fast` appears ONLY in the console cell (README Product Flow step 4 verbatim — terminal context, never in prose).

### 1.3 `#setup` — Boot Sequence

- **Kicker**: `SETUP`
- **H2**: "Five gates. Each one visible."
- **Lead**: "Onboarding wires identity, approval, and runtime together — in that order, with a human checkpoint before anything heavy runs." (No unverified duration claims.)
- **Steps** (left rail, lucide icons `LogIn`, `UserRound`, `Server`, `MessageCircle`, `LayoutDashboard`):
  - `01` **Sign in with Google** — "Supabase OAuth. No new password to invent."
  - `02` **Set your identity** — "Owner name, avatar name, and avatar setup, so generated pages reference you consistently."
  - `03` **Provision the runtime** — "A ready-made agent snapshot is restored onto a dedicated AWS Lightsail instance. Your own machine, not a shared pool."
  - `04` **Pair Telegram** — "Your approval channel. Sensitive agent actions wait here until you say go — with progress shown while they wait."
  - `05` **Enter the dashboard** — "Wiki, graph, and gateway are live. Start with intent."
- **Provisioning receipt** (sticky right card, mono 13 px, dashed internal rules, slight `rotate(0.6deg)`):
  - Header: `PROVISIONING RECORD`
  - `✓ google sign-in ....... verified`
  - `✓ identity ............. owner + avatar set`
  - `✓ lightsail restore .... dedicated instance`
  - `✓ telegram pairing ..... approved by you`
  - Status line (in `var(--brand-green)`): `STATUS: YOUR AGENT IS AWAKE`

### 1.4 `#workspace` — Three Rooms

- **Kicker**: `WORKSPACE`
- **H2**: "Three rooms. One memory."
- **Panels** (sticky room-nav left: `01 WIKI` / `02 GRAPH` / `03 GATEWAY`):
  - **Panel 1 — LLM Wiki.** Lead line: "The memory, as markdown." Body: "Generate a wiki project from an intent prompt and optional source files. Then open the markdown and change it — your edits are the source of truth, not a chat transcript." Checklist: `edit, save, and export any generated page` · `search and paginate across every project` · `delete a project and its workspace folder with it`. Footer chip (styled as code, not a link): `/dashboard/wiki`
  - **Panel 2 — Knowledge Graph.** Lead line: "The memory, as a map." Body: "Wiki pages sync into graph tables scoped per project, so big wikis stay fast. Explore concepts and page links as a living map." Checklist: `draggable nodes, semantic edges` · `one graph per project, re-runnable on demand` · `built on cytoscape with the fcose layout`. Footer chip: `/dashboard/graph`
  - **Panel 3 — AI Agent Gateway.** Lead line: "The runtime, in the open." Body: "Your agent is a real machine you can inspect. Check gateway status, refresh URLs, reconnect the model — or drop into the authenticated SSH console." Checklist: `gateway status + reconnect controls` · `authenticated SSH console, in the dashboard` · `destroy the workspace whenever you choose`. Footer chip: `/dashboard/openclaw`

### 1.5 `#ownership` — Exit Is a Feature

- **Kicker**: `OWNERSHIP`
- **H2**: "If you can't edit it, export it, and delete it — you don't own it."
- **Rows** (lucide `PencilLine` / `Download` / `Trash2` in tinted squircles — blue, green, orange at 12 % background):
  - **Edit** — "Every generated page is plain markdown. Rewrite anything; your version wins."
  - **Export** — "Take the entire wiki out as files. No proprietary format, no exit interview."
  - **Delete** — "Removing a project removes its workspace folder too. Gone means gone."
- **Visual** (right): folder outline with three `.md` chips (`overview.md`, `runbook.md`, `pricing.md`) sliding out onto a dotted "your disk" boundary. Caption: `markdown in, markdown out`
- **Footline** (mono 12 px, `var(--fg-secondary)`): `teardown is one click. export first. no hostages.`

### 1.6 `#integrations` — Wired In

- **Kicker**: `INTEGRATIONS`
- **H2**: "Wired in, not walled in."
- **Six chips** (lucide icon + name + mono descriptor):
  - `Briefcase` **Google Workspace** — "agent-side credentials via Google OAuth"
  - `Send` **Telegram** — "pairing + approval gate"
  - `Terminal` **SSH Console** — "authenticated, in-dashboard"
  - `Video` **Remotion Avatar** — "a face for your agent"
  - `KeyRound` **Google OAuth** — "sign-in through Supabase"
  - `Coins` **Solana** — "credit top-ups on-chain"
- **Footline** (mono 12 px): `every jack on this panel ships today. nothing here is "coming soon".`

### 1.7 `#start` — Final CTA

- **Mono status line** (pays off the hero): `agent: ready — awaiting intent ▍`
- **H2**: "Give it something worth remembering."
- **Buttons**: primary `<a class="btn-primary" href="/intent">Start with intent <span class="arrow">-&gt;</span></a>` · ghost `<a class="btn-ghost" href="/onboarding">Walk through onboarding</a>`
- **File facts caption** (sits HERE because `/intent` hosts the POST form that accepts attachments): `PDF · DOCX · TXT · MD · images — up to 8 files, 12 MB each.`
- **Reconciliation ledger** (mono 12 px, below a thin rule): `demo ledger — 15 pages · 12 nodes · 14 edges · 1 human approval. same numbers the machine printed above. we keep our books.`
- Card has a 3 px top border in a blue→green linear gradient (the only gradient on the page; a hairline, not text).

---

## 2. File plan

### 2.1 `app/page.tsx` (server component — structure sketch)

Keeps: `export const dynamic = "force-dynamic"`, `<Atmosphere/>`, `<MarketingNav supabaseConfigured={hasSupabaseEnv()}/>`, skip-link, `.page-shell`, `<Footer/>`, hero `<ChatInput action="/intent" method="get"/>`.

```tsx
import { Manrope } from "next/font/google";
import { Atmosphere } from "@/components/atmosphere";
import { ChatInput } from "@/components/chat-input";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { hasSupabaseEnv } from "@/lib/env";
import { Reveal } from "@/components/landing/reveal";
import { OperatingRoom } from "@/components/landing/operating-room";
import { BootRail } from "@/components/landing/boot-rail";
import { WorkspaceRail } from "@/components/landing/workspace-rail";
import { ExportProof } from "@/components/landing/export-proof";
import { RECORD } from "@/components/landing/record";
import "./landing.css";

export const dynamic = "force-dynamic";

const manrope = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"]
});

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Atmosphere />
      <div className={`page-shell lp-type ${manrope.variable}`}>
        <MarketingNav supabaseConfigured={hasSupabaseEnv()} />
        <main id="main-content">
          <section className="lp-hero">{/* server JSX: kicker, h1 + SVG underline,
            vertical annotation, subhead, ChatInput, status line, runs-on strip,
            decorative traces SVG — all CSS-animated, no client JS */}</section>
          <section className="lp-section" id="how-it-works">
            {/* Reveal-wrapped header, then: */}
            <OperatingRoom />
          </section>
          <section className="lp-section" id="setup">
            <BootRail />
          </section>
          <section className="lp-section" id="workspace">
            <WorkspaceRail />
          </section>
          <section className="lp-section" id="ownership">
            {/* Reveal-wrapped card; rows server JSX; visual: */}
            <ExportProof />
          </section>
          <section className="lp-section" id="integrations">{/* Reveal chips */}</section>
          <section className="lp-section" id="start">{/* Reveal card; ledger uses RECORD */}</section>
        </main>
        <Footer />
      </div>
    </>
  );
}
```

Notes:
- `next/font/google` is built into Next.js — **no new npm dependency**. It self-hosts the woff2 at build time, fixing the "Manrope never actually loads" failure. `--font-manrope` is exposed on the `.page-shell` wrapper; `landing.css` sets `.lp-type { font-family: var(--font-manrope), var(--font-sans); }` so the whole landing (nav, chat, footer included) finally renders real Manrope. Fallback if the build environment blocks Google Fonts: drop `Manrope-{400..800}.woff2` into `public/fonts/` and `@font-face` them from `landing.css` instead — same variable name, nothing else changes.
- Forbidden files untouched: `marketing-nav.tsx`, `footer.tsx`, `chat-input.tsx`, `atmosphere.tsx`, `brand-heart.tsx`, `globals.css`. No reuse of `.hero`, `.section`, `.steps-grid`, etc. Reused from globals: `.container`, `.btn-primary`, `.btn-ghost`, `.skip-link`, `.page-shell`, and all CSS custom properties.

### 2.2 `app/landing.css` — lp- class inventory (every new class prefixed `lp-`)

**Globals/shared**
`.lp-type` (font), `.lp-section` (padding-block clamp(72px, 9vw, 128px); `scroll-margin-top: 96px`), `.lp-kicker` (mono pill), `.lp-h2` (clamp(32px, 4.5vw, 54px), 800, −0.02 em), `.lp-lead`, `.lp-mono` (mono utility), `.lp-vh` (visually hidden clip pattern), `.lp-footline`, `[data-lp-reveal]` + `.is-in` (reveal system), `:root`-level `--lp-ease: cubic-bezier(0.22, 1, 0.36, 1)` (declared inside `.lp-type` scope to avoid touching globals).

**Hero**
`.lp-hero`, `.lp-hero__grid` (12-col), `.lp-hero__kicker`, `.lp-hero__h1`, `.lp-hero__line` (overflow mask), `.lp-underline-wrap`, `.lp-underline` (SVG), `.lp-hero__annot` (vertical-rl), `.lp-hero__sub`, `.lp-hero-chat` (wrapper spacing only — ChatInput internals untouched), `.lp-hero__caption`, `.lp-status` + `.lp-status__cursor`, `.lp-runs-on`, `.lp-traces`.

**Operating Room**
`.lp-or-head`, `.lp-bento` (12-col grid, `position: relative`), `.lp-cell` (white, `var(--radius-lg)`, `var(--border-soft)`, `var(--shadow-md)`, overflow hidden), `.lp-cell--intent|--ingest|--editor|--tree|--graph|--console|--telegram` (grid placement), `.lp-cell__tag`, `.lp-cell__title`, `.lp-cell__sub`, `.lp-fig` (caption), `.lp-deck`, `.lp-deck__card`, `.lp-drop`, `.lp-chip-file`, `.lp-convert-arrow`, `.lp-editor`, `.lp-editor__tab`, `.lp-editor__line`, `.lp-caret`, `.lp-tree`, `.lp-tree__row`, `.lp-tree__count`, `.lp-tree__new` (green flash), `.lp-micrograph`, `.lp-node`, `.lp-node--new`, `.lp-node.is-lit` (cross-highlight), `.lp-edge`, `.lp-console` (bg `#0d1420`), `.lp-console__line`, `.lp-console__ok|__wait|__err` (text tints), `.lp-tg`, `.lp-tg__head`, `.lp-tg__msg`, `.lp-tg__actions`, `.lp-tg__btn` + `.lp-tg__btn--approve|--reject`, `.lp-tg__result`, `.lp-replay-btn`, `.lp-trace-svg`, `.lp-trace-path` (+ `.is-waiting` dashed / `.is-approved` solid green), `.lp-pad` (solder dots), `.lp-dot-amber` (pulse), `.is-armed` (Telegram cell border-pulse fallback).

**Setup**
`.lp-setup-grid`, `.lp-rail`, `.lp-rail__line`, `.lp-rail__fill` (scaleY progress), `.lp-step`, `.lp-step__index`, `.lp-step__icon`, `.lp-step.is-done`, `.lp-receipt` (sticky), `.lp-receipt__head`, `.lp-receipt__row`, `.lp-receipt__check` (SVG), `.lp-receipt__rule` (dashed), `.lp-receipt__status` (+ one-shot green background flash).

**Workspace**
`.lp-ws-grid`, `.lp-room-nav`, `.lp-room-nav__item` + `.is-active`, `.lp-room-nav__bar` (translating indicator), `.lp-room-panel`, `.lp-room-panel__lead`, `.lp-check-list`, `.lp-check`, `.lp-path-chip` (mono code chip), `.lp-vignette` (per-panel static inline SVG).

**Ownership**
`.lp-own` (wide card), `.lp-own__rows`, `.lp-own-row`, `.lp-own-row__icon` (+ `--blue|--green|--orange` tints), `.lp-proof`, `.lp-proof__folder`, `.lp-proof__chip`, `.lp-proof__boundary` (dotted), `.lp-proof__caption`.

**Integrations**
`.lp-int-grid`, `.lp-int-chip`, `.lp-int-chip__icon`, `.lp-int-chip__sub`.

**Start**
`.lp-start-card` (+ `::before` 3 px blue→green top hairline), `.lp-start__status`, `.lp-start__h2`, `.lp-start__actions`, `.lp-start__files`, `.lp-start__ledger`.

**Master reduced-motion block** (last rules in the file — the safety net):
```css
@media (prefers-reduced-motion: reduce) {
  [class^="lp-"], [class*=" lp-"], [class^="lp-"]::before, [class*=" lp-"]::after,
  [data-lp-reveal] {
    animation: none !important;
    transition: none !important;
  }
  [data-lp-reveal] { opacity: 1 !important; transform: none !important; }
}
@media (scripting: none) {
  [data-lp-reveal] { opacity: 1; transform: none; }  /* no-JS failsafe */
}
```

### 2.3 `components/landing/record.ts` (shared const module — no `"use client"` needed)

Single source of truth for every demo string and number (J1 + J3 graft). Anything the replay prints, the page reconciles against:

```ts
export const RECORD = {
  pagesBefore: 14, pagesAfter: 15,
  nodesBefore: 11, nodesAfter: 12,
  edgesBefore: 12, edgesAfter: 14,
  approvals: 1,
  files: [
    { name: "board-deck.pdf", size: "2.1 MB" },
    { name: "pricing-notes.docx", size: "840 KB" },
    { name: "standup.txt", size: "12 KB" },
    { name: "spec.md", size: "6 KB" },
    { name: "whiteboard.png", size: "3.4 MB" }
  ],
  editorLines: [
    "# Incident Runbook",
    "Generated from 3 sources. Edited by you.",
    "## Escalation",
    "1. Page the on-call lead",
    "2. Open the gateway console"
  ],
  treeRows: ["wiki-1748212996/", "├─ overview.md", "├─ sources/",
    "│  ├─ q3-board-deck.md", "│  └─ pricing-notes.md", "└─ operations/"],
  treeInsert: "incident-runbook.md",
  consoleRun: [
    "$ clawmacdo ls-restore-fast",
    "[ok] snapshot found: openclaw-base",
    "[ok] runtime restored on lightsail",
    "[..] telegram pairing: waiting for approval"
  ],
  consoleApproved: [
    "[ok] approval received via telegram",
    "[ok] gateway online · ssh ready",
    "[ok] wiki synced: 15 pages (+1)",
    "$ "
  ],
  consoleAutoApproved: "[ok] demo auto-approved — your real agent keeps waiting",
  consoleRejected: ["[!] rejected — action halted. nothing ran.", "$ "],
  graphNodes: [/* id, label?, x, y — 11 entries; ids include "escalation", "gateway" */],
  graphEdges: [/* 12 [from, to] pairs */],
  graphNewNode: { id: "runbook", label: "Runbook" },
  graphNewEdges: [["runbook", "escalation"], ["runbook", "gateway"]],
  ledger: "demo ledger — 15 pages · 12 nodes · 14 edges · 1 human approval. same numbers the machine printed above. we keep our books."
} as const;
```

`#start` interpolates `RECORD.ledger`; the bento interpolates everything else. A copy edit can no longer break the books.

### 2.4 Client components (`components/landing/*.tsx`, all `"use client"`)

| File | Props | Behavior | DOM rendered |
|---|---|---|---|
| `reveal.tsx` | `{ as?: "div"\|"section"\|"article"\|"header"\|"p"\|"h2"\|"li"; className?: string; delay?: number; children: ReactNode }` | THE one reusable scroll-reveal. Module-level singleton `IntersectionObserver` (threshold 0.18, rootMargin `0px 0px -8% 0px`), lazily created; registers element via callback-ref into a `WeakMap<Element, () => void>`; adds `.is-in` and unobserves on first hit. If `matchMedia("(prefers-reduced-motion: reduce)")` matches at mount, adds `.is-in` synchronously. `delay` → inline `style={{ "--lp-delay": `${delay}ms` }}`. | One element of type `as` (default `div`) with `data-lp-reveal`, merged className, children passed through. |
| `operating-room.tsx` | none (imports `RECORD`) | The Gated Bento — full spec in §4. Owns the state machine, replay timeline, trace overlay, cross-highlight, all cleanup. | `<div className="lp-bento">` + 7 `<article className="lp-cell …">` + absolutely-positioned `<svg className="lp-trace-svg" aria-hidden>` + one `.lp-vh` prose paragraph. |
| `boot-rail.tsx` | none | Renders `#setup` body. IO (threshold 0) attaches a passive scroll listener only while the section is on screen; rAF-throttled handler maps section progress to `transform: scaleY()` on `.lp-rail__fill` (transform-origin top); flips `.is-done` on steps as the fill passes their `offsetTop`; receipt rows mirror the same indices (row N reveals when step N is done; status row when step 5 is done, with one 800 ms green background flash). PRM: render everything in done/printed state, no listener. | `.lp-setup-grid` → left `.lp-rail` + 5 `.lp-step` articles; right sticky `.lp-receipt` with rows + inline-SVG checkmarks. |
| `workspace-rail.tsx` | none | Renders `#workspace` body. One IO (threshold 0.55) over the three panels sets active index; indicator bar moves via `transform: translateY` (240 ms, `var(--lp-ease)`); nav labels shift `var(--fg-muted)` → `var(--fg-primary)`. Nav is `aria-hidden` decoration ≥ 960 px (panels are in normal document flow); hidden below 960 px. PRM: indicator jumps with no transition. | `.lp-ws-grid` → sticky left column (kicker, h2, `.lp-room-nav`), right column of 3 `.lp-room-panel` articles each with `.lp-vignette` static SVG, checklist, `.lp-path-chip`. |
| `export-proof.tsx` | none | IO (threshold 0.4, once): chips translate from inside the folder outline to the boundary line, staggered 0/120/240 ms, 600 ms ease-out; a 1 px dashed path draws under each (`stroke-dashoffset`). PRM: final positions, no draw. | `.lp-proof` → inline SVG folder + 3 `.lp-proof__chip` spans + dotted boundary + caption. |

`record.ts` is data only. Total new client JS is small (~9–12 KB minified across all five files); no new npm dependencies; lucide-react only for icons already listed in §1.

---

## 3. Motion spec

### 3.1 System rules (apply everywhere)

- Animate **only** `transform`, `opacity`, `stroke-dashoffset`, `background-color` (small surfaces), `border-color`. Never animate box-shadow on large surfaces; hover "lift" = `transform: translateY(-3px)` + pre-rendered shadow swap via opacity on a `::after`.
- Shared easing `var(--lp-ease)` = `cubic-bezier(0.22, 1, 0.36, 1)`; reveals 500 ms; micro-interactions 160–240 ms.
- ALL scroll reveals go through the one `Reveal` component (§2.4). Stagger via `delay` prop → `transition-delay: var(--lp-delay)`.
- Every JS loop (timeline, typing rAF, scroll rAF) pauses on IO exit AND `document.visibilitychange`, resumes where it left off, and is fully torn down in `useEffect` cleanup.
- The master `prefers-reduced-motion` block (§2.2) zeroes every lp- animation/transition; components additionally check `matchMedia` for behavioral fallbacks (end-states instead of choreography).

### 3.2 Per-section

| Section | Trigger | Animation | Reduced motion |
|---|---|---|---|
| Hero | Load only, pure CSS | H1 lines rise inside overflow masks: `translateY(110%)→0`, 700 ms `var(--lp-ease)`, delays 0/90 ms. SVG underline draws (`stroke-dashoffset → 0`, 500 ms) at +900 ms. Kicker/subhead fade-rise at +500/+650 ms; chat at +800 ms with ONE soft halo pulse (`box-shadow 0 0 0 0 → 0 0 0 10px rgba(0,167,255,.10) → 0`, 1.6 s, never loops). Traces draw 1.1 s at +500 ms, then 9 s linear dash-drift loop at 0.4 opacity. Status cursor blinks `steps(2)` 1.1 s. Runs-on spans fade in 60 ms apart. | Everything rendered final: underline full, traces static, cursor solid, no pulse. |
| #how-it-works | IO on bento (see §4) | Full timeline in §4.4. Header via Reveal. Cell hover: `translateY(-3px)` + border-color → `rgba(0,167,255,.35)`, 160 ms. | §4.8. |
| #setup | IO + gated scroll listener | Rail fill `scaleY` tracks scroll (rAF-throttled, transform only). Step flip: icon tint → `var(--brand-green)` 300 ms; receipt row reveals `opacity + translateY(6px)→0` 240 ms, check draws `stroke-dashoffset 16→0` 240 ms; status row lands with one 800 ms green background flash. Steps themselves reveal via Reveal, 100 ms stagger. | Rail full, all steps done, receipt fully printed, checks solid, no flash. |
| #workspace | IO threshold 0.55 | Indicator bar `translateY` 240 ms `var(--lp-ease)`; label color 200 ms. Panels reveal via Reveal (16 px rise), once. Gateway vignette's 3 console lines stagger-fade 120 ms apart on panel reveal. | Indicator jumps; everything else instant. |
| #ownership | IO 0.4 once (inside ExportProof) + Reveal on card | Chips `translate` folder→boundary, 600 ms ease-out, 0/120/240 ms stagger; dashed under-paths draw 400 ms; row icons do a single 6° tilt-settle (`rotate(6deg)→0`, 400 ms) on reveal. | Chips at final position, no draws, no tilt. |
| #integrations | Reveal per chip | Rise 10 px + fade, 45 ms cascade. Hover: border → `rgba(0,167,255,.4)`, icon → `var(--brand-blue)`, status-dot one-shot 600 ms glow (transition, not loop). | Instant render; hover changes color only. |
| #start | Reveal on card | Card reveal; cursor blink `steps(2)` 1.1 s; top hairline slides `background-position` once over 800 ms (background-size 200 %). | Static hairline, solid cursor, instant card. |

---

## 4. Signature interaction — the Gated Bento (implementation level)

### 4.1 Grid map (≥ 960 px) — narrative order resolved

`.lp-bento`: `display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: 250px; gap: 14px; position: relative; max-width: var(--container-max);`

```
row 1:  [ A  01 INTENT          ][ B 02 INGEST ][ C 03 WIKI       ]
row 2:  [ A  (spans rows 1–2)   ][ D 04 TREE   ][ E 05 GRAPH      ]
row 3:  [ G  06 RUN (console)            ][ F 07 APPROVE (gate)   ]
```

- A `grid-column: 1/6; grid-row: 1/3` — fanned deck of the three real screenshots (`<img src="/landing/1.png" width={830} height={900} loading="lazy" alt="Generated wiki project card for a senior DevSecOps engineer profile">` etc., `object-fit: cover; object-position: top` inside fixed `aspect-ratio` frames → zero CLS; back two cards offset 14/28 px, rotate −2°/2°).
- B `6/9, row 1` · C `9/13, row 1` · D `6/9, row 2` · E `9/13, row 2` · G `1/8, row 3` · F `8/13, row 3`.
- DOM order = A, B, C, D, E, G, F → row-major visual scan reads **01→07 exactly**; the human gate is the final cell. (Resolves J2's order criticism.)

### 4.2 State machine

`type Phase = "idle" | "running" | "waiting" | "approved" | "rejected"` held in one `useState`; all choreography driven by refs + a timeline runner so typing/log-appends never trigger React re-renders (textContent mutation on ref'd nodes).

### 4.3 SVG structures

- **Micro-graph (E)**: `viewBox="0 0 400 170"`, 11 `<g class="lp-node" data-node="…">` (6 with `<text>` labels at 11 px mono, 5 bare 5 px-radius circles), 12 `<line class="lp-edge">` (stroke `var(--border-strong)`, 1 px; semantic edges to labeled nodes in `rgba(0,167,255,.5)`). New node `Runbook` + 2 edges pre-rendered with `opacity: 0`, popped in on approval. Whole SVG `aria-hidden="true" focusable="false"`.
- **Trace overlay**: `<svg class="lp-trace-svg">` absolutely positioned `inset: 0`, `pointer-events: none`, full bento size, containing one `<path class="lp-trace-path">` + two 4 px `circle.lp-pad` solder pads.
- **Ingest (B)**: dashed-outline drop area (CSS border, not SVG) + file chips; mono arrow is a 60 px inline SVG line + chevron that draws.
- **Editor (C)**: plain DOM — `.lp-editor__tab` + five `.lp-editor__line` spans (mono 12.5 px) + `.lp-caret`.
- **Console (G)**: plain DOM `<div class="lp-console">` with appended `.lp-console__line` rows. Colors on `#0d1420`: default `#c9d6e3`, `[ok]` `#34d399`, `[..]` `#fbbf24`, `[!]` `#f87171`, command `#9fd8ff` (all ≥ 7:1 contrast).

### 4.4 Replay timeline (single sequenced run — nothing simultaneous)

Trigger: IO on `.lp-bento`, threshold 0.2, rootMargin `0px 0px -10% 0px` (starts just before fully in view → fast scrollers see it mid-flow, not frozen). Runs once per page load. Implementation: an array of `{ at: number, fn: () => void }` steps consumed by one `setTimeout` chain; a cursor index makes pause/resume trivial.

| t (ms) | Beat |
|---|---|
| 0 | B: file chips stagger in 80 ms apart (`translateY(8px)+fade`); convert-arrow draws (`stroke-dashoffset`, 300 ms) |
| 600 | C: editor starts typing — one rAF loop, ~2 chars per 33 ms tick, mutating `textContent` of the current line ref; caret blinks `steps(2)`; total ≈ 2.8 s |
| 1000 | D: tree rows stagger-reveal (`translateX(-6px)+fade`, 70 ms apart); count caption fades in: `14 pages indexed` |
| 1600 | E: 12 edges draw (`stroke-dashoffset`, 700 ms total), then 11 nodes pop `scale(.4)→1` (`transform-box: fill-box`, 50 ms stagger) |
| 2200 | G: console lines 1–3 append at 700 ms cadence |
| ~4300 | G prints `[..] telegram pairing: waiting for approval` → **phase = "waiting"**: amber dot pulses (scale/opacity keyframe, 1.2 s loop); trace draws G→F dashed (§4.6), 600 ms; F's Approve/Reject buttons breathe (2 s `box-shadow 0 0 0 0/6px rgba(0,167,255,.25)` loop — small buttons only, allowed) |
| +7000 after waiting | Auto-approve fires if untouched (§4.5) |

Graph idle drift: nodes get CSS `translate` keyframes ±4 px, 7–9 s `alternate`, `animation-play-state: paused` until the bento is in view, paused again on exit.

### 4.5 The gate (resolves "hostile gate" + "non-clickers never see payoff")

- **Approve (click)**: trace swaps `.is-waiting`→`.is-approved` — `stroke-dasharray` 6 4 → none, stroke → `var(--brand-green)`, 300 ms, plus one 400 ms opacity flash. Console resumes `RECORD.consoleApproved` at 600 ms cadence. D inserts `incident-runbook.md` under `operations/` (`.lp-tree__new`: green background flash 800 ms → transparent) and the count flips to `15 pages (+1)`. E pops node `Runbook` (`scale 0→1`, 380 ms, `cubic-bezier(0.34,1.56,0.64,1)`) + draws its 2 edges. F appends `✓ Approved · 09:42`; buttons disable (`aria-disabled`, opacity .5).
- **Reject (click)**: console prints `RECORD.consoleRejected`; trace fades out 300 ms; breathing stops; F appends `✗ Rejected — halted.` and reveals a mono **Run it again** button that returns phase to `"waiting"` (re-arms trace, breathing, and a fresh auto-approve timer). The page never punishes the skeptic — it proves the gate: *nothing ran.*
- **Auto-approve fallback**: 7 s after entering `"waiting"` with no interaction, the run approves itself, prefixing `RECORD.consoleAutoApproved` (`[ok] demo auto-approved — your real agent keeps waiting`) before the approved lines. Honest, self-labeling, and every scroller sees the full payoff. Timer cleared on any click, on IO exit (re-armed on re-entry), and on unmount.

### 4.6 Cross-cell trace geometry (resolves J3's "hardest unspecced problem")

- Rendered ONLY ≥ 960 px (`matchMedia("(min-width: 960px)")` checked at mount and on change).
- Two invisible 1 px anchor spans: `.lp-anchor--console` inline at the end of console line 4, `.lp-anchor--gate` just above F's button row. Endpoint = anchor's `getBoundingClientRect()` center minus the bento's rect origin.
- Path: exit the console anchor rightward, 90° elbow across the 14 px gutter, terminate at the gate anchor — total length ~120–200 px, drawn with rounded joins, 2 px stroke, solder-pad circles at both ends. Because G and F are adjacent in row 3, geometry is short, stable, and never crosses other cells.
- Recompute on a single `ResizeObserver` watching `.lp-bento` (covers viewport resize, font load reflow, grid remap). Path `d` is set imperatively on a ref.
- `< 960 px` fallback (J3 graft): no trace; the waiting state instead sets `.is-armed` on F — a synchronized 1.2 s border-pulse (`border-color` ↔ `rgba(0,167,255,.55)`) matching the console's amber dot cadence.

### 4.7 Cross-highlight graft (Living Graph — "two views, one memory")

Editor heading lines carry `data-node="runbook"` / `data-node="escalation"`. On `mouseenter`/`mouseleave`/`focus`/`blur` (delegated on the editor, pointer-fine and width ≥ 960 px only), toggle `.is-lit` on the matching `g.lp-node[data-node]` via a prebuilt ref map — JS class toggle, no `:has()` dependency. `.is-lit`: node circle fill → `var(--brand-blue)`, label → `var(--fg-primary)`, 200 ms. Pure progressive enhancement; zero claims added.

### 4.8 Reduced motion / a11y / cleanup for the bento

- **PRM**: component checks `matchMedia` once — phase initializes to `"approved"` end-frame (all lines printed, tree at 15 pages, Runbook node present, trace solid green, `✓ Approved` shown). Approve/Reject still respond with instant state swaps (Reject swaps to the rejected end-frame). No typing, drift, pulse, or breathing.
- **A11y**: console, editor, tree, ingest, and graph internals are `aria-hidden="true"`; one `.lp-vh` paragraph narrates the flow: "Demo replay: the agent restores a workspace snapshot on AWS Lightsail, converts five source files into 14 markdown wiki pages, syncs them into a knowledge graph, then pauses at a Telegram approval gate. Approving adds one page and one graph node; rejecting halts the run with nothing executed." Approve/Reject are real `<button>`s with visible focus rings (`box-shadow 0 0 0 3px rgba(0,167,255,.35)`) and `aria-describedby` pointing at fig. 07's caption id (the "demo replay" disclosure).
- **Cleanup**: timeline cursor + every timeout id + rAF id live in refs; IO exit and `visibilitychange: hidden` clear them (cursor position retained for resume); `useEffect` teardown clears all + disconnects IO/ResizeObserver.

---

## 5. Responsive plan (existing breakpoints: 960 / 640 / 420)

| Section | ≤ 960 px | ≤ 640 px | ≤ 420 px |
|---|---|---|---|
| Hero | Vertical annotation hidden; grid → single column, still left-aligned; H1 `clamp` midrange | Decorative traces `display: none`; runs-on strip wraps to 2 rows | H1 floor 40 px; subhead 16 px; chat full-width |
| Bento | 2-col grid: A spans both cols (min-height 360 px, row 1), then B\|C, D\|E, G full-width, F full-width — order preserved; trace replaced by `.is-armed` border-pulse | Single column in DOM order (= narrative order); `grid-auto-rows: auto`, cells `min-height: 200px`; typing disabled → editor lines fade in 120 ms apart; deck shows front card only (back cards `display: none`; with `loading="lazy"` they are typically never fetched); graph drift off | Cell padding 16 px; console 12 px text; Telegram buttons full-width stacked |
| Setup | Receipt unsticks, follows steps full-width, rotation removed; sticky also disabled under 700 px viewport height | Rail line moves to left 14 px; steps full-width | Receipt 12 px mono; dotted leaders shorten (`text-overflow` safe fixed strings) |
| Workspace | Sticky off; room-nav hidden; panels stack, 16 px gap | Panel padding 20 px; vignettes scale to 100 % width | Checklist 14 px |
| Ownership | Card stacks: rows above, proof visual below (max-height 260 px) | Proof chips shrink to 12 px mono | Card padding 20 px |
| Integrations | 3-col grid | 2-col | 2-col holds; sub-descriptors wrap |
| Start | — | Card padding 32 px | Buttons stack vertically, full-width |

General: hero uses `min-height: calc(100svh - 76px)`; all images carry explicit `width`/`height`; no horizontal scroll at 390 px (verify `.lp-bento` `min-width: 0` on cells).

---

## 6. Accessibility

- **Heading hierarchy**: exactly one `h1` (hero). Each section: one `h2`. Bento cells, setup steps, workspace panels, ownership rows: `h3`. No skipped levels.
- **Landmarks**: existing `header` (MarketingNav), `main#main-content` (skip-link target, kept), `footer` (Footer). Each `.lp-section` is a `<section>` with `aria-labelledby` pointing at its `h2` id (`lp-h-how`, `lp-h-setup`, `lp-h-workspace`, `lp-h-ownership`, `lp-h-integrations`, `lp-h-start`).
- **Decorative SVG**: every inline SVG (traces, underline, micro-graph, vignettes, receipt checks, proof folder) gets `aria-hidden="true" focusable="false"`. Simulated UI (console/editor/tree/Telegram transcript) is `aria-hidden` with `.lp-vh` prose equivalents (§4.8).
- **Contrast** (on white / `#f5f8fb`): body copy `var(--fg-secondary)` #52606d ≈ 7.0:1 ✓; `var(--fg-muted)` #8a97a6 ≈ 3.4:1 — used ONLY inside `aria-hidden` decoration (fig. captions duplicated meaningfully? no — fig captions are meaningful, so they use `var(--fg-secondary)` at 12 px; muted is reserved for the cell tags and ledger flourishes that are also present in accessible text elsewhere). Console colors all ≥ 7:1 on `#0d1420` (§4.3). Never set meaningful text in `var(--brand-blue)` on white below 18 px bold (3.0:1) — blue is for strokes, fills, and large display accents only.
- **Focus**: Approve / Reject / Run-it-again are real buttons with a 3 px visible focus ring; CTA anchors inherit globals' focus styles; nothing animated is focusable; the fixed-position nav keeps z-index 20 above all lp content (lp layers stay ≤ z-index 5).
- **Motion safety**: master PRM block (§2.2) + per-component `matchMedia` behavioral fallbacks; zero infinite loops under PRM (cursors solid, dots static); the only persistent loops in normal mode are two tiny cursor blinks, one 9 s hero dash-drift, and in-view graph drift — all paused off-screen or by tab visibility throttling.
- **No-JS**: `@media (scripting: none)` failsafe shows all Reveal content; the bento server-renders its final "approved" frame as initial markup styled-hidden only by JS-added classes — with JS dead, cells render readable static content.

---

## 7. Performance & weight budget

- **Zero new npm dependencies.** New assets: none beyond existing `/landing/1-3.png` (lazy, explicit dimensions, below the fold) and the build-time-self-hosted Manrope woff2 subsets (~70 KB total, `display: swap`).
- New client JS ≈ 9–12 KB min across five components; `record.ts` is shared data; hero animates with zero JS.
- Only compositor-friendly properties animated; all observers unobserve after first fire where one-shot; single shared Reveal observer; one ResizeObserver; rAF loops are singular and gated by IO + `visibilitychange`.
- `landing.css` target ≤ 18 KB raw; every selector lp-prefixed; no `!important` outside the PRM block.

## 8. Build checklist (acceptance gates)

1. `app/landing.css` created, imported at top of `app/page.tsx`; globals.css untouched; forbidden components untouched.
2. Ids `#how-it-works`, `#setup`, `#workspace` exist; nav anchors land unclipped (scroll-margin verified at 1440/390 px).
3. `page.tsx` remains a server component with `force-dynamic`, Atmosphere, MarketingNav(hasSupabaseEnv()), skip-link, `.page-shell`, Footer, and hero `ChatInput action="/intent" method="get"`.
4. Replay numbers reconcile: bento tree/graph/console vs `#start` ledger — all from `RECORD`.
5. Reduced-motion pass: emulate PRM in devtools; confirm end-states everywhere, no loops, buttons still functional.
6. Keyboard pass: tab order reaches chat → Approve/Reject → all CTAs with visible rings; skip-link works.
7. 390 px pass: no horizontal scroll, no mid-word typewriter reflow (typing disabled ≤ 640 px), deck shows one screenshot.
8. Run `npm run typecheck` (PowerShell) — nullable refs in operating-room/boot-rail are the expected friction; type all refs explicitly (`useRef<HTMLDivElement | null>(null)`, timeline ids as `ReturnType<typeof setTimeout>[]`).
9. `npm run build` once to confirm `next/font/google` resolves in the build environment; if blocked, switch to the self-hosted `@font-face` fallback (§2.1) — no other change required.
