# 1on1 – Konzept (Arbeitstitel)

Ein taktisches Mittelalter-Duell im Browser. Link teilen, Freund klickt drauf, 1 gegen 1.
Langsam, überlegt und hart: Jede Waffe und jede Rüstung verändert, wie schnell und wie verwundbar du bist.

---

## 1. Eckdaten

| Punkt | Entscheidung |
|---|---|
| Spielmodus | 1 gegen 1, Online |
| Plattform | PC / Laptop im Browser (keine Installation) |
| Grafik | 3D, Low-Poly-Stil |
| Kampf | Echtzeit, aber bewusst langsam (Ausdauer, Wucht, Timing) |
| Steuerung | Maus: Richtungs-Angriffe und Richtungs-Blocks |
| Schaden | Trefferzonen (Kopf, Torso, Arme, Beine) |
| Dauer | ca. 3 bis 5 Minuten pro Kampf |
| Beitritt | Raum-Link, kein Account nötig |
| Ausrüstung | Waffe und Rüstung geheim wählen, dann Enthüllung. Frei wählbar, kein Punkte-Budget |
| Kamera | Über der Schulter, freie Kamera, Lock-on auf den Gegner per Mausrad-Klick |
| Gewalt | Realistisch: viel Blut, sichtbar beschädigte Rüstung (kein Abtrennen von Gliedmaßen) |

**Grundidee in einem Satz:** Wer schwere Rüstung trägt, hält mehr aus, ist aber langsamer, und wer langsam ist, muss den Gegner lesen statt ihn zu überrumpeln.

---

## 2. Spielablauf

1. **Raum erstellen:** Spieler A drückt auf „Spiel erstellen", gibt sich einen Namen und stellt die Regeln ein.
2. **Link teilen:** Das Spiel gibt einen Link (z. B. `…/raum/AB12`). Den schickt A an den Freund.
3. **Beitreten:** Spieler B öffnet den Link, gibt seinen Namen ein und ist im Raum.
4. **Ausrüstung wählen (geheim):** Beide wählen Waffe, Rüstung und optional die Wurfaxt. Der andere sieht nur „bereit", nicht was gewählt wurde. **Das passiert vor jeder Runde neu**, man kann sich also nach einer Niederlage anpassen.
5. **Enthüllung:** Die Wahl wird gleichzeitig gezeigt, kurzer Countdown.
6. **Kampf:** Runde beginnt in der gewählten Arena.
7. **Rundenende:** Wer keine Lebenspunkte mehr hat, bekommt noch die „Letzte Chance" (siehe 4.7). Danach ist die Runde entschieden.
8. **Sieg:** Wer zuerst die eingestellte Zahl an Runden gewonnen hat, gewinnt. Danach gibt es einen **Ergebnis-Bildschirm mit Statistik** (Sieger, Runden, getroffene Zonen, verursachter Schaden) und einen Revanche-Knopf.

Verlässt jemand den Raum mitten im Kampf, ist die Runde für den anderen gewonnen. Bei kurzem Verbindungsabbruch (bis ca. 15 Sekunden) wird der Kampf pausiert.

---

## 3. Lobby-Einstellungen (vom Ersteller wählbar)

- **Anzahl Runden:** 1, 3 (Best of 3) oder 5 (Best of 5). Standard: 3.
- **Arena:** Beide Spieler stimmen ab. Bei Uneinigkeit entscheidet der Zufall.
- **Gleiche Ausrüstung erzwingen:** An = beide müssen dieselbe Waffe und Rüstung nehmen (reiner Können-Vergleich). Aus = freie Wahl.
- **Schaden-Regeln:**
  - *Realistisch:* wenig Lebenspunkte, Treffer tun richtig weh, Kämpfe sind kürzer.
  - *Standard:* ausgewogen.
  - *Arcade:* viele Lebenspunkte, längere Kämpfe.

---

## 4. Kampfsystem

### 4.1 Angreifen und Blocken (Richtungssystem)

Es gibt **drei Richtungen**: **oben**, **links**, **rechts**.

