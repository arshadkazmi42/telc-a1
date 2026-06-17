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

// Speak one chunk, resolve when it finishes (or on error so we never hang).
function speakOnce(text, { rate = 0.8, voice } = {}) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = rate;
    u.pitch = 1;
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

// Play a listening item twice with the usual framing and a pause between.
// onStatus(text) lets the UI show "Wird abgespielt … (1/2)".
export async function playListeningItem(script, { rate = 0.8, onStatus, signal } = {}) {
  const voice = await germanVoice();
  const aborted = () => signal && signal.aborted;

  for (let round = 1; round <= 2; round++) {
    if (aborted()) return;
    onStatus && onStatus(`Wird abgespielt … (${round}/2)`);
    if (round === 1) {
      await speakOnce('Sie hören den Text jetzt. Sie hören den Text zweimal.', { rate, voice });
      await wait(500);
    }
    if (aborted()) return;
    await speakOnce(script, { rate, voice });
    if (round === 1) {
      onStatus && onStatus('Kurze Pause …');
      await wait(1600);
    }
  }
  if (!aborted()) onStatus && onStatus('Wiedergabe beendet.');
}
