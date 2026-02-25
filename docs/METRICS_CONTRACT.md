# Metrics contract (truth sales & dashboard consistency)

This document defines the **canonical (“truth”)** definitions for sales-related metrics so that **KPIs, charts, widgets, and exports stay aligned**.

## Truth order set (default)

When a metric is described as **Truth Orders**, it MUST use:

- **Order inclusion**
  - Include **all Shopify paid orders** (`financial_status = 'paid'`)
  - Exclude **test** orders (`test IS NULL OR test = 0`)
  - Exclude **cancelled** orders (`cancelled_at IS NULL`)
  - Do **not** filter to `checkout_token` (POS/manual/subscription renewals are still real sales)

- **Sale timestamp (“sale_at”)**
  - \(sale\_at = COALESCE(processed\_at, created\_at)\)
  - Rationale: `processed_at` is the best available paid/sale time; `created_at` is the fallback for older/edge orders.

- **Bucketing / range boundaries**
  - “Today / Yesterday / date ranges” are computed in the **Admin timezone** (`store.resolveAdminTimeZone()`).
  - Daily/hourly buckets use the **sale_at** timestamp when assigning orders to a day/hour.

This is the basis used by:

- `server/salesTruth.js` truth helpers (`getTruthSalesTotalGbp`, `getTruthOrderCount`, …)
- `/api/kpis` (“Yesterday”/rolling windows sales)
- `/api/business-snapshot` revenue/order totals + timeseries

## Checkout-only order set (explicit opt-in)

Some analyses intentionally restrict to **online-store checkout orders** (proxy: `checkout_token IS NOT NULL AND TRIM(checkout_token) != ''`) for **apples-to-apples** comparisons with Shopify sessions / pixel evidence.

If you use this variant:

- The metric name, key, and/or UI label MUST say **“checkout”** explicitly (e.g. `checkoutSalesGbp`, “Checkout revenue”).
- It MUST still bucket by \(sale\_at = COALESCE(processed\_at, created\_at)\) unless a metric explicitly documents otherwise.

## Refunds: gross vs net (must be stated)

If a metric subtracts refunds (net sales), it MUST be labeled as such (“Net of refunds”) and must not be mixed with gross sales in the same comparison without explicit UI copy.