- **Angriff:** Linke Maustaste gedrückt halten (Ausholen), dabei die Maus in eine Richtung bewegen, loslassen = Schlag aus dieser Richtung.
- **Block:** Rechte Maustaste halten, Maus zeigt die Richtung, aus der du den Schlag erwartest. Nur die **richtige Richtung** blockt.
- **Angriffsphasen:** Ausholen → Schlag → Erholung. Beim Ausholen kann man die Richtung noch wechseln (kostet Zeit und Ausdauer) oder abbrechen (Finte).
- **Finten (begrenzt):** Eine Finte ist erlaubt, kostet aber Ausdauer und macht dich kurz langsam. Bluffen lohnt sich ab und zu, aber nicht ständig.
- **Konter:** Wer im letzten Moment vor dem Treffer blockt (Perfect Block), wirft den Gegner kurz aus dem Rhythmus und kann direkt kontern.
- **Falscher Block:** Falsche Richtung = der Treffer geht durch, und der Block hat trotzdem Ausdauer gekostet.

Das Spiel lebt vom **Lesen des Gegners**: Ausholen dauert, also sieht man Angriffe kommen. Wer zu vorhersehbar ist, wird geblockt und gekontert.

### 4.1a Kamera und Lock-on

- **Kamera:** Über der Schulter (hinter der Figur), frei drehbar mit der Maus.
- **Lock-on:** Klick auf das **Mausrad** richtet die Kamera auf den Gegner und hält sie dort. Nochmal klicken löst den Lock-on wieder.
- Ohne Lock-on steuerst du Kamera und Figur komplett selbst.

### 4.1b Bewegung

- **Gehen und Rennen:** Rennen kostet Ausdauer.
- **Seitschritt / Umkreisen:** Im Lock-on läufst du seitlich um den Gegner. Wichtig für Positionskampf.
- **Ausweichrolle / Sprung nach hinten:** Kostet viel Ausdauer, du bist dabei kurz verwundbar. Schwere Rüstung macht die Rolle kürzer und langsamer.
- **Kein Springen** (bringt Chaos ohne Nutzen).

### 4.1c Tastenbelegung (Standard)

| Taste | Aktion |
|---|---|
| W A S D | Bewegen |
| Shift | Rennen |
| Leertaste | Ausweichrolle / Sprung nach hinten |
| Linke Maustaste (halten) + Maus bewegen | Angriff (Richtung wählen, loslassen = Schlag) |
| Rechte Maustaste (halten) + Maus bewegen | Block (Richtung wählen) |
| Mausrad-Klick | Lock-on an / aus |
| Q | Wurfaxt werfen |
| Esc | Menü, dort „Aufgeben" mit Bestätigung |

Die Belegung ist zunächst fest. Anpassbar machen kann man sie später.

### 4.2 Geschwindigkeit

Alles läuft über Zeit. Die Dauer für Ausholen, Schlag und Erholung ergibt sich so:

> **Dauer = Waffen-Grundtempo × Rüstungs-Faktor**

Schwere Waffen und schwere Rüstung machen also **doppelt** langsam. Das gilt auch für Laufgeschwindigkeit und Ausdauer-Erholung.

### 4.3 Ausdauer (zentral)

Ausdauer ist die wichtigste Ressource neben den Lebenspunkten.

| Aktion | Kostet Ausdauer |
|---|---|
| Schlagen | ja (schwere Waffe = mehr) |
| Blocken | ja, beim Auffangen eines Treffers (schwerer Treffer = mehr) |
| Rennen | ja, langsam |
| Gehen, Stehen | nein, Erholung |

Ist die Ausdauer leer, ist man **erschöpft**: Schläge werden langsamer, Blocks halten weniger. Schwere Rüstung verbraucht mehr Ausdauer und erholt langsamer. Das zwingt zu Pausen und Positionskämpfen.

### 4.4 Trefferzonen

Beim Treffer zählt, **wohin** er geht. Die Zone wird durch die **Schlagrichtung** bestimmt (einfach und gut lesbar):

