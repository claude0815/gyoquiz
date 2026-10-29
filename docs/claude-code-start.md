# Startprompt für Claude Code

Diesen Text in eine neue Claude-Code-Sitzung mit dem Repository `claude0815/gyoquiz` kopieren.

---

Lies zuerst `CLAUDE.md` und `docs/SPEC-duell.md` vollständig.

Setze den Duell-Modus genau nach der Spezifikation um:

1. Lege einen Branch `duell` an.
2. Beginne mit den reinen Modulen und ihren Tests: Link-Format (encode/decode/Prüfung), Wertung (`compare`),
   deterministische Antwortreihenfolge, lokale Speicherung. Erst wenn diese Tests grün sind, baue die Oberfläche.
3. Erweitere die Oberfläche: „Duell starten“ in den Einstellungen, Namensabfrage, Verschicken per Teilen-Menü
   und „Link kopieren“, Einladungskarte für `#d=…`, Gegner-Hinweis und Spielstand nach jeder Antwort,
   Ergebnis-Banner mit Vergleichstabelle, Rückmelde-Link `#r=…`, Revanche.
4. Halte die festen Regeln aus `CLAUDE.md` ein: keine externen Anfragen, kein Server, Hash-Routing,
   Namen nur per `textContent`, Bedienung per Tastatur, 390 px Breite, hell und dunkel.
5. Hake die Akzeptanzkriterien am Ende der Spezifikation einzeln ab. Wenn etwas davon nicht erreichbar ist,
   schreib es in die Beschreibung des Pull Requests statt es stillschweigend wegzulassen.
6. Führe `npm run check` aus. Teste das Duell im Browser mit zwei getrennten Profilen (oder einem normalen und einem
   privaten Fenster), damit Herausforderer und Gegner verschiedenen lokalen Speicher haben.
7. Öffne einen Pull Request gegen `main` mit Zusammenfassung, abgehakten Akzeptanzkriterien und Screenshots
   (Einladung, Spielstand während des Spiels, Banner) in Handy- und Desktopbreite.

Frag nach, bevor du von der Spezifikation abweichst. Fragen und Inhalte in `content/fragen.yaml` bitte nicht
ändern, außer ein Test zwingt dazu.
