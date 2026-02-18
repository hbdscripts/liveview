/**
 * Edge blocked logging endpoints.
 *
 * - POST /api/edge-blocked: internal only (Worker); X-Internal-Secret must match INGEST_SECRET
 * - GET /api/edge-blocked/summary: admin-only; aggregate counts
 * - GET /api/edge-blocked/events: admin-only; recent events with filters
 */

const config = require('../config');
const { getDb, isPostgres } = require('../db');

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }

function trimText(v, maxLen) {
  const out = s(v).trim();
  if (!out) return null;
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function normalizeCountry(v) {
  const out = s(v).trim().toUpperCase();
  if (!out || out.length !== 2 || out === 'XX' || out === 'T1') return null;
  return out;
}

function normalizeBool01(v) {
  if (v === true || v === 1 || v === '1') return 1;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return 1;
  return 0;
}

function normalizeAsn(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t !== 'string' && t !== 'number') return null;
  const out = String(v).trim();
  if (!out) return null;
  // Keep storage-friendly: digits only.
  const digits = out.replace(/[^0-9]+/g, '');
  if (!digits) return null;
  return digits.length > 16 ? digits.slice(0, 16) : digits;
}

function normalizeLimit(v) {
  const n = parseInt(s(v).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.max(1, Math.min(1000, n));
}

function normalizeSinceMs(v, fallbackMs) {
  const n = parseInt(s(v).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  const now = Date.now();
  // Clamp: allow up to 31 days back, no future.
  const min = now - 31 * 24 * 60 * 60 * 1000;
  const clamped = Math.max(min, Math.min(now, n));
  return clamped;
}

function rangeToSinceMs(rangeKey) {
  const k = s(rangeKey).trim().toLowerCase();
  const now = Date.now();
  if (k === '7d') return now - 7 * 24 * 60 * 60 * 1000;
  return now - 24 * 60 * 60 * 1000;
}

async function insertEdgeBlockEvent(fields) {
  const db = getDb();
  const now = Date.now();
  const createdAt = now;
  const hourTs = Math.floor(createdAt / (60 * 60 * 1000)) * (60 * 60 * 1000);

  const edgeResult = trimText(fields.edge_result, 64);
  const blockedReason = trimText(fields.blocked_reason, 64);
  const httpMethod = trimText(fields.http_method, 16);
  const host = trimText(fields.host, 128);
  const path = trimText(fields.path, 512);
  const rayId = trimText(fields.ray_id, 96);
  const country = normalizeCountry(fields.country);
  const colo = trimText(fields.colo, 32);
  const asn = normalizeAsn(fields.asn);
  const knownBot = normalizeBool01(fields.known_bot);
  const verifiedBotCategory = trimText(fields.verified_bot_category, 128);
  const ua = trimText(fields.ua, 512);
  const origin = trimText(fields.origin, 512);
  const referer = trimText(fields.referer, 512);
  const ipHash = trimText(fields.ip_hash, 128);
  const ipPrefix = trimText(fields.ip_prefix, 64);
  const tenantKey = trimText(fields.tenant_key, 128) || '';

  if (!edgeResult || !blockedReason) return { ok: false, error: 'Missing edge_result or blocked_reason' };

  if (isPostgres()) {
    await db.run(
      `
      INSERT INTO edge_block_events (
        created_at, edge_result, blocked_reason,
        http_method, host, path,
        ray_id, country, colo, asn,
        known_bot, verified_bot_category,
        ua, origin, referer,
        ip_hash, ip_prefix, tenant_key
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17, $18
      )
      `.trim(),
      [
        createdAt, edgeResult, blockedReason,
        httpMethod, host, path,
        rayId, country, colo, asn,
        knownBot, verifiedBotCategory,
        ua, origin, referer,
        ipHash, ipPrefix, tenantKey,
      ]
    );
    await db.run(
      'INSERT INTO edge_block_counts_hourly (hour_ts, blocked_reason, tenant_key, count, updated_at) VALUES ($1, $2, $3, 1, $4) ON CONFLICT (hour_ts, blocked_reason, tenant_key) DO UPDATE SET count = edge_block_counts_hourly.count + 1, updated_at = EXCLUDED.updated_at',
      [hourTs, blockedReason, tenantKey, now]
    ).catch(() => null);
  } else {
    await db.run(
      `
      INSERT INTO edge_block_events (
        created_at, edge_result, blocked_reason,
        http_method, host, path,
        ray_id, country, colo, asn,
        known_bot, verified_bot_category,
        ua, origin, referer,
        ip_hash, ip_prefix, tenant_key
      )
      VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
      `.trim(),
      [
        createdAt, edgeResult, blockedReason,
        httpMethod, host, path,
        rayId, country, colo, asn,
        knownBot, verifiedBotCategory,
        ua, origin, referer,
        ipHash, ipPrefix, tenantKey,
      ]
    );
    await db.run(
      'INSERT INTO edge_block_counts_hourly (hour_ts, blocked_reason, tenant_key, count, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(hour_ts, blocked_reason, tenant_key) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at',
      [hourTs, blockedReason, tenantKey, now]
    ).catch(() => null);
  }

  return { ok: true };
}

async function postEdgeBlocked(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).set('Allow', 'POST').end();
  }

  const secret = (req.get('x-internal-secret') || req.get('X-Internal-Secret') || '').trim();
  if (!secret || secret !== config.ingestSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    const r = await insertEdgeBlockEvent(body || {});
    if (!r || r.ok !== true) return res.status(400).json({ error: (r && r.error) ? r.error : 'Invalid payload' });
    return res.status(204).end();
  } catch (err) {
    console.error('[edge-blocked]', err);
    return res.status(500).json({ error: 'Failed to record edge block' });
  }
}