- **Von oben** → Kopf.
- **Von links/rechts** → Torso. Wenn der Gegner gerade ausholt (Arm ist ausgestreckt), trifft der Schlag stattdessen den **Arm**.
- **Beine** → nur durch bestimmte Waffen (Speer-Stich tief, Streitaxt-Hieb tief) oder wenn der Gegner gerade in der Ausweichrolle oder in der Erholung ist.

Diese Regeln sind Startwerte und werden in Testkämpfen angepasst.

| Zone | Schaden | Zusatzeffekt |
|---|---|---|
| Kopf | hoch (×1,5) | kurze Benommenheit |
| Torso | normal (×1,0) | – |
| Arme | niedrig (×0,7) | Waffenarm getroffen = langsameres Ausholen für kurze Zeit |
| Beine | niedrig (×0,7) | Bein getroffen = Laufen langsamer für kurze Zeit |

Die Rüstung schützt **pro Zone** (siehe 6.). Wer schwer gepanzert ist, verliert kaum Lebenspunkte, ist aber ein langsames Ziel.

### 4.5 Wurfaxt (einmalig)

Optional wählbar **eine Wurfaxt pro Kampf** (statt eines kleinen Vorteils, z. B. etwas weniger Ausdauer am Start).

- Wird mit einer eigenen Taste geworfen, hat eine sichtbare Flugbahn und lässt sich blocken oder ausweichen.
- Trifft sie, macht sie soliden Schaden und bringt den Gegner kurz aus dem Rhythmus.
- Verfehlt sie, liegt sie in der Arena und kann aufgehoben werden (Wagnis!). Pro Kampf ist sie nur einmal werfbar.

### 4.6 Ablauf einer Runde (Beispiel)

Beide Spieler starten an gegenüberliegenden Seiten. Man umkreist sich, testet mit einem Schlag, sieht den Block, wartet, lässt den Gegner Ausdauer verbrauchen, und schlägt dann zu, wenn er müde ist. Eine gute Runde dauert etwa 60 bis 90 Sekunden.

### 4.6a Block-Folgen, Waffen und Aufgeben

- Ein geblockter Schlag kostet den Verteidiger nur **Ausdauer** (bei schweren Waffen mehr). Waffen und Schilde gehen nicht kaputt.
- **Kein Entwaffnen:** Die Waffe bleibt immer in der Hand (nur die Wurfaxt kann am Boden liegen).
- **Aufgeben:** Jederzeit per Taste mit Bestätigung. Man verliert die Runde.

### 4.7 Letzte Chance (Todesstoß-Moment)

Sinkt ein Spieler auf 0 Lebenspunkte, geht er in die Knie. Er hat **ca. 3 Sekunden**, um einen letzten Angriff oder Block zu schaffen (mit stark eingeschränkter Ausdauer). Der Sieger muss den Todesstoß setzen. Gelingt dem Verlierer ein Treffer oder Perfect Block, kann er mit einem kleinen Rest an Lebenspunkten weiterkämpfen. Sonst ist die Runde vorbei, mit kurzer Zeitlupe.

---

## 5. Waffen (Startwerte, werden später getestet und angepasst)

Sechs Waffen plus die Wurfaxt. Werte sind grob (1 = niedrig, 5 = hoch). Alle Waffen und Rüstungen sind frei wählbar (kein Punkte-Budget), die Balance kommt aus den Werten selbst.

| Waffe | Tempo | Reichweite | Schaden | Ausdauer-Kosten | Besonderheit |
|---|---|---|---|---|---|
| **Schwert + Schild** | 4 | 3 | 3 | 2 | Bester Block, sicherer Allrounder |
| **Speer** | 3 | 5 | 3 | 3 | Hält auf Distanz, gut gegen Beine, schwach im Nahkampf |
| **Zweihänder** | 2 | 4 | 5 | 5 | Sehr starke Treffer, langsam, Block ist schwächer |
| **Streitaxt** | 3 | 3 | 4 | 4 | Durchbricht Blocks teilweise, kostet viel Ausdauer |
| **Streitkolben** | 2 | 2 | 4 | 4 | Ignoriert einen Teil der Rüstung, gut gegen Schwere |
| **Rapier** | 5 | 2 | 2 | 1 | Sehr schnell, Stiche in Lücken der Rüstung, schwach gegen schwere Rüstung |

