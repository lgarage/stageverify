import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * @param {string} filePath
 */
export function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} content
 */
export function sha256String(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
