/**
 * Idempotent provisioning of UPLOAD_CLICKS conversion goals (Revenue, Profit).
 * Persists conversion action IDs/resource names to google_ads_conversion_goals.
 */
const { getAdsDb } = require('./adsDb');
const googleAdsClient = require('./googleAdsClient');

const GOAL_TYPES = ['revenue', 'profit'];
const GOAL_DISPLAY_NAMES = { revenue: 'Revenue', profit: 'Profit' };

/**
 * List existing UPLOAD_CLICKS conversion actions for the customer.
 * @param {string} [shop]
 * @returns {Promise<{ ok: boolean, actions?: Array<{ id, resourceName, name }>, error?: string }>}
 */
async function listUploadClickConversionActions(shop) {
  const query =
    "SELECT conversion_action.id, conversion_action.resource_name, conversion_action.name " +
    "FROM conversion_action WHERE conversion_action.type = 'UPLOAD_CLICKS'";
  const out = await googleAdsClient.search(shop, query);
  if (!out || !out.ok) {
    return { ok: false, error: (out && out.error) || 'list conversion actions failed' };
  }
  const actions = (out.results || []).map((r) => {
    const ca = r && r.conversionAction ? r.conversionAction : {};
    return {
      id: ca.id != null ? Number(ca.id) : null,
      resourceName: ca.resourceName != null ? String(ca.resourceName) : '',
      name: (ca.name != null ? String(ca.name) : '').trim(),
    };
  });
  return { ok: true, actions };
}

/**
 * Ensure a conversion action exists; create if missing. Returns resource name.
 * @param {string} [shop]
 * @param {string} goalType - 'revenue' | 'profit'
 * @returns {Promise<{ ok: boolean, resourceName?: string, id?: number, error?: string }>}
 */
async function ensureConversionAction(shop, goalType) {
  const name = GOAL_DISPLAY_NAMES[goalType] || goalType;
  const list = await listUploadClickConversionActions(shop);
  if (!list.ok) return { ok: false, error: list.error };
  const existing = (list.actions || []).find(
    (a) => a.name && a.name.toLowerCase() === name.toLowerCase()
  );
  if (existing && existing.resourceName) {
    return { ok: true, resourceName: existing.resourceName, id: existing.id };
  }
  const operations = [
    {
      create: {
        name,
        type: 'UPLOAD_CLICKS',
        category: 'PURCHASE',
        status: 'ENABLED',
      },
    },
  ];
  const mutate = await googleAdsClient.mutateConversionActions(shop, operations);
  if (!mutate.ok) return { ok: false, error: mutate.error };
  const result = (mutate.results && mutate.results[0]) || null;
  const resourceName = result && result.resourceName ? String(result.resourceName) : null;
  const id = result && result.resourceName
    ? (result.resourceName.match(/\/(\d+)$/) && Number(RegExp.$1)) || null
    : null;
  return { ok: true, resourceName: resourceName || '', id };
}

/**
 * Upsert google_ads_conversion_goals for a shop (revenue, profit).
 * @param {string} shop
 * @param {object} row - { goal_type, conversion_action_id, conversion_action_resource_name, custom_goal_id?, custom_goal_resource_name? }
 */
async function upsertConversionGoal(shop, row) {
  const db = getAdsDb();
  if (!db) return;
  const now = Date.now();
  const goalType = String(row.goal_type || '').toLowerCase();
  if (!goalType) return;
  const resourceName = String(row.conversion_action_resource_name || '');
  const actionId = row.conversion_action_id != null ? Number(row.conversion_action_id) : null;
  const customId = row.custom_goal_id != null ? Number(row.custom_goal_id) : null;
  const customResource = row.custom_goal_resource_name != null ? String(row.custom_goal_resource_name) : null;
  await db.run(
    `INSERT INTO google_ads_conversion_goals (shop, goal_type, conversion_action_id, conversion_action_resource_name, custom_goal_id, custom_goal_resource_name, last_provisioned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (shop, goal_type) DO UPDATE SET
       conversion_action_id = EXCLUDED.conversion_action_id,
       conversion_action_resource_name = EXCLUDED.conversion_action_resource_name,
       custom_goal_id = EXCLUDED.custom_goal_id,
       custom_goal_resource_name = EXCLUDED.custom_goal_resource_name,
       last_provisioned_at = EXCLUDED.last_provisioned_at`,
    [shop, goalType, actionId, resourceName, customId, customResource, now]
  );
}

/**
 * Provision Revenue and Profit conversion actions and persist to google_ads_conversion_goals.
 * @param {string} shop
 * @returns {Promise<{ ok: boolean, goals?: object, error?: string }>}
 */
async function provisionGoals(shop) {
  if (!shop || typeof shop !== 'string' || !shop.trim()) {
    return { ok: false, error: 'shop required' };
  }
  const normShop = String(shop).trim().toLowerCase();
  const goals = {};
  for (const goalType of GOAL_TYPES) {
    const out = await ensureConversionAction(normShop, goalType);
    if (!out.ok) {
      return { ok: false, error: `provision ${goalType}: ${out.error || 'failed'}` };
    }
    goals[goalType] = {
      conversion_action_id: out.id,
      conversion_action_resource_name: out.resourceName || '',
    };
    await upsertConversionGoal(normShop, {
      goal_type: goalType,
      conversion_action_id: out.id,
      conversion_action_resource_name: out.resourceName || '',
    });
  }
  return { ok: true, goals };
}

/**
 * Get persisted conversion goals for a shop.
 * @param {string} shop
 * @returns {Promise<Array<{ goal_type, conversion_action_id, conversion_action_resource_name, last_provisioned_at }>>}
 */
async function getConversionGoals(shop) {
  const db = getAdsDb();
  if (!db) return [];
  const normShop = String(shop || '').trim().toLowerCase();
  if (!normShop) return [];
  const rows = await db.all(
    `SELECT goal_type, conversion_action_id, conversion_action_resource_name, custom_goal_id, custom_goal_resource_name, last_provisioned_at
     FROM google_ads_conversion_goals WHERE shop = ?`,
    [normShop]
  );
  return (rows || []).map((r) => ({
    goal_type: r.goal_type,
    conversion_action_id: r.conversion_action_id,
    conversion_action_resource_name: r.conversion_action_resource_name,
    custom_goal_id: r.custom_goal_id,
    custom_goal_resource_name: r.custom_goal_resource_name,
    last_provisioned_at: r.last_provisioned_at,
  }));
}

module.exports = {
  listUploadClickConversionActions,
  ensureConversionAction,
  provisionGoals,
  getConversionGoals,
  GOAL_TYPES,
  GOAL_DISPLAY_NAMES,
};