**Wurfaxt:** einmalig, siehe 4.5.

**Gegenspiel (Stein-Schere-Papier-Gefühl, aber nicht starr):**
- Speer hält Nahkämpfer auf Abstand, wird vom Rapier aber unterlaufen.
- Streitkolben ist gut gegen schwere Rüstung, aber zu langsam für flinke Gegner.
- Schwert + Schild ist stabil, hat aber wenig Druck.

---

## 6. Rüstung (drei Stufen)

| Stufe | Schutz | Bewegung & Tempo | Ausdauer | Idee |
|---|---|---|---|---|
| **Leicht** (Stoff/Leder) | niedrig | schnell (×0,8 Dauer) | erholt schnell | Ausweichen, Tempo, Risiko |
| **Mittel** (Kettenhemd) | mittel | normal (×1,0) | normal | Ausgewogen |
| **Schwer** (Plattenrüstung) | hoch | langsam (×1,3 Dauer) | erholt langsam, hoher Verbrauch | Panzer, Geduld, wenig Fehler erlaubt |

Der Schutz gilt **pro Trefferzone**: Kopf, Torso, Arme, Beine. Schwere Rüstung schützt am besten, aber auch der Kopf ist dort ein Ziel für Streitkolben.

Der Rüstungs-Faktor beeinflusst auch **Laufgeschwindigkeit**, **Ausholtempo** und **Ausdauer-Erholung**.

---

## 7. Arenen

Im Low-Poly-Stil, jede mit anderer Wirkung auf die Taktik:

- **Burghof:** Offen, ausgewogen. Einstiegsarena.
- **Wald-Lichtung:** Bäume als Hindernisse, schränken lange Waffen ein.
- **Steinbrücke:** Schmal, wenig Platz zum Ausweichen, Speer stark.

Später denkbar: Turnierplatz mit Zuschauern, Ruine, Schneelandschaft (rutschig).

Es gibt eine **Arenagrenze**: Zurückweichen ist möglich, aber nicht endlos. Wer sich in die Ecke drängen lässt, hat verloren.

---

## 8. Optik, Gewalt und Sound

### Gewalt-Darstellung (realistisch)
- **Viel Blut:** Spritzer bei Treffern, Flecken auf Kleidung und Rüstung, Blut auf dem Boden. Bleibt bis Rundenende sichtbar.
- **Sichtbarer Rüstungsschaden:** Dellen, Kratzer und abgebrochene Teile bei schweren Treffern.
- **Kein Abtrennen von Gliedmaßen** (bewusst weggelassen, wegen möglicher Probleme bei Plattformen und im Freundeskreis).
- Später optional: Schalter in den Einstellungen, um Blut zu reduzieren oder auszuschalten.

### Optik anpassen
Rein kosmetisch, ohne Einfluss auf den Kampf:
- Farbe der Kleidung, Wappen/Symbol auf Schild oder Brust, Helmform, Umhangfarbe.
- Auswahl wird lokal gespeichert (im Browser) und beim Beitritt an den Gegner geschickt.

### Sound & Musik
- Klirren, Blocks, Treffer, Rüstungsklappern (schwer klingt schwer).
- Ruhige, düstere mittelalterliche Musik, im Kampf etwas intensiver.
- Lautstärke einstellbar, Musik abschaltbar.

---

## 9. Zuschauer-Link

- Der Raum hat zusätzlich einen **Zuschauer-Link**.
- Zuschauer sehen den Kampf live (freie Kamera oder feste Perspektive), können aber nicht eingreifen.
- Sie sehen die Ausrüstung erst **nach der Enthüllung**, nicht vorher (keine Geheimnisverrat-Gefahr).
- Optional später: einfacher Emote-Chat („👏", „🔥") für Zuschauer.

---

## 10. Technischer Vorschlag (zur Diskussion)

