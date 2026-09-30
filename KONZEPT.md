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
| Anzeigen | **Kein Lebensbalken.** Nur Ausdauerbalken und Richtungsanzeige. Zustand erkennt man am Körper und an Bildschirm-Effekten |
| Stil | Low-Poly, düster mit bunten Akzenten, mittelalterliche Menüs |

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

**Lauftempo (Ergebnis des ersten Tests):** Das aktuelle Gehtempo (ca. 2,4 m/s) fühlt sich gut an und gilt als **Tempo für schwere Rüstung**. Es war für den Tester „minimal zu langsam", deshalb sollen mittlere und leichte Rüstung spürbar schneller sein. Startwerte: schwer 2,4 m/s, mittel ca. 2,7 m/s, leicht ca. 3,0 m/s (Rennen entsprechend schneller). Eingebaut wird das mit den Rüstungsstufen in Stufe 2.

---

## 7. Arenen

Im Low-Poly-Stil, jede mit anderer Wirkung auf die Taktik:

- **Burghof:** Offen, ausgewogen. Einstiegsarena.
- **Wald-Lichtung:** Bäume als Hindernisse, schränken lange Waffen ein.
- **Steinbrücke:** Schmal, wenig Platz zum Ausweichen, Speer stark.

Später denkbar: Turnierplatz mit Zuschauern, Ruine, Schneelandschaft (rutschig).

Es gibt eine **Arenagrenze**: Zurückweichen ist möglich, aber nicht endlos. Wer sich in die Ecke drängen lässt, hat verloren.

---

## 8. Design, Gewalt und Sound

### Grafikstil
- **Low-Poly, eine Mischung aus düster und bunt:** Die Welt ist matt und erdig (Stein, Holz, Nebel), dazu kommen **bunte, leuchtende Akzente**: Wappen, Banner, Umhänge, Blut. Die Arenen unterscheiden sich im Ton: manche düster (Nacht, Nebel), manche farbig (goldener Abend). Manchmal wirkt die Umgebung hell und leuchtend, während die Kämpfer selbst dunkel und ernst aussehen. Diese drei Richtungen werden kombiniert und pro Arena gewichtet.
- **Waffen und Rüstungen:** Mittlerer Detailgrad, Ornamente wie Gravuren und Nieten. **Die Silhouette muss trotzdem sofort erkennbar sein** (Speer, Zweihänder, Rapier usw.), damit man im Kampf sieht, was der Gegner trägt.
- **Charaktere:** Ein gleicher Körper für alle. Unterschied entsteht durch Rüstung, Farben, Wappen und Umhang.
- **Stimmung und Tageszeit der Arenen:** Bewölkter Tag (matt), goldene Abendsonne, Nacht mit Fackeln, Regen und Nebel. Die Effekte werden schlank gehalten, damit das Spiel im Browser flüssig läuft und man den Gegner immer gut erkennt.

### Benutzeroberfläche (Menüs, Lobby)
Mittelalterlicher Look: Pergament, Holzrahmen, Eisenbeschläge, passende Schrift. Klar lesbar, nicht überladen.

### Anzeigen im Kampf (kein Lebensbalken)
Bewusst **kein Lebensbalken**, weder für dich noch für den Gegner. Das macht den Kampf spannender und unsicherer: Man muss den Gegner lesen.

- **Sichtbar:** Ausdauerbalken und eine **Richtungsanzeige** für Angriff und Block (oben, links, rechts), die beim Lernen hilft.
- **Nicht sichtbar:** Lebenspunkte (gibt es intern weiter, werden nur nicht als Zahl oder Balken gezeigt), keine Körper-Silhouette dauerhaft.

**Eigener Zustand ohne Balken:**
- **Bildschirm-Effekte:** Roter Rand, Herzschlag und schwerer Atem, leicht verschwommene Sicht bei schwacher Gesundheit.
- **Körper reagiert spürbar:** Verletzter Arm = Waffe hebt sich langsamer oder zittert, verletztes Bein = du humpelst.
- **Kurzes Aufblitzen nach Treffer:** Eine kleine Körper-Silhouette zeigt 1 bis 2 Sekunden, welche Zone getroffen wurde, dann verschwindet sie.

**Zustand des Gegners:** Nur sichtbare Zeichen: Blut, Humpeln, beschädigte Rüstung, Atmung. Der Ergebnis-Bildschirm nach dem Kampf zeigt dann die Statistik (Schaden, getroffene Zonen).

### Effekte bei Treffern
Wuchtig und spürbar: kurzer Freeze-Frame, leichtes Kamerawackeln, Funken bei Metall, Blutspritzer. Treffer sollen sich schwer und wichtig anfühlen. Der „Todesstoß" darf etwas filmischer sein, aber nicht den Rhythmus zerstören.

### Enthüllung vor der Runde
Kurze Kamerafahrt: Beide Kämpfer werden nacheinander gezeigt, mit Namen von Waffe und Rüstung, dann Countdown.

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
- **Ohne Lebensbalken:** Das ist eine mutige Entscheidung. Risiko: Man weiß nicht, wie knapp es ist, und kann sich unfair getroffen fühlen. Das prüfen wir im Test. Idee für später: Lobby-Schalter „Lebensbalken an/aus".
- **Stimmung pro Arena:** Vorschlag: Burghof = bewölkter Tag, Wald = goldener Abend, Steinbrücke = Nebel/Regen, dazu eine Nacht-Variante mit Fackeln. Endgültig festlegen, wenn die Arenen gebaut werden.
- **Kostenloser Server:** Prüfen, welcher Dienst bei der Umsetzung gerade kostenlos ist, und ob die Aufwachzeit stört.

