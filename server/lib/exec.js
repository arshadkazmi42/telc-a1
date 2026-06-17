'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { pathEnv } = require('./preflight');
const { log } = require('./log');

// Spawn a process, capture stdout/stderr, resolve { code, stdout, stderr, killed }.
// Mirrors the iChat exec pattern (own process group so cancel kills the whole tree).
function streamProcess(cmd, args, { cwd, env, stdinData, signal } = {}) {
  return new Promise((resolve, reject) => {
    let command = cmd;
    let spawnArgs = args;
    // On Windows, npm-installed CLIs are .cmd shims that recent Node refuses to
    // spawn directly — route them through cmd.exe.
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
      command = process.env.ComSpec || 'cmd.exe';
      spawnArgs = ['/d', '/s', '/c', cmd, ...args];
    }

    const proc = spawn(command, spawnArgs, {
      cwd,
      env: { ...process.env, PATH: pathEnv(), ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    const label = path.basename(cmd);
    const t0 = Date.now();
    const hb = setInterval(
      () => log.info(`exec: ${label} still running (${Math.round((Date.now() - t0) / 1000)}s)…`),
      15000,
    );
    hb.unref();

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    if (stdinData != null) proc.stdin.write(stdinData);
    proc.stdin.end();

    const killTree = (sigName) => {
      if (process.platform === 'win32') {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']); } catch {}
        return;
      }
      try { process.kill(-proc.pid, sigName); } catch { try { proc.kill(sigName); } catch {} }
    };
    let killed = false;
    if (signal) {
      const onAbort = () => {
        killed = true;
        killTree('SIGTERM');
        setTimeout(() => killTree('SIGKILL'), 1200).unref();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.on('error', (err) => { clearInterval(hb); reject(err); });
    proc.on('close', (code) => {
      clearInterval(hb);
      const secs = Math.round((Date.now() - t0) / 1000);
      log.info(`exec: ${label} exited code=${code}${killed ? ' (killed)' : ''} after ${secs}s, stdout ${stdout.length}b`);
      resolve({ code, stdout, stderr, killed });
    });
  });
}

module.exports = { streamProcess };
