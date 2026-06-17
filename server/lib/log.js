'use strict';

// Tiny leveled logger. TELC_DEBUG=1 turns on debug lines.
const ts = () => new Date().toISOString().slice(11, 19);
const debugOn = !!process.env.TELC_DEBUG;

const log = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  warn: (...a) => console.warn(`[${ts()}] WARN`, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
  debug: (...a) => { if (debugOn) console.log(`[${ts()}] debug`, ...a); },
};

module.exports = { log };
