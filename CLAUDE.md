# CLAUDE.md – GyO-VO & AP-V Quiz

Statische Web-App (Vite + TypeScript), die auf GitHub Pages läuft: ein Multiple-Choice-Quiz zur
**Verordnung über die Gymnasiale Oberstufe (GyO-VO)** und zur **Verordnung über die Abiturprüfung (AP-V)**
im Land Bremen. Zielgruppe sind **Lehrkräfte und Schulleitungen**. Oberfläche und Inhalte sind deutsch,
Ansprache mit „du“ (Spiel unter Kolleginnen und Kollegen).

**Aktueller Auftrag:** den Duell-Modus nach [`docs/SPEC-duell.md`](docs/SPEC-duell.md) umsetzen.

## Befehle

```bash
npm ci              # Abhängigkeiten installieren (exakte Versionen aus package-lock.json)
npm run dev         # Entwicklungsserver, http://localhost:5173
npm test            # Vitest: Fragenkatalog, Abdeckung, Rechenfragen, Logik
npm run typecheck   # tsc (TypeScript 7, strict)
npm run build       # Typprüfung + Produktionsbuild nach dist/
npm run check       # alles zusammen; muss vor jedem Commit grün sein
```

`.npmrc` setzt `legacy-peer-deps=true`. Ohne das stürzt npm 10 beim Auflösen der optionalen
Peer-Abhängigkeiten von Vitest 5 ab (`Cannot read properties of null (reading 'edgesOut')`). Nicht entfernen.

## Aufbau

```
content/fragen.yaml      Fragenkatalog (Daten, von Menschen gepflegt) – Metadaten, Abschnitte, Glossar, Fragen
src/catalogue.ts         Lädt und prüft die YAML-Daten, Typen (Question, Section …), questionById, paragraphKey
src/engine.ts            Reine Logik: Runde, Antworten, Zeiten, Auswertung, Fragenauswahl, Lernstand
src/rng.ts               Seeded Zufall (mulberry32), hashString, shuffle – Grundlage für reproduzierbare Duelle
src/storage.ts           localStorage-Wrapper (wirft nie)
src/ui.ts                DOM-Rendering der drei Ansichten: Einstellungen, Frage, Ergebnis
src/main.ts              Einstieg: Schriften, CSS, startApp()
src/styles.css           Design-Tokens (hell/dunkel über prefers-color-scheme) und Komponenten
tests/*.test.ts          Vitest
docs/SPEC-duell.md       Spezifikation Duell-Modus
.github/workflows/       Build, Tests und Deployment auf GitHub Pages
```

Der YAML-Katalog wird über ein kleines Vite-Plugin in `vite.config.ts` als JSON-Modul importiert;
dadurch funktioniert er im Build und in den Tests gleich.

## Feste Regeln

- **Keine externen Anfragen zur Laufzeit.** Kein CDN, keine Google Fonts, kein Analytics, keine Cookies.
  Schriften kommen aus `@fontsource*` und werden gebündelt. Hintergrund: DSGVO, Nutzung im Schulkontext.
- **Kein Server.** Alles läuft im Browser. Zustand nur in `localStorage` über `src/storage.ts`.
  Daten zwischen Personen werden ausschließlich über den Link (Hash-Fragment) übertragen.
- **Routing nur über `location.hash`** (z. B. `#d=…`). GitHub Pages liefert für andere Pfade 404.
- **`base: './'`** in `vite.config.ts` bleibt relativ, damit die Seite unter `/gyoquiz/` und unter eigener Domain läuft.
- Fremdtext (Namen aus Links, Katalogtexte) nur über `textContent` oder die `esc()`-Hilfe in `ui.ts` ins DOM.
- Reine Logik gehört in testbare Module ohne DOM-Zugriff (wie `engine.ts`). Neue Logik bekommt Tests.
- Barrierefreiheit beibehalten: sichtbarer Fokus, Tastatursteuerung (1–4, Enter), `aria-live` für Rückmeldungen,
  Buttons statt klickbarer `div`s.
- Muss bei 390 px Breite ohne horizontales Scrollen funktionieren, in hellem und dunklem Modus.
  Farben nur über die Tokens in `styles.css`.

## Fragenkatalog pflegen (`content/fragen.yaml`)

- **IDs sind dauerhaft.** `g001…` für GyO-VO, `a001…` für AP-V. Nie ändern, nie neu vergeben,
  denn Duell-Links speichern IDs. Neue Fragen bekommen die nächste freie Nummer.
- Ändert sich bei einer bestehenden Frage die **richtige Antwort**, wandert die alte Fassung unverändert unter
  `ausgemustert:` und die neue Fassung bekommt eine neue ID. Tippfehler und Umformulierungen ohne
  Bedeutungsänderung dürfen in place korrigiert werden.
- Nach jeder inhaltlichen Änderung `katalog.version` um 1 erhöhen.
- `richtig` ist die korrekte Antwort, `falsch` hat genau drei Ablenker. Die App mischt die Reihenfolge.
  Kommazahlen als Antwort in Anführungszeichen setzen (`"2,4"`).
- `fundstelle` beginnt mit `§ <Nr>` oder `Anlage <Nr>` und muss zu den `paragraphen` des Abschnitts passen.
- `fall: true` für Fall- und Rechenfragen.
- **Jede Frage muss für sich verständlich sein**, ohne den Abschnittsnamen. Fallfragen nennen Situation,
  Verordnung bzw. Anlage und was gefragt ist (z. B. „fünffache Wertung“, „Gesamtergebnis der Qualifikationsphase“).
- Keine unerklärten Abkürzungen: `JWS`, `PF`, `AF`, `MSA` sind verboten (Test prüft das).
  LK, GK, E-Phase, Q-Phase, Block I/II sind erlaubt und stehen im `glossar`.
- Inhalte immer gegen den Verordnungstext prüfen (Quellen in `verordnungen[].quelle`). Rechenfragen zu den
  Anlagen werden in `tests/rechenfragen.test.ts` unabhängig nachgerechnet; neue Rechenfragen dort ergänzen.
- Die Tests prüfen u. a.: eindeutige IDs, vier verschiedene Antworten, Abdeckung jedes Paragraphen und jeder Anlage.

Die Verordnungen sind amtliche Werke im Sinne von § 5 UrhG; Zitate sind unproblematisch.

## Fertig heißt

1. `npm run check` ist grün.
2. Im Browser (`npm run dev`) bei 390 px und ~1100 px Breite, hell und dunkel angesehen.
3. Keine Konsolenfehler, keine Netzwerkanfragen an fremde Hosts.
4. Änderungen per Pull Request; `main` wird automatisch auf GitHub Pages veröffentlicht.

## Deployment

Push auf `main` → GitHub Actions (`.github/workflows/deploy.yml`) → Typprüfung, Tests, Build →
GitHub Pages. Pull Requests werden nur gebaut und getestet, nicht veröffentlicht.
In den Repository-Einstellungen muss unter *Settings → Pages → Build and deployment* die Quelle
**GitHub Actions** gewählt sein.
