# Spezifikation: Duell-Modus

Stand 29.10.2026. Die Entscheidungen unten sind mit dem Auftraggeber abgestimmt.
Was hier nicht festgelegt ist, darf bei der Umsetzung sinnvoll entschieden werden (siehe letzter Abschnitt).

## Ziel

Zwei Personen spielen **nacheinander denselben Fragensatz** in derselben Reihenfolge und vergleichen ihr Ergebnis.
Alles läuft ohne Server: Die Herausforderung und das Ergebnis reisen **im Link** mit.

## Entscheidungen

| Thema | Entscheidung |
| --- | --- |
| Spielmodus | Asynchron, nacheinander per Link. Kein Live-Modus, kein Server, keine Konten. |
| Mitspieler | 1 gegen 1. Die herausgeforderte Person kann ihr Ergebnis per **Rückmelde-Link** zurückschicken. |
| Wertung | Mehr richtige Antworten gewinnt. Bei gleich vielen richtigen gewinnt die **kürzere Gesamtzeit**. Exakt gleiche Zeit (auf 0,1 s) ist unentschieden. |
| Spannung | Die herausgeforderte Person sieht **nach jeder eigenen Antwort**, ob der Gegner diese Frage richtig hatte, dazu einen laufenden Spielstand. Am Ende ein Banner „Gewonnen“, „Verloren“ oder „Unentschieden“. |
| Teilen | **Teilen-Menü** des Geräts (Web Share API, falls vorhanden) und **Link kopieren**. Kein QR-Code. |
| Zielgruppe | Lehrkräfte und Schulleitungen, Ansprache „du“. |

## Rollen und Begriffe

- **A** – Herausforderer: spielt zuerst und verschickt die Herausforderung.
- **B** – Herausgeforderte Person: öffnet den Link und spielt dieselben Fragen.
- **Herausforderungs-Link**: `#d=<payload>` – enthält Fragen, Seed und das Ergebnis von A.
- **Rückmelde-Link**: `#r=<payload>` – enthält zusätzlich das Ergebnis von B.

## Ablauf

### 1. A erstellt eine Herausforderung

1. In den Einstellungen gibt es neben „Runde starten“ einen zweiten Button **„Duell starten“**.
   Er nutzt die aktuelle Auswahl (Verordnung, Abschnitte, nur Fallfragen). Fragenzahl 10, 20 oder 40;
   ist „Alle“ gewählt, wird für das Duell 40 verwendet und das im Button angezeigt („Duell starten · 40 Fragen“).
   „Unsicheres bevorzugen“ gilt im Duell nicht (Fragen werden gleichverteilt gezogen).
2. Vor dem Start fragt ein kleines Formular den **Namen** ab (Pflicht, 1–24 Zeichen nach `trim()`).
   Hinweis darunter: „Wird im Link mitgeschickt. Vorname oder Kürzel reicht.“ Der Name wird lokal als
   Vorbelegung gespeichert.
3. Das Spiel läuft wie im Lernmodus (Erklärung nach jeder Frage bleibt). Pro Frage wird die Antwortzeit gemessen
   (`RoundItem.ms` gibt es schon). Statt „Runde beenden“ heißt der Link **„Duell aufgeben“** und braucht eine
   Bestätigung direkt auf der Seite (kein `confirm()`); unbeantwortete Fragen zählen dann als falsch mit
   Höchstzeit.
4. Am Ende kommt die normale Auswertung plus ein Bereich **„Herausforderung verschicken“**:
   - Text: „Schick diesen Link an die Person, die du herausfordern willst. Dein Ergebnis wird erst nach und nach aufgedeckt.“
   - Button **„Teilen …“** nur, wenn `navigator.share` existiert.
   - Button **„Link kopieren“** (`navigator.clipboard.writeText` im Klick-Handler; bei Fehler den Link im
     Textfeld markieren und „Bitte manuell kopieren“ anzeigen). Statusmeldung in einer `aria-live`-Region:
     „Link kopiert“.
   - Schreibgeschütztes Textfeld mit dem Link.
   - Teilen-Text, **ohne** Punktzahl: „{A} fordert dich zum GyO-VO & AP-V Quiz heraus: {n} Fragen. Schaffst du mehr?“
