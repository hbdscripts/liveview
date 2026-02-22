const Sentry = require('@sentry/node');
const express = require('express');
const store = require('../store');
const salesTruth = require('../salesTruth');
const compareCr = require('../tools/compareCr');
const shippingCr = require('../tools/shippingCr');
const clickOrderLookup = require('../tools/clickOrderLookup');
const changePins = require('../tools/changePins');
const timeOfDay = require('../tools/timeOfDay');
const { warnOnReject } = require('../shared/warnReject');

const router = express.Router();

// In-memory backfill jobs (best-effort). Intended for one-off historical catch-up.
const shippingCrBackfillJobs = new Map(); // jobId -> job
const MAX_ACTIVE_BACKFILL_JOBS = 2;
const BACKFILL_JOB_TTL_MS = 60 * 60 * 1000; // 1 hour; prune finished jobs older than this

function pruneShippingCrBackfillJobs() {
  const now = Date.now();
  for (const [id, job] of shippingCrBackfillJobs.entries()) {
    if (job.done && job.finished_at != null && (now - job.finished_at) > BACKFILL_JOB_TTL_MS) {
      shippingCrBackfillJobs.delete(id);
    }
  }
}

function safeYmd(v) {
  const s = v != null ? String(v).trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function ymdAddDays(ymd, deltaDays) {
  const s = safeYmd(ymd);
  if (!s) return '';
  const d = new Date(s + 'T00:00:00.000Z');
  if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + (Number(deltaDays) || 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function randomId() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

async function runShippingCrBackfillJob(job) {
  if (!job || job.running) return;
  job.running = true;
  job.started_at = Date.now();
  job.error = null;
  job.done = false;

  const tz = store.resolveAdminTimeZone();

  try {
    let curStart = job.start_ymd;
    let chunkIndex = 0;
    while (curStart && curStart <= job.end_ymd) {
      const chunkEnd = (() => {
        const candidate = ymdAddDays(curStart, job.step_days - 1);
        if (!candidate) return job.end_ymd;
        return candidate <= job.end_ymd ? candidate : job.end_ymd;
      })();

      const rangeKey = `r:${curStart}:${chunkEnd}`;
      const bounds = store.getRangeBounds(rangeKey, Date.now(), tz);
      const startMs = bounds && Number.isFinite(bounds.start) ? Number(bounds.start) : null;
      const endMs = bounds && Number.isFinite(bounds.end) ? Number(bounds.end) : null;
      if (!(startMs != null && endMs != null && endMs > startMs)) break;

      job.current = { chunkIndex, start_ymd: curStart, end_ymd: chunkEnd, startMs, endMs };
      job.progress_done = chunkIndex;

      const scope = (`tools_shipping_cr_backfill_${job.job_id}_` + String(chunkIndex)).slice(0, 64);
      try {
        const r = await salesTruth.reconcileRange(job.shop, startMs, endMs, scope);
        job.last_result = r || null;
      } catch (e) {
        job.last_result = null;
        throw e;
      }

      chunkIndex += 1;
      curStart = ymdAddDays(chunkEnd, 1);
    }

    job.progress_done = job.progress_total;
    job.done = true;
  } catch (err) {
    job.error = err && err.message ? String(err.message).slice(0, 300) : 'backfill_failed';
  } finally {
    job.running = false;
    job.finished_at = Date.now();
    job.current = null;
  }
}

function safeShopParam(req) {
  const raw = req && req.query && req.query.shop != null ? String(req.query.shop).trim().toLowerCase() : '';
  const resolved = salesTruth.resolveShopForSales(raw);
  return resolved || raw;
}

router.get('/catalog-search', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const q = req && req.query && req.query.q != null ? String(req.query.q) : '';
    const out = await compareCr.catalogSearch({ shop, q, limit: req.query.limit });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.catalog-search' } });
    console.error('[tools.catalog-search]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/click-order-lookup', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const q = req && req.query && req.query.q != null ? String(req.query.q) : '';
    const out = await clickOrderLookup.lookup({ shop, q });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.click-order-lookup' } });
    console.error('[tools.click-order-lookup]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/change-pins', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const out = await changePins.listPins({
      from_ymd: req?.query?.from_ymd,
      to_ymd: req?.query?.to_ymd,
      q: req?.query?.q,
      kind: req?.query?.kind,
      include_archived: req?.query?.include_archived,
      limit: req?.query?.limit,
      offset: req?.query?.offset,
    });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.list' } });
    console.error('[tools.change-pins.list]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/change-pins/recent', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const days = req?.query?.days;
    const out = await changePins.listRecentPins({ days });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.recent' } });
    console.error('[tools.change-pins.recent]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/change-pins/:id/effect', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const id = req?.params?.id;
    const windowDays = req?.query?.window_days;
    const preset = req?.query?.preset;
    const out = await changePins.getPinEffect(id, { preset, window_days: windowDays });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.effect' } });
    console.error('[tools.change-pins.effect]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/change-pins', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const out = await changePins.createPin(req?.body || {}, {});
    if (!out || !out.ok) return res.status(400).json(out || { ok: false, error: 'invalid_request' });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.create' } });
    console.error('[tools.change-pins.create]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.patch('/change-pins/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const id = req?.params?.id;
    const out = await changePins.patchPin(id, req?.body || {}, {});
    if (!out || !out.ok) return res.status(out && out.error === 'not_found' ? 404 : 400).json(out || { ok: false, error: 'invalid_request' });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.patch' } });
    console.error('[tools.change-pins.patch]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/change-pins/:id/archive', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const id = req?.params?.id;
    const out = await changePins.setArchived(id, true, {});
    if (!out || !out.ok) return res.status(out && out.error === 'not_found' ? 404 : 400).json(out || { ok: false, error: 'invalid_request' });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.archive' } });
    console.error('[tools.change-pins.archive]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/change-pins/:id/unarchive', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const id = req?.params?.id;
    const out = await changePins.setArchived(id, false, {});
    if (!out || !out.ok) return res.status(out && out.error === 'not_found' ? 404 : 400).json(out || { ok: false, error: 'invalid_request' });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.change-pins.unarchive' } });
    console.error('[tools.change-pins.unarchive]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/compare-cr/variants', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const productId = req && req.query && req.query.product_id != null ? String(req.query.product_id) : '';
    const out = await compareCr.getProductVariants({ shop, productId });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.compare-cr.variants' } });
    console.error('[tools.compare-cr.variants]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/compare-cr/mapped-groups', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const productId = req && req.query && req.query.product_id != null ? String(req.query.product_id) : '';
    const tableId = req && req.query && req.query.table_id != null ? String(req.query.table_id) : '';
    const out = await compareCr.getProductMappedVariantGroups({ shop, productId, tableId });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.compare-cr.mapped-groups' } });
    console.error('[tools.compare-cr.mapped-groups]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/compare-cr/compare', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = (req && req.body && req.body.shop != null) ? String(req.body.shop).trim().toLowerCase() : safeShopParam(req);
    const eventDate = req && req.body && req.body.event_date != null ? String(req.body.event_date) : '';
    const target = req && req.body && req.body.target ? req.body.target : null;
    const mode = req && req.body && req.body.mode != null ? String(req.body.mode) : '';
    const variantIds = req && req.body && Array.isArray(req.body.variant_ids) ? req.body.variant_ids : null;
    const variantMapping = req && req.body && req.body.variant_mapping && typeof req.body.variant_mapping === 'object'
      ? req.body.variant_mapping
      : null;

    const out = await compareCr.compareConversionRate({
      shop,
      eventDateYmd: eventDate,
      target,
      mode,
      variantIds,
      variantMapping,
    });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.compare-cr.compare' } });
    console.error('[tools.compare-cr.compare]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/time-of-day', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = (req && req.body && req.body.shop != null) ? String(req.body.shop).trim().toLowerCase() : safeShopParam(req);
    const countryCode = (req && req.body && req.body.country_code != null) ? String(req.body.country_code).trim() : '';
    const startYmd = (req && req.body && req.body.start_ymd != null) ? String(req.body.start_ymd).trim() : '';
    const endYmd = (req && req.body && req.body.end_ymd != null) ? String(req.body.end_ymd).trim() : '';

    const out = await timeOfDay.getTimeOfDay({
      shop,
      countryCode: countryCode || undefined,
      startYmd,
      endYmd,
    });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.time-of-day' } });
    console.error('[tools.time-of-day]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/shipping-cr/labels', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = (req && req.body && req.body.shop != null) ? String(req.body.shop).trim().toLowerCase() : safeShopParam(req);
    const countryCode = (req && req.body && req.body.country_code != null) ? String(req.body.country_code) : '';
    const startYmd = (req && req.body && req.body.start_ymd != null) ? String(req.body.start_ymd) : '';
    const endYmd = (req && req.body && req.body.end_ymd != null) ? String(req.body.end_ymd) : '';

    const out = await shippingCr.getShippingOptionsByCountry({
      shop,
      countryCode,
      startYmd,
      endYmd,
    });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.shipping-cr.labels' } });
    console.error('[tools.shipping-cr.labels]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/shipping-cr/backfill/start', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = (req && req.body && req.body.shop != null) ? String(req.body.shop).trim().toLowerCase() : safeShopParam(req);
    const safeShop = salesTruth.resolveShopForSales(shop || '');
    if (!safeShop) return res.status(400).json({ ok: false, error: 'missing_shop' });

    const startYmd = safeYmd(req && req.body && req.body.start_ymd != null ? req.body.start_ymd : '');
    const endYmd = safeYmd(req && req.body && req.body.end_ymd != null ? req.body.end_ymd : '');
    if (!startYmd || !endYmd) return res.status(400).json({ ok: false, error: 'invalid_dates' });

    const stepDays = clampInt(req && req.body && req.body.step_days != null ? req.body.step_days : 7, 7, 1, 31);

    pruneShippingCrBackfillJobs();
    const runningCount = Array.from(shippingCrBackfillJobs.values()).filter((j) => j.running).length;
    if (runningCount >= MAX_ACTIVE_BACKFILL_JOBS) {
      return res.status(429).json({ ok: false, error: 'too_many_jobs', message: 'Max concurrent backfill jobs reached.' });
    }
    const normStart = startYmd <= endYmd ? startYmd : endYmd;
    const normEnd = startYmd <= endYmd ? endYmd : startYmd;
    for (const j of shippingCrBackfillJobs.values()) {
      if (j.shop !== safeShop || j.start_ymd !== normStart || j.end_ymd !== normEnd) continue;
      if (j.running) {
        return res.status(409).json({ ok: false, error: 'duplicate_range', message: 'A backfill for this range is already running.' });
      }
      if (j.done && j.finished_at != null && (Date.now() - j.finished_at) < 60000) {
        return res.status(409).json({ ok: false, error: 'duplicate_range', message: 'Same range was just finished; wait before retrying.' });
      }
    }

    const jobId = 'shipcr_' + Date.now().toString(36) + '_' + randomId().slice(0, 8);
    const totalDays = (() => {
      try {
        const a = new Date(startYmd + 'T00:00:00.000Z').getTime();
        const b = new Date(endYmd + 'T00:00:00.000Z').getTime();
        if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
        return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
      } catch (_) {
        return 0;
      }
    })();
    const totalChunks = totalDays > 0 ? Math.ceil(totalDays / stepDays) : 0;

    const job = {
      job_id: jobId,
      shop: safeShop,
      start_ymd: normStart,
      end_ymd: normEnd,
      step_days: stepDays,
      progress_total: totalChunks,
      progress_done: 0,
      running: false,
      done: false,
      error: null,
      started_at: null,
      finished_at: null,
      current: null,
      last_result: null,
      created_at: Date.now(),
    };
    shippingCrBackfillJobs.set(jobId, job);

    setImmediate(() => {
      runShippingCrBackfillJob(job).catch(warnOnReject('[tools] runShippingCrBackfillJob'));
    });

    res.json({
      ok: true,
      job_id: jobId,
      shop: safeShop,
      start_ymd: job.start_ymd,
      end_ymd: job.end_ymd,
      step_days: stepDays,
      chunks_total: totalChunks,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.shipping-cr.backfill.start' } });
    console.error('[tools.shipping-cr.backfill.start]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/shipping-cr/backfill/metrics', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const activeCount = Array.from(shippingCrBackfillJobs.values()).filter((j) => j.running).length;
    res.json({ ok: true, activeCount, totalJobs: shippingCrBackfillJobs.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/shipping-cr/backfill/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const jobId = req && req.query && req.query.job_id != null ? String(req.query.job_id) : '';
    const job = jobId ? shippingCrBackfillJobs.get(jobId) : null;
    if (!job) return res.status(404).json({ ok: false, error: 'job_not_found' });
    res.json({
      ok: true,
      job: {
        job_id: job.job_id,
        shop: job.shop,
        start_ymd: job.start_ymd,
        end_ymd: job.end_ymd,
        step_days: job.step_days,
        progress_total: job.progress_total,
        progress_done: job.progress_done,
        running: !!job.running,
        done: !!job.done,
        error: job.error || null,
        started_at: job.started_at,
        finished_at: job.finished_at,
        current: job.current,
        last_result: job.last_result,
      },
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.shipping-cr.backfill.status' } });
    console.error('[tools.shipping-cr.backfill.status]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
