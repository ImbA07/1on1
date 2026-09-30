# 1on1

Taktisches Mittelalter-Duell im Browser. Link teilen, 1 gegen 1.
Das ganze Konzept steht in [KONZEPT.md](KONZEPT.md).

**Stand:** Spielbarer Kern. Man kann einen Raum erstellen, den Link teilen und sich in der Burghof-Arena duellieren (Angriff und Block aus drei Richtungen, Ausdauer, Trefferzonen, versteckte Lebenspunkte, Runden). Es gibt auch ein **Training gegen eine Puppe**, damit man alleine üben kann. Die Kampf-Animationen der Figuren fehlen noch.

## Steuerung

| Taste | Aktion |
|---|---|
| W A S D | Bewegen |
| Shift | Rennen (kostet Ausdauer) |
| Maus | Umschauen (erst ins Bild klicken) |
| Linke Maustaste halten | Ausholen. Dabei die Maus nach **oben / links / rechts** bewegen (auch kurz davor), um die Richtung zu wählen. **Loslassen = zuschlagen** |
| Rechte Maustaste halten | Blocken. Die Maus wählt die Richtung, aus der du den Schlag erwartest |
| Block-Taste beim Ausholen | Finte (Angriff abbrechen, kostet Ausdauer) |
| Mausrad-Klick | Fokus auf den Gegner an/aus |
| Esc | Menü |

**Wichtig beim Blocken:** Du musst die Seite decken, auf der du das Schwert des Gegners auf deinem Bildschirm siehst. Greift er von *seiner* linken Seite an, kommt der Schlag bei dir von *rechts*. Die orange Markierung am Ring zeigt dir aktuell die richtige Block-Richtung. Blockst du erst ganz kurz vor dem Treffer, ist es ein **Perfect Block**: Der Angreifer taumelt und du verlierst keine Ausdauer.

Die Kamera dreht sich beim Ausholen und Blocken normal weiter. Die Richtung ergibt sich aus der letzten deutlichen Mausbewegung: nach oben = oben, nach links = links, nach rechts = rechts. Steht die Maus still, bleibt die letzte Richtung. Mit dem Fokus auf den Gegner (Mausrad-Klick) folgt die Kamera dem Gegner selbst, und die Maus wählt nur noch die Richtung. Die Richtungsanzeige sitzt um die Bildmitte.

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
