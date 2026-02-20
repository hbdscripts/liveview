/**
 * Run migrations. Usage: node server/migrate.js
 */
require('dotenv').config();
const { getDb } = require('./db');
const backup = require('./backup');
const { writeAudit } = require('./audit');
const { up: up001 } = require('./migrations/001_initial');
const { up: up002 } = require('./migrations/002_shop_sessions');
const { up: up003 } = require('./migrations/003_cart_order_money');
const { up: up004 } = require('./migrations/004_session_stats_fields');
const { up: up005 } = require('./migrations/005_utm_campaign');
const { up: up006 } = require('./migrations/006_utm_source_medium_content');
const { up: up007 } = require('./migrations/007_first_path');
const { up: up008 } = require('./migrations/008_purchases');
const { up: up009 } = require('./migrations/009_cf_traffic');
const { up: up010 } = require('./migrations/010_referrer');
const { up: up011 } = require('./migrations/011_entry_url');
const { up: up012 } = require('./migrations/012_bot_block_counts');
const { up: up013 } = require('./migrations/013_session_is_returning');
const { up: up014 } = require('./migrations/014_dedupe_legacy_purchases');
const { up: up015 } = require('./migrations/015_backfill_session_is_returning');
const { up: up016 } = require('./migrations/016_dedupe_h_purchases');
const { up: up017 } = require('./migrations/017_sales_truth_and_evidence');
const { up: up018 } = require('./migrations/018_orders_shopify_returning_fields');
const { up: up019 } = require('./migrations/019_customer_order_facts');
const { up: up020 } = require('./migrations/020_bot_block_counts_updated_at');
const { up: up021 } = require('./migrations/021_sessions_traffic_fields');
const { up: up022 } = require('./migrations/022_report_indexes');
const { up: up023 } = require('./migrations/023_reconcile_snapshots');
const { up: up024 } = require('./migrations/024_shopify_sessions_snapshots');
const { up: up025 } = require('./migrations/025_orders_shopify_line_items');
const { up: up026 } = require('./migrations/026_report_cache');
const { up: up027 } = require('./migrations/027_traffic_source_maps');
const { up: up028 } = require('./migrations/028_backfill_purchases_from_evidence');
const { up: up029 } = require('./migrations/029_dedupe_traffic_source_meta_labels');
const { up: up030 } = require('./migrations/030_canonicalize_built_in_traffic_sources');
const { up: up031 } = require('./migrations/031_orders_shopify_line_items_variant_title_index');
const { up: up032 } = require('./migrations/032_sessions_bs_ads_fields');
const { up: up033 } = require('./migrations/033_sessions_landing_composite_index');
const { up: up034 } = require('./migrations/034_perf_indexes_more');
const { up: up035 } = require('./migrations/035_growth_retention_indexes');
const { up: up036 } = require('./migrations/036_tools_compare_cr_indexes');
const { up: up037 } = require('./migrations/037_perf_composite_indexes_wal');
const { up: up038 } = require('./migrations/038_perf_indexes_events_traffic');
const { up: up039 } = require('./migrations/039_active_sessions_last_seen_started_at_index');
const { up: up040 } = require('./migrations/040_orders_shopify_processed_at_paid_index');
const { up: up041 } = require('./migrations/041_orders_shopify_shipping_options');
const { up: up042 } = require('./migrations/042_orders_shopify_shipping_options_set_and_paid_price');
const { up: up043 } = require('./migrations/043_business_snapshot_perf_indexes');
const { up: up044 } = require('./migrations/044_backfill_first_product_handle');
const { up: up045 } = require('./migrations/045_users');
const { up: up046 } = require('./migrations/046_rename_master_to_admin');
const { up: up047 } = require('./migrations/047_affiliate_attribution_and_fraud');
const { up: up048 } = require('./migrations/048_sessions_bs_network');
const { up: up049 } = require('./migrations/049_sessions_utm_term');
const { up: up050 } = require('./migrations/050_acquisition_attribution');
const { up: up051 } = require('./migrations/051_admin_notes');
const { up: up052 } = require('./migrations/052_change_pins');
const { up: up053 } = require('./migrations/053_sessions_click_ids');
const { up: up054 } = require('./migrations/054_sessions_city_browser');
const { up: up055 } = require('./migrations/055_purchases_payment_method');
const { up: up056 } = require('./migrations/056_edge_block_events');
const { up: up057 } = require('./migrations/057_purchases_payment_method_key');
const { up: up058 } = require('./migrations/058_attribution_tags');
const { runAdsMigrations } = require('./ads/adsMigrate');

