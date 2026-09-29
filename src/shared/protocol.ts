// Nachrichten zwischen Browser (Client) und Server. Alles wird als JSON gesendet.

export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;
// Ohne verwechselbare Zeichen (kein 0/O, 1/I/L)
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type Phase = 'lobby' | 'arena';

export interface PlayerInfo {
  id: string;
  name: string;
}

// ---- Client -> Server ----
export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'start' } // nur der Ersteller
  | { t: 'toLobby' } // zurueck in die Lobby
  | { t: 'input'; seq: number; fwd: number; right: number; yaw: number; sprint: boolean }
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
}

export type ServerMessage =
  | { t: 'room'; code: string; youId: string; hostId: string; phase: Phase; players: PlayerInfo[] }
  | { t: 'state'; players: NetPlayerState[] }
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
