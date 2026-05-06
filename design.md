# design.md — Lovable.dev Clone Spec (v3)

> A clone-ready design specification covering both the **marketing homepage** at `https://lovable.dev/` and the **in-product surfaces** (dashboard, onboarding, chat). Framework-agnostic, with concrete tokens and React/Tailwind hints where useful.
>
> **v3 changes** (after analyzing in-product screenshots):
> - Re-characterized the signature gradient: it's a **full-viewport atmospheric gradient**, not a localized "pulse orb."
> - **Primary button is near-black, not blue.** Blue is an accent. Corrected throughout.
> - Added the **heart icon mark** (orange→pink→blue gradient) — the brand's true visual signature.
> - Added in-product component vocabulary (sidebar, workspace selector, pagination dots, option cards, form fields, theme picker).
> - Chat input surface corrected to cream-tinted, not pure white.

---

## 1. Brand & Aesthetic Direction

**Tone:** Warm-editorial × refined-tech. Premium-but-friendly. Reads more like a high-end magazine/lifestyle brand than a typical SaaS dev tool. Conveys "soft AI" — humanized, calm, inviting — rather than "loud AI" (no neon gradients, no dark cyber aesthetic).

**Differentiator (the one thing to remember):** A **3D heart icon mark** in a glowing multi-color gradient (orange → pink → blue), set on a warm-cream canvas that's bathed in a soft, full-viewport atmospheric gradient running cream-at-top to coral-at-bottom. The brand reads like a sunrise over a sheet of paper.

**Mood adjectives:** soft, generous, breathable, intentional, atmospheric, quietly confident, warm-to-cool, multi-hued.

**Core visual signature:** the heart mark + the gradient atmosphere. Both contain the same orange-pink-blue blend. Everywhere else is restrained — typography in warm-near-black, surfaces in cream tones, generous whitespace.

**Two contexts to distinguish:**

| Surface          | Primary button color | Where the brand shows up                           |
|------------------|----------------------|----------------------------------------------------|
| Marketing site   | Black or Blue pill   | Hero headline + chat input + heart mark in nav    |
| In-product UI    | **Black pill**       | Heart mark in nav, gradient atmosphere, accents   |

The in-product app uses **black** as the primary action color (e.g., onboarding "Next →"), with brand blue reserved for the small "New" badge in announcement pills.

---

## 2. Color Palette

```css
:root {
  /* — Surfaces — */
  --bg-canvas:        #fcfbf8;  /* warm cream — page bg (verified via <meta theme-color>) */
  --bg-elevated:      #faf8f3;  /* chat input, option cards, workspace pill (cream-tinted, NOT pure white) */
  --bg-elevated-hi:   #ffffff;  /* highest elevation only — popovers, modal */
  --bg-subtle:        #f4f1ea;  /* hover states, section dividers, muted blocks */
  --bg-panel:         #f7f4ed;  /* inner surface holding the templates grid */

  /* — Foreground — */
  --fg-primary:       #1a1a1a;  /* near-black — headlines, primary text (matches product UI) */
  --fg-soft:          #272725;  /* "Tuatara" — official brand near-black, body text */
  --fg-secondary:     #6b6760;  /* warm gray — body copy, descriptions */
  --fg-muted:         #a39e95;  /* captions, placeholders, section labels */

  /* — Action colors (in-product) — */
  --action-primary:   #1a1a1a;  /* black pill — "Next →", primary submit */
  --action-primary-hover: #000000;

  /* — Brand accents (official, multi-hue) — */
  --brand-blue:       #1e52f1;  /* "Blue Ribbon" — the "New" badge, focused accents */
  --brand-orange:     #f3702f;  /* "Flamingo" — top of heart mark */
  --brand-pink:       #ea8aab;  /* "Carissma" — mid of heart mark */

  /* — Brand accent variants (derived) — */
  --brand-blue-deep:  #163fc7;
  --brand-orange-deep:#d75a1a;
  --brand-pink-deep:  #d96d92;

  /* — Atmospheric gradient stops (for the full-viewport background) — */
  --atmos-top:        #fdfbf6;  /* cream-white at top */
  --atmos-upper:      #d8e0f5;  /* light periwinkle */
  --atmos-mid:        #b3b9ee;  /* lavender-blue */
  --atmos-lower:      #e89cc4;  /* magenta-pink */
  --atmos-bottom:     #f37960;  /* coral-orange at bottom */

  /* — Borders — */
  --border-soft:      rgba(26, 26, 26, 0.06);
  --border-medium:    rgba(26, 26, 26, 0.10);
  --border-strong:    rgba(26, 26, 26, 0.18);

  /* — Shadows — soft, diffused, never harsh — */
  --shadow-sm:        0 1px 2px rgba(26, 26, 26, 0.04);
  --shadow-md:        0 4px 16px rgba(26, 26, 26, 0.05);
  --shadow-lg:        0 12px 40px rgba(26, 26, 26, 0.07);
  --shadow-xl:        0 24px 80px rgba(26, 26, 26, 0.08);
}
```

