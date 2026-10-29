# GyO-VO & AP-V Quiz

Multiple-Choice-Quiz zur **Verordnung über die Gymnasiale Oberstufe (GyO-VO)** und zur
**Verordnung über die Abiturprüfung im Lande Bremen (AP-V)** – für Lehrkräfte und Schulleitungen.

**Seite:** https://claude0815.github.io/gyoquiz/

- 399 Fragen, die jeden Paragraphen und jede Anlage beider Verordnungen abdecken
- Filter nach Verordnung, Abschnitt und Fall-/Rechenfragen
- Erklärung mit Fundstelle nach jeder Antwort, Auswertung in Notenpunkten
- Lernstand pro Gerät, „Unsicheres bevorzugen“, „Falsche wiederholen“
- In Arbeit: **Duell per Link** (siehe [`docs/SPEC-duell.md`](docs/SPEC-duell.md))

Die Seite lädt nichts von fremden Servern (auch keine Schriften) und speichert nur im eigenen Browser.

## Fragen bearbeiten

Alle Fragen stehen in [`content/fragen.yaml`](content/fragen.yaml). Eine Frage sieht so aus:

```yaml
  - id: a223
    abschnitt: apv-anlagen
    fundstelle: Anlage 2
    fall: true
    frage: Eine Abiturientin schreibt in ihrem 2. Prüfungsfach 9 Punkte …
    richtig: "50"
    falsch:
      - "53"
      - "45"
      - "57"
    erklaerung: "Schriftlich und mündlich werden 2:1 verrechnet: (2 × 9 + 12) ÷ 3 = 10, fünffach gewertet 50 Punkte."
```

Die wichtigsten Regeln (vollständig in [`CLAUDE.md`](CLAUDE.md)):

- Die `id` nie ändern oder wiederverwenden; neue Fragen bekommen die nächste freie Nummer.
- Ändert sich die richtige Antwort einer Frage, die alte Fassung nach `ausgemustert:` verschieben und die neue mit neuer `id` anlegen.
- Nach jeder inhaltlichen Änderung `katalog.version` erhöhen.
- Jede Frage muss ohne weiteren Zusammenhang verständlich sein.

Nach einem Push auf `main` prüfen automatische Tests den Katalog (Format, Abdeckung aller Paragraphen,
Nachrechnen der Tabellenfragen). Schlägt ein Test fehl, wird die Seite nicht aktualisiert.

## Lokal starten

Voraussetzung: Node.js 22 (siehe `.nvmrc`).

```bash
npm ci
npm run dev     # http://localhost:5173
npm run check   # Typprüfung, Tests, Build
```

## Veröffentlichung

GitHub Actions baut und testet jeden Push; Pushes auf `main` werden auf GitHub Pages veröffentlicht.
Einmalig nötig: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.

## Weiterentwickeln mit Claude Code

[`CLAUDE.md`](CLAUDE.md) beschreibt Aufbau und Regeln, [`docs/SPEC-duell.md`](docs/SPEC-duell.md) den nächsten
Auftrag. Einen fertigen Startprompt gibt es in [`docs/claude-code-start.md`](docs/claude-code-start.md).

## Quellen

- [Verordnung über die Gymnasiale Oberstufe (GyO-VO) vom 1. August 2005](https://www.transparenz.bremen.de/metainformationen/verordnung-ueber-die-gymnasiale-oberstufe-gyo-vo-vom-1-august-2005-130143?asl=bremen02.c.732.de&template=20_gp_ifg_meta_detail_d), letzte berücksichtigte Änderung vom 25.04.2019
- [Verordnung über die Abiturprüfung im Lande Bremen (AP-V) vom 11. März 2022](https://www.transparenz.bremen.de/metainformationen/verordnung-ueber-die-abiturpruefung-im-lande-bremen-ap-v-vom-11-maerz-2022-192657?asl=bremen203_tpgesetz.c.55340.de&template=20_gp_ifg_meta_detail_d), letzte berücksichtigte Änderung vom 19.04.2023
- Arbeitszeiten der schriftlichen Prüfung zusätzlich abgeglichen mit Mitteilung Nr. 221/2024 der Senatorin für Kinder und Bildung

Das Quiz ersetzt nicht den Verordnungstext; bei Abweichungen gilt die amtliche Fassung.
Vor einer breiten Veröffentlichung bitte prüfen, ob für die Seite ein Impressum nötig ist.
