// Thin client for the local server. Default base is the local server port; a
// different URL can be saved in chrome.storage (Settings) if you change the port.

const DEFAULT_BASE = 'http://127.0.0.1:7332';

let baseUrl = DEFAULT_BASE;

export async function loadBaseUrl() {
  try {
    const got = await chrome.storage?.local?.get?.('serverUrl');
    if (got && got.serverUrl) baseUrl = got.serverUrl;
  } catch {
    // Running as a plain web page (not the extension) — same-origin works too.
    if (location.origin.startsWith('http')) baseUrl = location.origin;
  }
  return baseUrl;
}

export function getBaseUrl() { return baseUrl; }

export async function setBaseUrl(url) {
  baseUrl = url || DEFAULT_BASE;
  try { await chrome.storage?.local?.set?.({ serverUrl: baseUrl }); } catch {}
}

async function req(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  }
  return data;
}

export const api = {
  health: () => req('GET', '/health'),
  getConfig: () => req('GET', '/config'),
  setConfig: (cfg) => req('POST', '/config', cfg),
  generate: () => req('POST', '/generate'),
  grade: (payload) => req('POST', '/grade', payload),
};
