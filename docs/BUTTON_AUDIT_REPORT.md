# Button style inconsistency audit

Scan scope: `server/public/**/*.html`, `server/public/**/*.js`, `client/app/**/*.js`.  
No code changes were made; this report is for decision-making before any standardization.

---

## 1. By page / route

| Page / route | Component area | Notes |
|--------------|----------------|--------|
| **Header** (partials/header.html) | Nav | `btn btn-ghost-secondary btn-icon` (notifications), `btn btn-sm btn-ghost-secondary` / `btn btn-icon btn-ghost-secondary` (Kexo Score modal) |
| **Settings** (settings.html, settings-page.js) | Settings UI | `btn btn-md btn-icon`, `btn btn-ghost-secondary btn-sm`, `btn btn-ghost-secondary btn-md`, `btn-close`; Cost breakdown: `btn btn-sm btn-ghost-secondary`. Contract forbids `btn-outline-*` in Settings — **none found in Settings HTML** |
| **Admin** (admin-page.js) | Admin UI | **`btn btn-outline-secondary`** used for role-perm bulk "All" / "None" (outside Settings layout) |
| **Performance** (performance.html) | Report | `btn btn-secondary btn-md` (range dropdown) |
| **Tools** (shipping-cr, time-of-day, etc.) | Tools | `btn btn-primary` (Go); some `btn btn-secondary` |
| **Insights / countries** (countries.html) | Map controls | `btn-group btn-group-sm` with `btn btn-primary` (Live / By period) |
| **Snapshot** (insights/snapshot.html) | Snapshot | `btn btn-sm btn-ghost-secondary` (Revenue & Cost settings) |
| **Dashboard / app.js** (client) | Modals, cards | `btn btn-sm btn-primary`, `btn-close`, chart settings/layout shortcuts use various btn classes |
| **Client app** (15-user-footer-product.js, etc.) | Modals, rows | `btn-close` (product insights), other dynamic buttons |

---

## 2. Mismatch types

### 2.1 Size mismatch
- **Explicit sizes**: `btn-sm`, `btn-md`, `btn-lg` appear across the app; many buttons have **no size class** (rely on Tabler default).
- **Inconsistency**: Header uses `btn-sm` for some actions and `btn-icon` without a consistent size; Settings uses `btn-md` for primary actions and `btn-sm` for cost-breakdown range toggles; Performance uses `btn-md` for the range button.
- **Recommendation**: Pick a default (e.g. `btn-md` for most actions, `btn-sm` for tight toolbars/secondary actions) and document; then apply consistently.

### 2.2 Tone / variant
- **Primary**: `btn-primary` (Go buttons, Live/By period active state).
- **Secondary**: `btn-secondary` (Performance range, some tools).
- **Ghost**: `btn-ghost-secondary` (header notifications, Kexo Score, Settings GA/cost breakdown, Insights variants).
- **Outline**: `btn-outline-secondary` only in **admin-page.js** (role-perm bulk All/None). Contract says no `btn-outline-*` in Settings/Admin UI — this is in Admin but not in the Settings normaliser path; worth aligning to solid variant if you extend the contract to all admin surfaces.
- **Danger**: used sparingly (e.g. retry/danger alerts).
- **Recommendation**: Standardise on solid variants for primary actions; keep ghost for low-emphasis nav/secondary actions; replace any remaining outline with solid or ghost per contract.

### 2.3 Icon buttons
- **Patterns**: `btn-icon` (with or without `btn-ghost-secondary`), `btn-close` for modals.
- **Inconsistency**: Some icon buttons have `btn-sm` (e.g. Kexo Score "Show summary" is `btn btn-sm btn-ghost-secondary` with text); close buttons use `btn-close` (Bootstrap/Tabler pattern).
- **Recommendation**: One pattern for icon-only (e.g. `btn btn-icon btn-ghost-secondary` or `btn-close` for dismiss); one for icon+label; document in UI contract.

---

## 3. Summary

- **btn-outline-***: Only in **admin-page.js** (role-perm bulk All/None). Consider replacing with `btn btn-secondary` (or ghost) to match contract.
- **Sizes**: Mix of none, `btn-sm`, `btn-md`; no `btn-lg` in scan. Recommend defaulting to `btn-md` for primary/secondary and reserving `btn-sm` for compact areas.
- **Ghost vs secondary**: Ghost used in header and Settings for low emphasis; secondary used for Performance and some tools. Consistent.
- **Settings/Admin contract**: No `btn-outline-*` in Settings HTML; Admin role-perm panel uses outline — clarify if contract applies to all admin UI and, if so, change to solid/ghost.

No mass changes were applied; choose a standard (sizes + variants + icon pattern) and then apply across pages/areas.