5. Die ausgehende Herausforderung wird lokal unter „Meine Duelle“ gespeichert (siehe unten).

### 2. B nimmt die Herausforderung an

1. Beim Öffnen von `#d=…` erscheint statt der Einstellungen eine **Einladungskarte**:
   „{A} fordert dich heraus“, Anzahl Fragen, Auswahl in Kurzform (z. B. „GyO-VO und AP-V, 14 Abschnitte“),
   Spielregel („Mehr richtige Antworten gewinnt, bei Gleichstand die kürzere Zeit“), Namensfeld, Button
   **„Duell starten“** und ein Link **„Lieber frei üben“** (leert den Hash).
2. B spielt **dieselben Fragen in derselben Reihenfolge mit derselben Antwortreihenfolge** wie A.
3. Nach jeder Antwort von B erscheint zusätzlich zur normalen Rückmeldung:
   - ein Hinweis „**{A} hatte das richtig**“ bzw. „**{A} lag hier falsch**“ (optional mit Zeit von A),
   - der laufende Spielstand „**Du 7 : 6 {A}**“, gezählt nur bis zur aktuellen Frage.
   Vor der Antwort verrät die Oberfläche nichts über das Ergebnis von A.
4. Am Ende ein **Banner**:
   - Gewonnen: „Gewonnen! 14 : 12 gegen {A}“
   - Verloren: „Verloren. 12 : 14 gegen {A}“
   - Gleichstand bei richtigen Antworten: „Gewonnen! 13 : 13, du warst 41,2 s schneller“ bzw. „Verloren …“
   - Unentschieden nur bei exakt gleicher Gesamtzeit.
   Darunter eine **Vergleichstabelle** je Frage (Kurztext, ✓/✗ für beide, optional Zeiten) und die Liste der
   eigenen falschen Antworten wie im Lernmodus.
5. Aktionen: **„Ergebnis an {A} zurückschicken“** (Teilen/Kopieren des Rückmelde-Links, gleiche Bedienelemente
   wie oben), **„Revanche“** (startet als Herausforderer ein neues Duell mit derselben Auswahl und neuen Fragen),
   **„Frei üben“**.
6. **Nur ein Versuch pro Gerät:** Hat B dieses Duell auf diesem Gerät schon beendet, zeigt `#d=…` direkt das
   Ergebnis mit dem Rückmelde-Link statt einer neuen Runde. Ein laufendes Duell überlebt ein Neuladen der Seite.
7. Öffnet A den eigenen Herausforderungs-Link (Duell-ID ist lokal als „ausgehend“ bekannt), erscheint der Hinweis
   „Das ist deine eigene Herausforderung“ und erneut der Bereich zum Verschicken.

### 3. A öffnet den Rückmelde-Link

- `#r=…` zeigt das Ergebnis **aus Sicht von A**, wenn die Duell-ID lokal als „ausgehend“ bekannt ist
  („Du hast gegen {B} gewonnen“). Sonst eine neutrale Ansicht („{A} gegen {B}: 14 : 12“).
- Vergleichstabelle und Button „Revanche“.
- Das Ergebnis wird in „Meine Duelle“ gespeichert.

### 4. Meine Duelle (soll, nicht muss)

Auf der Einstellungsseite eine kompakte Liste der letzten 10 Duelle dieses Geräts: Gegner, Datum, Stand
(„wartet auf {B}“, „gewonnen 14 : 12“, …) mit Link zum Ergebnis bzw. zum erneuten Verschicken.

## Link-Format

- Basis-URL: `location.origin + location.pathname` (funktioniert unter `/gyoquiz/` und mit eigener Domain).
- Nur das **Hash-Fragment** trägt Daten, nie Query-Parameter. So landet nichts in Server-Logs, und
  GitHub Pages liefert immer `index.html`.