const APP_MIGRATIONS = [
  ['001_initial', up001],
  ['002_shop_sessions', up002],
  ['003_cart_order_money', up003],
  ['004_session_stats_fields', up004],
  ['005_utm_campaign', up005],
  ['006_utm_source_medium_content', up006],
  ['007_first_path', up007],
  ['008_purchases', up008],
  ['009_cf_traffic', up009],
  ['010_referrer', up010],
  ['011_entry_url', up011],
  ['012_bot_block_counts', up012],
  ['013_session_is_returning', up013],
  ['014_dedupe_legacy_purchases', up014],
  ['015_backfill_session_is_returning', up015],
  ['016_dedupe_h_purchases', up016],
  ['017_sales_truth_and_evidence', up017],
  ['018_orders_shopify_returning_fields', up018],
  ['019_customer_order_facts', up019],
  ['020_bot_block_counts_updated_at', up020],
  ['021_sessions_traffic_fields', up021],
  ['022_report_indexes', up022],
  ['023_reconcile_snapshots', up023],
  ['024_shopify_sessions_snapshots', up024],
  ['025_orders_shopify_line_items', up025],
  ['026_report_cache', up026],
  ['027_traffic_source_maps', up027],
  ['028_backfill_purchases_from_evidence', up028],
  ['029_dedupe_traffic_source_meta_labels', up029],
  ['030_canonicalize_built_in_traffic_sources', up030],
  ['031_orders_shopify_line_items_variant_title_index', up031],
  ['032_sessions_bs_ads_fields', up032],
  ['033_sessions_landing_composite_index', up033],
  ['034_perf_indexes_more', up034],
  ['035_growth_retention_indexes', up035],
  ['036_tools_compare_cr_indexes', up036],
  ['037_perf_composite_indexes_wal', up037],
  ['038_perf_indexes_events_traffic', up038],
  ['039_active_sessions_last_seen_started_at_index', up039],
  ['040_orders_shopify_processed_at_paid_index', up040],
  ['041_orders_shopify_shipping_options', up041],
  ['042_orders_shopify_shipping_options_set_and_paid_price', up042],
  ['043_business_snapshot_perf_indexes', up043],
  ['044_backfill_first_product_handle', up044],
  ['045_users', up045],
  ['046_rename_master_to_admin', up046],
  ['047_affiliate_attribution_and_fraud', up047],
  ['048_sessions_bs_network', up048],
  ['049_sessions_utm_term', up049],
  ['050_acquisition_attribution', up050],
  ['051_admin_notes', up051],
  ['052_change_pins', up052],
  ['053_sessions_click_ids', up053],
  ['054_sessions_city_browser', up054],
  ['055_purchases_payment_method', up055],
  ['056_edge_block_events', up056],
  ['057_purchases_payment_method_key', up057],
  ['058_attribution_tags', up058],
];

async function ensureAppMigrationsTable(db) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )`
  );
}

async function isAppMigrationApplied(db, id) {
  const row = await db.get('SELECT id FROM app_migrations WHERE id = ?', [id]);
  return !!row;
}

async function markAppMigrationApplied(db, id) {
  const now = Date.now();
  await db.run(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING',
    [id, now]
  );
}

async function runAppMigrations(db) {
  await ensureAppMigrationsTable(db);
  for (const [id, up] of APP_MIGRATIONS) {
    const applied = await isAppMigrationApplied(db, id);
    if (applied) continue;
    await up();
    await markAppMigrationApplied(db, id);
  }
}

async function main() {
  const db = getDb();
  const preBackup = await backup.backupBeforeTruthSchemaCreate();
  await runAppMigrations(db);

  try {
    const r = await runAdsMigrations();
    if (r && r.skipped) console.log('[ads.migrate] skipped:', r.reason);
    else console.log('[ads.migrate] applied:', r && r.applied != null ? r.applied : 0);
  } catch (e) {
    console.error('[ads.migrate] failed (continuing):', e);
  }
  if (preBackup) {
    await writeAudit('system', 'backup', { when: 'manual_migrate_pre_truth_schema', ...preBackup });
  }
  console.log('Migrations complete.');
  db.close?.();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
