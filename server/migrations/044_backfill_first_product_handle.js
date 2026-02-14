/**
 * Backfill `sessions.first_product_handle` from landing URLs when missing.
 *
 * Why:
 * - Many reports use product-landing sessions as the denominator.
 * - Older ingests sometimes recorded `first_path`/`entry_url` without persisting the parsed handle.
 * - Filling `first_product_handle` allows fast SQL aggregation (indexes exist) and removes
 *   per-request JS parsing/scans.
 *
 * Safe:
 * - UPDATE only, no deletes.
 * - Only populates when `first_product_handle` is NULL/blank.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  if (isPostgres()) {
    try {
      await db.run(
        `
          UPDATE sessions
          SET first_product_handle = LEFT(
            LOWER(
              COALESCE(
                NULLIF(SUBSTRING(first_path FROM '^/products/([^/?#]+)'), ''),
                NULLIF(SUBSTRING(entry_url FROM '/products/([^/?#]+)'), '')
              )
            ),
            128
          )
          WHERE (first_product_handle IS NULL OR BTRIM(first_product_handle) = '')
            AND (
              (first_path IS NOT NULL AND LOWER(first_path) LIKE '/products/%')
              OR (entry_url IS NOT NULL AND LOWER(entry_url) LIKE '%/products/%')
            )
            AND (
              SUBSTRING(first_path FROM '^/products/([^/?#]+)') IS NOT NULL
              OR SUBSTRING(entry_url FROM '/products/([^/?#]+)') IS NOT NULL
            )
        `
      );
    } catch (_) {
      // Fail-open: older installs may lack columns.
    }
    return;
  }

  // SQLite: use string ops (no regex).
  try {
    await db.exec(
      `
        UPDATE sessions
        SET first_product_handle = SUBSTR(
          LOWER(TRIM(
            CASE
              WHEN first_path IS NOT NULL AND LOWER(first_path) LIKE '/products/%' THEN
                CASE
                  WHEN INSTR(SUBSTR(first_path, 11), '/') > 0 THEN SUBSTR(SUBSTR(first_path, 11), 1, INSTR(SUBSTR(first_path, 11), '/') - 1)
                  WHEN INSTR(SUBSTR(first_path, 11), '?') > 0 THEN SUBSTR(SUBSTR(first_path, 11), 1, INSTR(SUBSTR(first_path, 11), '?') - 1)
                  WHEN INSTR(SUBSTR(first_path, 11), '#') > 0 THEN SUBSTR(SUBSTR(first_path, 11), 1, INSTR(SUBSTR(first_path, 11), '#') - 1)
                  ELSE SUBSTR(first_path, 11)
                END
              WHEN entry_url IS NOT NULL AND LOWER(entry_url) LIKE '%/products/%' THEN
                CASE
                  WHEN INSTR(SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10), '/') > 0 THEN SUBSTR(
                    SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10),
                    1,
                    INSTR(SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10), '/') - 1
                  )
                  WHEN INSTR(SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10), '?') > 0 THEN SUBSTR(
                    SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10),
                    1,
                    INSTR(SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10), '?') - 1
                  )
                  WHEN INSTR(SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10), '#') > 0 THEN SUBSTR(
                    SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10),
                    1,
                    INSTR(SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10), '#') - 1
                  )
                  ELSE SUBSTR(entry_url, INSTR(LOWER(entry_url), '/products/') + 10)
                END
              ELSE first_product_handle
            END
          )),
          1,
          128
        )
        WHERE (first_product_handle IS NULL OR TRIM(first_product_handle) = '')
          AND (
            (first_path IS NOT NULL AND LOWER(first_path) LIKE '/products/%')
            OR (entry_url IS NOT NULL AND LOWER(entry_url) LIKE '%/products/%')
          )
      `
    );
  } catch (_) {
    // Fail-open if columns don't exist yet.
  }
}

module.exports = { up };

