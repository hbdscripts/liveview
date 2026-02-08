const { Client } = require('pg');

function argHas(flag) {
  return process.argv.includes(flag);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] != null ? String(process.argv[i + 1]) : null;
}

function argHasWithValuePrefix(flag) {
  return process.argv.some((a) => typeof a === 'string' && a.startsWith(flag + '='));
}

function argValueWithPrefix(flag) {
  const entry = process.argv.find((a) => typeof a === 'string' && a.startsWith(flag + '='));
  if (!entry) return null;
  return entry.slice((flag + '=').length);
}

async function tableExists(client, tableName) {
  const r = await client.query('SELECT to_regclass($1) AS reg', [tableName]);
  return !!(r.rows[0] && r.rows[0].reg);
}

async function getCutoffs(client, timeZone) {
  const r = await client.query(
    "SELECT now() AS now_utc, (now() AT TIME ZONE $1) AS now_tz, (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS cutoff_ts, (EXTRACT(EPOCH FROM (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)) * 1000)::bigint AS cutoff_ms, to_char(date_trunc('day', now() AT TIME ZONE $1), 'YYYY-MM-DD') AS cutoff_ymd",
    [timeZone]
  );
  const row = r.rows[0] || {};
  return {
    nowUtc: row.now_utc,
    nowTz: row.now_tz,
    cutoffTs: row.cutoff_ts,
    cutoffMs: Number(row.cutoff_ms),
    cutoffYmd: String(row.cutoff_ymd || ''),
  };
}

