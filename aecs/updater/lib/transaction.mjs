import crypto from 'node:crypto';

/** Matches createTransactionId output: txn-YYYY-MM-DDTHH-MM-SS-mmmZ-xxxxxxxx */
const TRANSACTION_ID_RE =
  /^txn-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([0-9a-f]{8})$/;

/**
 * @param {string} [prefix]
 */
export function createTransactionId(prefix = 'txn') {
  if (prefix !== 'txn') {
    throw new Error(`Unsupported transaction prefix: ${prefix}`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Validate transaction id matches createTransactionId format exactly.
 * Rejects malformed dates, path chars, traversal, loose prefixes, wrong suffix length.
 *
 * @param {string} transactionId
 */
export function isValidTransactionId(transactionId) {
  if (typeof transactionId !== 'string') {
    return false;
  }
  if (transactionId.includes('/') || transactionId.includes('\\') || transactionId.includes('..')) {
    return false;
  }
  const m = transactionId.match(TRANSACTION_ID_RE);
  if (!m) {
    return false;
  }
  const [, year, month, day, hour, min, sec, ms] = m;
  const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return false;
  }
  return (
    d.getUTCFullYear() === Number(year) &&
    d.getUTCMonth() + 1 === Number(month) &&
    d.getUTCDate() === Number(day) &&
    d.getUTCHours() === Number(hour) &&
    d.getUTCMinutes() === Number(min) &&
    d.getUTCSeconds() === Number(sec) &&
    d.getUTCMilliseconds() === Number(ms)
  );
}
