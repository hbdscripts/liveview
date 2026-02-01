#!/usr/bin/env node
/**
 * Output a strong random secret for INGEST_SECRET.
 * Copy the output into .env as INGEST_SECRET=...
 */

const crypto = require('crypto');
console.log(crypto.randomBytes(32).toString('hex'));