Bereits entschieden (Design): Düster mit bunten Akzenten, mittlerer Waffen-Detailgrad mit klarer Silhouette, ein Körper für alle, mittelalterliche Menüs, kein Lebensbalken (nur Ausdauer und Richtungsanzeige), Zustand über Bildschirm-Effekte, Körperreaktion und kurzes Treffer-Aufblitzen, wuchtige Effekte, Kamerafahrt bei der Enthüllung.

Bereits entschieden (davor): Trefferzone nach Schlagrichtung, Standard-Tastenbelegung (fest), Three.js + Node.js, kostenloses Hosting.

Bereits entschieden (frühere Runden): Kamera über der Schulter mit Lock-on per Mausrad, begrenzte Finten, Rapier statt Dolch, „Letzte Chance"-Todesstoß, freie Ausrüstungswahl, realistische Gewalt, Ergebnis mit Statistik.

Bereits entschieden (letzte Runde): Server entscheidet bei Treffern, beide stimmen über die Arena ab, Ausrüstung wird vor jeder Runde neu (geheim) gewählt, Übungsmodus gegen Puppe, Aufgeben per Taste mit Bestätigung, kein Chat, Blocks kosten nur Ausdauer, kein Entwaffnen.

---

## 13. Umsetzungsstand Kampf (erste Version)

Umgesetzt und als Startwerte eingestellt (Schwert & Schild, schwere Rüstung, mittleres Tempo):

- **Angriff:** Linke Maustaste halten = ausholen (frühestens nach 0,5 s, automatischer Schlag nach 1,2 s), Maus bewegen = Richtung (oben, links, rechts), Loslassen = Schlag (0,13 s aktiv), danach 0,4 s Erholung. Zusammen ca. 1 Sekunde.
- **Block:** Rechte Maustaste halten, Maus wählt die Richtung. Der Block wirkt nach 0,13 s. Ein Treffer in den ersten 0,17 s nach dem Aufbau ist ein **Perfect Block**: Der Angreifer taumelt 0,8 s, der Blockende zahlt keine Ausdauer.
- **Richtungen sind gespiegelt:** Was beim Angreifer von links kommt, erscheint beim Verteidiger von rechts. Der Verteidiger deckt die Seite, auf der er das Schwert auf seinem Bildschirm sieht. Am Richtungsring zeigt eine orange Markierung als Lernhilfe die richtige Block-Seite.
- **Finte:** Block-Taste während des Ausholens bricht den Angriff ab (8 Ausdauer, kurze Erholung). Richtungswechsel beim Ausholen kostet Zeit und 3 Ausdauer.
- **Kamera:** Während Angriff oder Block hält die Kamera still (die Maus wählt die Richtung). Mit dem Fokus auf den Gegner folgt sie ihm trotzdem.
- **Trefferzonen:** Von oben Kopf (x1,5), seitlich Torso (x1,0), Arm beim Ausholen des Gegners (x0,7), Bein in der Erholung (x0,7). Schwere Rüstung lässt 60 % des Schadens durch. Grundschaden 24, 100 Lebenspunkte.
- **Nachwirkungen:** Kopf = 0,5 s benommen, Arm = 3 s langsameres Ausholen, Bein = 3 s langsamer laufen. Ein Treffer unterbricht Ausholen und Block.
- **Ausdauer:** Ausholen 10, geblockter Schlag kostet den Blockenden 20 (Schild halbiert auf 10). Ist sie leer, ist man erschöpft (langsamer, längeres Ausholen, Block wird durchbrochen).
- **Kein Lebensbalken:** Lebenspunkte sieht nur der Server. Man merkt es an einem roten Bildschirmrand, einer kurzen Treffer-Silhouette und der Figur des Gegners.
- **Letzte Chance:** Bei 0 Leben kniet der Spieler 3 Sekunden. Trifft er oder blockt er perfekt, steht er mit 15 Leben wieder auf (einmal pro Runde). Ein Treffer auf den Knienden beendet die Runde.
- **Runden:** Countdown 3 s, Rundenende 3,5 s. Der Ersteller wählt in der Lobby 1, 3 oder 5 Runden (Best of). Danach Statistik und Revanche.
- **Training:** Trainingspuppe, die sich bewegt, angreift und in 40 % der Fälle die richtige Seite blockt.
- **Server:** 30 Schritte pro Sekunde, eine Eingabe pro Schritt und Spieler. Nur der Server entscheidet über Treffer.

**Noch offen im Kampf:** Sound, Blut und Trefferfunken, weitere Waffen (Zweihänder, Speer, Streitaxt, Streitkolben, Rapier), Rüstungsstufen im Spiel, geheime Ausrüstungswahl, Wurfaxt, Ausweichrolle, Lobby-Einstellungen für Schaden-Regeln und Stimmung, Feintuning aller Werte nach echten Testkämpfen.
