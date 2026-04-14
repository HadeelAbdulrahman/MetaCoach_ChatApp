// ── Logger ────────────────────────────────────────────────────────

import fs   from 'fs';
import path from 'path';

const LOG_FILE = 'metacoach.log';

function _write(level, msg) {
  const ts   = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const line = `${ts} [${level}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

export const logger = {
  info:  (msg) => _write('INFO',  msg),
  warn:  (msg) => _write('WARN',  msg),
  error: (msg) => _write('ERROR', msg),
  readLast: (n = 60) => {
    if (!fs.existsSync(LOG_FILE)) return 'No log file yet.';
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n).join('\n');
  },
};
