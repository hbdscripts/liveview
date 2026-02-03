# CR fix – Phase 1 (retention + purchase dedupe)

**Purpose:** Document Phase 1 changes and before/after query outputs.

---

## 1. Changes implemented

### 1A) Retention / cleanup

**Problem:** Cleanup deleted sessions by `last_seen` only (default 24h), so sessions that *started* in yesterday/3d/7d but had no activity in 24h were already deleted → denominator too small → CR inflated.

**Solution:**
- New env: **SESSION_RETENTION_DAYS** (default 30). Cleanup deletes sessions only when **BOTH** `last_seen` and `started_at` are older than retention (and not abandoned within retention).
- Events for those sessions are deleted first, then sessions.

**Files changed:**
- `server/config.js` – added `sessionRetentionDays: getInt('SESSION_RETENTION_DAYS', 30)`.
- `server/cleanup.js` – delete only when `last_seen < retentionCutoff AND started_at < retentionCutoff`; delete events for those sessions before deleting sessions.
- `.env.example` – added `SESSION_RETENTION_DAYS=30`.

### 1B) Order-level purchase dedupe

**Problem:** No durable order identifier; one real order could be counted multiple times (e.g. thank-you in two tabs = two sessions with `has_purchased=1`).

**Solution:**
- New **purchases** table with UNIQUE `purchase_key`. Keys: `order:id` (from Shopify `checkout.order.id`), else `token:...` (from `checkout.token`), else deterministic hash of (currency + total + rounded ts + session_id).
- On `checkout_completed` ingest: compute `purchase_key`, INSERT into purchases (ON CONFLICT DO NOTHING / INSERT OR IGNORE). Still set `sessions.has_purchased=1` for UI.
- Stats (conversion count, sales total, country stats) **count from purchases table**, not from `sessions.has_purchased`.

**Files changed:**
- `server/migrations/008_purchases.js` – new table `purchases` (purchase_key PK, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code). Backfill from existing sessions with has_purchased=1 using `legacy:session_id`.
- `server/store.js` – WHITELIST + `order_id`, `checkout_token`. New `computePurchaseKey`, `insertPurchase`. `getSalesTotal`, `getConvertedCount`, `getConversionRate`, `getCountryStats` use `purchases` table.
- `server/routes/ingest.js` – on `payload.checkout_completed`, call `store.insertPurchase(payload, sessionId, payload.country_code)` before insertEvent.
- `extensions/live-visitors-pixel/src/index.js` – send `order_id` (checkout.order?.id) and `checkout_token` (checkout.token) in checkout_completed payload.
- `server/migrate.js` and `server/index.js` – run migration 008 on migrate and startup.

---

## 2. Before/after query outputs

### Re-run baseline script after Phase 1

```bash
node scripts/cr-baseline-queries.js
```

**Expected (after Phase 1):**
- **Yesterday / 7d:** `sessions_started_in_window` should be **materially larger** than pre-fix (sessions that started in the window are no longer deleted until both last_seen and started_at are older than SESSION_RETENTION_DAYS).
- **Purchased count:** Now comes from `purchases` table (deduped). Re-sending same checkout_completed (same order_id/token) should not increase count.

### Dedupe validation query

After Phase 1, simulate or re-send the same checkout_completed payload twice (e.g. same session, same order_id). Then:

```sql
SELECT COUNT(*) AS purchase_count FROM purchases WHERE purchase_key = 'order:<that_order_id>';
-- Should be 1.
```

---

## 3. DB queries to prove correctness

**Sessions started today (unchanged):**
```sql
-- Use start/end from getRangeBounds('today', now, timeZone)
SELECT COUNT(*) FROM sessions WHERE started_at >= ? AND started_at < ?;
```

**Purchases in window (new – from purchases table):**
```sql
SELECT COUNT(*) FROM purchases WHERE purchased_at >= ? AND purchased_at < ?;
```

**Sales total (new – from purchases table):**
```sql
SELECT COALESCE(SUM(order_total), 0) FROM purchases WHERE purchased_at >= ? AND purchased_at < ?;
```

**Cleanup – rows that would be deleted (after Phase 1):**
```sql
-- retentionCutoff = now - (SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
SELECT COUNT(*) FROM sessions
WHERE last_seen < ? AND started_at < ?
AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?);
```
(Use retentionCutoff and abandonedCutoff.)

---

## 4. Confirmation

- **Bot scoring:** NOT used anywhere (no cf.bot_management.score / request.cf.botManagement.score).
- Phase 2 (Cloudflare human-only) is implemented behind flags; default behaviour unchanged until TRAFFIC_MODE and CF proxy are configured.
