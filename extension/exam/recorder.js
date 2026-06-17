// Capture a spoken answer: record audio (for playback) and, in parallel, run
// the browser's German speech recognition to produce a transcript. The
// transcript is editable afterwards, so it works even if recognition is shaky.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function speechRecognitionAvailable() {
  return !!SR;
}

export class AnswerRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
    this.recognition = null;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.onInterim = null;
  }

  async start({ onInterim } = {}) {
    this.onInterim = onInterim;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.chunks = [];

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.mediaRecorder.start();

    if (SR) {
      try {
        this.recognition = new SR();
        this.recognition.lang = 'de-DE';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) this.finalTranscript += r[0].transcript + ' ';
            else interim += r[0].transcript;
          }
          this.interimTranscript = interim;
          this.onInterim && this.onInterim((this.finalTranscript + interim).trim());
        };
        this.recognition.onerror = () => { /* keep the audio; transcript may stay empty */ };
        this.recognition.start();
      } catch {
        this.recognition = null;
      }
    }
  }

  async stop() {
    const audioBlob = await new Promise((resolve) => {
      if (!this.mediaRecorder) { resolve(null); return; }
      this.mediaRecorder.onstop = () => resolve(new Blob(this.chunks, { type: 'audio/webm' }));
      try { this.mediaRecorder.stop(); } catch { resolve(null); }
    });

    if (this.recognition) { try { this.recognition.stop(); } catch {} }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());

    // Give recognition a beat to flush its last final result.
    await new Promise((r) => setTimeout(r, 250));

    const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
    const transcript = (this.finalTranscript + ' ' + this.interimTranscript).trim();
    return { audioUrl, transcript };
  }
}
