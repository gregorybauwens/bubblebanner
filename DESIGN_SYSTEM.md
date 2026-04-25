# Design System — Cursor Implementation Spec

> Drop this file into the **root of any new project** and ask Cursor:
> _"Implement the design system in `DESIGN_SYSTEM.md`."_
>
> This spec is self-contained. It targets a Vite + React + TypeScript + Tailwind CSS stack
> but the tokens transfer cleanly to Next.js, Astro, Remix, or plain HTML.

---

## 0. Stack assumptions

- React 18+ with TypeScript
- Tailwind CSS 3.4+
- `tailwindcss-animate` plugin
- `lucide-react` for icons
- Class-based dark mode (`darkMode: ["class"]`)
- Theme is persisted in `localStorage` under the key `app.theme`

If the project already has these installed, skip section 1.

---

## 1. Install dependencies

```bash
npm install -D tailwindcss postcss autoprefixer tailwindcss-animate
npm install lucide-react
npx tailwindcss init -p
```

---

## 2. Replace `src/index.css` with this exactly

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Design system. All colors MUST be HSL. */
@layer base {
  :root {
    --background: 0 0% 99%;
    --foreground: 0 0% 12%;

    --card: 0 0% 100%;
    --card-foreground: 0 0% 12%;

    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 12%;

    --primary: 45 100% 45%;
    --primary-foreground: 0 0% 100%;

    --secondary: 0 0% 92%;
    --secondary-foreground: 0 0% 20%;

    --muted: 0 0% 92%;
    --muted-foreground: 0 0% 40%;

    --accent: 0 0% 94%;
    --accent-foreground: 0 0% 12%;

    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;

    --border: 0 0% 85%;
    --input: 0 0% 85%;
    --ring: 45 100% 45%;

    --radius: 0.5rem;

    /* Glass panel container (e.g. Motion / Colors panels) */
    --panel-bg: 0 0% 100% / 0.85;
    --panel-border: 0 0% 0% / 0.08;

    /* Interactive surfaces (buttons, chips) */
    --surface: 0 0% 96%;
    --surface-foreground: 0 0% 30%;
    --surface-hover: 0 0% 90%;
    --surface-active: 0 0% 84%;

    --sidebar-background: 0 0% 98%;
    --sidebar-foreground: 0 0% 20%;
    --sidebar-primary: 45 100% 45%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 0 0% 94%;
    --sidebar-accent-foreground: 0 0% 20%;
    --sidebar-border: 0 0% 88%;
    --sidebar-ring: 45 100% 45%;
  }

  .dark {
    --background: 0 0% 8%;
    --foreground: 0 0% 90%;

    --card: 0 0% 10%;
    --card-foreground: 0 0% 90%;

    --popover: 0 0% 10%;
    --popover-foreground: 0 0% 90%;

    --primary: 45 100% 50%;
    --primary-foreground: 0 0% 6%;

    --secondary: 0 0% 15%;
    --secondary-foreground: 0 0% 90%;

    --muted: 0 0% 15%;
    --muted-foreground: 0 0% 55%;

    --accent: 0 0% 18%;
    --accent-foreground: 0 0% 90%;

    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;

    --border: 0 0% 20%;
    --input: 0 0% 20%;
    --ring: 45 100% 50%;

    --panel-bg: 0 0% 8% / 0.9;
    --panel-border: 0 0% 100% / 0.12;

    --surface: 0 0% 17%;
    --surface-foreground: 0 0% 75%;
    --surface-hover: 0 0% 24%;
    --surface-active: 0 0% 32%;

    --sidebar-background: 0 0% 8%;
    --sidebar-foreground: 0 0% 85%;
    --sidebar-primary: 45 100% 50%;
    --sidebar-primary-foreground: 0 0% 6%;
    --sidebar-accent: 0 0% 12%;
    --sidebar-accent-foreground: 0 0% 85%;
    --sidebar-border: 0 0% 15%;
    --sidebar-ring: 45 100% 50%;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}

/* Range input slider styling — used in control panels */
@layer components {
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
  }
  input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    background: hsl(var(--border));
    border-radius: 9999px;
  }
  input[type="range"]::-moz-range-track {
    height: 4px;
    background: hsl(var(--border));
    border-radius: 9999px;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: hsl(var(--muted-foreground));
    border-radius: 50%;
    border: none;
    cursor: pointer;
    margin-top: -4px;
  }
  input[type="range"]::-webkit-slider-thumb:hover { background: hsl(var(--foreground)); }
  input[type="range"]::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: hsl(var(--muted-foreground));
    border-radius: 50%;
    border: none;
    cursor: pointer;
  }
  input[type="range"]::-moz-range-thumb:hover { background: hsl(var(--foreground)); }
  input[type="range"]:focus { outline: none; }
  input[type="range"]:focus::-webkit-slider-thumb { box-shadow: 0 0 0 2px rgba(163,163,163,0.3); }
  input[type="range"]:focus::-moz-range-thumb { box-shadow: 0 0 0 2px rgba(163,163,163,0.3); }
}
```

---

## 3. Replace `tailwind.config.ts` with this exactly

```ts
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary:     { DEFAULT: "hsl(var(--primary))",     foreground: "hsl(var(--primary-foreground))" },
        secondary:   { DEFAULT: "hsl(var(--secondary))",   foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted:       { DEFAULT: "hsl(var(--muted))",       foreground: "hsl(var(--muted-foreground))" },
        accent:      { DEFAULT: "hsl(var(--accent))",      foreground: "hsl(var(--accent-foreground))" },
        popover:     { DEFAULT: "hsl(var(--popover))",     foreground: "hsl(var(--popover-foreground))" },
        card:        { DEFAULT: "hsl(var(--card))",        foreground: "hsl(var(--card-foreground))" },
        surface: {
          DEFAULT:    "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
          hover:      "hsl(var(--surface-hover))",
          active:     "hsl(var(--surface-active))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",                  /* 8px */
        md: "calc(var(--radius) - 2px)",      /* 6px */
        sm: "calc(var(--radius) - 4px)",      /* 4px */
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
```

---

## 4. Patch `index.html` — anti-flash + font

Insert the script as the first child of `<head>`, then add the font links anywhere in `<head>`.

```html
<script>
  (function(){var t=localStorage.getItem('app.theme');
  document.documentElement.classList.add(t==='light'?'light':'dark')})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap"
  rel="stylesheet"
/>
```

Make sure `src/main.tsx` (or equivalent) imports the stylesheet:

```ts
import "./index.css";
```

---

## 5. Theme toggle (drop-in component)

Create `src/components/ThemeToggle.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const THEME_STORAGE_KEY = "app.theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(THEME_STORAGE_KEY) !== "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
  };

  return (
    <button
      onClick={toggle}
      className="fixed top-4 right-4 z-50 h-9 w-9 rounded-full bg-surface hover:bg-surface-hover text-surface-foreground transition-colors flex items-center justify-center shadow-md border border-border"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
```

---

## 6. Design system reference (rules the LLM must follow)

### 6.1 Surfaces — the brightness ladder

Use these in order from background → foreground. Never hand-pick hex values.

| Token | Tailwind | Light hex | Dark hex | Use |
|---|---|---|---|---|
| `--background` | `bg-background` | `#FCFCFC` | `#141414` | Page background |
| `--card` | `bg-card` | `#FFFFFF` | `#1A1A1A` | Solid raised card |
| `--panel-bg` | inline `style={{background:"hsl(var(--panel-bg))"}}` | `#FFFFFF` @ 85% | `#141414` @ 90% | Glass containers (panels) |
| `--surface` | `bg-surface` | `#F5F5F5` | `#2B2B2B` | Default interactive surface |
| `--surface-hover` | `bg-surface-hover` | `#E6E6E6` | `#3D3D3D` | Hover state |
| `--surface-active` | `bg-surface-active` | `#D6D6D6` | `#525252` | Pressed / "primary" rest |

### 6.2 Glass panel pattern (always use for grouped controls)

```tsx
<div
  className="mt-0 p-4 rounded-xl text-xs"
  style={{
    background: "hsl(var(--panel-bg))",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid hsl(var(--panel-border))",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
  }}
>
  {/* content */}
</div>
```

### 6.3 Buttons (canonical recipes)

```tsx
{/* Icon button (32 × 32) */}
<button className="h-8 w-8 rounded-lg bg-surface hover:bg-surface-hover text-surface-foreground transition-colors flex items-center justify-center" />

{/* Disabled icon button */}
<button disabled className="h-8 w-8 rounded-lg bg-surface text-muted-foreground/50 cursor-not-allowed flex items-center justify-center" />

{/* Primary text button */}
<button className="h-8 px-3 rounded-lg bg-surface-hover hover:bg-surface-active text-foreground text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5" />

{/* Floating pill (overlays) */}
<button className="px-4 py-2 rounded-full bg-surface/90 border border-foreground/20 text-foreground text-[11px] uppercase tracking-wider backdrop-blur-sm hover:bg-surface-hover/90 hover:border-foreground/40 transition-all shadow-lg" />
```

### 6.4 Interaction state contract

```
rest    → bg-surface          text-surface-foreground
hover   → bg-surface-hover    text-foreground
pressed → bg-surface-active   text-foreground
focus   → ring-2 ring-ring ring-offset-2 ring-offset-background
disabled→ bg-surface text-muted-foreground/50 cursor-not-allowed
```

Always pair color transitions with `transition-colors` (or `transition-all` for the floating pill).

### 6.5 Corner radius scale

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 4px | Inline chips, small inputs |
| `rounded-md` | 6px | Inputs, dropdown items |
| `rounded-lg` | 8px | Buttons, default control surfaces |
| `rounded-xl` | 12px | Panels / containers |
| `rounded-full` | ∞ | Floating pills, theme toggle, slider thumbs |

### 6.6 Spacing rhythm

- Panel padding: `p-4`
- Section gap inside panels: `gap-3` / `gap-4`
- Icon button size: `h-8 w-8`
- Text button size: `h-8 px-3`
- Spacing above first panel: `mt-8 mb-4`
- Spacing between stacked panels: `mt-4`

### 6.7 Typography scale

All UI **labels** are `uppercase` + `tracking-wider`. All **body copy** is sentence case.

| Class | Use |
|---|---|
| `text-[14px] uppercase tracking-wider text-foreground/80` | Panel section titles ("Motion", "Colors") |
| `text-[10px] uppercase tracking-wider text-muted-foreground` | Sub-section labels ("Hover", "Saved") |
| `text-[9px] uppercase tracking-wider text-muted-foreground` | Caption labels under thumbnails |
| `text-[10px]` / `text-[11px]` / `text-[13px]` | Inline microcopy, button labels, small numerics |
| `text-xs` | Default body inside dense panels |
| `text-sm` | Default body outside panels |
| `font-medium` | Buttons / emphasized inline text |
| Inter weight 900 | Display only — never UI |

Body font: `Inter` (or system stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`).

### 6.8 Borders & dividers

- Panel border: `border: 1px solid hsl(var(--panel-border))` (inline).
- Inline divider: `<div className="w-px h-5 bg-border" />`
- Hairline ring states:
  - rest:     `ring-1 ring-foreground/10`
  - hover:    `ring-foreground/30`
  - selected: `ring-2 ring-foreground/60 ring-offset-1 ring-offset-background`

### 6.9 Elevation (shadows)

Only three levels — pick from this list:

| Use | Class / style |
|---|---|
| Panels | `boxShadow: "0 4px 20px rgba(0,0,0,0.15)"` (inline) |
| Theme toggle / icon button | `shadow-md` |
| Floating pill / overlay | `shadow-lg` |

### 6.10 Motion

- Default: `transition-colors` for color/background changes.
- For multi-prop changes (border + bg + ring): `transition-all`.
- Accordion / collapse: use the `accordion-down` / `accordion-up` keyframes provided in `tailwind.config.ts`.
- Panel collapse pattern (no JS height measurement):

```tsx
<div
  style={{
    display: "grid",
    gridTemplateRows: isOpen ? "1fr" : "0fr",
    transition: "grid-template-rows 350ms cubic-bezier(0.4, 0, 0.2, 1)",
  }}
>
  <div style={{ overflow: "hidden" }}>{/* content */}</div>
</div>
```

---

## 7. Worked example — collapsible panel

Use this as the reference layout for any "group of controls" in the app.

```tsx
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function ControlPanel({ title, children }: { title: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="mt-4 p-4 rounded-xl text-xs"
      style={{
        background: "hsl(var(--panel-bg))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid hsl(var(--panel-border))",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <div className="py-1 text-[14px] uppercase tracking-wider text-foreground/80">
          {title}
        </div>
        <ChevronDown
          size={16}
          className="text-muted-foreground group-hover:text-foreground transition-all duration-300"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          transition: "grid-template-rows 350ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div style={{ overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
```

---

## 8. Hard rules for the LLM (do not violate)

1. **Never** use raw hex / rgb in component classes — always reference tokens (`bg-surface`, `text-foreground`, `hsl(var(--panel-bg))`).
2. **Never** invent new surface levels. The ladder is fixed: `background → card → panel-bg → surface → surface-hover → surface-active`.
3. **All UI labels are uppercase + `tracking-wider`.** Body copy stays sentence case.
4. **All interactive elements have all four states**: rest, hover, pressed, disabled. Use the contract in §6.4.
5. **All grouped controls** live inside the glass panel from §6.2.
6. **Radius is fixed** to the scale in §6.5. Default for buttons is `rounded-lg`. Default for panels is `rounded-xl`.
7. **Only three elevation levels** exist — see §6.9.
8. **Color tokens must work in both themes.** If you add a new token, define it in both `:root` and `.dark`.
9. **Theme switching is class-based on `<html>`** with the key `app.theme`. Don't use OS-level `prefers-color-scheme` queries.
10. **No emoji in UI** unless the user explicitly requests them.

---

## 9. Acceptance checklist

After implementing, verify:

- [ ] `src/index.css` contains the tokens from §2 verbatim.
- [ ] `tailwind.config.ts` extends colors with `surface.{DEFAULT,foreground,hover,active}` and `sidebar.*`.
- [ ] `index.html` has the anti-flash script as the first `<head>` child.
- [ ] Inter is loaded from Google Fonts.
- [ ] `ThemeToggle` toggles `dark`/`light` classes on `<html>` and persists to `localStorage` as `app.theme`.
- [ ] Default page background uses `bg-background`, default body text uses `text-foreground`.
- [ ] Every button uses one of the four recipes in §6.3.
- [ ] Every grouped control sits inside the glass panel from §6.2.
- [ ] Toggling between light/dark only changes the theme — no layout shift, no flash.
