# Color / theme consistency audit

This document lists **10 inconsistencies** that can cause the colors you set in Settings → Theme (Display / Color) to not apply consistently across the site, or to “load then change” (especially in the header).

**Fixes applied (same session as audit):**
- **#1** – Server now uses `theme_header_settings_border_color` for `--kexo-header-settings-border-color`.
- **#3** – Strip dropdowns (Settings/Online) now use `--kexo-header-settings-bg` and `--kexo-header-settings-text-color` instead of hardcoded #fff / #000.
- **#4** – Removed head-theme override of `--kexo-top-menu-border-color`; server output is the single source.
- **#6** – Server accent 4 default set to `#e4644b`, accent 5 to `#6681e8` to match client `ACCENT_DEFAULTS`.
- **#10** – Server now outputs `--kexo-top-menu-border-color` from `theme_header_main_border_color` (when border not hidden).

---

## 1. **Header settings border color is ignored (server bug)**

**Where:** `server/routes/settings.js` (around line 2421) in `getThemeVarsCss`.

**What:** The setting `theme_header_settings_border_color` is read from the DB and has a fallback, but the CSS output always uses **accent 1** for `--kexo-header-settings-border-color` instead of the user’s border color.

**Effect:** The “Settings panel border colour” in Theme → Header has no effect; the border always uses the primary accent.

**Fix:** Use the resolved settings border color (e.g. `normalizeCssColor(settingsBorderColor, FALLBACKS.theme_header_settings_border_color)`) for `--kexo-header-settings-border-color` instead of `accent1Hex`.

---

## 2. **Dual source of truth: localStorage vs theme-vars.css (flash)**

**Where:** `server/public/partials/head-theme.html` (inline script) and `/theme-vars.css` (server-generated).

**What:**  
- **First:** The inline script in `head-theme.html` runs and sets `--kexo-accent-1`–`6`, `--tblr-primary`, and `kexo:css_var_overrides:v1` from **localStorage**.  
- **Then:** The stylesheet `/theme-vars.css` loads (as a normal `<link>`, so it’s non-blocking) and overwrites `:root` with **server/DB** values.

So the first paint uses localStorage (or defaults if empty); when the CSS file loads, colors can “jump” to the server theme. If localStorage is out of sync with the DB (e.g. different device, or save failed to sync), you get “loads my colors, then changes to another colour” or the reverse.

**Effect:** Inconsistent first paint vs. final theme, especially noticeable on the header.

**Fix (options):**  
- Prefer a single source: e.g. inline critical theme vars in the initial HTML (from server) so first paint matches DB, and optionally use localStorage only for instant UI preview before save.  
- Or ensure every theme save updates both DB and localStorage and that `theme-vars.css` is applied in a way that doesn’t visibly overwrite (e.g. same values), and/or block first paint until theme is resolved.

---

## 3. **Strip dropdowns (Settings / Online) ignore theme**

**Where:** `server/public/custom.css` (around 5363–5385).

**What:**  
- `.kexo-top-strip-settings-menu`, `.kexo-top-strip-online-menu`, `.kexo-footer-settings-menu`: `background: #fff !important;`  
- `.kexo-top-strip-settings-item` and icon: `color: #000 !important;`

**Effect:** The Settings and Online dropdowns in the header strip always use white background and black text, regardless of Theme → Header settings (e.g. “Settings text colour”, “Settings background”).

**Fix:** Replace with theme variables, e.g.  
- Background: `var(--kexo-header-settings-bg, #fff)` or a dedicated dropdown-bg var.  
- Text/icon: `var(--kexo-header-settings-text-color, var(--kexo-header-top-text-color, #1f2937))` (and remove `!important` if possible so theme can override).

---

## 4. **head-theme forces `--kexo-top-menu-border-color` to transparent**

**Where:** `server/public/partials/head-theme.html` (around line 31).

**What:** The script does `root.style.setProperty('--kexo-top-menu-border-color', 'transparent');` unconditionally. The server then also outputs `--kexo-top-menu-border-color:transparent` in `theme-vars.css` (and does not use `theme_header_main_border_color` for this var).

**Effect:** Even if you later change the server to send a visible border colour, the inline script would override it on load. Redundant and can confuse which layer “owns” the value.

**Fix:** Either remove the line from `head-theme.html` and let `theme-vars.css` be the only source, or have the server output the real border color and remove the hardcoded `transparent` in both places so the setting is respected.

---

## 5. **Settings background and Online badge background not used from DB**

**Where:** `server/routes/settings.js` in `getThemeVarsCss`.

**What:** `theme_header_settings_bg` and `theme_header_online_bg` are in `THEME_BASE_KEYS` (saved/loaded in API) but **are not read** in `getThemeVarsCss`. The CSS always uses:  
- `--kexo-header-settings-bg: ${accent1Hex}`  
- `--kexo-header-online-bg: ${accent1Hex}`  

**Effect:** “Settings background” and “Online badge background” in Theme → Header have no effect; both always use accent 1.

**Fix:** In `getThemeVarsCss`, add `getThemeKey('theme_header_settings_bg', …)` and `getThemeKey('theme_header_online_bg', …)` and use those values for `--kexo-header-settings-bg` and `--kexo-header-online-bg` instead of `accent1Hex`.