- `#d=<payload>` für Herausforderungen, `#r=<payload>` für Rückmeldungen.
- `payload` = base64url (ohne `=`-Padding) von UTF-8-JSON mit kurzen Schlüsseln:

```ts
interface DuelPlayer {
  n: string;   // Name, 1–24 Zeichen
  r: string;   // Ergebnis je Frage als Zeichenkette aus "1" (richtig) und "0" (falsch), Länge = q.length
  t: number[]; // Antwortzeit je Frage in Zehntelsekunden, ganzzahlig, 0–9999 (max. 999,9 s)
}

interface DuelPayload {
  v: 1;          // Version des Linkformats
  k: number;     // katalog.version beim Erstellen (nur zur Information/Fehlermeldung)
  id: string;    // Duell-ID, 8 Zeichen [a-z0-9], zufällig
  s: number;     // Seed (uint32) für die Antwortreihenfolge
  q: string[];   // Fragen-IDs in Spielreihenfolge, 5–40 Stück, eindeutig
  a: DuelPlayer; // Herausforderer
  b?: DuelPlayer;// nur im Rückmelde-Link
  c: string;     // Prüfsumme: hashString(JSON ohne c) in Basis 36, die ersten 6 Zeichen
}
```

- **Antwortreihenfolge** je Frage deterministisch, unabhängig von der Position:
  `shuffle([0, 1, 2, 3], seededRng(hashString(`${s}:${questionId}`)))` – die Bausteine liegen in `src/rng.ts`,
  `createRound(questions, orderFor)` in `src/engine.ts` nimmt die Funktion entgegen.
- **Länge:** Ein Rückmelde-Link mit 40 Fragen muss unter 2000 Zeichen bleiben (Test).
- **Prüfung beim Einlesen** mit verständlichen Fehlermeldungen statt Absturz:
  - ungültiges base64/JSON oder falsche Prüfsumme → „Der Link ist unvollständig oder beschädigt. Bitte den ganzen Link erneut kopieren.“
  - `v` unbekannt → „Dieser Link stammt aus einer neueren Version. Bitte die Seite neu laden.“
  - unbekannte Fragen-ID → „Dieser Link passt nicht zum aktuellen Fragenkatalog.“ (ausgemusterte Fragen sind über
    `questionById` weiterhin auffindbar und dürfen gespielt werden)
  - Längen von `r`/`t` passen nicht zu `q`, doppelte IDs, Name leer oder zu lang → wie „beschädigt“.
- Namen werden nur per `textContent` angezeigt.

## Wertung

```ts
type Outcome = 'win' | 'loss' | 'draw'; // aus Sicht der vergleichenden Person
function compare(me: DuelPlayer, other: DuelPlayer): { outcome: Outcome; myCorrect: number; otherCorrect: number; timeDiffTenths: number };
```

1. Mehr richtige Antworten gewinnt.
2. Bei Gleichstand gewinnt die kleinere Summe von `t`.
3. Exakt gleiche Summe: unentschieden.

Zeitmessung von der Anzeige der Frage bis zum Klick, ohne Pause bei Tab-Wechsel; Obergrenze 999,9 s pro Frage.

## Lokale Speicherung

`localStorage` über `src/storage.ts`, Schlüssel `gyoquiz:duels:v1`:

```ts
interface StoredDuel {
  id: string;
  role: 'challenger' | 'opponent';
  payload: DuelPayload;          // zuletzt bekannter Stand (mit b, sobald vorhanden)
  inProgress?: Round;            // laufende Runde, damit Neuladen nicht alles verliert
  finishedAt?: string;           // ISO-Zeitstempel
}
```

Der Lernstand (`gyoquiz:stats:v1`) wird auch durch Duell-Antworten aktualisiert.
Höchstens 50 Duelle speichern, älteste zuerst verwerfen.

## Grenzen (bewusst akzeptiert)

- **Kein Schutz gegen Manipulation.** Der Link ist nur kodiert, nicht verschlüsselt; wer will, kann Ergebnisse
  ändern oder die Lösungen im Quelltext finden. Die Prüfsumme erkennt nur beschädigte Links. Für ein Spiel unter
  Kolleginnen und Kollegen reicht das.
