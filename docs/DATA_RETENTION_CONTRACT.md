## Data retention contract (Phase 1)

This document defines what “retention” means in Kexo and how it maps to plan tiers.

### Definitions

- **Drilldowns**: raw session + event data used for per-session timelines and event-level inspection.
  - Backed by raw tables (`sessions`, `events`, and related join tables).
  - Subject to **drilldown retention** (raw rows are deleted beyond this window).

- **Charts / KPIs**: time-series and headline metrics for longer ranges.
  - Backed by **daily rollups** (aggregated rows) so we can keep multi-year history without keeping all raw events.
  - Subject to **charts retention** (rollups are kept for this window).

### Tier matrix (source of truth)

Retention tiers are normalized to: `starter`, `growth`, `scale`, `max`.

| Tier | Charts/KPIs retention (rollups) | Drilldowns retention (raw) |
|---|---:|---:|
| starter | 7 days | 7 days |
| growth | 90 days (3 months) | 30 days |
| scale | 548 days (1.5 years) | 60 days |
| max | 1095 days (3 years) | 90 days |

### Safety & failure modes

- **Fail-safe tier resolution**: if multiple sources exist (env override + user tiers), Kexo selects the **highest** tier to avoid accidental deletions.
- **Rollups before deletion**: cleanup must ensure rollups exist for days that are about to fall out of drilldown retention (so long-range charts remain correct).
- **Sales truth**: revenue/orders remain Shopify-truth backed; retention applies to session/event-derived metrics.

### Phase boundaries

- **Phase 1**: single-install “effective tier” with daily rollups; not per-shop multi-tenant retention.
- **Phase 2**: per-shop billing tier and per-shop retention windows (and `shop` scoping across raw + rollup tables).