async function getEdgeBlockedSummary(req, res) {
  const range = s(req.query && req.query.range).trim().toLowerCase() || '24h';
  const since = rangeToSinceMs(range);
  const now = Date.now();
  const tenantKey = trimText(req.query && req.query.tenant_key, 128);
  const db = getDb();

  try {
    const baseWhere = isPostgres() ? 'WHERE created_at >= $1' : 'WHERE created_at >= ?';
    const tenantClause = tenantKey ? (isPostgres() ? ' AND tenant_key = $2' : ' AND tenant_key = ?') : '';
    const baseParams = tenantKey ? [since, tenantKey] : [since];

    // Totals by edge_result
    const sqlTotals = `SELECT edge_result, COUNT(*) AS n FROM edge_block_events ${baseWhere}${tenantClause} GROUP BY edge_result`;
    const paramsTotals = baseParams.slice();

    // By reason/country/asn/category
    const sqlReason = `SELECT blocked_reason, COUNT(*) AS n FROM edge_block_events ${baseWhere}${tenantClause} GROUP BY blocked_reason ORDER BY n DESC`;
    const paramsReason = baseParams.slice();

    const sqlCountry = `SELECT country, COUNT(*) AS n FROM edge_block_events ${baseWhere}${tenantClause} AND country IS NOT NULL AND country <> '' GROUP BY country ORDER BY n DESC LIMIT 50`;
    const paramsCountry = baseParams.slice();

    const sqlAsn = `SELECT asn, COUNT(*) AS n FROM edge_block_events ${baseWhere}${tenantClause} AND asn IS NOT NULL AND asn <> '' GROUP BY asn ORDER BY n DESC LIMIT 50`;
    const paramsAsn = baseParams.slice();

    const sqlCat = `SELECT verified_bot_category, COUNT(*) AS n FROM edge_block_events ${baseWhere}${tenantClause} AND verified_bot_category IS NOT NULL AND verified_bot_category <> '' GROUP BY verified_bot_category ORDER BY n DESC LIMIT 50`;
    const paramsCat = baseParams.slice();

    const [totalsRows, reasonRows, countryRows, asnRows, catRows] = await Promise.all([
      db.all(sqlTotals, paramsTotals),
      db.all(sqlReason, paramsReason),
      db.all(sqlCountry, paramsCountry),
      db.all(sqlAsn, paramsAsn),
      db.all(sqlCat, paramsCat),
    ]);

    const totals = { blocked: 0, bots: 0, junk: 0 };
    const byEdgeResult = [];
    for (const r of totalsRows || []) {
      const key = trimText(r.edge_result, 64) || '';
      const n = r && r.n != null ? Number(r.n) : 0;
      if (Number.isFinite(n)) totals.blocked += n;
      byEdgeResult.push({ edge_result: key, count: Number.isFinite(n) ? n : 0 });
      if (key === 'dropped_bot') totals.bots += Number.isFinite(n) ? n : 0;
      if (key === 'dropped_junk' || key === 'dropped_offsite' || key === 'bad_method' || key === 'bad_path' || key === 'host_denied') totals.junk += Number.isFinite(n) ? n : 0;
    }

    function mapRows(rows, keyName) {
      const out = [];
      for (const r of rows || []) {
        const k = trimText(r && r[keyName], 128);
        const n = r && r.n != null ? Number(r.n) : 0;
        if (!k) continue;
        out.push({ [keyName]: k, count: Number.isFinite(n) ? n : 0 });
      }
      return out;
    }

    return res.json({
      ok: true,
      range: range === '7d' ? '7d' : '24h',
      since,
      until: now,
      tenant_key: tenantKey || null,
      totals,
      by_edge_result: byEdgeResult,
      by_reason: mapRows(reasonRows, 'blocked_reason'),
      by_country: mapRows(countryRows, 'country'),
      by_asn: mapRows(asnRows, 'asn'),
      by_verified_bot_category: mapRows(catRows, 'verified_bot_category'),
    });
  } catch (err) {
    console.error('[edge-blocked/summary]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load summary' });
  }
}

