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
const { runAdsMigrations } = require('./ads/adsMigrate');

async function main() {
  const db = getDb();
  const preBackup = await backup.backupBeforeTruthSchemaCreate();
  await up001();
  await up002();
  await up003();
  await up004();
  await up005();
  await up006();
  await up007();
  await up008();
  await up009();
  await up010();
  await up011();
  await up012();
  await up013();
  await up014();
  await up015();
  await up016();
  await up017();
  await up018();
  await up019();
  await up020();
  await up021();
  await up022();
  await up023();
  await up024();
  await up025();
  await up026();
  await up027();
  await up028();
  await up029();
  await up030();
  await up031();
  await up032();
  await up033();
  await up034();
  await up035();
  await up036();
  await up037();
  await up038();
  await up039();
  await up040();
  await up041();
  await up042();
  await up043();
  await up044();
  await up045();

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
