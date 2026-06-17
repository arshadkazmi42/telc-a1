'use strict';

const http = require('http');
const path = require('path');
const express = require('express');

const { log } = require('./lib/log');
const { complete, extractJson, getSettings, saveConfig } = require('./lib/llm');
const { buildGeneratePrompt, buildGradePrompt } = require('./lib/prompts');
const { version: VERSION } = require('./package.json');

const PORT = Number(process.env.TELC_PORT || 7332);
const HOST = '127.0.0.1';

const app = express();
app.use(express.json({ limit: '4mb' }));

// Permissive CORS so the chrome-extension page (a different origin) can call us.
// Bound to 127.0.0.1 only, single-user local tool — this is safe here.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve the extension folder too, so the exam also works as a plain web app at
// http://127.0.0.1:7332/exam/index.html (handy if you don't want to load the extension).
app.use(express.static(path.join(__dirname, '..', 'extension')));

app.get('/health', (req, res) => {
  const s = getSettings();
  res.json({ ok: true, name: 'telc-a1', version: VERSION, provider: s.provider });
});

// Report current AI settings (never returns the secret key itself).
app.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    provider: s.provider,
    deepseekModel: s.deepseekModel,
    hasDeepseekKey: !!s.deepseekApiKey,
  });
});

app.post('/config', (req, res) => {
  const { provider, deepseekApiKey, deepseekModel } = req.body || {};
  const patch = {};
  if (provider === 'claude' || provider === 'deepseek') patch.provider = provider;
  if (typeof deepseekApiKey === 'string' && deepseekApiKey.trim()) patch.deepseekApiKey = deepseekApiKey.trim();
  if (typeof deepseekModel === 'string' && deepseekModel.trim()) patch.deepseekModel = deepseekModel.trim();
  saveConfig(patch);
  const s = getSettings();
  res.json({ ok: true, provider: s.provider, deepseekModel: s.deepseekModel, hasDeepseekKey: !!s.deepseekApiKey });
});

app.post('/generate', async (req, res) => {
  const t0 = Date.now();
  try {
    // Date.now()/Math.random() here are fine — this is the Node server, not a workflow.
    const seed = `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    log.info(`generate: starting (provider=${getSettings().provider}, seed=${seed})`);
    const { system, prompt } = buildGeneratePrompt(seed);
    const text = await complete({ system, prompt, maxTokens: 8000 });
    const exam = extractJson(text);
    log.info(`generate: done in ${Math.round((Date.now() - t0) / 1000)}s`);
    res.json({ ok: true, exam });
  } catch (e) {
    log.error('generate failed:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/grade', async (req, res) => {
  try {
    log.info('grade: starting');
    const { system, prompt } = buildGradePrompt(req.body || {});
    const text = await complete({ system, prompt, maxTokens: 4000 });
    const grade = extractJson(text);
    log.info('grade: done');
    res.json({ ok: true, grade });
  } catch (e) {
    log.error('grade failed:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const server = http.createServer(app);
// Generation can take a while on slower models; don't let the socket time out.
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, HOST, () => {
  const s = getSettings();
  log.info(`telc-a1 server listening on http://${HOST}:${PORT}`);
  const providerNote = s.provider === 'deepseek'
    ? `deepseek (${s.deepseekApiKey ? 'key set' : 'NO KEY — set one in Settings'})`
    : 'claude CLI';
  log.info(`AI provider: ${providerNote}`);
  log.info(`Web-app fallback: http://${HOST}:${PORT}/exam/index.html`);
});

function shutdown() { log.info('shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 2000).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
