/**
 * Daily notifications job: daily report (yesterday's KPIs summary).
 * Run once per day (e.g. after startup and every 24h).
 */
const store = require('./store');
const notificationsService = require('./notificationsService');

function formatGbp(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n * 100) / 100;
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n * 10) / 10 + '%';
}

async function runOnce() {
  try {
    const prefs = await notificationsService.getPreferences();
    if (!prefs.daily_report) return;

    const kpis = await store.getKpis({ trafficMode: 'human_only', rangeKey: 'yesterday' });
    if (!kpis) return;

    const sales = kpis.sales && kpis.sales.yesterday != null ? kpis.sales.yesterday : null;
    const orders = kpis.convertedCount && kpis.convertedCount.yesterday != null ? kpis.convertedCount.yesterday : null;
    const breakdown = kpis.trafficBreakdown && kpis.trafficBreakdown.yesterday ? kpis.trafficBreakdown.yesterday : null;
    const sessions = breakdown && typeof breakdown.human_sessions === 'number' ? breakdown.human_sessions : null;
    const conv = kpis.conversion && kpis.conversion.yesterday != null ? kpis.conversion.yesterday : null;
    const aov = kpis.aov && kpis.aov.yesterday != null ? kpis.aov.yesterday : null;
    const vpv = kpis.vpv && kpis.vpv.yesterday != null ? kpis.vpv.yesterday : null;
    const roas = kpis.roas && kpis.roas.yesterday != null ? kpis.roas.yesterday : null;

    const parts = [];
    parts.push('Revenue: £' + formatGbp(sales));
    parts.push('Orders: ' + (orders != null ? orders : '—'));
    parts.push('Sessions: ' + (sessions != null ? sessions : '—'));
    parts.push('Conversion: ' + formatPct(conv));
    if (aov != null) parts.push('AOV: £' + formatGbp(aov));
    if (vpv != null) parts.push('VPV: £' + formatGbp(vpv));
    if (roas != null) parts.push('ROAS: ' + roas);

    const body = parts.join(' · ');
    const title = 'Daily report (yesterday)';
    await notificationsService.create({
      type: 'daily_report',
      title,
      body,
      link: '/dashboard/overview',
      forAdminOnly: false,
    });
  } catch (err) {
    console.warn('[notifications-daily] runOnce failed:', err && err.message ? err.message : err);
    throw err;
  }
}

module.exports = { runOnce };
