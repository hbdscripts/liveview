# Settings tab UI and mobile scroll — plan (with join-container fix)

## Goal

- **Active tab** looks like it joins the content div below (same background, no gap, rounded top on tab).
- **Side menu**: `margin-right: 10px` on category blocks.
- **Inactive tabs**: Clearly distinct so the active “join” reads well.
- **Mobile**: In-panel tab bars do not wrap; they scroll horizontally (swipe).
- **All settings pages** use the same opening container below the tab bar so the tab design joins properly (see § Consistent join container below).

All styling in `server/public/settings-ui.css`. No inline styles in `server/public/settings.html`. Contract: `docs/UI_SETTINGS_CONTRACT.md`.

---

## Consistent join container (all settings pages)

**Problem:** Panels like `/settings/layout/tables`, `/settings/layout/kpis`, `/settings/layout/date-ranges` do not have the same opening container that wraps their content as others (e.g. Costs & profit → Cost sources). For accordion-based panels (Kexo, Integrations, Layout, Attribution, Insights, Admin), content lives inside `.accordion-body`, and `settings-ui.css` strips `.settings-panel-wrap` border/background when inside `.accordion-body`, so there is no consistent framed “join target” below the tab bar. For Cost-expenses, the normaliser adds `.settings-panel-wrap` inside each tab panel and that wrap keeps its frame, so the join works there only.

**Requirement:** Every settings tab view must have a single, consistent wrapper element directly below the tab bar with the same class and styling (border, background, radius, margin-top: -1px) so the active tab can visually “join” it.

**Approach:**

1. **Introduce a shared join container class** (e.g. `.settings-tab-content-box`) that has the same frame styling as `.settings-panel-wrap` (border except top, border-radius bottom, background, margin-top: -1px).

2. **Accordion-based panels (JS-injected tabs):** In `server/public/settings-page.js` inside `injectMainTabsFromAccordion`, after creating the `ul.nav-tabs`, wrap the accordion in a `div.settings-tab-content-box` (create the wrapper, append the accordion into it, insert the wrapper where the accordion was). So structure becomes: `card-body > ul.nav-tabs + div.settings-tab-content-box > accordion`. Run this only when the accordion is not already wrapped (e.g. check for existing wrapper or use a data attribute to avoid double wrap).

3. **Cost-expenses panel (static HTML):** In `server/public/settings.html`, wrap the existing tab panels (the sibling `div#settings-cost-expenses-panel-*`) in a single `div.settings-tab-content-box` so structure is: `card-body > ul#settings-cost-expenses-tabs + div.settings-tab-content-box > (all settings-cost-expenses-panel divs)`.

4. **CSS:** In `server/public/settings-ui.css`, add rules for `.settings-tab-content-box` (same frame as `.settings-panel-wrap`: border-left/right/bottom, border-radius bottom, padding, margin-top: -1px, background). Ensure the existing “tab joins content” rules target the content below the tab bar as this box (active tab background matches `.settings-tab-content-box`). Do not strip this box’s frame when it is inside accordion-body; the box is the direct sibling of the tab bar, not inside accordion-body.

5. **Normaliser / contract:** Ensure the normaliser does not remove or alter the new wrapper. The contract in `docs/UI_SETTINGS_CONTRACT.md` can state that panels with in-page tab bars must have exactly one `.settings-tab-content-box` as the direct sibling of the tab list.

**Result:** Layout/tables, layout/kpis, layout/date-ranges, and every other settings tab view (Kexo, Integrations, Attribution, Insights, Cost-expenses, Admin) will have the same opening container below the tabs, so the tab system design joins properly everywhere.

---

## 1. Side menu: category margin

**File:** `server/public/settings-ui.css`

- Add `margin-right: 10px` to `.settings-nav-category` (e.g. next to the existing `margin-bottom: 0.15rem`).

---

## 2. In-panel tab bar styling (join + inactive)

**Scope:** All Settings in-panel tab bars (JS-injected and `#settings-cost-expenses-tabs`).

**File:** `server/public/settings-ui.css`

Add rules scoped to `body[data-page="settings"]`:

- **Tab list:** Remove default nav-tabs chrome (border: 0, margin: 0, padding: 0). Ensure margin-bottom so the bar touches `.settings-tab-content-box` (e.g. 0 or 1px).
- **Active .nav-link:** Background same as `.settings-tab-content-box` (e.g. `var(--tblr-bg-surface)`), border-radius 8px 8px 0 0, border-bottom matching so no seam, padding 10px 15px, font-weight 600, font-size 14px, optional underline.
- **Inactive .nav-link:** Different background, no “join” border, padding and optional gap so inactive tabs are distinct.

Target both `a.nav-link` (JS-injected) and `button.nav-link` (cost-expenses).

---

## 3. Mobile: no wrap, horizontal scroll/swipe

**File:** `server/public/settings-ui.css`

In a mobile media query for the same in-panel tab bars:

- Tab list: `display: flex`, `flex-wrap: nowrap`, `overflow-x: auto`, `-webkit-overflow-scrolling: touch`.
- Tab items: `flex-shrink: 0` so tabs don’t shrink and the list scrolls horizontally.

---

## 4. Existing rules to respect

- `.settings-panel-wrap` and `body[data-page="settings"] .accordion-body .settings-panel-wrap` — keep; `.settings-tab-content-box` is a separate sibling-of-tabs container and is not inside accordion-body.
- `server/public/custom.css` `.settings-main-tabs-accordion` — leave as is.

---

## 5. Verification

- `npm run ui:check` and `npm test`.
- Manually: Desktop — active tab joins content on every tab view (Kexo, Integrations, Layout, Attribution, Insights, Cost-expenses, Admin); side menu 10px margin-right; inactive tabs distinct. Mobile — tab row scrolls horizontally, no wrap.
- Spot-check URLs: `/settings/layout/tables`, `/settings/layout/kpis`, `/settings/layout/date-ranges`, `/settings/cost-expenses/cost-sources`, `/settings/kexo/general`.

---

## Files to change

| File | Change |
|------|--------|
| `server/public/settings-ui.css` | `.settings-nav-category { margin-right: 10px }`. Add `.settings-tab-content-box` frame rules. Scoped in-panel tab bar rules (active/inactive). Mobile media query (flex, nowrap, overflow-x, flex-shrink: 0). |
| `server/public/settings-page.js` | In `injectMainTabsFromAccordion`, wrap accordion in `div.settings-tab-content-box` before inserting nav so structure is `host > nav + div.settings-tab-content-box > accordion`. |
| `server/public/settings.html` | Wrap cost-expenses tab panels in `div.settings-tab-content-box` (one wrapper containing all `#settings-cost-expenses-panel-*` divs). |
| `docs/UI_SETTINGS_CONTRACT.md` | Optional: note that tab panels must have a single `.settings-tab-content-box` as the direct sibling of the tab list for consistent join styling. |
