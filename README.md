# 1on1

Taktisches Mittelalter-Duell im Browser. Link teilen, 1 gegen 1.
Das ganze Konzept steht in [KONZEPT.md](KONZEPT.md).

**Stand:** Erster Baustein (Verbindung + Bewegung). Man kann einen Raum erstellen, den Link teilen und sich als Figur in der Burghof-Arena bewegen (gehen, rennen, Kamera, Fokus auf den Gegner). Der eigentliche Kampf kommt als Nächstes.

## Steuerung

| Taste | Aktion |
|---|---|
| W A S D | Bewegen |
| Shift | Rennen (kostet Ausdauer) |
| Maus | Umschauen (erst ins Bild klicken) |
| Mausrad-Klick | Fokus auf den Gegner an/aus |
| Esc | Menü |

## Lokal starten (Entwicklung)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Dann im Browser `http://localhost:5173` öffnen. Für den zweiten Spieler einen zweiten Tab oder ein Inkognito-Fenster mit dem Einladungslink nehmen.

## Wie alles zusammenhängt

- `src/client/` läuft im Browser: 3D-Grafik (Three.js), Steuerung, Menüs.
- `src/server/` läuft auf dem Server: Räume, Einladungslinks, Bewegung. **Der Server entscheidet**, was passiert, damit niemand schummeln kann.
- `src/shared/` wird von beiden benutzt: Bewegungsregeln und Nachrichtenformat.

## Prüfen

```bash
npm test          # automatische Tests
npm run typecheck # Code-Prüfung
```

## Online stellen

Für kostenloses Hosting liegt eine Vorlage für [Render](https://render.com) bei (`render.yaml`). Den Server baut und startet man mit:

```bash
npm run build
npm start
```

Kostenlose Server "schlafen" nach einiger Zeit ohne Besucher. Der erste Aufruf des Links kann dann bis zu einer Minute dauern. Am besten öffnest du den Link kurz, bevor deine Freunde kommen.
