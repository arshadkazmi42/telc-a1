import { api, loadBaseUrl, getBaseUrl, setBaseUrl } from './api.js';
import { playListeningItem, cancelAudio, germanVoice, hasGermanVoice } from './audio.js';
import { AnswerRecorder, speechRecognitionAvailable } from './recorder.js';

const appEl = document.getElementById('app');
const timerEl = document.getElementById('timer');
const pillEl = document.getElementById('status-pill');

// ---------- state ----------
const state = {
  screen: 'home',
  exam: null,
  answers: null,
  grade: null,
  gradeError: '',
  error: '',
  loadingMsg: '',
  listenPos: 0,
  sprechenPos: 0,
  config: { provider: 'claude', hasDeepseekKey: false, deepseekModel: 'deepseek-chat' },
  rate: 0.8,
  returnScreen: 'home',
};

let audioAbort = null;
let timerHandle = null;
let recorder = null;

// ---------- helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (sel) => appEl.querySelector(sel);
const $$ = (sel) => Array.from(appEl.querySelectorAll(sel));

function listenItems(exam) {
  const out = [];
  (exam.hoeren?.teil1 || []).forEach((it, idx) => out.push({ teil: 1, idx, type: 'mc', ...it }));
  (exam.hoeren?.teil2 || []).forEach((it, idx) => out.push({ teil: 2, idx, type: 'tf', ...it }));
  (exam.hoeren?.teil3 || []).forEach((it, idx) => out.push({ teil: 3, idx, type: 'mc', ...it }));
  return out;
}

function sprechenTasks() {
  const ex = state.exam.sprechen || {};
  const tasks = [];
  if (ex.teil1) tasks.push({ key: 'teil1', i: 0, title: 'Sprechen · Teil 1 — Sich vorstellen', instruction: ex.teil1.instruction, keywords: ex.teil1.keywords });
  (ex.teil2 || []).forEach((t, i) => tasks.push({ key: 'teil2', i, title: `Sprechen · Teil 2 — Fragen & Antworten`, sub: `Karte ${i + 1} von ${(ex.teil2 || []).length}`, instruction: t.instruction, thema: t.thema, stichwort: t.stichwort }));
  (ex.teil3 || []).forEach((t, i) => tasks.push({ key: 'teil3', i, title: `Sprechen · Teil 3 — Bitten`, sub: `Karte ${i + 1} von ${(ex.teil3 || []).length}`, instruction: t.instruction, bildkarte: t.bildkarte }));
  return tasks;
}

function freshAnswers(exam) {
  return {
    hoeren: {},
    lesen: {},
    schreiben: { teil1: (exam.schreiben?.teil1?.fields || []).map(() => ''), teil2: '' },
    sprechen: {
      teil1: { transcript: '', audioUrl: null },
      teil2: (exam.sprechen?.teil2 || []).map(() => ({ transcript: '', audioUrl: null })),
      teil3: (exam.sprechen?.teil3 || []).map(() => ({ transcript: '', audioUrl: null })),
    },
  };
}

function scoreSection(section) {
  const exam = state.exam, ans = state.answers[section];
  let correct = 0, total = 0;
  for (const teil of [1, 2, 3]) {
    (exam[section]?.[`teil${teil}`] || []).forEach((it, idx) => {
      total++;
      if (ans[`${teil}-${idx}`] !== undefined && ans[`${teil}-${idx}`] === it.answer) correct++;
    });
  }
  return { correct, total, percent: total ? Math.round((correct / total) * 100) : 0 };
}

// ---------- timer ----------
function startTimer(totalSeconds) {
  stopTimer();
  const end = Date.now() + totalSeconds * 1000;
  timerEl.hidden = false;
  const tick = () => {
    let left = Math.max(0, Math.round((end - Date.now()) / 1000));
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    timerEl.textContent = `⏱ ${m}:${s}`;
    timerEl.classList.toggle('timer-low', left <= 60);
    if (left <= 0) stopTimer();
  };
  tick();
  timerHandle = setInterval(tick, 1000);
}
function stopTimer() { if (timerHandle) clearInterval(timerHandle); timerHandle = null; timerEl.hidden = true; timerEl.classList.remove('timer-low'); }

