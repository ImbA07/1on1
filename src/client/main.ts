import './style.css';
import { Game } from './game.js';
import { Net } from './net.js';
import { UI, type RoomView } from './ui.js';
import { normalizeCode } from '../shared/protocol.js';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = new UI(document.getElementById('ui')!);
const net = new Net();
const game = new Game(canvas, net, {
  onStamina: (v, ex) => ui.setStamina(v, ex),
  onLockOn: (on) => ui.setLockOn(on),
  onPointerLock: (locked) => ui.setPointerLock(locked),
  onCombat: (v) => ui.updateCombat(v),
  onEvents: (ev, youId) => ui.showEvents(ev, youId),
  onMatch: (m, youId) => ui.updateMatch(m, youId),
  onNotice: (text) => ui.toast(text),
});

if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __game: Game }).__game = game;
}

const NAME_KEY = '1on1.name';
function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Speichern nicht moeglich (z. B. privates Fenster), ist nicht schlimm
  }
}

// Ersteller-Schluessel: bleibt beim Neuladen der Seite erhalten, damit man Ersteller bleibt
function loadHostKey(code: string): string | undefined {
  try {
    return sessionStorage.getItem(`1on1.hk.${code}`) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveHostKey(code: string, key: string): void {
  try {
    sessionStorage.setItem(`1on1.hk.${code}`, key);
  } catch {
    // nicht schlimm
  }
}

const inviteMatch = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
let inviteCode: string | null = inviteMatch ? normalizeCode(inviteMatch[1]) : null;

let room: RoomView | null = null;
let inArena = false;
let connecting = false; // verhindert doppeltes Absenden (z. B. zweimal Enter)

function showMenu(error?: string): void {
  room = null;
  inArena = false;
  game.enterMenu();
  ui.showMenu({
    inviteCode,
    name: loadName(),
    error,
    onCreate: (name) => connectAnd(name, { t: 'create', name }),
    onPractice: (name) => connectAnd(name, { t: 'create', name, practice: true }),
    onJoin: (code, name) => connectAnd(name, { t: 'join', code, name, key: loadHostKey(code) }),
    onOwnGame: () => {
      inviteCode = null;
      history.replaceState(null, '', '/');
      showMenu();
    },
  });
}

async function connectAnd(name: string, first: { t: 'create'; name: string; practice?: boolean } | { t: 'join'; code: string; name: string; key?: string }): Promise<void> {
  if (connecting) return;
  connecting = true;
  saveName(name);
  ui.setMenuStatus('Verbinde mit dem Server ...');
  // Kostenlose Server "schlafen" und brauchen beim ersten Aufruf bis zu einer Minute.
  const slowTimer = window.setTimeout(
    () => ui.setMenuStatus('Der Server wacht gerade auf. Das kann bis zu einer Minute dauern ...'),
    3000,
  );
  try {
    await net.connect();
  } catch {
    window.clearTimeout(slowTimer);
    connecting = false;
    showMenu('Keine Verbindung zum Server. Bitte versuch es gleich noch einmal.');
    return;
  }
  window.clearTimeout(slowTimer);
  net.send(first);
  // Kurz sperren, damit ein zweites Enter nicht noch einmal abschickt
  window.setTimeout(() => (connecting = false), 1500);
}

function leaveRoom(): void {
  net.close(); // absichtlich: meldet kein "Verbindung verloren"
  inviteCode = null;
  history.replaceState(null, '', '/');
  showMenu();
}

net.onMessage = (msg) => {
  switch (msg.t) {
    case 'room': {
      room = msg;
      if (msg.hostKey) saveHostKey(msg.code, msg.hostKey);
      // Trainingsraeume haben keinen Einladungslink
      if (!msg.practice) {
        if (location.pathname !== `/r/${msg.code}`) history.replaceState(null, '', `/r/${msg.code}`);
        inviteCode = msg.code;
      }
      if (msg.phase === 'arena') {
        if (!inArena) {
          inArena = true;
          game.enterArena(msg.youId, msg.players);
          ui.showHud(
            {
              onResume: () => game.requestPointerLock(),
              onToLobby: () => net.send({ t: 'toLobby' }),
              onLeave: leaveRoom,
              onRematch: () => net.send({ t: 'rematch' }),
              practice: msg.practice,
            },
            msg.players,
            msg.youId,
          );
        }
      } else {
        inArena = false;
        game.enterMenu();
        ui.showLobby(msg, {
          onStart: () => net.send({ t: 'start' }),
          onLeave: leaveRoom,
          onSettings: (rounds) => net.send({ t: 'settings', rounds }),
        });
      }
      break;
    }
    case 'state':
      game.onState(msg);
      break;
    case 'error':
      if (room) ui.toast(msg.message);
      else showMenu(msg.message);
      break;
    case 'info':
      ui.toast(msg.message);
      break;
  }
};

net.onClose = () => {
  game.enterMenu();
  inArena = false;
  room = null;
  ui.showDisconnected(() => location.reload());
};

showMenu();