---

## 6. **Accent 4 default differs between client and server**

**Where:**  
- **Client:** `server/public/theme-settings.js` – `ACCENT_DEFAULTS[3]` = `'#e4644b'`.  
- **Server:** `server/routes/settings.js` – fallback for accent 4 = `'#8b5cf6'`.  
- **CSS:** `server/public/custom.css` uses `var(--kexo-accent-4, #e4644b)` (client default).

**What:** When no theme is saved, head-theme uses client defaults (so accent 4 = #e4644b); when theme-vars.css loads, server sends #8b5cf6. So accent 4 can “flip” after first paint. CSS fallback matches client, not server.

**Effect:** Inconsistent default for accent 4 and possible flash.

**Fix:** Align defaults: e.g. use one canonical list (e.g. `['#4b94e4','#3eb3ab','#f59e34','#e4644b','#6681e8','#8395aa']`) in both server and client and in CSS fallbacks.

---

## 7. **Hardcoded body/border fallbacks differ across custom.css**

**Where:** `server/public/custom.css` in many rules.

**What:** Multiple different hardcoded fallbacks are used for “body” text and borders, e.g.  
- `#182433`, `#1e293b`, `#1f2937` for body/text;  
- `#e6e7e9` for borders.

**Effect:** If `--tblr-body-color` or `--tblr-border-color` are missing or wrong, pages can look inconsistent (e.g. one card uses #1e293b, another #182433). Not all of these are driven by the same theme vars.

**Fix:** Standardise on one body and one border fallback (e.g. from a small set of theme fallbacks) and use `var(--tblr-body-color, <single-fallback>)` and `var(--tblr-border-color, <single-fallback>)` everywhere.

---

## 8. **Fully hardcoded colours with no theme var**

**Where:** `server/public/custom.css` (examples).

**What:** Some rules use a raw hex with no `var(…)`, so they never follow theme, e.g.:  
- `color: #0f172a` (e.g. around 1572, 1623, 2839, 2891, 2965, 3101, 3501, 4434);  
- `color: #090f17` (1559);  
- `color: #334155` (988, 1858);  
- `color: #144c88` (1776);  
- `.kexo-sale-banner .tblr-banner-close { color: #fff; }` in dark mode (6171);  
- `background: #000 !important` (1891).

**Effect:** Those elements never respond to Theme / colour settings and can look out of place when the rest of the UI uses your colours.

**Fix:** Replace with theme vars where appropriate (e.g. `var(--tblr-body-color, #0f172a)` for text, or a dedicated var for banner close button in dark mode).

---

## 9. **CSS var overrides (kexo:css_var_overrides:v1) applied before theme-vars.css**

**Where:** `head-theme.html` applies `kexo:css_var_overrides:v1` from localStorage; then `theme-vars.css` is loaded and includes the same overrides from the DB (from `cssVarOverridesV1` in settings).

**What:** If the “Colours” grid in Settings writes only to localStorage (and/or the server merge is different), the order is: (1) head-theme applies localStorage overrides, (2) theme-vars.css applies server overrides. So again, first paint can differ from after-load, and the “Colours” overrides can appear to change when the stylesheet loads.

**Effect:** Same “load then change” behaviour for any CSS variable that is both in the Colours grid and in theme-vars.css.

**Fix:** Same as #2: single source of truth (e.g. server inlined for first paint, or ensure localStorage and server are always in sync and applied in one place).

---

## 10. **Main nav border colour setting not reflected in CSS var**

**Where:** `server/routes/settings.js` – `theme_header_main_border_color` is read and has a fallback, but the generated CSS sets `--kexo-top-menu-border-color: transparent` (hardcoded).

**What:** The “Main nav border” colour in Theme → Header is stored but never output into the theme CSS; the var is always `transparent`.

**Effect:** “Main nav border colour” has no effect.

**Fix:** In `getThemeVarsCss`, set  
`--kexo-top-menu-border-color: ${normalizeCssColor(mainBorderColor, FALLBACKS.theme_header_main_border_color)}`  
(and remove the unconditional `transparent` in head-theme as in #4).

---

## Summary table

| # | Issue | Area | Severity |
|---|--------|------|----------|
| 1 | Settings border colour ignored (server uses accent1) | Header | High |
| 2 | localStorage vs theme-vars.css causes flash | All pages | High |
| 3 | Strip dropdowns hardcoded #fff / #000 | Header | High |
| 4 | head-theme forces top-menu border to transparent | Header | Medium |
| 5 | Settings bg & Online bg not read from DB | Header | Medium |
| 6 | Accent 4 default mismatch client vs server | Accents | Medium |
| 7 | Inconsistent body/border fallbacks in custom.css | Global | Medium |
| 8 | Hardcoded colours with no theme var | Various | Medium |
| 9 | CSS var overrides applied before theme-vars.css | Colours grid | Medium |
| 10 | Main nav border colour not output in CSS | Header | High |

Recommended order to fix for “colors work the same on every page”: **1, 10, 3, 5, 4**, then **2/9** (single source of truth), then **6, 7, 8**.