**Critical color rules:**

- **Pure white is forbidden** in chat surfaces and most cards. Use `--bg-elevated` (`#faf8f3`). Pure white reads cold and breaks the warm cream system.
- **Pure black is forbidden** for buttons. Use `--action-primary` (`#1a1a1a`) — slightly off-black so it sits gently against the cream.
- **Blue is an accent, not the action color.** Use it for the "New" pill badge, focused outlines, and subtle informational accents.
- **Pink and orange appear together only inside the heart icon and the atmospheric gradient.** Don't sprinkle them across UI elements.

**Tailwind config:**
```js
// tailwind.config.js
theme: {
  extend: {
    colors: {
      canvas: '#fcfbf8',
      surface: { DEFAULT: '#faf8f3', hi: '#ffffff', subtle: '#f4f1ea', panel: '#f7f4ed' },
      ink:     { DEFAULT: '#1a1a1a', soft: '#272725', muted: '#6b6760', faint: '#a39e95' },
      brand: {
        blue:   { DEFAULT: '#1e52f1', deep: '#163fc7' },
        orange: { DEFAULT: '#f3702f', deep: '#d75a1a' },
        pink:   { DEFAULT: '#ea8aab', deep: '#d96d92' },
      },
    },
  },
}
```

---

## 3. The Brand Heart Icon Mark

This is the brand's most concentrated visual signature. Every product surface (workspace selector, every onboarding screen) leads with it.

**Description:** A stylized heart shape — looks like a heart whose right lobe has been simplified into a "B"-like form. Rendered as a soft, slightly 3D / glassmorphic blob with the brand's full multi-color gradient.

**Gradient composition (top → bottom):**
- Top-left lobe: warm orange/red (`#f3702f` → `#e8418a`)
- Right lobe / middle: hot pink to magenta (`#ea8aab` → `#9b6dd8`)
- Bottom-right point: blue/purple (`#5b6dd8` → `#1e52f1`)

**Sizing in product:**
- Top-left of dashboard sidebar: ~24px
- Onboarding screens (centered above heading): ~64–72px
- Inside workspace pill: ~16–18px

**Implementation notes:**
- Ship as **SVG with embedded gradients** — this is the simplest path. Define one `<linearGradient>` going from `#f3702f` at the top through `#ea8aab` to `#1e52f1` at the bottom-right.
- For the soft 3D feel, layer a subtle inner highlight (`<feGaussianBlur>` + lighter fill) and a soft drop-shadow.
- Always rendered against cream — it loses character on white or dark surfaces.

```svg
<!-- Simplified version of the heart mark -->
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="heart-grad" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%"   stop-color="#f3702f"/>
      <stop offset="40%"  stop-color="#ea8aab"/>
      <stop offset="80%"  stop-color="#5b6dd8"/>
      <stop offset="100%" stop-color="#1e52f1"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
      <feOffset dy="2"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Heart-with-B-shape path; replace with actual brand path -->
  <path d="M16 12 Q16 4 24 4 Q32 4 32 14 Q40 4 48 4 Q56 4 56 16 Q56 32 32 56 Q8 32 8 16 Q8 8 16 12 Z"
        fill="url(#heart-grad)" filter="url(#soft-shadow)"/>
</svg>
```

For an exact reproduction, download Lovable's official brand assets: `https://lovable.dev/img/logo/lovable-brand.zip` (linked from `/brand`).

---

## 4. The Atmospheric Gradient (Signature Background)

This is what makes Lovable feel like Lovable. It is **not** a localized blob — it's a soft, full-viewport gradient that fills the entire content area like a sunrise sky, with warm hues at the bottom and cool/cream at the top.

**Direction:** Vertical (top → bottom), with a slight radial concentration toward the bottom-center where the warmest colors gather.

**Composition (top → bottom):**

| Position | Color              | Notes                               |
|----------|--------------------|-------------------------------------|
| 0%       | `#fdfbf6` cream    | Indistinguishable from canvas       |
| 25%      | `#d8e0f5` periwinkle | Soft cool transition              |
| 50%      | `#b3b9ee` lavender | Heart of the cool zone              |
| 70%      | `#e89cc4` magenta-pink | Warming up                      |
| 90–100%  | `#f37960` coral    | Hottest at bottom-center            |

**CSS implementation:**