Das ist nur ein Vorschlag, damit das Konzept realistisch bleibt:

- **3D im Browser:** Three.js (läuft in jedem modernen Browser). Entschieden.
- **Online-Verbindung:** Ein kleiner Server (Node.js mit WebSockets) verwaltet die Räume und entscheidet über Treffer (damit niemand schummeln kann). Entschieden.
- **Raum-Links:** Kurzer Code in der Adresse, keine Datenbank nötig, Räume leben nur im Speicher.
- **Server entscheidet:** Der Server bestimmt Treffer und Blocks (kein Schummeln). Eine kleine Verzögerung wird bewusst akzeptiert.
- **Kein Chat:** Kommunikation läuft extern (Discord, Handy). Spart Aufwand.
- **Wichtig für langsamen Kampf:** Weil alles absichtlich langsam ist (Ausholen dauert ~0,5 bis 1,5 Sekunden), ist eine kleine Verzögerung (Ping) verkraftbar. Das ist ein großer Vorteil gegenüber schnellen Actionspielen.
- **Hosting: kostenlos.** Ein kostenloser Dienst (z. B. Render oder ähnlich, Angebote ändern sich, wird bei der Umsetzung geprüft) reicht für zwei Spieler. **Bekannte Einschränkung:** Kostenlose Server „schlafen" nach einiger Zeit ohne Besucher. Der erste Aufruf des Links kann dann **30 bis 60 Sekunden** dauern. Tipp: Den Link einmal kurz vorher öffnen, bevor die Freunde kommen. Falls das nervt, kann man später auf einen günstigen Server umsteigen.
- **Assets:** Low-Poly-Modelle und Animationen, entweder selbst gebaut oder freie Pakete.

---

## 11. Umsetzung in Stufen

**Stufe 1 – Spielbarer Kern (MVP)**
- Raum-Link, Lobby, Namenseingabe
- Eine Arena (Burghof), zwei Waffen (Schwert + Schild, Zweihänder), zwei Rüstungsstufen
- Richtungs-Angriff, Block, Ausdauer, Trefferzonen, Lebenspunkte
- Runden (1/3/5)

**Stufe 1b – Übungsmodus:** Alleine gegen eine Trainingspuppe, um Steuerung und Waffen zu testen.

**Stufe 2 – Vollständiger Inhalt**
- Alle 6 Waffen, alle 3 Rüstungsstufen, Wurfaxt
- Geheime Wahl mit Enthüllung
- Alle Lobby-Einstellungen (Arena, gleiche Ausrüstung, Schaden-Regeln)
- Drei Arenen

**Stufe 3 – Feinschliff**
- Sound und Musik
- Optik anpassen
- Zuschauer-Link
- Balancing nach echten Testkämpfen mit Freunden

---

## 12. Offene Punkte (noch zu klären)

- **Name des Spiels:** Bleibt vorerst „1on1", später entscheiden.
- **Feinabstimmung im Test:** Trefferzonen-Regeln, Waffenwerte, Ausdauerkosten und Rüstungsfaktoren sind Startwerte und werden mit echten Testkämpfen angepasst.
- **Kostenloser Server:** Prüfen, welcher Dienst bei der Umsetzung gerade kostenlos ist, und ob die Aufwachzeit stört.

Bereits entschieden (jetzt): Trefferzone nach Schlagrichtung, Standard-Tastenbelegung (fest), Three.js + Node.js, kostenloses Hosting.

Bereits entschieden (frühere Runden): Kamera über der Schulter mit Lock-on per Mausrad, begrenzte Finten, Rapier statt Dolch, „Letzte Chance"-Todesstoß, freie Ausrüstungswahl, realistische Gewalt, Ergebnis mit Statistik.

Bereits entschieden (letzte Runde): Server entscheidet bei Treffern, beide stimmen über die Arena ab, Ausrüstung wird vor jeder Runde neu (geheim) gewählt, Übungsmodus gegen Puppe, Aufgeben per Taste mit Bestätigung, kein Chat, Blocks kosten nur Ausdauer, kein Entwaffnen.
