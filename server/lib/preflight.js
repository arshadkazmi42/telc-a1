'use strict';

// Resolve the `claude` CLI against the user's real login-shell PATH plus common
// install locations — a server not launched from a full login shell otherwise
// can't find CLIs that work fine in the terminal. Trimmed-down port of the
// iChat preflight (we only need `claude`).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const EXE_EXTS = isWin
  ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim()).filter(Boolean)
  : [''];

function commonBinDirs() {
  const home = os.homedir();
  if (isWin) {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(appdata, 'npm'),
      path.join(local, 'Microsoft', 'WindowsApps'),
      path.join(home, '.bun', 'bin'),
    ];
  }
  return [
    path.join(home, '.local', 'bin'),   // claude native install
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/usr/bin', '/bin',
  ];
}

let _loginPath;
function loginShellPath() {
  if (_loginPath !== undefined) return _loginPath;
  _loginPath = null;
  const shell = process.env.SHELL;
  if (!isWin && shell) {
    try {
      const out = spawnSync(shell, ['-lic', 'printf "__P__:%s" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
      const m = /__P__:(.*)/.exec(out.stdout || '');
      if (m && m[1].trim()) _loginPath = m[1].trim();
    } catch { /* ignore */ }
  }
  return _loginPath;
}

let _pathEnv = null;
function pathEnv() {
  if (_pathEnv) return _pathEnv;
  const parts = [];
  const login = loginShellPath();
  if (login) parts.push(...login.split(path.delimiter));
  parts.push(...(process.env.PATH || '').split(path.delimiter));
  parts.push(...commonBinDirs());
  _pathEnv = [...new Set(parts.filter(Boolean))].join(path.delimiter);
  return _pathEnv;
}

const _cache = new Map();
function resolveCli(name) {
  if (_cache.has(name)) return _cache.get(name);
  let resolved = null;
  outer:
  for (const dir of pathEnv().split(path.delimiter)) {
    for (const ext of EXE_EXTS) {
      const p = path.join(dir, name + ext);
      try { fs.accessSync(p, isWin ? fs.constants.F_OK : fs.constants.X_OK); resolved = p; break outer; } catch {}
    }
  }
  if (!resolved) {
    const env = { ...process.env, PATH: pathEnv() };
    const r = isWin
      ? spawnSync('where', [name], { encoding: 'utf8', env })
      : spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env });
    if (r.status === 0 && r.stdout.trim()) resolved = r.stdout.trim().split(/\r?\n/)[0].trim();
  }
  _cache.set(name, resolved || null);
  return resolved || null;
}

module.exports = { resolveCli, pathEnv };