```css
.atmos-bg {
  position: fixed;        /* stays put while page scrolls — the gradient is the room */
  inset: 0;
  pointer-events: none;
  z-index: 0;

  background:
    /* the warm core, low and slightly off-center */
    radial-gradient(ellipse 80% 60% at 50% 95%,
      rgba(243, 121, 96, 0.55)  0%,
      rgba(232, 156, 196, 0.45) 25%,
      rgba(232, 156, 196, 0)    50%),
    /* the cool atmosphere */
    linear-gradient(to bottom,
      #fdfbf6 0%,
      #ecedf6 18%,
      #d8e0f5 35%,
      #b3b9ee 55%,
      #c9b6e0 70%,
      #e89cc4 85%,
      #f37960 100%);

  filter: saturate(1.05);
}

/* Optional subtle breathing — much slower than I previously specified */
@keyframes atmos-breathe {
  0%, 100% { transform: scale(1)    translateY(0); }
  50%      { transform: scale(1.02) translateY(-4px); }
}
.atmos-bg { animation: atmos-breathe 14s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .atmos-bg { animation: none; }
}
```

**Key implementation points:**
- The gradient is **positioned fixed**, not absolute — it doesn't scroll with the page. As content scrolls past, it floats over this fixed atmosphere.
- Animation is **very slow and very subtle** (14s, 2% scale, 4px shift). The breathing should be barely perceptible.
- The bottom-center has a stronger radial concentration of coral/orange — that's where the warmth gathers.
- Saturation lifted by ~5% to compensate for the soft blends.
- All foreground content should sit on `position: relative; z-index: 1;` to stay above the atmosphere.

---

## 5. Typography

The product uses a **single sans-serif family with weight variation** — no serif pairing. Headings sit at weight 600–700 (bolder than I previously specified, confirmed from screenshots), body at 400.

```css
:root {
  /* PRIMARY CANDIDATES (commercial — self-host as Lovable does) */
  --font-sans:    'Söhne', 'Aeonik', 'GT Walsheim', 'Founders Grotesk',
                  'Inter Display', system-ui, sans-serif;

  /* FREE FALLBACKS — closest matches on Google Fonts */
  /* --font-sans: 'Manrope', 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif; */

  --font-mono:    'JetBrains Mono', 'IBM Plex Mono', 'Geist Mono', ui-monospace, monospace;
}
```

**Type scale** — calibrated against the onboarding screens:

| Token         | Mobile     | Desktop    | Line-height | Weight | Tracking | Usage                                  |
|---------------|------------|------------|-------------|--------|----------|----------------------------------------|
| `display-xl`  | 44px       | 72–88px    | 1.05        | 600    | -0.025em | Marketing hero headline                |
| `display-lg`  | 32px       | 44–52px    | 1.1         | 700    | -0.02em  | Onboarding question ("Pick your style")|
| `display-md`  | 26px       | 36–40px    | 1.15        | 700    | -0.015em | "Ready to build, Kenneth?"             |
| `heading-lg`  | 20px       | 22–24px    | 1.25        | 600    | -0.01em  | Card titles, section heads             |
| `heading-sm`  | 16px       | 17–18px    | 1.3         | 600    | 0        | Form labels, footer column titles      |
| `body-lg`     | 16px       | 17–18px    | 1.5         | 400    | 0        | Lead paragraphs                        |
| `body-md`     | 15px       | 16px       | 1.55        | 400    | 0        | Default body                           |
| `body-sm`     | 13px       | 14px       | 1.5         | 400    | 0        | Captions, descriptions, footer links   |
| `label`       | 12px       | 13px       | 1.3         | 500    | +0.01em  | Buttons, nav, chips, badges            |
| `eyebrow`     | 11px       | 12px       | 1.2         | 500    | +0.05em  | "Projects", "Recents" sidebar labels   |

**Critical settings:**
- Headlines are **600–700 weight** — bolder than typical SaaS sites. Tested visually against "Pick your style", "What's your name?", "Ready to build, Kenneth?".
- Letter-spacing is **moderately tight on display** (`-0.02em` to `-0.025em`), not extreme.
- Body text is `--fg-primary` (`#1a1a1a`), not the lighter `--fg-secondary`.
- Form labels (e.g., "Full name") use `body-md` weight 400, not weight 500.

**Font identity caveat:** Without DevTools access I can't confirm the exact family. The character of the lowercase `g` (double-storey), `a` (with tail), and the slightly humanist letterforms point to **Söhne** or **Aeonik** as the most likely commercial choices. **Manrope** is the closest free swap.

---

## 6. Spacing, Radii, and Layout