async function countN(client, sql, params) {
  const r = await client.query(sql, params || []);
  const n = r.rows[0] && r.rows[0].n != null ? Number(r.rows[0].n) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function del(client, label, sql, params, results) {
  const r = await client.query(sql, params || []);
  results.deletes[label] = r && typeof r.rowCount === 'number' ? r.rowCount : null;
}

async function main() {
  const timeZone = argValue('--tz') || 'Europe/London';
  const apply = argHas('--apply');
  const dryRun = !apply;
  const listTables = argHas('--list-tables');
  const schema = argValue('--schema') || argValueWithPrefix('--schema') || 'public';

  const cs = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  if (!cs) {
    throw new Error('Missing DATABASE_PUBLIC_URL/DATABASE_URL in environment (run via `railway run -s Postgres`).');
  }

  const useSsl = !cs.includes('railway.internal');
  const client = new Client({
    connectionString: cs,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    if (listTables) {
      const r = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename ASC",
        [schema]
      );
      console.log(
        JSON.stringify(
          {
            mode: 'list_tables',
            schema,
            count: (r.rows || []).length,
            tables: (r.rows || []).map((x) => x && x.tablename ? String(x.tablename) : '').filter(Boolean),
          },
          null,
          2
        )
      );
      return;
    }

    const cut = await getCutoffs(client, timeZone);
    if (!Number.isFinite(cut.cutoffMs) || !cut.cutoffYmd) {
      throw new Error('Failed to compute cutoff');
    }

    const tablesToCheck = [
      'report_cache',
      'events',
      'sessions',
      'visitors',
      'purchases',
      'purchase_events',
      'orders_shopify',
      'orders_shopify_line_items',
      'reconcile_snapshots',
      'shopify_sessions_snapshots',
      'bot_block_counts',
      'traffic_source_tokens',
    ];

    const present = {};
    for (const t of tablesToCheck) {
      present[t] = await tableExists(client, t);
    }

    const out = {
      mode: dryRun ? 'dry_run' : 'apply',
      timeZone,
      cutoff: {
        nowUtc: cut.nowUtc,
        nowTz: cut.nowTz,
        cutoffTs: cut.cutoffTs,
        cutoffMs: cut.cutoffMs,
        cutoffYmd: cut.cutoffYmd,
      },
      tablesPresent: present,
      counts: {},
      deletes: {},
    };

    if (dryRun) {
      if (present.report_cache) out.counts.report_cache_total = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM report_cache');
      if (present.sessions) out.counts.sessions_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM sessions WHERE started_at < $1', [cut.cutoffMs]);
      if (present.events && present.sessions) out.counts.events_join_sessions_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM events e JOIN sessions s ON s.session_id = e.session_id WHERE s.started_at < $1', [cut.cutoffMs]);
      if (present.events) out.counts.events_ts_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM events WHERE ts < $1', [cut.cutoffMs]);
      if (present.purchases) out.counts.purchases_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM purchases WHERE purchased_at < $1', [cut.cutoffMs]);
      if (present.purchase_events) out.counts.purchase_events_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM purchase_events WHERE occurred_at < $1', [cut.cutoffMs]);
      if (present.orders_shopify) out.counts.orders_shopify_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM orders_shopify WHERE created_at < $1', [cut.cutoffMs]);
      if (present.orders_shopify_line_items) out.counts.orders_shopify_line_items_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM orders_shopify_line_items WHERE order_created_at < $1', [cut.cutoffMs]);
      if (present.reconcile_snapshots) out.counts.reconcile_snapshots_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM reconcile_snapshots WHERE range_end_ts < $1', [cut.cutoffMs]);
      if (present.shopify_sessions_snapshots) out.counts.shopify_sessions_snapshots_before_day = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM shopify_sessions_snapshots WHERE day_ymd < $1', [cut.cutoffYmd]);
      if (present.bot_block_counts) out.counts.bot_block_counts_before_day = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM bot_block_counts WHERE date < $1', [cut.cutoffYmd]);
      if (present.traffic_source_tokens) out.counts.traffic_source_tokens_before_cutoff = await countN(client, 'SELECT COUNT(*)::bigint AS n FROM traffic_source_tokens WHERE last_seen_at < $1', [cut.cutoffMs]);

      console.log(JSON.stringify(out, null, 2));
      return;
    }

    await client.query('BEGIN');
    try {
      if (present.report_cache) await del(client, 'report_cache_all', 'DELETE FROM report_cache', [], out);

      if (present.events && present.sessions) {
        await del(
          client,
          'events_by_session_started_at_before_cutoff',
          'DELETE FROM events e USING sessions s WHERE e.session_id = s.session_id AND s.started_at < $1',
          [cut.cutoffMs],
          out
        );
      }
      if (present.events) await del(client, 'events_ts_before_cutoff', 'DELETE FROM events WHERE ts < $1', [cut.cutoffMs], out);

      if (present.purchases) await del(client, 'purchases_before_cutoff', 'DELETE FROM purchases WHERE purchased_at < $1', [cut.cutoffMs], out);

      if (present.purchase_events) await del(client, 'purchase_events_before_cutoff', 'DELETE FROM purchase_events WHERE occurred_at < $1', [cut.cutoffMs], out);

      if (present.orders_shopify_line_items) {
        await del(client, 'orders_shopify_line_items_before_cutoff', 'DELETE FROM orders_shopify_line_items WHERE order_created_at < $1', [cut.cutoffMs], out);
      }
      if (present.orders_shopify) {
        await del(client, 'orders_shopify_before_cutoff', 'DELETE FROM orders_shopify WHERE created_at < $1', [cut.cutoffMs], out);
      }

      if (present.reconcile_snapshots) {
        await del(client, 'reconcile_snapshots_before_cutoff', 'DELETE FROM reconcile_snapshots WHERE range_end_ts < $1', [cut.cutoffMs], out);
      }

      if (present.shopify_sessions_snapshots) {
        await del(client, 'shopify_sessions_snapshots_before_day', 'DELETE FROM shopify_sessions_snapshots WHERE day_ymd < $1', [cut.cutoffYmd], out);
      }
      if (present.bot_block_counts) {
        await del(client, 'bot_block_counts_before_day', 'DELETE FROM bot_block_counts WHERE date < $1', [cut.cutoffYmd], out);
      }

      if (present.traffic_source_tokens) {
        await del(client, 'traffic_source_tokens_before_cutoff', 'DELETE FROM traffic_source_tokens WHERE last_seen_at < $1', [cut.cutoffMs], out);
      }

      if (present.sessions) {
        await del(client, 'sessions_before_cutoff', 'DELETE FROM sessions WHERE started_at < $1', [cut.cutoffMs], out);
      }

      if (present.visitors && present.sessions) {
        await del(
          client,
          'visitors_orphaned_last_seen_before_cutoff',
          'DELETE FROM visitors v WHERE v.last_seen < $1 AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.visitor_id = v.visitor_id)',
          [cut.cutoffMs],
          out
        );
      }

      await client.query('COMMIT');
      console.log(JSON.stringify(out, null, 2));
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
