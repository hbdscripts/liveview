# Edge metadata contract (Worker ↔ Origin ↔ DB ↔ UI)

This document is the single source of truth for what **edge metadata** we collect, how it is transported, what we store, and what the UI may display.

## Goals

- Keep geo and bot metadata stable across Worker and origin changes.
- Avoid regressions (City/ASN/Browser).
- Be privacy-safe: **never** persist raw IP addresses.
- Prefer Cloudflare Worker / `request.cf` when available; fail open when not.

## Field set (minimum)

### Geo / edge (Cloudflare-derived)

- **country_code**: two-letter ISO country code (e.g. `GB`)
- **city**: best-effort city name (may be null)
- **region**: best-effort region/administrative area (may be null)
- **colo**: Cloudflare colo code (e.g. `LHR`)
- **asn**: ASN (string or number serialised to string)
- **timezone**: IANA tz if available (e.g. `Europe/London`)
- **cf_ray**: Cloudflare ray id (request identifier)

### User agent (origin-derived; not Cloudflare-only)

- **ua_browser**: canonical browser key (e.g. `chrome`, `safari`, `edge`, `firefox`, `opera`, `ie`, `other`)
- **ua_browser_version**: optional version string (best-effort)
- **ua_device_type**: `desktop` | `mobile` | `tablet`
- **ua_platform**: `windows` | `mac` | `ios` | `android` | `chromeos` | `linux` | `other`
- **ua_model**: optional (`iphone` | `ipad`)

### Bot signals

- **known_bot**: boolean
- **verified_bot_category**: optional string
- **edge_client_bot**: boolean flag derived from the `x-lv-client-bot` transform rule (when present)

### Privacy-safe IP signals

- **ip_prefix**: privacy-safe prefix only (IPv4 `/24` or IPv6 `/64`)
  - Never store raw IP.
  - If a hash is used, it must be HMAC/salted and non-reversible.

## Transport contract

### Preferred: Cloudflare Worker → origin (headers)

When ingest traffic goes through the Cloudflare Worker, the Worker forwards the request to the origin with these headers (all optional, best-effort):

- `x-cf-country` → **country_code**
- `x-cf-city` → **city** (Cloudflare-sourced; stored as `cf_city` in DB)
- `x-cf-region` → **region**
- `x-cf-colo` → **colo**
- `x-cf-asn` → **asn**
- `x-cf-timezone` → **timezone**
- `cf-ray` → **cf_ray** (pass-through)
- `x-cf-known-bot` → **known_bot**
- `x-cf-verified-bot-category` → **verified_bot_category**
- `x-lv-client-bot: 1` → **edge_client_bot**

### Fallback: origin-only (when Worker metadata is missing)

If Worker headers are missing, the origin fills what it can:

- **Geo**: `geoip-lite` lookup from client IP (best-effort)
  - `country_code` and `city` may be populated
  - Cloudflare-only fields (colo/asn/cf_ray) remain null
- **Browser**: parsed from the request `User-Agent` (best-effort)

## Precedence rules

1. **Worker Cloudflare metadata wins** for Cloudflare-derived fields.
2. If missing, use **origin fallback** (UA parsing + `geoip-lite`).
3. If still missing, store/display **null** (do not invent).

## Storage notes (current schema intent)

- Sessions may store both:
  - **cf_city**: city from Worker/Cloudflare (preferred)
  - **city**: city from origin fallback (`geoip-lite`)
- UI should display `cf_city` first, then `city`.

