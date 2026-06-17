#!/usr/bin/env node
'use strict';

// Cross-platform launcher: install deps on first run, then start the server.
//   node scripts/start.js   (or: npm start)

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'index.js');

function depsInstalled() {
  try {
    require.resolve('express', { paths: [path.join(ROOT, 'server'), ROOT] });
    return true;
  } catch {
    return false;
  }
}

if (!depsInstalled()) {
  process.stdout.write('Installing dependencies (first run)…\n');
  const r = spawnSync('npm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.error || r.status !== 0) {
    process.stderr.write('npm install failed' + (r.error ? ': ' + r.error.message : '') + '\n');
    process.exit(r.status || 1);
  }
}

require(SERVER);
