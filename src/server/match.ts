// Ablauf eines Kampfes: Countdown -> Kampf -> Rundenende -> naechste Runde -> Kampfende.
// Reine Logik ohne Netzwerk (gut testbar).

import type { MatchPhase, NetEvent, NetMatch, NetStats } from '../shared/protocol.js';
import { COUNTDOWN, HP_MAX, LAST_CHANCE, ROUND_END } from '../shared/weapons.js';
import { SPAWNS, newSimState, STAMINA_MAX } from '../shared/sim.js';
import { newStats, type Fighter, type PlayerStats } from './resolve.js';

export class Match {
  phase: MatchPhase = 'countdown';
  round = 1;
  wins: [number, number] = [0, 0];
  timer: number = COUNTDOWN; // Ticks
  lastWinner = -1;
  stats: [PlayerStats, PlayerStats] = [newStats(), newStats()];
  rematch = new Set<string>();

  constructor(
    public readonly roundsToWin = 2,
  ) {}

  get canAct(): boolean {
    return this.phase === 'fight';
  }

  /** Setzt beide Figuren auf ihre Startplaetze (neue Runde). */
  resetFighters(fighters: [Fighter, Fighter]): void {
    fighters.forEach((f, i) => {
      const s = SPAWNS[i]!;
      const old = f.sim;
      const fresh = newSimState(s.x, s.z, s.yaw);
      fresh.weapon = old.weapon;
      fresh.armor = old.armor;
      f.sim = fresh;
    });
  }

  /** Startet den ganzen Kampf neu (Revanche). */
  restart(fighters: [Fighter, Fighter]): void {
    this.phase = 'countdown';
    this.round = 1;
    this.wins = [0, 0];
    this.timer = COUNTDOWN;
    this.lastWinner = -1;
    this.stats = [newStats(), newStats()];
    this.rematch.clear();
    this.resetFighters(fighters);
  }

  /** Beendet die Runde zugunsten von `winner` (0/1). */
  endRound(winner: number, fighters: [Fighter, Fighter], events: NetEvent[]): void {
    if (this.phase !== 'fight') return;
    this.wins[winner as 0 | 1]++;
    this.lastWinner = winner;
    events.push({ k: 'round', w: fighters[winner]!.id });
    if (this.wins[winner as 0 | 1] >= this.roundsToWin) {
      this.phase = 'matchEnd';
      this.timer = 0;
      events.push({ k: 'match', w: fighters[winner]!.id });
    } else {
      this.phase = 'roundEnd';
      this.timer = ROUND_END;
    }
  }

  /** Einmal pro Tick: Zeitgeber fuer Countdown und Rundenende. */
  advance(fighters: [Fighter, Fighter]): void {
    if (this.phase === 'countdown') {
      if (--this.timer <= 0) {
        this.phase = 'fight';
        this.timer = 0;
      }
    } else if (this.phase === 'roundEnd') {
      if (--this.timer <= 0) {
        this.round++;
        this.phase = 'countdown';
        this.timer = COUNTDOWN;
        this.lastWinner = -1;
        this.resetFighters(fighters);
      }
    }
  }

  /** "Letzte Chance": Laeuft die Zeit ab, verliert der Spieler am Boden. Gibt den Gewinner zurueck (oder -1). */
  checkLastChance(fighters: [Fighter, Fighter]): number {
    for (let i = 0; i < 2; i++) {
      const s = fighters[i]!.sim;
      if (s.down) {
        s.downT = Math.max(0, s.downT - 1);
        if (s.downT <= 0) return 1 - i;
      }
    }
    return -1;
  }

  toNet(fighters: [Fighter, Fighter], ownIdIsBot: boolean[] = []): NetMatch {
    const showStats = this.phase === 'matchEnd';
    const stats: NetStats[] | undefined = showStats
      ? fighters.map((f, i) => ({ id: f.id, ...this.stats[i]!, zones: [...this.stats[i]!.zones] as NetStats['zones'] }))
      : undefined;
    void ownIdIsBot;
    return {
      ph: this.phase,
      round: this.round,
      ids: [fighters[0]!.id, fighters[1]!.id],
      wins: [this.wins[0], this.wins[1]],
      rw: this.roundsToWin,
      tm: this.phase === 'countdown' || this.phase === 'roundEnd' ? Math.ceil(this.timer / 30) : 0,
      ld: this.lastWinner,
      rm: [...this.rematch],
      stats,
    };
  }
}

export { HP_MAX, LAST_CHANCE, STAMINA_MAX };