```css
:root {
  /* Spacing — 4px base */
  --space-1:  4px;   --space-2:  8px;   --space-3: 12px;
  --space-4: 16px;   --space-5: 20px;   --space-6: 24px;
  --space-8: 32px;   --space-10: 40px;  --space-12: 48px;
  --space-16: 64px;  --space-20: 80px;  --space-24: 96px;
  --space-32: 128px; --space-40: 160px; --space-48: 192px;

  /* Radii — generously rounded across the board */
  --radius-xs:    6px;   /* small chips, icon containers */
  --radius-sm:   10px;   /* form fields, light theme cards */
  --radius-md:   14px;   /* option cards, sidebar items */
  --radius-lg:   20px;   /* template cards */
  --radius-xl:   28px;   /* large content cards */
  --radius-2xl:  32px;   /* the chat input */
  --radius-pill: 9999px; /* buttons, announcement pills, workspace selector */

  /* Layout widths */
  --container-max:    1280px;
  --container-narrow:  880px;  /* hero text column */
  --container-tight:   720px;  /* chat input column */
  --sidebar-width:     240px;  /* in-product sidebar */
  --gutter-desktop:    80px;
  --gutter-tablet:     40px;
  --gutter-mobile:     20px;
}
```

**Section vertical rhythm:** `padding: var(--space-32) 0` desktop, `var(--space-20) 0` mobile.

**Grid:** 12-column, 24px gutters. Templates use a 3-column responsive grid (3 → 2 → 1) with **24–28px gaps**. Steps explainer uses 3-column → 1-column.

---

## 7. Component Inventory

### 7.1 Top Navigation (marketing)

- Sticky, transparent over hero, gains `backdrop-filter: blur(12px) saturate(1.4)` + cream wash (`rgba(252, 251, 248, 0.85)`) on scroll.
- Left: heart icon (~24px) + lowercase "lovable" wordmark in `--fg-primary`.
- Center: text links — `Solutions`, `Resources`, `Community`, `Pricing`, `Security` (`label` size, weight 500, hover: opacity 0.7).
- Right: `Log in` (text link) + `Get started` (pill button — see §7.3).
- Height: 64px desktop, 56px mobile. Hamburger collapses everything <960px.

### 7.2 In-Product Sidebar

```
┌─────────────────────┐
│ ❤  ▢                │  ← heart icon + collapse toggle
│                     │
│ ┌─────────────────┐ │
│ │ K Kenneth's L. ▾│ │  ← workspace selector pill
│ └─────────────────┘ │
│                     │
│ 🏠 Home             │  ← selected: bg --bg-elevated
│ 🔍 Search    ⌘K     │
│ 🧭 Resources        │
│ 🔌 Connectors       │
│                     │
│ PROJECTS            │  ← eyebrow label
│ ▦ All projects      │
│ ★ Starred           │
│ 👤 Created by me    │
│ 👥 Shared with me   │
│                     │
│ RECENTS             │
│ No recent projects  │
│ ─────────────────── │
│ ┌─ Share Lovable ─┐ │  ← bottom utility cards
│ ┌─ Upgrade to Pro ┐ │
│  ⚪ avatar    📬    │
└─────────────────────┘
```

Specs:
- Width: 240px fixed desktop, drawer on mobile.
- Background: `--bg-canvas` (no separation from main canvas — just a subtle right border `1px solid var(--border-soft)`).
- Padding: 16px.
- Items: 36px tall, `radius-md`, padding 8px 12px, gap 10px between icon and label.
- Selected item: `background: var(--bg-elevated)` with very subtle shadow `0 1px 2px rgba(0,0,0,0.03)`.
- Hover (unselected): `background: var(--bg-subtle)`.
- Section labels (`PROJECTS`, `RECENTS`): `eyebrow` token, `--fg-muted`, padding 16px 12px 8px.
- Keyboard shortcut chips (e.g., `⌘K`): tiny pill, `--bg-subtle` bg, `border-soft`, 11px label.

### 7.3 Workspace Selector Pill

- Height: 40px, full sidebar width, `radius-pill` corners are TOO round here — use `radius-md` (14px) actually.
- Background: `--bg-elevated`.
- Border: `1px solid var(--border-soft)`.
- Contents: small avatar/initial square (24px, `radius-xs`, brand-blue background, white initial), workspace name, chevron-down.
- Padding: 6px 12px.
- Click: opens workspace switcher dropdown.

### 7.4 Pill Button — Primary (in-product action)

```css
.btn-primary {
  background: var(--action-primary);     /* #1a1a1a — near-black */
  color: #ffffff;
  border-radius: var(--radius-pill);
  padding: 12px 24px;
  font: 500 14px/1 var(--font-sans);
  letter-spacing: 0.005em;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: inline-flex; align-items: center; gap: 8px;
  transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
}
.btn-primary:hover {
  background: #000000;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}
.btn-primary .arrow { transition: transform 160ms ease; }
.btn-primary:hover .arrow { transform: translateX(2px); }
```

This is what the onboarding "Next →" buttons use. The arrow nudges right on hover — a small detail that adds polish.

### 7.5 Pill Button — Marketing CTA

Marketing's "Get started" may use either black (matching product) or `--brand-blue`. Given the product uses black consistently, the safest choice is **black for both surfaces**.

