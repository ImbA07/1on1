// Richtungswahl per Maus. Reine Logik ohne Browser, damit man sie testen kann.
//
// Die Richtung folgt der letzten DEUTLICHEN Mausbewegung (kurzer Rueckblick, klingt ab).
// Kleine Zuckungen aendern nichts, und nach einem Wechsel gibt es eine kurze Sperre,
// damit die Richtung nicht hin und her springt (jeder Wechsel kostet beim Ausholen Zeit
// und setzt beim Blocken den Block neu auf).

export const DIR_UP = 0;
export const DIR_LEFT = 1;
export const DIR_RIGHT = 2;

export class DirectionPicker {
  static readonly TAU_MS = 200; // so lange wirkt eine Bewegung nach
  static readonly THRESHOLD = 46; // Pixel im Rueckblick, ab denen eine Bewegung zaehlt
  static readonly MIN_GAP_MS = 180; // Sperre nach einem Wechsel

  private x = 0;
  private y = 0;
  private t = 0;
  private lastChange = -1e9;

  private decay(now: number): void {
    const k = Math.exp(-Math.max(0, now - this.t) / DirectionPicker.TAU_MS);
    this.x *= k;
    this.y *= k;
    this.t = now;
  }

  /** Neue Mausbewegung (Pixel). */
  feed(mx: number, my: number, now: number): void {
    this.decay(now);
    this.x += mx;
    this.y += my;
  }

  /** Gibt die neue Richtung zurueck oder `current`, wenn sich nichts Deutliches getan hat. */
  pick(now: number, current: number): number {
    this.decay(now);
    const T = DirectionPicker.THRESHOLD;
    const ax = Math.abs(this.x);
    const ay = Math.abs(this.y);
    let d = current;
    if (-this.y > T && -this.y >= ax) d = DIR_UP;
    else if (ax > T && ax > ay * 1.4) d = this.x < 0 ? DIR_LEFT : DIR_RIGHT;
    if (d !== current) {
      if (now - this.lastChange < DirectionPicker.MIN_GAP_MS) return current;
      this.lastChange = now;
    }
    return d;
  }

  /** Vergisst alle Bewegungen (z. B. bei neuer Runde). */
  reset(): void {
    this.x = 0;
    this.y = 0;
  }
}
