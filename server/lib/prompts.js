'use strict';

// Prompt builders for the two AI tasks: generate a fresh exam, and grade the
// free-text parts (writing + speaking). The exact JSON shape here is the
// contract the front-end (extension/exam/app.js) renders against — keep them
// in sync.

const EXAM_SHAPE = `{
  "hoeren": {
    "teil1": [ { "audioScript": "<ONLY the spoken dialogue/announcement (2-4 lines A1 German, e.g. 'Sprecher 1: …\\nSprecher 2: …'). Do NOT include the question text and do NOT name or list the a/b/c options. The answer must be inferable from the conversation.>", "question": "<question in German, shown on screen only>", "options": ["a", "b", "c"], "answer": 0 } ],
    "teil2": [ { "audioScript": "<ONLY the spoken announcement (Durchsage) in A1 German. Do NOT read the statement aloud.>", "statement": "<a statement in German to judge true/false, shown on screen only>", "answer": true } ],
    "teil3": [ { "audioScript": "<ONLY the spoken A1 dialogue. Do NOT include the question text and do NOT name or list the a/b/c options.>", "question": "<question in German, shown on screen only>", "options": ["a", "b", "c"], "answer": 2 } ]
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
- schreiben.teil2 ist eine SEHR kurze A1-Mitteilung: jeder der 3 Leitpunkte muss mit EINEM einfachen Satz beantwortbar sein (Gesamterwartung ca. 20–30 Wörter). Verwende einfache Alltagsanlässe (Einladung, Termin, Dank, Verspätung). KEINE komplexen/formellen oder argumentativen Aufgaben (das wäre B1).
- schreiben.teil1 ist ein einfaches Formular mit persönlichen Daten (z. B. Name, Adresse, Geburtsdatum, Telefon).
- "audioScript" ist NUR das Hörmaterial – ein natürliches Gespräch oder eine Durchsage, das vorgelesen wird.
- GANZ WICHTIG: Der "audioScript" darf die Frage NICHT wiederholen und die Antwortoptionen (a/b/c bzw. deren Werte wie "8:15 Uhr") NICHT vorlesen oder aufzählen. Frage und Optionen liest die Person nur auf dem Bildschirm; im Audio hört sie ausschließlich das Gespräch/die Durchsage.
- Beispiel richtig (audioScript für die Frage "Wie spät ist es?"): "Sprecher 1: Entschuldigung, wie spät ist es? Sprecher 2: Es ist halb neun." (NICHT die Uhrzeiten 8:15/8:30/8:45 aufzählen.)
- ZUSAMMENHANG: audioScript, Frage, Optionen und answer müssen exakt zueinander passen. Das audioScript muss die Information enthalten, mit der genau EINE Option (die richtige) eindeutig stimmt; die anderen Optionen sind plausible, aber im Audio NICHT genannte Ablenker. Prüfe vor der Ausgabe, dass die mit "answer" markierte Option wirklich der im audioScript genannten Information entspricht.
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