// ---------- topbar ----------
function updatePill(text, kind) {
  pillEl.textContent = text;
  pillEl.className = `pill pill-${kind}`;
}

async function refreshHealth() {
  try {
    const h = await api.health();
    updatePill(`bereit · ${h.provider}`, 'ok');
    return true;
  } catch {
    updatePill('Server offline', 'err');
    return false;
  }
}

// ---------- render dispatch ----------
function render(screen) {
  if (screen) state.screen = screen;
  stopTimer();
  if (state.screen !== 'hoeren') { if (audioAbort) audioAbort.abort(); cancelAudio(); }
  const fn = SCREENS[state.screen] || SCREENS.home;
  appEl.innerHTML = fn.html();
  fn.setup && fn.setup();
}

// ====================================================================
// Screens
// ====================================================================
const SCREENS = {};

// ---- Home ----
SCREENS.home = {
  html: () => `
    <section class="card hero">
      <h1>telc Deutsch A1 — Mock-Prüfung</h1>
      <p class="lead">Eine vollständige Übungsprüfung wie im Testzentrum: <b>Hören</b> (mit vorgelesenem Audio),
      <b>Lesen</b>, <b>Schreiben</b> und <b>Sprechen</b> (mit Aufnahme &amp; Auswertung).
      Jedes Mal neue Aufgaben.</p>

      <div class="grid4">
        <div class="mini"><span class="mini-k">Hören</span><span>15 Aufgaben · Audio wird 2× abgespielt</span></div>
        <div class="mini"><span class="mini-k">Lesen</span><span>15 Aufgaben · 25 Min</span></div>
        <div class="mini"><span class="mini-k">Schreiben</span><span>Formular + Mitteilung · 20 Min</span></div>
        <div class="mini"><span class="mini-k">Sprechen</span><span>Vorstellen + Fragen + Bitten · Aufnahme</span></div>
      </div>

      <button id="start-btn" class="btn btn-primary btn-lg">Neue Prüfung starten</button>
      <p id="home-hint" class="hint"></p>
      <p class="hint small">Tipp: Für Hören und Sprechen Lautsprecher und Mikrofon erlauben. Die Auswertung von
      Schreiben &amp; Sprechen macht die KI über den lokalen Server.</p>
    </section>`,
  setup: () => {
    $('#start-btn').addEventListener('click', startExam);
    refreshHealth().then((ok) => {
      const voiceMsg = hasGermanVoice() ? '' : ' (Hinweis: keine deutsche Stimme gefunden — das Audio nutzt eine Ersatzstimme.)';
      const srMsg = speechRecognitionAvailable() ? '' : ' Spracherkennung ist in diesem Browser nicht verfügbar — beim Sprechen können Sie das Transkript selbst eintippen.';
      if (!ok) $('#home-hint').innerHTML = '⚠ Lokaler Server nicht erreichbar. Starten Sie ihn mit <code>npm start</code> im Projektordner.';
      else $('#home-hint').textContent = (voiceMsg + srMsg).trim();
    });
    // Warm up the TTS voice list.
    germanVoice();
  },
};

// ---- Loading / Error ----
SCREENS.loading = {
  html: () => `
    <section class="card center">
      <div class="spinner"></div>
      <h2>${esc(state.loadingMsg || 'Bitte warten …')}</h2>
      <p class="hint">${esc(state.loadingSub || '')}</p>
    </section>`,
};

SCREENS.error = {
  html: () => `
    <section class="card center">
      <h2>Etwas ist schiefgelaufen</h2>
      <p class="err-text">${esc(state.error)}</p>
      <button id="back-home" class="btn">Zurück zum Start</button>
    </section>`,
  setup: () => { $('#back-home').addEventListener('click', () => render('home')); },
};

// ---- generic section intro ----
function intro(title, lines, next) {
  return {
    html: () => `
      <section class="card">
        <h2>${esc(title)}</h2>
        ${lines.map((l) => `<p>${l}</p>`).join('')}
        <button id="begin-btn" class="btn btn-primary">Beginnen</button>
      </section>`,
    setup: () => { $('#begin-btn').addEventListener('click', () => render(next)); },
  };
}

