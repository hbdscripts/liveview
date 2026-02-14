const Sentry = require('@sentry/node');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const {
  VARIANTS_CONFIG_KEY,
  normalizeVariantsConfigV1,
  configHash,
} = require('../variantInsightsConfig');
const {
  RANGE_KEYS,
  buildVariantsInsightTables,
} = require('../variantInsightsService');

async function getInsightsVariants(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'insights-variants.get', data: { shop: req?.query?.shop, range: req?.query?.range } });
  const rawShop = (req.query.shop || '').trim().toLowerCase();
  const shop = salesTruth.resolveShopForSales(rawShop) || salesTruth.resolveShopForSales('') || rawShop;
  let range = (req.query.range || 'today').trim().toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }
  // UI uses 7days/14days/30days; normalize to server keys.
  if (range === '7days') range = '7d';
  if (range === '14days') range = '14d';
  if (range === '30days') range = '30d';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = 'today';
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  try {
    const rawConfig = await store.getSetting(VARIANTS_CONFIG_KEY).catch(() => null);
    const variantsConfig = normalizeVariantsConfigV1(rawConfig);
    const cfgHash = configHash(variantsConfig);
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'insights-variants',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { cfgHash },
        ttlMs: 5 * 60 * 1000,
        force,
      },
      async () => {
        try {
          await salesTruth.ensureReconciled(shop, start, end, `insights_variants_${range}`);
        } catch (_) {}

        const payload = await buildVariantsInsightTables({
          shop,
          start,
          end,
          variantsConfig,
        });
        return {
          ok: true,
          range,
          configVersion: variantsConfig && variantsConfig.v ? variantsConfig.v : 1,
          tables: payload && Array.isArray(payload.tables) ? payload.tables : [],
          diagnostics: payload && Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
          attribution: payload && payload.attribution ? payload.attribution : null,
        };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { ok: true, range, tables: [], diagnostics: [], attribution: null });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'insights-variants', shop, range } });
    console.error('[insights-variants]', err);
    return res.status(500).json({ error: 'Failed to fetch variants insights' });
  }
}

module.exports = { getInsightsVariants };
