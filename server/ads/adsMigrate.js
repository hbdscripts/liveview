const { getAdsDb } = require('./adsDb');

async function ensureMigrationsTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ads_migrations (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `);
}

async function isApplied(db, id) {
  const row = await db.get('SELECT 1 AS ok FROM ads_migrations WHERE id = ? LIMIT 1', [id]);
  return !!row;
}

async function markApplied(db, id) {
  await db.run('INSERT INTO ads_migrations (id, applied_at) VALUES (?, ?)', [id, Date.now()]);
}

async function runAdsMigrations() {
  const db = getAdsDb();
  if (!db) return { ok: true, skipped: true, reason: 'ADS_DB_URL not set' };

  await ensureMigrationsTable(db);

  const migrations = [
    {
      id: '001_ads_core_tables',
      up: async () => {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS google_ads_spend_hourly (
            provider TEXT NOT NULL,
            hour_ts TIMESTAMPTZ NOT NULL,
            customer_id TEXT,
            campaign_id TEXT NOT NULL,
            adgroup_id TEXT NOT NULL,
            cost_micros BIGINT NOT NULL DEFAULT 0,
            spend_gbp DOUBLE PRECISION NOT NULL DEFAULT 0,
            clicks INTEGER NOT NULL DEFAULT 0,
            impressions INTEGER NOT NULL DEFAULT 0,
            updated_at BIGINT,
            PRIMARY KEY (provider, hour_ts, campaign_id, adgroup_id)
          )
        `);

        await db.exec(`
          CREATE TABLE IF NOT EXISTS bs_revenue_hourly (
            source TEXT NOT NULL,
            hour_ts TIMESTAMPTZ NOT NULL,
            campaign_id TEXT NOT NULL,
            adgroup_id TEXT NOT NULL,
            revenue_gbp DOUBLE PRECISION NOT NULL DEFAULT 0,
            orders INTEGER NOT NULL DEFAULT 0,
            updated_at BIGINT,
            PRIMARY KEY (source, hour_ts, campaign_id, adgroup_id)
          )
        `);

        await db.exec(`
          CREATE TABLE IF NOT EXISTS ads_refresh_state (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at BIGINT
          )
        `);

        await db.exec('CREATE INDEX IF NOT EXISTS idx_gash_hour_ts ON google_ads_spend_hourly(hour_ts)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gash_campaign ON google_ads_spend_hourly(campaign_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gash_adgroup ON google_ads_spend_hourly(adgroup_id)');

        await db.exec('CREATE INDEX IF NOT EXISTS idx_bsrh_hour_ts ON bs_revenue_hourly(hour_ts)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_bsrh_campaign ON bs_revenue_hourly(campaign_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_bsrh_adgroup ON bs_revenue_hourly(adgroup_id)');
      },
    },
    {
      id: '002_ads_name_columns',
      up: async () => {
        await db.exec(`ALTER TABLE google_ads_spend_hourly ADD COLUMN IF NOT EXISTS campaign_name TEXT`);
        await db.exec(`ALTER TABLE google_ads_spend_hourly ADD COLUMN IF NOT EXISTS adgroup_name TEXT`);
      },
    },
    {
      id: '003_ads_conversions_columns',
      up: async () => {
        await db.exec(`ALTER TABLE google_ads_spend_hourly ADD COLUMN IF NOT EXISTS conversions DOUBLE PRECISION NOT NULL DEFAULT 0`);
        await db.exec(`ALTER TABLE google_ads_spend_hourly ADD COLUMN IF NOT EXISTS conversions_value_gbp DOUBLE PRECISION NOT NULL DEFAULT 0`);
      },
    },
    {
      id: '004_gclid_campaign_cache',
      up: async () => {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS gclid_campaign_cache (
            gclid TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            adgroup_id TEXT,
            cached_at BIGINT NOT NULL
          )
        `);
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gcc_campaign ON gclid_campaign_cache(campaign_id)');
      },
    },
    {
      id: '005_ads_orders_attributed',
      up: async () => {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS ads_orders_attributed (
            shop TEXT NOT NULL,
            order_id TEXT NOT NULL,
            created_at_ms BIGINT NOT NULL,
            currency TEXT,
            total_price DOUBLE PRECISION,
            revenue_gbp DOUBLE PRECISION NOT NULL DEFAULT 0,
            source TEXT,
            campaign_id TEXT,
            adgroup_id TEXT,
            ad_id TEXT,
            gclid TEXT,
            country_code TEXT,
            attribution_method TEXT,
            landing_site TEXT,
            updated_at BIGINT,
            PRIMARY KEY (shop, order_id)
          )
        `);

        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_source_created_at_ms ON ads_orders_attributed(source, created_at_ms)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_source_campaign ON ads_orders_attributed(source, campaign_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_source_campaign_created ON ads_orders_attributed(source, campaign_id, created_at_ms)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_gclid ON ads_orders_attributed(gclid)');
      },
    },
    {
      id: '006_google_ads_geo_daily',
      up: async () => {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS google_ads_geo_daily (
            provider TEXT NOT NULL,
            day_ymd TEXT NOT NULL,
            customer_id TEXT,
            campaign_id TEXT NOT NULL,
            campaign_name TEXT,
            country_criterion_id BIGINT NOT NULL,
            country_code TEXT,
            location_type TEXT NOT NULL,
            cost_micros BIGINT NOT NULL DEFAULT 0,
            spend_gbp DOUBLE PRECISION NOT NULL DEFAULT 0,
            clicks INTEGER NOT NULL DEFAULT 0,
            impressions INTEGER NOT NULL DEFAULT 0,
            updated_at BIGINT,
            PRIMARY KEY (provider, day_ymd, campaign_id, country_criterion_id, location_type)
          )
        `);

        await db.exec('CREATE INDEX IF NOT EXISTS idx_gagd_day ON google_ads_geo_daily(day_ymd)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gagd_campaign ON google_ads_geo_daily(campaign_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gagd_country ON google_ads_geo_daily(country_code)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gagd_campaign_day ON google_ads_geo_daily(campaign_id, day_ymd)');
      },
    },
    {
      id: '007_ads_orders_attributed_session_country',
      up: async () => {
        await db.exec(`ALTER TABLE ads_orders_attributed ADD COLUMN IF NOT EXISTS session_id TEXT`);
        await db.exec(`ALTER TABLE ads_orders_attributed ADD COLUMN IF NOT EXISTS visitor_country_code TEXT`);

        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_session_id ON ads_orders_attributed(session_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_visitor_country ON ads_orders_attributed(visitor_country_code)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_campaign_visitor_country ON ads_orders_attributed(campaign_id, visitor_country_code)');
      },
    },
    {
      id: '008_google_ads_device_daily',
      up: async () => {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS google_ads_device_daily (
            provider TEXT NOT NULL,
            day_ymd TEXT NOT NULL,
            customer_id TEXT,
            campaign_id TEXT NOT NULL,
            campaign_name TEXT,
            device TEXT NOT NULL,
            cost_micros BIGINT NOT NULL DEFAULT 0,
            spend_gbp DOUBLE PRECISION NOT NULL DEFAULT 0,
            clicks INTEGER NOT NULL DEFAULT 0,
            impressions INTEGER NOT NULL DEFAULT 0,
            updated_at BIGINT,
            PRIMARY KEY (provider, day_ymd, campaign_id, device)
          )
        `);

        await db.exec('CREATE INDEX IF NOT EXISTS idx_gadd_day ON google_ads_device_daily(day_ymd)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gadd_campaign ON google_ads_device_daily(campaign_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gadd_device ON google_ads_device_daily(device)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_gadd_campaign_day ON google_ads_device_daily(campaign_id, day_ymd)');
      },
    },
    {
      id: '009_ads_orders_attributed_visitor_device_type',
      up: async () => {
        await db.exec(`ALTER TABLE ads_orders_attributed ADD COLUMN IF NOT EXISTS visitor_device_type TEXT`);

        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_visitor_device_type ON ads_orders_attributed(visitor_device_type)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_aoa_campaign_visitor_device_type ON ads_orders_attributed(campaign_id, visitor_device_type)');
      },
    },
  ];

  let applied = 0;
  for (const m of migrations) {
    if (await isApplied(db, m.id)) continue;
    await m.up();
    await markApplied(db, m.id);
    applied++;
  }

  return { ok: true, skipped: false, applied };
}

module.exports = {
  runAdsMigrations,
};