SCREENS['hoeren-intro'] = intro(
  'Teil 1: Hören',
  ['Sie hören kurze Texte. Jeder Text wird <b>zweimal</b> abgespielt.',
   'Wählen Sie die richtige Antwort bzw. entscheiden Sie <i>richtig</i> oder <i>falsch</i>.',
   'Stellen Sie sicher, dass der Ton an ist. Das Audio startet automatisch.'],
  'hoeren',
);
SCREENS['lesen-intro'] = intro(
  'Teil 2: Lesen',
  ['Lesen Sie die Texte und beantworten Sie die Aufgaben.',
   'Sie haben <b>25 Minuten</b> Zeit.'],
  'lesen',
);
SCREENS['schreiben-intro'] = intro(
  'Teil 3: Schreiben',
  ['Füllen Sie das Formular aus und schreiben Sie eine kurze Mitteilung.',
   'Sie haben <b>20 Minuten</b> Zeit.'],
  'schreiben',
);
SCREENS['sprechen-intro'] = intro(
  'Teil 4: Sprechen',
  ['Sie sprechen frei. Ihre Antwort wird <b>aufgenommen</b> und danach ausgewertet.',
   'Erlauben Sie den Zugriff auf das Mikrofon.',
   'Nach jeder Aufnahme können Sie das erkannte Transkript prüfen und korrigieren.'],
  'sprechen',
);

// ---- Hören (one item at a time) ----
SCREENS.hoeren = {
  html: () => {
    const items = listenItems(state.exam);
    const pos = state.listenPos;
    const it = items[pos];
    if (!it) return `<section class="card center"><h2>Hören beendet</h2></section>`;
    const teilInstr = it.type === 'tf' ? 'Richtig oder falsch?' : 'Wählen Sie: a, b oder c.';
    const sel = state.answers.hoeren[`${it.teil}-${it.idx}`];

    let body;
    if (it.type === 'mc') {
      body = `
        <p class="qtext">${esc(it.question)}</p>
        <div class="options">
          ${(it.options || []).map((opt, i) => `
            <button class="option ${sel === i ? 'selected' : ''}" data-val="${i}">
              <span class="optkey">${'abc'[i]}</span><span>${esc(opt)}</span>
            </button>`).join('')}
        </div>`;
    } else {
      body = `
        <p class="qtext">${esc(it.statement)}</p>
        <div class="tf">
          <button class="tf-btn ${sel === true ? 'selected' : ''}" data-val="true">✓ Richtig</button>
          <button class="tf-btn ${sel === false ? 'selected' : ''}" data-val="false">✗ Falsch</button>
        </div>`;
    }

    return `
      <section class="card">
        <div class="sec-head">
          <h2>Hören · Teil ${it.teil}</h2>
          <span class="counter">Aufgabe ${pos + 1} von ${items.length}</span>
        </div>
        <p class="hint">${teilInstr}</p>
        <div class="audio-box">
          <span class="audio-ico">🔊</span>
          <span id="audio-status">Wird abgespielt …</span>
          <button id="replay-btn" class="btn btn-sm">↺ nochmal</button>
        </div>
        ${body}
        <div class="nav">
          <button id="next-btn" class="btn btn-primary">${pos + 1 === items.length ? 'Hören beenden' : 'Weiter'}</button>
        </div>
      </section>`;
  },
  setup: () => {
    const items = listenItems(state.exam);
    const it = items[state.listenPos];
    if (!it) { render('lesen-intro'); return; }

    // answer selection (no re-render, so audio keeps playing)
    $$('.option, .tf-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.val;
        const val = it.type === 'mc' ? Number(raw) : raw === 'true';
        state.answers.hoeren[`${it.teil}-${it.idx}`] = val;
        $$('.option, .tf-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    $('#next-btn').addEventListener('click', () => {
      if (audioAbort) audioAbort.abort();
      cancelAudio();
      if (state.listenPos + 1 >= items.length) { render('lesen-intro'); }
      else { state.listenPos++; render('hoeren'); }
    });

    const play = () => {
      if (audioAbort) audioAbort.abort();
      cancelAudio();
      audioAbort = new AbortController();
      const statusEl = $('#audio-status');
      playListeningItem(it.audioScript, {
        rate: state.rate,
        signal: audioAbort.signal,
        onStatus: (t) => { if (statusEl) statusEl.textContent = t; },
      });
    };
    $('#replay-btn').addEventListener('click', play);
    play();
  },
};