- Das Ergebnis von A steckt im Link und ist für Neugierige vorab dekodierbar. Die Oberfläche deckt es trotzdem
  erst nach jeder Antwort auf.
- Datenschutz: Namen stehen nur im Link und im eigenen Browser. Keine Server, kein Tracking.

## Umsetzungshinweise

- Neue reine Module, z. B. `src/duel/link.ts` (encode/decode/validate), `src/duel/score.ts` (compare),
  `src/duel/store.ts` (lokale Duelle). UI-Erweiterungen in `src/ui.ts` oder einem eigenen `src/duel/ui.ts`.
- Hash beim Laden und bei `hashchange` auswerten. Nach Spielende den Hash stehen lassen, damit Neuladen das
  Ergebnis zeigt. „Frei üben“ setzt `location.hash = ''`.
- Die bestehenden Ansichten wiederverwenden; Einladungskarte und Banner als neue Bereiche in `index.html`.
- Gestaltung mit den vorhandenen Tokens; Sieg/Niederlage mit `--ok`/`--bad`, nicht nur über Farbe
  (Text und Symbol).

## Tests (Pflicht)

- Roundtrip: `encode → decode` für Herausforderung und Rückmeldung ergibt dasselbe Objekt.
- Prüfsumme: ein geändertes Zeichen und ein abgeschnittener Link werden erkannt.
- Unbekannte Fragen-ID, falsche Längen, doppelte IDs, leerer/zu langer Name → definierte Fehler.
- Antwortreihenfolge: für beide Spieler gleich, für verschiedene Seeds verschieden, je Frage eine Permutation von 0–3.
- `compare`: mehr richtige gewinnt; Gleichstand → schneller gewinnt; exakt gleich → unentschieden; Sicht von A und B
  sind spiegelbildlich.
- Link-Länge mit 40 Fragen und langen Namen < 2000 Zeichen.
- Ausgemusterte Frage im Link wird aufgelöst.

## Akzeptanzkriterien

- [ ] A kann aus den Einstellungen ein Duell mit 10, 20 oder 40 Fragen starten, spielen und danach den Link teilen oder kopieren.
- [ ] Der Teilen-Text verrät keine Punktzahl.
- [ ] B sieht eine Einladung mit Name von A, Fragenzahl und Regel, gibt einen Namen ein und spielt exakt dieselben Fragen mit derselben Antwortreihenfolge.
- [ ] Nach jeder Antwort von B erscheinen „{A} hatte das richtig/lag falsch“ und der laufende Spielstand, vorher nichts.
- [ ] Am Ende steht ein eindeutiges Banner; bei gleicher Trefferzahl entscheidet die Zeit, mit Angabe der Differenz.
- [ ] B kann einen Rückmelde-Link teilen/kopieren; A sieht damit das Ergebnis aus seiner Sicht.
- [ ] Ein zweites Öffnen des Herausforderungs-Links auf demselben Gerät startet kein neues Spiel.
- [ ] Neuladen mitten im Duell setzt an derselben Frage fort.
- [ ] Beschädigte oder unpassende Links zeigen eine verständliche Meldung und einen Weg zurück zum Lernmodus.
- [ ] Funktioniert bei 390 px Breite, mit Tastatur, hell und dunkel; keine Anfragen an fremde Hosts.
- [ ] `npm run check` grün, neue Logik mit Tests.

## Nicht Teil dieses Auftrags

Live-Spiel, Gruppen und Ranglisten, QR-Code, Server oder Datenbank, Konten, Schutz gegen Manipulation.

## Darf bei der Umsetzung entschieden werden

- Genaue Gestaltung von Einladungskarte, Banner und Vergleichstabelle (im Stil der bestehenden Seite).
- Ob die Zeit von A pro Frage angezeigt wird.
- Ob „Meine Duelle“ in diesem Schritt kommt oder später.
- Interne Modulaufteilung und Benennungen.
