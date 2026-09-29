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

const inviteMatch = location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
let inviteCode: string | null = inviteMatch ? normalizeCode(inviteMatch[1]) : null;

let room: RoomView | null = null;
let inArena = false;
let leaving = false;

function showMenu(error?: string): void {
  room = null;
  inArena = false;
  game.enterMenu();
  ui.showMenu({
    inviteCode,
    name: loadName(),
    error,
    onCreate: (name) => connectAnd(name, { t: 'create', name }),
    onJoin: (code, name) => connectAnd(name, { t: 'join', code, name }),
    onOwnGame: () => {
      inviteCode = null;
      history.replaceState(null, '', '/');
      showMenu();
    },
  });
}

async function connectAnd(name: string, first: { t: 'create'; name: string } | { t: 'join'; code: string; name: string }): Promise<void> {
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
    showMenu('Keine Verbindung zum Server. Bitte versuch es gleich noch einmal.');
    return;
  }
  window.clearTimeout(slowTimer);
  net.send(first);
}

function leaveRoom(): void {
  leaving = true;
  net.close();
  inviteCode = null;
  history.replaceState(null, '', '/');
  showMenu();
}

net.onMessage = (msg) => {
  switch (msg.t) {
    case 'room': {
      room = msg;
      if (location.pathname !== `/r/${msg.code}`) history.replaceState(null, '', `/r/${msg.code}`);
      inviteCode = msg.code;
      if (msg.phase === 'arena') {
        if (!inArena) {
          inArena = true;
          game.enterArena(msg.youId, msg.players);
          ui.showHud({
            onResume: () => game.requestPointerLock(),
            onToLobby: () => net.send({ t: 'toLobby' }),
            onLeave: leaveRoom,
          });
        }
      } else {
        inArena = false;
        game.enterMenu();
        ui.showLobby(msg, { onStart: () => net.send({ t: 'start' }), onLeave: leaveRoom });
      }
      break;
    }
    case 'state':
      game.onState(msg.players);
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
  if (leaving) {
    leaving = false;
    return;
  }
  game.enterMenu();
  inArena = false;
  room = null;
  ui.showDisconnected(() => location.reload());
};

showMenu();