// ---- Lesen (single page) ----
SCREENS.lesen = {
  html: () => {
    const L = state.exam.lesen || {};
    const a = state.answers.lesen;
    const tf = (teil, idx, text, statement) => `
      <div class="qitem">
        <div class="qbox">${esc(text)}</div>
        <p class="qtext">${esc(statement)}</p>
        <div class="tf">
          <button class="tf-btn ${a[`${teil}-${idx}`] === true ? 'selected' : ''}" data-teil="${teil}" data-idx="${idx}" data-val="true">✓ Richtig</button>
          <button class="tf-btn ${a[`${teil}-${idx}`] === false ? 'selected' : ''}" data-teil="${teil}" data-idx="${idx}" data-val="false">✗ Falsch</button>
        </div>
      </div>`;

    return `
      <section class="card">
        <div class="sec-head"><h2>Lesen</h2><span class="counter">15 Aufgaben</span></div>

        <h3>Teil 1 — Richtig oder falsch?</h3>
        ${(L.teil1 || []).map((it, i) => tf(1, i, it.text, it.statement)).join('')}

        <h3>Teil 2 — Welche Anzeige passt? (a oder b)</h3>
        ${(L.teil2 || []).map((it, i) => `
          <div class="qitem">
            <p class="qtext">${esc(it.situation)}</p>
            <div class="options">
              <button class="option ${a[`2-${i}`] === 'a' ? 'selected' : ''}" data-teil="2" data-idx="${i}" data-val="a"><span class="optkey">a</span><span>${esc(it.optionA)}</span></button>
              <button class="option ${a[`2-${i}`] === 'b' ? 'selected' : ''}" data-teil="2" data-idx="${i}" data-val="b"><span class="optkey">b</span><span>${esc(it.optionB)}</span></button>
            </div>
          </div>`).join('')}

        <h3>Teil 3 — Richtig oder falsch?</h3>
        ${(L.teil3 || []).map((it, i) => tf(3, i, it.text, it.statement)).join('')}

        <div class="nav"><button id="next-btn" class="btn btn-primary">Weiter zu Schreiben</button></div>
      </section>`;
  },
  setup: () => {
    startTimer(25 * 60);
    $$('.tf-btn, .option').forEach((btn) => {
      if (!btn.dataset.teil) return;
      btn.addEventListener('click', () => {
        const teil = btn.dataset.teil, idx = btn.dataset.idx, raw = btn.dataset.val;
        const val = raw === 'true' ? true : raw === 'false' ? false : raw;
        state.answers.lesen[`${teil}-${idx}`] = val;
        // clear siblings within the same qitem
        btn.closest('.qitem').querySelectorAll('.tf-btn, .option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
    $('#next-btn').addEventListener('click', () => render('schreiben-intro'));
  },
};

// ---- Schreiben ----
SCREENS.schreiben = {
  html: () => {
    const S = state.exam.schreiben || {};
    const t1 = S.teil1 || { scenario: '', fields: [] };
    const t2 = S.teil2 || { scenario: '', points: [] };
    return `
      <section class="card">
        <div class="sec-head"><h2>Schreiben</h2></div>

        <h3>Teil 1 — Formular ausfüllen</h3>
        <p class="scenario">${esc(t1.scenario)}</p>
        <div class="form-grid">
          ${(t1.fields || []).map((f, i) => `
            <label class="field">
              <span>${esc(f.label)}</span>
              <input type="text" data-i="${i}" value="${esc(state.answers.schreiben.teil1[i] || '')}" placeholder="${esc(f.hint || '')}" />
            </label>`).join('')}
        </div>

        <h3>Teil 2 — Eine kurze Mitteilung schreiben</h3>
        <p class="scenario">${esc(t2.scenario)}</p>
        <ul class="points">${(t2.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <textarea id="t2-text" rows="7" placeholder="Schreiben Sie hier …">${esc(state.answers.schreiben.teil2 || '')}</textarea>

        <div class="nav"><button id="next-btn" class="btn btn-primary">Weiter zu Sprechen</button></div>
      </section>`;
  },
  setup: () => {
    startTimer(20 * 60);
    $$('.form-grid input').forEach((inp) => {
      inp.addEventListener('input', () => { state.answers.schreiben.teil1[Number(inp.dataset.i)] = inp.value; });
    });
    $('#t2-text').addEventListener('input', (e) => { state.answers.schreiben.teil2 = e.target.value; });
    $('#next-btn').addEventListener('click', () => { state.sprechenPos = 0; render('sprechen-intro'); });
  },
};

// ---- Sprechen (one task at a time, with recording) ----
SCREENS.sprechen = {
  html: () => {
    const tasks = sprechenTasks();
    const pos = state.sprechenPos;
    const t = tasks[pos];
    if (!t) return `<section class="card center"><h2>Sprechen beendet</h2></section>`;
    const saved = t.key === 'teil1' ? state.answers.sprechen.teil1 : state.answers.sprechen[t.key][t.i];

    let card = '';
    if (t.key === 'teil1') {
      card = `<div class="speakcard"><div class="speakcard-label">Sprechen Sie über:</div>
        <div class="keywords">${(t.keywords || []).map((k) => `<span class="kw">${esc(k)}</span>`).join('')}</div></div>`;
    } else if (t.key === 'teil2') {
      card = `<div class="speakcard"><div class="speakcard-label">Thema: ${esc(t.thema)}</div>
        <div class="bigword">${esc(t.stichwort)}</div></div>`;
    } else {
      card = `<div class="speakcard"><div class="speakcard-label">Bildkarte</div>
        <div class="bigword">🗯️ ${esc(t.bildkarte)}</div></div>`;
    }

    return `
      <section class="card">
        <div class="sec-head"><h2>${esc(t.title)}</h2><span class="counter">${esc(t.sub || `Aufgabe ${pos + 1} von ${tasks.length}`)}</span></div>
        <p class="qtext">${esc(t.instruction)}</p>
        ${card}

        <div class="rec-area">
          <button id="rec-btn" class="btn btn-rec">● Aufnahme starten</button>
          <span id="rec-status" class="hint"></span>
        </div>

        <div id="rec-result" class="${saved && saved.transcript ? '' : 'hidden'}">
          ${saved && saved.audioUrl ? `<audio controls src="${saved.audioUrl}"></audio>` : ''}
          <label class="field">
            <span>Erkanntes Transkript (bei Bedarf korrigieren):</span>
            <textarea id="transcript" rows="3">${esc(saved ? saved.transcript : '')}</textarea>
          </label>
        </div>

        <div class="nav"><button id="next-btn" class="btn btn-primary">${pos + 1 === tasks.length ? 'Prüfung beenden & auswerten' : 'Weiter'}</button></div>
      </section>`;
  },
  setup: () => {
    const tasks = sprechenTasks();
    const t = tasks[state.sprechenPos];
    if (!t) { render('grading'); return; }
    const slot = () => (t.key === 'teil1' ? state.answers.sprechen.teil1 : state.answers.sprechen[t.key][t.i]);

    const recBtn = $('#rec-btn');
    const statusEl = $('#rec-status');
    const resultEl = $('#rec-result');
    let recording = false;

    const saveTranscript = () => {
      const ta = $('#transcript');
      if (!ta) return;
      ta.addEventListener('input', () => {
        const s = slot();
        s.transcript = ta.value;
      });
    };
    saveTranscript();

    recBtn.addEventListener('click', async () => {
      if (!recording) {
        try {
          recorder = new AnswerRecorder();
          await recorder.start({
            onInterim: (txt) => { statusEl.textContent = txt ? '“' + txt + '”' : 'Ich höre zu …'; },
          });
          recording = true;
          recBtn.textContent = '■ Aufnahme stoppen';
          recBtn.classList.add('recording');
          statusEl.textContent = 'Aufnahme läuft …';
        } catch (e) {
          statusEl.textContent = 'Mikrofon nicht verfügbar: ' + (e?.message || e);
        }
      } else {
        recBtn.disabled = true;
        const { audioUrl, transcript } = await recorder.stop();
        recording = false;
        recBtn.disabled = false;
        recBtn.textContent = '● Erneut aufnehmen';
        recBtn.classList.remove('recording');
        statusEl.textContent = 'Aufnahme gespeichert.';
        const s = slot();
        s.audioUrl = audioUrl;
        s.transcript = transcript;
        // re-render just the result block
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = `
          ${audioUrl ? `<audio controls src="${audioUrl}"></audio>` : ''}
          <label class="field"><span>Erkanntes Transkript (bei Bedarf korrigieren):</span>
          <textarea id="transcript" rows="3">${esc(transcript)}</textarea></label>`;
        saveTranscript();
      }
    });

    $('#next-btn').addEventListener('click', () => {
      if (recording && recorder) { try { recorder.stop(); } catch {} }
      if (state.sprechenPos + 1 >= tasks.length) render('grading');
      else { state.sprechenPos++; render('sprechen'); }
    });
  },
};

// ---- Grading ----
SCREENS.grading = {
  html: () => `
    <section class="card center">
      <div class="spinner"></div>
      <h2>Auswertung läuft …</h2>
      <p class="hint">Hören &amp; Lesen werden automatisch bewertet. Schreiben &amp; Sprechen bewertet die KI.</p>
    </section>`,
  setup: async () => {
    try {
      const payload = gradePayload();
      const { grade } = await api.grade(payload);
      state.grade = grade;
      state.gradeError = '';
    } catch (e) {
      state.grade = null;
      state.gradeError = String(e?.message || e);
    }
    render('results');
  },
};

function gradePayload() {
  const exam = state.exam, ans = state.answers;
  return {
    schreiben: {
      teil1: {
        scenario: exam.schreiben?.teil1?.scenario || '',
        answers: (exam.schreiben?.teil1?.fields || []).map((f, i) => ({ label: f.label, value: ans.schreiben.teil1[i] || '' })),
      },
      teil2: { scenario: exam.schreiben?.teil2?.scenario || '', points: exam.schreiben?.teil2?.points || [], text: ans.schreiben.teil2 || '' },
    },
    sprechen: {
      teil1: ans.sprechen.teil1?.transcript || '',
      teil2: (exam.sprechen?.teil2 || []).map((t, i) => ({ thema: t.thema, stichwort: t.stichwort, transcript: ans.sprechen.teil2[i]?.transcript || '' })),
      teil3: (exam.sprechen?.teil3 || []).map((t, i) => ({ bildkarte: t.bildkarte, transcript: ans.sprechen.teil3[i]?.transcript || '' })),
    },
  };
}

// ---- Results ----
SCREENS.results = {
  html: () => {
    const hoeren = scoreSection('hoeren');
    const lesen = scoreSection('lesen');
    const schreibenPct = state.grade?.schreiben?.scorePercent;
    const sprechenPct = state.grade?.sprechen?.scorePercent;
    const parts = [hoeren.percent, lesen.percent, schreibenPct, sprechenPct].filter((x) => typeof x === 'number');
    const overall = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
    const passed = overall >= 60;

    const corr = (c) => (state.grade?.schreiben?.corrections || []).map((x) => `<li><b>${esc(x.original)}</b> → <b>${esc(x.correction)}</b> <span class="hint">${esc(x.note)}</span></li>`).join('');

    const reviewHoeren = listenItems(state.exam).map((it, n) => {
      const your = state.answers.hoeren[`${it.teil}-${it.idx}`];
      const right = it.answer;
      const ok = your === right;
      const fmt = (v) => it.type === 'mc' ? (v === undefined ? '—' : `${'abc'[v]}) ${esc((it.options || [])[v] ?? '')}`) : (v === undefined ? '—' : v ? 'Richtig' : 'Falsch');
      return `<div class="review-row ${ok ? 'ok' : 'bad'}">
        <div class="rr-head">#${n + 1} · Teil ${it.teil} ${ok ? '✓' : '✗'}</div>
        <div class="rr-script"><b>Audio:</b> ${esc(it.audioScript)}</div>
        <div><b>${esc(it.question || it.statement)}</b></div>
        <div>Ihre Antwort: ${fmt(your)} · Richtig: ${fmt(right)}</div>
      </div>`;
    }).join('');

    const reviewLesen = [1, 2, 3].flatMap((teil) => (state.exam.lesen?.[`teil${teil}`] || []).map((it, idx) => {
      const your = state.answers.lesen[`${teil}-${idx}`];
      const right = it.answer;
      const ok = your === right;
      const fmt = (v) => teil === 2 ? (v === undefined ? '—' : v) : (v === undefined ? '—' : v ? 'Richtig' : 'Falsch');
      return `<div class="review-row ${ok ? 'ok' : 'bad'}">
        <div class="rr-head">Teil ${teil} ${ok ? '✓' : '✗'}</div>
        <div>${esc(it.text || it.situation)}</div>
        <div><b>${esc(it.statement || '')}</b></div>
        <div>Ihre Antwort: ${fmt(your)} · Richtig: ${fmt(right)}</div>
      </div>`;
    })).join('');

    const sprechenTasksHtml = (state.grade?.sprechen?.tasks || []).map((t) => `<li><b>${esc(t.label)}</b> — ${typeof t.scorePercent === 'number' ? t.scorePercent + '% · ' : ''}${esc(t.feedback || '')}</li>`).join('');

    return `
      <section class="card">
        <div class="result-banner ${passed ? 'pass' : 'fail'}">
          <div class="big-score">${overall}%</div>
          <div>${passed ? 'Bestanden 🎉' : 'Noch nicht bestanden'} <span class="hint">(Richtwert: 60% — Annäherung)</span></div>
        </div>

        <div class="grid4 score-grid">
          <div class="mini"><span class="mini-k">Hören</span><span>${hoeren.correct}/${hoeren.total} · ${hoeren.percent}%</span></div>
          <div class="mini"><span class="mini-k">Lesen</span><span>${lesen.correct}/${lesen.total} · ${lesen.percent}%</span></div>
          <div class="mini"><span class="mini-k">Schreiben</span><span>${typeof schreibenPct === 'number' ? schreibenPct + '%' : '—'}</span></div>
          <div class="mini"><span class="mini-k">Sprechen</span><span>${typeof sprechenPct === 'number' ? sprechenPct + '%' : '—'}</span></div>
        </div>

        ${state.gradeError ? `<p class="err-text">KI-Auswertung (Schreiben/Sprechen) fehlgeschlagen: ${esc(state.gradeError)}</p>` : ''}

        ${state.grade?.schreiben ? `<div class="fb"><h3>Schreiben — Feedback</h3><p>${esc(state.grade.schreiben.feedback)}</p>${corr() ? `<ul class="corr">${corr()}</ul>` : ''}</div>` : ''}
        ${state.grade?.sprechen ? `<div class="fb"><h3>Sprechen — Feedback</h3><p>${esc(state.grade.sprechen.feedback)}</p>${sprechenTasksHtml ? `<ul>${sprechenTasksHtml}</ul>` : ''}</div>` : ''}

        <details class="review"><summary>Hören — Lösungen ansehen</summary>${reviewHoeren}</details>
        <details class="review"><summary>Lesen — Lösungen ansehen</summary>${reviewLesen}</details>

        <div class="nav"><button id="again-btn" class="btn btn-primary">Neue Prüfung starten</button></div>
      </section>`;
  },
  setup: () => { $('#again-btn').addEventListener('click', startExam); },
};

// ---- Settings ----
SCREENS.settings = {
  html: () => {
    const c = state.config;
    return `
      <section class="card">
        <div class="sec-head"><h2>Einstellungen</h2></div>

        <h3>KI-Anbieter</h3>
        <label class="radio"><input type="radio" name="prov" value="claude" ${c.provider === 'claude' ? 'checked' : ''}> <span><b>Claude Code (CLI)</b> — nutzt Ihr vorhandenes Abo, kein API-Key nötig.</span></label>
        <label class="radio"><input type="radio" name="prov" value="deepseek" ${c.provider === 'deepseek' ? 'checked' : ''}> <span><b>DeepSeek API</b> — benötigt einen API-Key.</span></label>

        <label class="field"><span>DeepSeek API-Key ${c.hasDeepseekKey ? '<span class="hint">(gespeichert — leer lassen, um beizubehalten)</span>' : ''}</span>
          <input id="ds-key" type="password" placeholder="sk-…" /></label>
        <label class="field"><span>DeepSeek-Modell</span>
          <input id="ds-model" type="text" value="${esc(c.deepseekModel || 'deepseek-chat')}" /></label>

        <h3>Audio</h3>
        <label class="field"><span>Sprechtempo Hören: <span id="rate-val">${state.rate.toFixed(2)}×</span></span>
          <input id="rate" type="range" min="0.6" max="1.0" step="0.05" value="${state.rate}" /></label>

        <h3>Server</h3>
        <label class="field"><span>Server-URL</span>
          <input id="server-url" type="text" value="${esc(getBaseUrl())}" /></label>

        <p id="settings-msg" class="hint"></p>
        <div class="nav">
          <button id="save-settings" class="btn btn-primary">Speichern</button>
          <button id="cancel-settings" class="btn">Zurück</button>
        </div>
      </section>`;
  },
  setup: () => {
    $('#rate').addEventListener('input', (e) => { state.rate = Number(e.target.value); $('#rate-val').textContent = state.rate.toFixed(2) + '×'; });
    $('#cancel-settings').addEventListener('click', () => render(state.returnScreen));
    $('#save-settings').addEventListener('click', async () => {
      const provider = $$('input[name="prov"]').find((r) => r.checked)?.value || 'claude';
      const deepseekApiKey = $('#ds-key').value;
      const deepseekModel = $('#ds-model').value;
      const serverUrl = $('#server-url').value.trim();
      try {
        await setBaseUrl(serverUrl);
        const cfg = { provider, deepseekModel };
        if (deepseekApiKey) cfg.deepseekApiKey = deepseekApiKey;
        const res = await api.setConfig(cfg);
        state.config = { provider: res.provider, deepseekModel: res.deepseekModel, hasDeepseekKey: res.hasDeepseekKey };
        try { await chrome.storage?.local?.set?.({ rate: state.rate }); } catch {}
        $('#settings-msg').textContent = 'Gespeichert.';
        await refreshHealth();
        setTimeout(() => render(state.returnScreen), 500);
      } catch (e) {
        $('#settings-msg').textContent = 'Fehler: ' + (e?.message || e);
      }
    });
  },
};

// ====================================================================
// flow
// ====================================================================
async function startExam() {
  state.loadingMsg = 'Neue Prüfung wird erstellt …';
  state.loadingSub = 'Die KI generiert frische Aufgaben. Das kann ~10–40 Sekunden dauern.';
  render('loading');
  try {
    const { exam } = await api.generate();
    if (!exam || !exam.hoeren) throw new Error('Unerwartetes Format vom Server.');
    state.exam = exam;
    state.answers = freshAnswers(exam);
    state.grade = null;
    state.gradeError = '';
    state.listenPos = 0;
    state.sprechenPos = 0;
    render('hoeren-intro');
  } catch (e) {
    state.error = String(e?.message || e) + '\n\nIst der lokale Server gestartet (npm start)?';
    render('error');
  }
}

function openSettings() {
  if (state.screen !== 'settings') state.returnScreen = state.screen;
  api.getConfig().then((c) => { state.config = c; render('settings'); }).catch(() => render('settings'));
}

document.getElementById('settings-btn').addEventListener('click', openSettings);

// ====================================================================
// boot
// ====================================================================
(async function boot() {
  await loadBaseUrl();
  try {
    const got = await chrome.storage?.local?.get?.('rate');
    if (got && typeof got.rate === 'number') state.rate = got.rate;
  } catch {}
  try { state.config = await api.getConfig(); } catch {}
  render('home');
})();
