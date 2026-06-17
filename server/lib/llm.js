'use strict';

// One small abstraction over two AI back-ends:
//   provider "claude"   -> spawn the local `claude` CLI in one-shot print mode
//                          (uses the subscription you already have; no API key).
//   provider "deepseek" -> direct HTTPS call to DeepSeek's OpenAI-compatible API
//                          (needs an API key, stored locally in ~/.telc-a1/config.json).
// Both just return a string of model text; the server parses JSON out of it.

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { streamProcess } = require('./exec');
const { resolveCli } = require('./preflight');
const { log } = require('./log');

const CONFIG_DIR = process.env.TELC_CACHE_DIR || path.join(os.homedir(), '.telc-a1');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function getSettings() {
  const cfg = loadConfig();
  return {
    provider: process.env.TELC_PROVIDER || cfg.provider || 'claude',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || cfg.deepseekApiKey || '',
    deepseekModel: cfg.deepseekModel || 'deepseek-chat',
    claudeModel: cfg.claudeModel || '', // empty -> CLI default (your subscription model)
  };
}

async function complete({ system, prompt, maxTokens = 8000, signal }) {
  const s = getSettings();
  if (s.provider === 'deepseek') {
    if (!s.deepseekApiKey) {
      throw new Error('DeepSeek is selected but no API key is set. Open Settings and paste your DeepSeek API key.');
    }
    return deepseekComplete({ system, prompt, apiKey: s.deepseekApiKey, model: s.deepseekModel, maxTokens, signal });
  }
  return claudeComplete({ system, prompt, model: s.claudeModel, signal });
}

async function claudeComplete({ system, prompt, model, signal }) {
  const bin = resolveCli('claude');
  if (!bin) {
    throw new Error("`claude` CLI not found on PATH. Install Claude Code (https://docs.claude.com/en/docs/claude-code), or switch the provider to DeepSeek in Settings.");
  }
  // Pure text generation — no tools needed. We don't pass --permission-mode
  // bypassPermissions because (a) we never ask the model to touch the filesystem
  // and (b) that flag is rejected when the process runs as root.
  const args = ['-p', '--output-format', 'json'];
  if (system) args.push('--append-system-prompt', system);
  if (model) args.push('--model', model);
  args.push(prompt); // prompt is the positional argument in print mode

  const cwd = path.join(CONFIG_DIR, 'claude-cwd');
  fs.mkdirSync(cwd, { recursive: true });

  const result = await streamProcess(bin, args, { cwd, signal });
  if (result.code !== 0 && !result.killed) {
    throw new Error(`claude exited ${result.code}: ${(result.stderr || '').slice(0, 400)}`);
  }
  // `--output-format json` prints one envelope: { type:"result", result:"<text>", ... }
  try {
    const obj = JSON.parse(result.stdout.trim());
    if (typeof obj.result === 'string') return obj.result;
    return result.stdout;
  } catch {
    return result.stdout;
  }
}

function deepseekComplete({ system, prompt, apiKey, model, maxTokens, signal }) {
  const body = JSON.stringify({
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 1.0, // variety across runs
    stream: false,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.deepseek.com/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`DeepSeek ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const obj = JSON.parse(data);
            resolve(obj.choices?.[0]?.message?.content || '');
          } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.write(body);
    req.end();
  });
}

// Pull a JSON object out of model text that may be fenced or have stray prose.
function extractJson(text) {
  if (!text || !text.trim()) throw new Error('empty AI output');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

module.exports = { complete, extractJson, getSettings, saveConfig, log };
