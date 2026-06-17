'use strict';

// Prompt builders for the two AI tasks: generate a fresh exam, and grade the
// free-text parts (writing + speaking). The exact JSON shape here is the
// contract the front-end (extension/exam/app.js) renders against — keep them
// in sync.

const EXAM_SHAPE = `{
  "hoeren": {
    "teil1": [ { "audioScript": "<2-4 lines of A1 German; a short dialogue or announcement; use 'Sprecher 1:'/'Sprecher 2:' for dialogues>", "question": "<question in German>", "options": ["a", "b", "c"], "answer": 0 } ],
    "teil2": [ { "audioScript": "<a short public announcement (Durchsage) in A1 German>", "statement": "<a statement in German to judge true/false>", "answer": true } ],
    "teil3": [ { "audioScript": "<a short A1 dialogue>", "question": "<question in German>", "options": ["a", "b", "c"], "answer": 2 } ]
  },
  "lesen": {
    "teil1": [ { "text": "<a very short A1 email or note in German>", "statement": "<statement in German>", "answer": true } ],
    "teil2": [ { "situation": "<an everyday situation in German, e.g. 'Sie suchen ein Restaurant.'>", "optionA": "<short ad / listing text>", "optionB": "<short ad / listing text>", "answer": "a" } ],
    "teil3": [ { "text": "<a short sign or notice in German, e.g. an opening-hours notice>", "statement": "<statement in German>", "answer": false } ]
  },
  "schreiben": {
    "teil1": { "scenario": "<a short German scenario describing a person who must fill in a form>", "fields": [ { "label": "<form field label in German>", "hint": "<what to write>" } ] },
    "teil2": { "scenario": "<a short German prompt asking to write a message, e.g. an email to a friend>", "points": ["<point 1 in German>", "<point 2>", "<point 3>"] }
  },
  "sprechen": {
    "teil1": { "instruction": "Stellen Sie sich vor.", "keywords": ["Name", "Alter", "Land", "Wohnort", "Sprachen", "Beruf", "Hobby"] },
    "teil2": [ { "thema": "<theme in German, e.g. 'Einkaufen'>", "stichwort": "<a single keyword card, e.g. 'Brot'>", "instruction": "Bilden Sie eine Frage und eine Antwort mit dem Stichwort." } ],
    "teil3": [ { "bildkarte": "<a single object on a picture card, e.g. 'Telefon'>", "instruction": "Formulieren Sie eine höfliche Bitte." } ]
  }
}`;

function buildGeneratePrompt(seed) {
  const system =
    'Du bist Prüfungsautor/in für die Prüfung "telc Deutsch A1" bzw. "Start Deutsch 1". ' +
    'Du erstellst authentische, realistische Mock-Prüfungen exakt auf CEFR-Niveau A1 (einfacher Wortschatz, ' +
    'Präsens, kurze Sätze, Alltagsthemen: Familie, Einkaufen, Wohnen, Essen, Uhrzeit, Termine, Reisen). ' +
    'Gib AUSSCHLIESSLICH gültiges JSON zurück – kein Markdown, keine Code-Fences, keine Erklärungen.';

  const prompt =
`Erstelle eine vollständige, NEUE telc-Deutsch-A1-Mock-Prüfung als JSON.

Variations-Seed (nutze ihn, damit jede Prüfung anders ist – andere Namen, Zahlen, Uhrzeiten, Orte, Themen): ${seed}

Anforderungen an die Anzahl:
- hoeren.teil1: genau 5 Aufgaben (Multiple Choice, 3 Optionen, "answer" ist der Index 0-2)
- hoeren.teil2: genau 5 Aufgaben (Richtig/Falsch, "answer" ist true/false)
- hoeren.teil3: genau 5 Aufgaben (Multiple Choice, 3 Optionen)
- lesen.teil1: genau 5 Aufgaben (Richtig/Falsch)
- lesen.teil2: genau 5 Aufgaben (Auswahl zwischen optionA und optionB, "answer" ist "a" oder "b")
- lesen.teil3: genau 5 Aufgaben (Richtig/Falsch)
- schreiben.teil1.fields: genau 5 Felder
- schreiben.teil2.points: genau 3 Punkte
- sprechen.teil2: genau 2 Karten
- sprechen.teil3: genau 2 Karten

Wichtig:
- Alle Inhalte auf Deutsch, Niveau A1.
- "audioScript" ist der gesprochene Text, der den Lernenden vorgelesen wird (er sieht ihn NICHT). Halte ihn kurz und natürlich.
- Die Fragen müssen eindeutig aus dem audioScript / Text beantwortbar sein.
- Mische die richtigen Antworten (nicht immer dieselbe Option / immer true).

Gib das JSON GENAU in dieser Struktur zurück (Arrays mit der geforderten Länge):
${EXAM_SHAPE}`;

  return { system, prompt };
}

function buildGradePrompt(payload) {
  const system =
    'Du bist erfahrene/r Prüfer/in für telc Deutsch A1. Du bewertest die schriftliche und die mündliche ' +
    'Leistung fair, aber auf A1-Niveau (kleine Fehler sind normal; bewertet wird vor allem, ob die Aufgabe ' +
    'erfüllt ist und ob man verstanden wird). Gib AUSSCHLIESSLICH gültiges JSON zurück.';

  const prompt =
`Bewerte die folgenden Antworten einer Kandidatin/eines Kandidaten in der telc-Deutsch-A1-Prüfung.

=== SCHREIBEN ===
Teil 1 (Formular ausfüllen):
Szenario: ${JSON.stringify(payload?.schreiben?.teil1?.scenario || '')}
Felder und Antworten: ${JSON.stringify(payload?.schreiben?.teil1?.answers || [])}

Teil 2 (kurze Mitteilung schreiben):
Szenario: ${JSON.stringify(payload?.schreiben?.teil2?.scenario || '')}
Geforderte Punkte: ${JSON.stringify(payload?.schreiben?.teil2?.points || [])}
Geschriebener Text: ${JSON.stringify(payload?.schreiben?.teil2?.text || '')}

=== SPRECHEN (automatische Transkripte der Aufnahme – können kleine Erkennungsfehler enthalten) ===
Teil 1 (Sich vorstellen): ${JSON.stringify(payload?.sprechen?.teil1 || '')}
Teil 2 (Fragen/Antworten): ${JSON.stringify(payload?.sprechen?.teil2 || [])}
Teil 3 (Bitten): ${JSON.stringify(payload?.sprechen?.teil3 || [])}

Bewertungsregeln:
- "scorePercent" ist eine Zahl 0-100.
- "feedback" ist 2-4 Sätze AUF ENGLISCH, damit die lernende Person es versteht; nenne konkrete deutsche Fehler.
- "corrections" listet bis zu 6 konkrete Korrekturen: { "original": "<falsch>", "correction": "<richtig>", "note": "<kurzer Hinweis auf Englisch>" }.
- Beim Sprechen: wenn ein Transkript leer ist, gib dafür 0 Punkte und weise im feedback darauf hin.

Gib GENAU diese Struktur zurück:
{
  "schreiben": { "scorePercent": 0, "feedback": "", "corrections": [ { "original": "", "correction": "", "note": "" } ] },
  "sprechen": {
    "scorePercent": 0,
    "feedback": "",
    "tasks": [ { "label": "Teil 1", "scorePercent": 0, "feedback": "" } ]
  }
}`;

  return { system, prompt };
}

module.exports = { buildGeneratePrompt, buildGradePrompt };