```css
.btn-marketing-cta {
  /* Same as .btn-primary above — same shape, same color */
}
```

If you want differentiation, use `--brand-blue` only for marketing CTAs and keep black for in-product.

### 7.6 Pill Button — Ghost (filter pill)

Used for the "Templates" filter chip and similar:

```css
.btn-ghost {
  background: var(--bg-elevated);
  color: var(--fg-primary);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  font: 500 14px/1 var(--font-sans);
}
.btn-ghost:hover { background: var(--bg-subtle); border-color: var(--border-strong); }
```

### 7.7 Hero Chat Input (THE money component)

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Ask Lovable to make a document that…              │
│                                                     │
│                                                     │
│   ⊕                          Build ▾   🎤   ●↑      │
└─────────────────────────────────────────────────────┘
```

- Surface color: **`--bg-elevated`** (`#faf8f3`) — cream-tinted, NOT pure white. (Verified from Image 2.)
- `border-radius: var(--radius-2xl);` (32px — large but not fully pill-shaped).
- `box-shadow: var(--shadow-xl);` — soft, generous, sits up from the gradient.
- Padding: `20px 16px 12px`.
- Width: ~720px max (`--container-tight`), full-width with 20px gutters on mobile.
- **Top row:** textarea with placeholder text (`body-lg`, `--fg-muted`).
- **Bottom row:**
  - Left: a `+` icon (attach/add, 32px circle, ghost) and any other small action chips.
  - Right (in order): a "Build ▾" model selector chip (ghost pill, label size, 8px 12px), a microphone icon button (32px, ghost), and a circular **dark** send button (40px, `--action-primary` fill, white up-arrow icon).
- The send button is **dark, not blue** — confirmed from Image 2.
- Focus state: outer glow `box-shadow: var(--shadow-xl), 0 0 0 4px rgba(26, 26, 26, 0.08);`

### 7.8 Announcement Pill

```
┌──────────────────────────────────────┐
│ [New]  Lovable is now on Telegram  → │
└──────────────────────────────────────┘
```

```css
.announcement-pill {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 4px 14px 4px 4px;
  font: 500 13px/1 var(--font-sans);
  color: var(--fg-primary);
  box-shadow: var(--shadow-sm);
}
.announcement-pill .badge {
  background: var(--brand-blue);   /* ← THIS is where blue lives */
  color: #ffffff;
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  font-size: 12px; font-weight: 600;
  letter-spacing: 0;
}
.announcement-pill .arrow { color: var(--fg-secondary); }
```

This is the **only** place in the typical UI where brand-blue appears as a fill.

### 7.9 Onboarding Option Card

Used for "How many people work at your company?" (Solo / 2-20 / 21-200 / 200+):

```css
.option-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 24px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}
.option-card:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.option-card[aria-pressed="true"] { border: 1.5px solid var(--fg-primary); }
.option-card .icon { width: 28px; height: 28px; color: var(--fg-primary); }
.option-card .label { font: 500 15px/1 var(--font-sans); color: var(--fg-primary); }
```

Layout: 4-column grid desktop (equal width), 2-column tablet, stacked mobile. Gap: 16px.

### 7.10 Form Field

Used for the "What's your name?" input:

```html
<label class="field">
  <span class="field-label">Full name</span>
  <input class="field-input" type="text" />
</label>
```

```css
.field-label {
  display: block;
  font: 400 14px/1.4 var(--font-sans);
  color: var(--fg-primary);
  margin-bottom: 8px;
}
.field-input {
  width: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font: 400 16px/1.3 var(--font-sans);
  color: var(--fg-primary);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.field-input:focus {
  outline: none;
  border-color: var(--fg-primary);
  box-shadow: 0 0 0 3px rgba(26, 26, 26, 0.08);
}
```

### 7.11 Theme Picker Cards (Light / Dark)

Two miniature interface previews side-by-side:

- Container: 220×140px (desktop), `radius-md`, internal padding ~16px representing a mock UI layout.
- Light variant: `--bg-elevated` background with light gray skeleton bars representing content.
- Dark variant: `#1a1a1a` background with darker skeleton bars.
- Selected state: 1.5px outline in `--fg-primary` around the card.
- Label below: `body-md`, weight 500, centered.
- Each card has a tiny heart icon mark in the top-left corner of the mock.

### 7.12 Pagination Dots (onboarding step indicator)

```
●  ○  ○  ○      ←  step 1 of 4
○  ●  ○  ○      ←  step 2 of 4
```

But the "current" dot is a **wider pill**, not just a filled circle:

```css
.pagination { display: flex; gap: 8px; align-items: center; justify-content: center; }
.pagination .dot {
  width: 6px; height: 6px;
  background: var(--fg-muted);
  border-radius: var(--radius-pill);
  opacity: 0.4;
  transition: width 200ms ease, opacity 200ms ease;
}
.pagination .dot.current {
  width: 20px;
  background: var(--fg-primary);
  opacity: 1;
}
```

