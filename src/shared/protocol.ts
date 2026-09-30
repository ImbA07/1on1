// Nachrichten zwischen Browser (Client) und Server. Alles wird als JSON gesendet.

export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;
// Ohne verwechselbare Zeichen (kein 0/O, 1/I/L)
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type Phase = 'lobby' | 'arena';

/** Einstellungen, die der Ersteller in der Lobby waehlt. */
export interface RoomSettings {
  rounds: 1 | 3 | 5; // "Best of ..."
}
export const DEFAULT_SETTINGS: RoomSettings = { rounds: 3 };
export function cleanRounds(v: unknown): 1 | 3 | 5 {
  return v === 1 || v === 5 ? v : 3;
}

export interface PlayerInfo {
  id: string;
  name: string;
  bot?: boolean;
}

// ---- Client -> Server ----
export type ClientMessage =
  | { t: 'create'; name: string; practice?: boolean } // practice = Training gegen die Puppe
  | { t: 'join'; code: string; name: string; key?: string } // key: Ersteller-Schluessel (beim Neuladen wieder Ersteller werden)
  | { t: 'start' } // nur der Ersteller
  | { t: 'settings'; rounds: number } // nur der Ersteller, nur in der Lobby: 1, 3 oder 5 (Best of ...)
  | { t: 'toLobby' } // zurueck in die Lobby
  | { t: 'rematch' } // nach Kampfende: nochmal
  | {
      t: 'input';
      seq: number;
      fwd: number;
      right: number;
      yaw: number;
      sprint: boolean;
      atk: boolean; // linke Maustaste gehalten
      blk: boolean; // rechte Maustaste gehalten
      dir: number; // Richtung 0 oben / 1 links / 2 rechts
    }
  | { t: 'ping' };

// ---- Server -> Client ----
export interface NetPlayerState {
  id: string;
  x: number;
  z: number;
  yaw: number;
  st: number; // Ausdauer
  ex: boolean; // erschoepft
  rd: number; // Pause bis zur Ausdauer-Erholung
  sp: boolean; // rennt
  ack: number; // zuletzt verarbeitete Eingabe dieses Spielers
  // Kampf
  ac: number; // Aktion (Act)
  d: number; // Richtung
  at: number; // Ticks in der Aktion
  sg: number; // Taumeln
  dz: number; // Benommenheit
  am: number; // Armtreffer-Nachwirkung
  lg: number; // Beintreffer-Nachwirkung
  dn: boolean; // "Letzte Chance": am Boden
  dt: number; // Ticks der letzten Chance
  rv: boolean; // Letzte Chance schon genutzt
  hd: boolean; // aktueller Schlag hat schon getroffen/wurde geblockt
  pa: boolean; // Taste-Zustand des letzten Ticks
  pb: boolean;
  kx: number; // Rueckstoss
  kz: number;
  hp?: number; // nur im eigenen Eintrag: Lebenspunkte (kein Balken, nur fuer Effekte)
}

export type NetEvent =
  | { k: 'hit'; a: string; d: string; z: number; dmg: number; fin?: boolean }
  | { k: 'block'; a: string; d: string }
  | { k: 'parry'; a: string; d: string }
  | { k: 'break'; d: string } // Block durchbrochen (Ausdauer leer)
  | { k: 'down'; id: string }
  | { k: 'revive'; id: string }
  | { k: 'round'; w: string } // Runde gewonnen von w
  | { k: 'match'; w: string }; // Kampf gewonnen von w

export type MatchPhase = 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';

export interface NetStats {
  id: string;
  hits: number;
  damage: number;
  taken: number;
  blocks: number;
  parries: number;
  zones: [number, number, number, number]; // Kopf, Torso, Arm, Bein
}

export interface NetMatch {
  ph: MatchPhase;
  round: number;
  ids: [string, string];
  wins: [number, number];
  rw: number; // Runden zum Sieg
  tm: number; // Sekunden bis zum Ende der Phase (Countdown/Rundenende), sonst 0
  ld: number; // Runden-/Kampfgewinner (Index) oder -1
  rm: string[]; // Spieler, die Revanche wollen
  stats?: NetStats[];
}

export type ServerMessage =
  | {
      t: 'room';
      code: string;
      youId: string;
      hostId: string;
      phase: Phase;
      players: PlayerInfo[];
      practice: boolean;
      settings: RoomSettings;
      hostKey?: string; // nur an den Ersteller: damit er nach Neuladen wieder Ersteller wird
    }
  | { t: 'state'; tk: number; players: NetPlayerState[]; ev: NetEvent[]; match: NetMatch | null }
  | { t: 'error'; message: string }
  | { t: 'info'; message: string };

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // Steuerzeichen raus, Leerzeichen zusammenfassen
  const t = s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, MAX_NAME_LENGTH);
}

export function normalizeCode(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}
