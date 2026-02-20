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
- **Sale date:** For dashboard and Total sales we use **`processed_at`** (fallback `created_at` when null). Product/variant reports also bucket by `order_processed_at` on line items.
- **orders_paid** = `COUNT(DISTINCT order_id)`.

---

## Revenue (GBP)

### Total sales (dashboard Revenue KPI)

- **Total sales** = sum of order `total_price` for orders with sale date (`processed_at` or `created_at`) in range, **minus** refund amounts (from `orders_shopify_refunds`) bucketed by the **Returns & refunds attribution** setting.
- Refunds are attributed either to **processing date** (`refund_created_at`) or **original sale date** (order `processed_at`). Setting: `kpi_ui_config_v1.options.general.returnsRefundsAttribution` (`processing_date` | `original_sale_date`).
- This matches Shopify-style “Total sales” (net of refunds). Display: 2 decimal places.

### Net sales (product / variant reports)

- **Net sales** = `SUM(COALESCE(line_net, line_revenue))` on `orders_shopify_line_items` for sale date in range, **minus** refund line item subtotals (`orders_shopify_refund_line_items.subtotal`) bucketed by the same attribution setting.
- `line_net` = line gross − line discount (Shopify line item: `quantity * price − total_discount`). Used for product/variant revenue columns; labelled “Net sales” in UI where appropriate.
- Display: 2 decimal places (GBP).

### Legacy / internal

- **Revenue** (legacy) from Shopify truth: `SUM(orders_shopify_line_items.line_revenue)` with FX to GBP. Prefer **Total sales** (dashboard) or **Net sales** (product/variant) as above.

---

## Conversion rate (CR%)

- **CR%** = `(orders_paid / sessions_human) * 100`; 1 decimal place; **null** when `sessions_human <= 0`.

---

## Product-level CR%

- Denominator = product landing sessions (entry = product page; handle from `first_path` / `first_product_handle` / `entry_url`).
- **product_cr_pct** = `(product_orders_paid / product_landing_sessions_human) * 100`; null when denominator 0.

---

## Returns & refunds attribution

- Setting: **Returns & refunds attribution** (`kpi_ui_config_v1.options.general.returnsRefundsAttribution`).
  - **Credited to processing date** (`processing_date`): refunds reduce revenue in the bucket where `refund_created_at` falls.
  - **Credited to original sale date** (`original_sale_date`): refunds reduce revenue in the bucket of the order’s `processed_at`.
- Applies to: dashboard Total sales (refund deduction), Returns KPI total and sparkline, and product/variant Net sales (refund line item subtraction).
- Refund facts are persisted in `orders_shopify_refunds` and `orders_shopify_refund_line_items` (synced from Shopify Orders API by `updated_at`).

---

## Abandoned carts

- **Abandoned session:** `has_purchased = 0`, `is_abandoned = 1`, `abandoned_at` in range; mode filter cart vs checkout.
- **Abandoned value:** `SUM(sessions.cart_value)` in GBP.
- Ratio: null when denominator 0.