Sits centered at the bottom of the onboarding card, ~40px above the bottom edge.

### 7.13 Template Card

- Aspect ratio 4:3 thumbnail, `radius-lg` (20px), `overflow: hidden`.
- Below: title (`heading-sm`) and a one-line description (`body-sm`, `--fg-secondary`).
- Hover: thumbnail scales `1.02`, gains `--shadow-md`.
- Grid: 3-col desktop, 2-col tablet, 1-col mobile. Gap: 24–28px.

### 7.14 Templates Section Container (the panel holding cards)

The templates row sits on a soft cream **inner panel**, not the bare canvas:

```css
.templates-panel {
  background: var(--bg-panel);
  border-radius: var(--radius-2xl);
  padding: 32px;
  margin: 0 var(--gutter-desktop);
}
```

The atmospheric gradient bleeds through at the top edge of this panel — that's the colorful band you see above the "Templates" pill in Image 1. To get this effect, the panel sits on a section above the gradient atmosphere; or, simulate it with an explicit gradient strip at the top of the panel itself (5–10px tall, the same vertical gradient as §4 sampled at the bottom).

### 7.15 Footer

- Background: `--bg-canvas`. Top border `1px solid var(--border-soft)`.
- Five columns: **Company / Product / Resources / Legal / Community**. `heading-sm` titles, `body-sm` link list with 12px vertical spacing.
- Optional decorative oversized faded "lovable" wordmark across the bottom.
- Language selector ("EN") on the right.
- Padding: `var(--space-24) 0 var(--space-12)`.

---

## 8. Page Structure (marketing homepage)

1. **Sticky nav** (transparent over hero)
2. **Hero**
   - Atmospheric gradient (full-viewport, fixed-position, behind everything)
   - Announcement pill: `[New] Try the Lovable mobile app →`
   - Headline: *Build something Lovable* (`display-xl`, weight 600)
   - Subhead: *Create apps and websites by chatting with AI* (`body-lg`, `--fg-secondary`)
   - Chat input component (cream-tinted surface, `Build…` placeholder, dark send button)
   - Below input: "Teams from top companies build with Lovable"
   - Logo strip (grayscale, opacity 0.5)
3. **Section heading**: *AI App Builder* (`display-lg`, centered)
4. **Three-step explainer** (3-col grid, looping product videos)
5. **Templates** — sits in a soft panel (`--bg-panel`), with `[Templates]` pill top-left, `Browse all →` top-right, 3-col grid of cards
6. **Stats** — "Lovable in numbers" + 3 large counters
7. **Final CTA** — *Ready to build?* with another chat input instance
8. **Footer**

## 9. Page Structure (in-product dashboard)

1. **Left sidebar** (240px, fixed, see §7.2)
2. **Main canvas** (with atmospheric gradient as the background):
   - Top-center announcement pill (`[New] Lovable is now on Telegram →`)
   - Personalized greeting headline: *Ready to build, Kenneth?* (`display-md`, weight 700)
   - Chat input (`Ask Lovable to make a document that…`)
   - Below: Templates panel (the same section from marketing) starting from below the fold

## 10. Page Structure (onboarding flow)

Each step shares the same template:
- Atmospheric gradient background (full-viewport)
- Heart icon centered, ~64–72px
- Heading (`display-lg`, weight 700, centered) — "What's your name?", "How many people work at your company?", "Pick your style"
- Step content (form field / option cards / theme picker)
- "Next →" black pill button below
- Pagination dots at the bottom

---

## 11. Motion & Interaction

Lovable's motion is **slow, soft, considered** — never bouncy.

- **Default transition:** `160–200ms cubic-bezier(0.4, 0, 0.2, 1)`.
- **Atmospheric gradient:** 14s very subtle breathe (2% scale, 4px shift) — see §4. Barely perceptible.
- **Page-load reveal:** stagger hero elements (announcement pill → headline → subhead → chat input) at 80ms intervals, fading + 8px Y rise.
- **Step videos** (marketing): play on `IntersectionObserver` (threshold 0.4), pause when out of view.
- **Stat counters:** count-up over 1.6s with `easeOutQuart` when in view; uses `tabular-nums`.
- **Hover states:** subtle — `translateY(-1px)` and shadow lift. Never scale > 1.04.
- **Arrow buttons:** the arrow shifts right `2px` on hover.
- **Pagination dots:** width transitions smoothly when stepping forward.
- **Reduced-motion:** all animations respect `prefers-reduced-motion: reduce` — gradient becomes static, count-ups jump to final, step videos do not autoplay.

Use **Framer Motion** (`motion.div` with `viewport={{ once: true }}`) for in-view reveals, CSS keyframes for the gradient breathe.

