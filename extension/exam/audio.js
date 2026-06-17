// Text-to-speech for the listening section, using the browser's built-in
// SpeechSynthesis. We pick a German voice and speak slowly (A1 pace), and play
// each item twice — like the real test ("Sie hören den Text zweimal.").

let cachedVoices = null;

function loadVoices() {
  return new Promise((resolve) => {
    const existing = speechSynthesis.getVoices();
    if (existing && existing.length) { resolve(existing); return; }
    // Voices can load asynchronously.
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(speechSynthesis.getVoices() || []); };
    speechSynthesis.onvoiceschanged = finish;
    setTimeout(finish, 1500);
  });
}

export async function germanVoice() {
  if (!cachedVoices) cachedVoices = await loadVoices();
  const v = cachedVoices;
  return (
    v.find((x) => /de[-_]DE/i.test(x.lang)) ||
    v.find((x) => /^de\b/i.test(x.lang)) ||
    v.find((x) => /deutsch|german/i.test(x.name)) ||
    null
  );
}

export function hasGermanVoice() {
  return !!(cachedVoices && cachedVoices.some((x) => /^de/i.test(x.lang)));
}

// Up to a few German voices, so a two-speaker dialogue can use different voices.
export async function germanVoices() {
  if (!cachedVoices) cachedVoices = await loadVoices();
  const de = cachedVoices.filter((x) => /^de/i.test(x.lang));
  if (de.length) return de;
  return cachedVoices.filter((x) => /deutsch|german/i.test(x.name));
}

// Speak one chunk, resolve when it finishes (or on error so we never hang).
function speakOnce(text, { rate = 0.8, voice, pitch = 1 } = {}) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = rate;
    u.pitch = pitch;
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function cancelAudio() {
  try { speechSynthesis.cancel(); } catch {}
}

// Split a script into spoken turns, stripping speaker labels like "Sprecher 1:"
// or "Kellner:" so the TTS doesn't read the labels aloud. Only strips when the
// script clearly uses turn labels (≥2 labelled lines) — a single announcement
// (e.g. a Durchsage that starts with "Achtung:") is left untouched.
function parseTurns(script) {
  const lines = String(script || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const labelRe = /^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9 .]{0,18}):\s+(.*)$/;
  const useLabels = lines.filter((l) => labelRe.test(l)).length >= 2;
  const speakers = new Map();
  let last = 0;
  const turns = [];
  for (const line of lines) {
    const m = useLabels ? line.match(labelRe) : null;
    if (m) {
      const key = m[1].toLowerCase();
      if (!speakers.has(key)) speakers.set(key, speakers.size);
      last = speakers.get(key);
      turns.push({ text: m[2], speaker: last });
    } else {
      turns.push({ text: line, speaker: last });
    }
  }
  return turns.length ? turns : [{ text: String(script || ''), speaker: 0 }];
}

// Speak the turns in order. If two German voices exist, give each speaker a
// different voice; otherwise vary the pitch a little so they still sound distinct.
async function speakTurns(script, { rate, voices, signal }) {
  const turns = parseTurns(script);
  for (const t of turns) {
    if (signal && signal.aborted) return;
    const voice = voices.length ? voices[t.speaker % voices.length] : undefined;
    const pitch = voices.length >= 2 ? 1 : (t.speaker % 2 === 0 ? 1.05 : 0.82);
    await speakOnce(t.text, { rate, voice, pitch });
    await wait(250);
  }
}

// Play a listening item twice with the usual framing and a pause between.
// onStatus(text) lets the UI show "Wird abgespielt … (1/2)".
export async function playListeningItem(script, { rate = 0.8, onStatus, signal } = {}) {
  const voices = await germanVoices();
  const aborted = () => signal && signal.aborted;

  for (let round = 1; round <= 2; round++) {
    if (aborted()) return;
    // The "you hear it twice" hint is shown on screen only — not spoken — so the
    // audio is just the dialogue itself.
    onStatus && onStatus(`Wird abgespielt … (${round}/2) · Sie hören den Text zweimal`);
    if (round === 1) await wait(400); // short lead-in before the first play
    if (aborted()) return;
    await speakTurns(script, { rate, voices, signal });
    if (round === 1) {
      onStatus && onStatus('Kurze Pause …');
      await wait(1600);
    }
  }
  if (!aborted()) onStatus && onStatus('Wiedergabe beendet.');
}
