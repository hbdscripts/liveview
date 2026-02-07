const { getDb, isPostgres } = require('../db');
const fx = require('../fx');
const { getAdsDb } = require('./adsDb');

function normalizeSource(v) {
  const s = v != null ? String(v).trim().toLowerCase() : '';
  return s || null;
}

function purchaseDedupWhere(alias = 'p') {
  const p = alias ? alias + '.' : '';
  const bucket = isPostgres()
    ? `FLOOR(${p}purchased_at/900000.0)::bigint`
    : `CAST(${p}purchased_at/900000 AS INTEGER)`;
  const bucketCmp = isPostgres()
    ? `FLOOR(p2.purchased_at/900000.0) = FLOOR(${p}purchased_at/900000.0)`
    : `CAST(p2.purchased_at/900000 AS INTEGER) = CAST(${p}purchased_at/900000 AS INTEGER)`;
  const sameRow = isPostgres()
    ? `(p2.order_total IS NOT DISTINCT FROM ${p}order_total) AND (p2.order_currency IS NOT DISTINCT FROM ${p}order_currency)`
    : `(p2.order_total IS ${p}order_total OR (p2.order_total IS NULL AND ${p}order_total IS NULL)) AND (p2.order_currency IS ${p}order_currency OR (p2.order_currency IS NULL AND ${p}order_currency IS NULL))`;

  return ` AND (
    (NULLIF(TRIM(${p}checkout_token), '') IS NOT NULL OR NULLIF(TRIM(${p}order_id), '') IS NOT NULL)
    OR (${p}purchase_key LIKE 'h:%' AND NOT EXISTS (
      SELECT 1 FROM purchases p2
      WHERE (NULLIF(TRIM(p2.checkout_token), '') IS NOT NULL OR NULLIF(TRIM(p2.order_id), '') IS NOT NULL)
        AND p2.session_id = ${p}session_id AND ${sameRow} AND ${bucketCmp}
    ))
  )`;
}

function hourTsSql(alias = 'p') {
  const p = alias ? alias + '.' : '';
  return isPostgres()
    ? `DATE_TRUNC('hour', TO_TIMESTAMP(${p}purchased_at/1000.0))`
    : `DATETIME(${p}purchased_at/1000, 'unixepoch', 'start of hour')`;
}

async function rollupRevenueHourly(options = {}) {
  const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
  const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;
  const sourceRaw = normalizeSource(options.source);

  if (!rangeStartTs || !rangeEndTs || !Number.isFinite(rangeStartTs) || !Number.isFinite(rangeEndTs)) {
    return { ok: false, error: 'Missing rangeStartTs/rangeEndTs' };
  }

  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

  const db = getDb();

  const sourceClause = sourceRaw ? ' AND LOWER(TRIM(s.bs_source)) = ?' : '';
  const params = sourceRaw ? [rangeStartTs, rangeEndTs, sourceRaw] : [rangeStartTs, rangeEndTs];

  const rows = await db.all(
    `
      SELECT
        ${hourTsSql('p')} AS hour_ts,
        LOWER(TRIM(COALESCE(NULLIF(TRIM(s.bs_source), ''), ''))) AS source,
        TRIM(s.bs_campaign_id) AS campaign_id,
        COALESCE(NULLIF(TRIM(s.bs_adgroup_id), ''), '_all_') AS adgroup_id,
        COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS currency,
        COUNT(*) AS orders,
        COALESCE(SUM(p.order_total), 0) AS revenue
      FROM purchases p
      INNER JOIN sessions s ON s.session_id = p.session_id
      WHERE p.purchased_at >= ? AND p.purchased_at < ?
        AND NULLIF(TRIM(s.bs_campaign_id), '') IS NOT NULL
        AND NULLIF(TRIM(s.bs_source), '') IS NOT NULL
        ${purchaseDedupWhere('p')}
        ${sourceClause}
      GROUP BY hour_ts, source, campaign_id, adgroup_id, currency
      ORDER BY hour_ts ASC
    `,
    params
  );

  const ratesToGbp = await fx.getRatesToGbp();

  const grouped = new Map();
  for (const r of rows || []) {
    const hourTs = r && r.hour_ts != null ? r.hour_ts : null;
    const source = normalizeSource(r && r.source != null ? r.source : '') || null;
    const campaignId = r && r.campaign_id != null ? String(r.campaign_id).trim() : '';
    const adgroupId = r && r.adgroup_id != null ? String(r.adgroup_id).trim() : '';
    if (!hourTs || !source || !campaignId || !adgroupId) continue;

    const currency = fx.normalizeCurrency(r.currency) || 'GBP';
    const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
    const revenue = r && r.revenue != null ? Number(r.revenue) : 0;
    const revenueNum = Number.isFinite(revenue) ? revenue : 0;
    const gbp = fx.convertToGbp(revenueNum, currency, ratesToGbp);
    const revenueGbp = typeof gbp === 'number' && Number.isFinite(gbp) ? gbp : 0;

    const key = String(hourTs) + '\0' + source + '\0' + campaignId + '\0' + adgroupId;
    const cur = grouped.get(key) || {
      hourTs,
      source,
      campaignId,
      adgroupId,
      orders: 0,
      revenueGbp: 0,
    };
    cur.orders += orders;
    cur.revenueGbp += revenueGbp;
    grouped.set(key, cur);
  }

  const now = Date.now();
  let upserts = 0;
  for (const v of grouped.values()) {
    const revenueGbp = Math.round((Number(v.revenueGbp) || 0) * 100) / 100;
    const orders = Math.max(0, Math.floor(Number(v.orders) || 0));
    await adsDb.run(
      `
        INSERT INTO bs_revenue_hourly (source, hour_ts, campaign_id, adgroup_id, revenue_gbp, orders, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source, hour_ts, campaign_id, adgroup_id) DO UPDATE SET
          revenue_gbp = EXCLUDED.revenue_gbp,
          orders = EXCLUDED.orders,
          updated_at = EXCLUDED.updated_at
      `,
      [v.source, v.hourTs, v.campaignId, v.adgroupId, revenueGbp, orders, now]
    );
    upserts++;
  }

  return {
    ok: true,
    rangeStartTs,
    rangeEndTs,
    source: sourceRaw,
    scannedGroups: grouped.size,
    upserts,
  };
}

module.exports = {
  rollupRevenueHourly,
};