---

## 12. Imagery & Iconography

- **Photography on marketing:** none, intentionally. The page is text + abstract gradient + UI mock videos.
- **Photography on templates** (Image 1): each template uses its own imagery (faces, architecture, lifestyle photos). Cards are visual.
- **Videos:** short looping clips of the product (e.g., `storage.googleapis.com/lovable-assets/videos/homepage/scene-2.mov`). Always `muted autoplay loop playsinline`.
- **Icons:** thin-stroke (1.5px), rounded line caps, 16–20px in product UI. **Lucide** or **Phosphor (regular)** match well. Sidebar icons sit at 18px.
- **Heart icon mark:** SVG with embedded gradient, 24px in nav, 64–72px in onboarding (see §3).

---

## 13. Responsive Behavior

| Breakpoint | Width      | Behavior                                                              |
|------------|------------|-----------------------------------------------------------------------|
| Mobile     | <640px     | 1-col, 20px gutters, sidebar becomes drawer, hero text 44–48px        |
| Tablet     | 640–960px  | 2-col template/option grid, hero text 56–64px                         |
| Desktop    | 960–1280px | 3-col template grid, fixed sidebar visible, hero text 72–80px         |
| Wide       | >1280px    | Container caps at 1280px, gutters grow to 80px, hero text up to 88px  |

Touch targets minimum 44px. Chat input on mobile takes full viewport width minus 20px gutters.

---

## 14. Accessibility Targets

- Color contrast: `--fg-primary (#1a1a1a)` on `--bg-canvas (#fcfbf8)` ≈ **17.4:1** (AAA). `--fg-secondary` on `--bg-canvas` ≈ **5.2:1** (AA).
- Primary button: white on `--action-primary (#1a1a1a)` ≈ **17.4:1** (AAA pass).
- "New" badge: white on `--brand-blue (#1e52f1)` ≈ **5.6:1** (AA pass).
- All decorative gradients: `aria-hidden="true"`.
- Form fields: visible label always (no placeholder-only labels), `aria-describedby` for helper text.
- Focus rings: 2–3px outline in `--fg-primary` with `0.08` alpha. Never `outline: none` without replacement.
- `prefers-reduced-motion` honored everywhere.
- Skip-to-content link first focusable element.
- Semantic landmarks: `<header>`, `<nav>`, `<main id="main-content">`, `<aside>` (sidebar), `<footer>`.

---

## 15. Tech Stack Notes (for AI builders)

- **Framework:** **Next.js (App Router).** Lovable's site is Next.js — `_next/static/media/...` paths visible in the HTML.
- **Image pipeline:** **Cloudflare Image Resizing** (`cdn-cgi/image/...`).
- **Styling:** **Tailwind CSS** with the tokens above mapped into `tailwind.config.js`. Use `@layer base` for CSS variables.
- **Component library:** **shadcn/ui** is what Lovable's own product favors and is a great match for the visual language.
- **Animation:** **Framer Motion** (or Motion One) for staggered reveals; CSS keyframes for the atmospheric breathe.
- **Fonts:** self-host with `next/font/local`. If using free fallbacks, `next/font/google` for `Manrope` (closest free swap).
- **Video:** native `<video muted loop autoplay playsinline>` — no library.
- **Icons:** `lucide-react` package.

---

## 16. Anti-patterns (what NOT to do)

These will instantly betray the clone:

- ❌ **Pure white background.** It must be cream (`#fcfbf8`).
- ❌ **Pure white surfaces.** Cards and inputs use `#faf8f3` (cream-tinted).
- ❌ **Pure black text or buttons.** Use `#1a1a1a`.
- ❌ **Inter or Roboto for the headline.** Use Söhne, Aeonik, or fallback to Manrope.
- ❌ **Purple gradients.** Lovable is blue + orange + pink. (Lovable's own community has called purple-gradient AI sites the visual cliché to avoid.)
- ❌ **Blue as the primary CTA color.** Primary actions are **black**. Blue is reserved for the "New" badge.
- ❌ **Pink as the primary CTA color.** Same — accent only, in the heart mark and gradient.
- ❌ **A localized "blob" gradient.** It's a full-viewport atmospheric gradient that fills the page like sky.
- ❌ **Hard shadows or sharp corners.** Everything is soft and rounded (radius 14–32px).
- ❌ **Dense layouts.** Whitespace is a feature, not a bug.
- ❌ **Bouncy spring animations.** Motion is calm and slow.
- ❌ **A flat 2D heart icon.** The heart is a 3D-feeling glowy gradient blob, not a simple flat heart silhouette.
- ❌ **Underweight headings.** They're 600–700, not 400–500.

---

## 17. Quick-Start Prompt for AI Builders

If you want to paste this into Lovable / v0 / Bolt verbatim:

> Build a single-page marketing site with a warm cream background (`#fcfbf8`) and warm-near-black text (`#1a1a1a`). The page sits on a soft, full-viewport, fixed-position **atmospheric vertical gradient** that runs from cream-white at the top, through soft periwinkle and lavender-blue in the middle, into magenta-pink, and ends in coral-orange (`#f37960`) concentrated at the bottom-center. The gradient breathes very slowly (14s loop, 2% scale, 4px shift) — barely perceptible.
>
> Brand mark: a 3D-feeling stylized heart icon rendered as an SVG with a multi-color gradient — orange (`#f3702f`) at top-left, transitioning through hot pink (`#ea8aab`) in the middle to brand-blue (`#1e52f1`) at the bottom-right. Use it 24px in the nav and 64px above each onboarding heading.
>
> Use a single humanist sans-serif (Manrope or Plus Jakarta Sans, weights 400/500/600/700) for everything — no serif. Headlines are weight 600–700, tightened (`letter-spacing: -0.02em`).
>
> The hero is centered: a cream-bg announcement pill containing a small blue "New" badge and "Try the Lovable mobile app →", an oversized 72–88px headline "Build something Lovable" (weight 600), a 17px subheading "Create apps and websites by chatting with AI", and a large pill-shaped **cream-tinted** chat input (`#faf8f3`, radius 32px, generous shadow) with a circular **dark** (`#1a1a1a`) send button bottom-right and a "Build ▾" model selector chip.
>
> Below: a 3-step explainer with looping product videos, a soft cream inner panel holding a 3-col grid of template cards with rounded thumbnails, a stats row with three count-up numbers, a final CTA echoing the hero, and a 5-column footer with an oversized faded "lovable" wordmark across the bottom.
>
> Generous whitespace everywhere. Soft rounded corners (radius 14–32px), soft shadows, slow calm animations (160–200ms ease, no bouncy springs). **Primary CTA color is near-black, not blue or pink.** Pure white forbidden — use cream-tinted surfaces. No purple gradients, no Inter, no flat heart silhouettes.

---

## 18. Sources & Verification

This spec mixes verified data with educated inference. Treat it accordingly.

### ✅ Verified directly from lovable.dev (live HTML and meta tags)

- **Page background `#fcfbf8`** — from the live page's `<meta name="theme-color" content="#fcfbf8">`.
- **Tech stack: Next.js + Cloudflare image resizing** — visible in asset URLs.
- **Self-hosted fonts** — independent font scrapers detect zero web-loaded fonts.
- **Page structure & copy** — pulled from the live page HTML.
- **Pulse asset / step videos / brand assets ZIP** — confirmed at their respective URLs.

### ✅ Verified from product screenshots (Images 1–6)

- **Atmospheric vertical gradient direction & color order** (cream → blue → lavender → magenta → coral, top to bottom).
- **Black is the primary in-product button** (every "Next →" button is black, not blue).
- **Heart icon mark with multi-color gradient** (orange → pink → blue) — visible across all in-product screens.
- **Chat input surface is cream-tinted, not pure white.**
- **Send button is dark, not blue.**
- **Brand-blue lives in the "New" badge** of the announcement pill.
- **Headlines are bolder than typical** (weight 600–700, not 500).
- **Templates section sits on a soft inner panel** with the gradient bleeding through at the top edge.
- **Sidebar layout, workspace selector, pagination dots, option cards, theme picker** — all transcribed from screenshots.

### 📋 Verified via published brand-tracking sources

- **Brand color palette** — Brandfetch publishes `#1E52F1`, `#F3702F`, `#EA8AAB`, `#272725`, `#FFFFFF`. These match what's visible in the heart mark and pulse gradient.

### 🔍 Inferred from screenshots & visual analysis

- **Exact gradient stop percentages** — calibrated to visually match the screenshots, not extracted from CSS.
- **Type scale, spacing, radii, shadow values** — derived to visually match, not measured.
- **Animation durations and easings** — calibrated to perceived feel.
- **Specific surface hexes** (`--bg-elevated`, `--bg-panel`, `--bg-subtle`) — sampled visually from the screenshots; may be off by ±5%.
- **Font family** — undetermined. Söhne / Aeonik / Inter Display are visually closest.
- **Tailwind + shadcn/ui as the implementation stack** — Lovable's own prompting documentation recommends this combo.

### ❓ Could not verify (would require browser DevTools)

- Exact font-family string in CSS.
- Exact font-size, line-height, letter-spacing values per heading level.
- Exact box-shadow values per surface.
- Whether the gradient is a CSS gradient, a fixed-position SVG, or a webp asset.
- Exact spacing rhythm between sections.

If you want a fully verified spec, the next step is opening the site in Chrome DevTools and pulling computed styles. Once the Chrome connector is available I can do this pass and tighten everything.
