# Metrics (definitions and truth sources)

Single source of truth for core metric semantics so UI tables/charts stay consistent.

---

## Time windows

- **Admin timezone:** `ADMIN_TIMEZONE` (e.g. Europe/London); `store.resolveAdminTimeZone()`.
- **Range bounds:** `store.getRangeBounds(rangeKey, nowMs, timeZone)` → half-open `[startMs, endMs)`.
  - For “today” ranges, `endMs` is `nowMs`.
  - For fixed past days (e.g. yesterday, `d:YYYY-MM-DD`), `endMs` is next day start in admin TZ.
- **Range key normalization:** UI may send `7days`/`14days`/`30days`; server normalizes to `7d`/`14d`/`30d`.

---

## Null / divide-by-zero

- Any **ratio** (CR%, bounce rate, ROAS, etc.) is **null** when denominator is 0 or unknown.
- UI must render null ratios as **—** (never `0.0%`).

---

## Traffic filtering

- **Human-only:** Exclude sessions with `sessions.cf_known_bot = 1` (treat NULL as human).
- Canonical filter: `store.sessionFilterForTraffic()` and route-local equivalents.

---

## Sessions

- **Sessions** = rows in `sessions` where `started_at` is in `[startMs, endMs)`.
- **Human sessions** = count after human-only filter.

---

## Orders (Shopify truth)

- **Orders** = distinct Shopify truth orders: `financial_status = 'paid'`, `cancelled_at IS NULL`, `(test IS NULL OR test = 0)`.
- Order time: typically `orders_shopify.created_at` (or `processed_at` where documented).
- **orders_paid** = `COUNT(DISTINCT order_id)`.

---

## Revenue (GBP)

- **Revenue** from Shopify truth: `SUM(orders_shopify_line_items.line_revenue)` with FX to GBP at report time.
- Display: 2 decimal places.

---

## Conversion rate (CR%)

- **CR%** = `(orders_paid / sessions_human) * 100`; 1 decimal place; **null** when `sessions_human <= 0`.

---

## Product-level CR%

- Denominator = product landing sessions (entry = product page; handle from `first_path` / `first_product_handle` / `entry_url`).
- **product_cr_pct** = `(product_orders_paid / product_landing_sessions_human) * 100`; null when denominator 0.

---

## Abandoned carts

- **Abandoned session:** `has_purchased = 0`, `is_abandoned = 1`, `abandoned_at` in range; mode filter cart vs checkout.
- **Abandoned value:** `SUM(sessions.cart_value)` in GBP.
- Ratio: null when denominator 0.
