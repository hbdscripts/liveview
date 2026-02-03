# CR fix – Phase 0 baseline

**Purpose:** Document current /api/stats CR formula and denominator logic, then run baseline queries. Paste query outputs below after running `node scripts/cr-baseline-queries.js` (or run SQL manually).

---

## 1. /api/stats calculation (server-side)

**File:** `server/store.js`

**CR formula:**
- Conversion rate = `(sessions with started_at in window AND has_purchased = 1) / (sessions with started_at in window)`.
- `getConversionRate(start, end)`:
  - Total = `COUNT(*) FROM sessions WHERE started_at >= start AND started_at < end`
  - Purchased = same + `AND has_purchased = 1`
  - CR = purchased / total (as percentage, rounded to 1 decimal).

**Denominator logic:**
- Denominator = **sessions that started** in the time window `[start, end)`.
- Windows are calendar-based in `ADMIN_TIMEZONE` (default Europe/London):
  - **today:** start of today → now
  - **yesterday:** start of yesterday → start of today
  - **3d:** start of day 3 days ago → now
  - **7d:** start of day 7 days ago → now
- **Important:** Only sessions that **still exist** in the DB are counted. Cleanup deletes sessions where `last_seen < now - SESSION_TTL_MINUTES` (default 24h), so sessions that started in “yesterday” or “7d” but had no activity in the last 24h are **already deleted** → denominator is too small → CR inflated.

**Purchased count (numerator):**
- `getConvertedCount(start, end)` counts sessions where `has_purchased = 1` and `(purchased_at in window OR (purchased_at IS NULL AND last_seen in window))`.
- Sales total: same sessions, `SUM(order_total)`.

---

## 2. Cleanup logic (what rows get deleted)

**File:** `server/cleanup.js`  
**Runs:** Every 2 minutes (server/index.js).

**Current rule:**
- Delete sessions where:
  - `last_seen < sessionCutoff` (sessionCutoff = now - SESSION_TTL_MINUTES, default 24*60 minutes),
  - AND `(is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < abandonedCutoff)`.
- So: non-abandoned sessions (or abandoned outside retention) with no activity in the last 24h are deleted.
- Events: per-session trim to last `MAX_EVENTS_PER_SESSION` (50); no cascade delete of events when session is deleted (FK may leave orphans depending on DB).

---

## 3. Baseline query outputs

Run from project root (with DB available):

```bash
node scripts/cr-baseline-queries.js
```

Then paste the printed output below.

### 3.1 Today

```
( paste output for today window )
```

### 3.2 Yesterday

```
( paste output for yesterday window )
```

### 3.3 Last 7 days

```
( paste output for 7d window )
```

### 3.4 Duplicate checkout_completed per session_id

```
( paste any rows where same session has multiple checkout_completed events )
```

### 3.5 Cleanup – rows that would be deleted (pre-fix)

```
( paste count of sessions matching current cleanup WHERE clause )
```

---

## 4. Placeholder (paste here after running script)

Replace this section with the actual script output.

**Date/time baseline was run:** _______________  
**ADMIN_TIMEZONE:** _______________  
**SESSION_TTL_MINUTES:** _______________