async function getEdgeBlockedEvents(req, res) {
  const limit = normalizeLimit(req.query && req.query.limit);
  const fallbackSince = rangeToSinceMs('24h');
  const since = normalizeSinceMs(req.query && req.query.since, fallbackSince);
  const tenantKey = trimText(req.query && req.query.tenant_key, 128);
  const blockedReason = trimText(req.query && req.query.blocked_reason, 64);
  const country = normalizeCountry(req.query && req.query.country);
  const asn = normalizeAsn(req.query && req.query.asn);
  const qRaw = trimText(req.query && req.query.q, 96);
  const q = qRaw ? qRaw.toLowerCase() : null;

  const db = getDb();
  const clauses = [];
  const params = [];
  let idx = 0;
  const ph = () => (isPostgres() ? `$${++idx}` : '?');

  clauses.push(`created_at >= ${ph()}`);
  params.push(since);
  if (tenantKey) { clauses.push(`tenant_key = ${ph()}`); params.push(tenantKey); }
  if (blockedReason) { clauses.push(`blocked_reason = ${ph()}`); params.push(blockedReason); }
  if (country) { clauses.push(`country = ${ph()}`); params.push(country); }
  if (asn) { clauses.push(`asn = ${ph()}`); params.push(asn); }
  if (q) {
    const like = '%' + q.replace(/[%_]/g, '\\$&') + '%';
    clauses.push(
      `(LOWER(COALESCE(ua, '')) LIKE ${ph()} ESCAPE '\\' OR ` +
      `LOWER(COALESCE(origin, '')) LIKE ${ph()} ESCAPE '\\' OR ` +
      `LOWER(COALESCE(referer, '')) LIKE ${ph()} ESCAPE '\\' OR ` +
      `LOWER(COALESCE(path, '')) LIKE ${ph()} ESCAPE '\\')`
    );
    params.push(like, like, like, like);
  }

  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  const sql =
    `SELECT id, created_at, edge_result, blocked_reason, http_method, host, path, ray_id, country, colo, asn, known_bot, verified_bot_category, ua, origin, referer, tenant_key
       FROM edge_block_events
       ${where}
      ORDER BY created_at DESC
      LIMIT ${isPostgres() ? ph() : '?'}
    `;
  params.push(limit);

  try {
    const rows = await db.all(sql, params);
    return res.json({ ok: true, since, limit, events: rows || [] });
  } catch (err) {
    console.error('[edge-blocked/events]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load events' });
  }
}

module.exports = {
  postEdgeBlocked,
  getEdgeBlockedSummary,
  getEdgeBlockedEvents,
};

