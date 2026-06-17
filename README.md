# telc Deutsch A1 — Mock Exam

A realistic **telc Deutsch A1 / Start Deutsch 1** practice exam that mimics the real
test-center flow, right in your browser. It covers all four parts:

| Part | What you get |
|------|--------------|
| **Hören** (Listening) | 15 tasks across 3 Teile. Each item's audio is **generated and read aloud in German, slowly (A1 pace), and played twice** — like the real test ("Sie hören den Text zweimal."). |
| **Lesen** (Reading) | 15 tasks (richtig/falsch + anzeigen matching), on a timer. |
| **Schreiben** (Writing) | Fill out a form (Teil 1) + write a short message (Teil 2), graded by AI. |
| **Sprechen** (Speaking) | Introduce yourself, ask/answer with keyword cards, and formulate requests. Your answer is **recorded, transcribed, and graded** with specific feedback. |

**New questions every time** — the exam is generated fresh on each run.

## Architecture

Same shape as the `ichat` extension in this workspace: a **Chrome extension** (the UI)
talks to a **small local Node server** (the AI bridge). The server can use either:

- **Claude Code CLI** (default) — runs the `claude` binary you already have; uses your
  existing subscription, **no API key needed**.
- **DeepSeek API** — a direct call to DeepSeek's API; needs an API key you paste into Settings.

```
 Chrome extension (full-page exam UI)
   • TTS for listening (browser SpeechSynthesis, German, slow)
   • MediaRecorder + speech-to-text for speaking
        │  HTTP (http://127.0.0.1:7332)
        ▼
 Local Node server
   • POST /generate  → fresh exam JSON
   • POST /grade     → AI grading of writing + speaking
        │  spawns / calls
        ▼
   claude CLI   ·OR·   DeepSeek API
```

Listening/Reading are auto-scored in the browser; Writing/Speaking are graded by the AI.

## Requirements

- **Node.js ≥ 18**
- **Google Chrome** (or Chromium with Manifest V3)
- One AI back-end:
  - the **`claude`** CLI on your PATH (default), **or**
  - a **DeepSeek API key** (set it in the extension's Settings)

## Run

```bash
cd telc-a1
npm start        # installs deps on first run, then starts http://127.0.0.1:7332
```

(`./run.sh` on macOS/Linux or `run.cmd` on Windows do the same.)

Then load the extension:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Click the toolbar icon → the exam opens in a new tab

**No-extension fallback:** with the server running, just open
`http://127.0.0.1:7332/exam/index.html` in Chrome — the same exam, served by the server.

## Settings (gear icon, top-right)

- **AI provider** — Claude CLI (default) or DeepSeek (+ API key + model).
- **Sprechtempo** — listening speech rate (slower = easier).
- **Server-URL** — change if you run the server on a different port (`TELC_PORT`).

## Notes & limitations

- **Listening voice** depends on the German voices installed in your OS/Chrome. If none is
  found, a fallback voice is used (still German-tagged).
- **Speaking** uses the browser's German speech recognition (Chrome). It can mis-hear; the
  transcript is shown and **editable** before grading. Fine-grained *pronunciation* scoring
  from a browser is approximate — grading focuses on task fulfilment, grammar, vocabulary,
  and intelligibility.
- The **60% pass mark** shown is an approximation of telc weighting, for practice only — not
  an official result.
- Runs **locally** on `127.0.0.1`. Your answers go to your chosen AI back-end (the `claude`
  CLI you already use, or DeepSeek if you pick it) and nowhere else.

## Config file

Server-side settings live in `~/.telc-a1/config.json` (written by the Settings page):

```json
{ "provider": "claude", "deepseekApiKey": "sk-…", "deepseekModel": "deepseek-chat" }
```

Env overrides: `TELC_PORT` (default 7332), `TELC_PROVIDER`, `DEEPSEEK_API_KEY`, `TELC_DEBUG=1`.

## Layout

```
extension/        Chrome MV3 extension
  background/      opens the exam tab
  exam/            the exam UI (index.html, app.js, audio.js, recorder.js, api.js, styles.css)
server/           local Node server: /generate, /grade, claude-CLI + DeepSeek back-ends
scripts/start.js  install-deps-then-run launcher
```
