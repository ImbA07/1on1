import type { PlayerInfo, Phase } from '../shared/protocol.js';
import { MAX_NAME_LENGTH } from '../shared/protocol.js';

export interface RoomView {
  code: string;
  youId: string;
  hostId: string;
  phase: Phase;
  players: PlayerInfo[];
}

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | ((e: Event) => void)>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export interface MenuOptions {
  inviteCode: string | null;
  name: string;
  error?: string;
  onCreate(name: string): void;
  onJoin(code: string, name: string): void;
  onOwnGame?(): void;
}

export interface HudHandlers {
  onResume(): void;
  onToLobby(): void;
  onLeave(): void;
}

export class UI {
  private screen: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private staminaFill: HTMLElement | null = null;
  private staminaBox: HTMLElement | null = null;
  private lockBadge: HTMLElement | null = null;
  private banner: HTMLElement | null = null;
  private pauseCard: HTMLElement | null = null;
  private hadPointerLock = false;
  private toastTimer: number | undefined;
  private readonly toastEl: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.toastEl = h('div', { class: 'toast', role: 'status' });
    this.root.append(this.toastEl);
  }

  // ------------------------------------------------------------ Bildschirme

  private setScreen(el: HTMLElement | null): void {
    this.screen?.remove();
    this.status = null;
    this.screen = el;
    if (el) this.root.append(el);
  }

  showMenu(opts: MenuOptions): void {
    this.hideHud();
    const nameInput = h('input', {
      class: 'input',
      type: 'text',
      maxlength: String(MAX_NAME_LENGTH),
      placeholder: 'Dein Name',
      value: opts.name,
      autocomplete: 'off',
      'aria-label': 'Dein Name',
    });
    const errorEl = h('p', { class: 'error', role: 'alert' }, opts.error ?? '');
    const status = h('p', { class: 'status' });
    this.status = status;

    const submit = (): void => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = 'Bitte gib zuerst deinen Namen ein.';
        nameInput.focus();
        return;
      }
      errorEl.textContent = '';
      if (opts.inviteCode) opts.onJoin(opts.inviteCode, name);
      else opts.onCreate(name);
    };
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    const primary = h(
      'button',
      { class: 'btn primary', type: 'button', onClick: submit },
      opts.inviteCode ? 'Duell annehmen' : 'Spiel erstellen',
    );
    primary.dataset.role = 'primary';

    const card = h(
      'div',
      { class: 'card menu' },
      h('h1', { class: 'title' }, '1on1'),
      h('p', { class: 'tagline' }, 'Ein Duell im Browser. Link teilen und los.'),
      opts.inviteCode
        ? h('p', { class: 'invite' }, 'Du wurdest herausgefordert! Raum: ', h('strong', {}, opts.inviteCode))
        : null,
      h('label', { class: 'label' }, 'Wie sollen dich alle nennen?', nameInput),
      errorEl,
      primary,
      opts.inviteCode && opts.onOwnGame
        ? h('button', { class: 'btn link', type: 'button', onClick: () => opts.onOwnGame?.() }, 'Lieber ein eigenes Spiel erstellen')
        : null,
      status,
    );
    this.setScreen(h('div', { class: 'screen' }, card));
    nameInput.focus();
  }

  /** Meldung unter dem Formular (z. B. "Verbinde ..."). */
  setMenuStatus(text: string, busy = true): void {
    if (this.status) this.status.textContent = text;
    const btn = this.screen?.querySelector<HTMLButtonElement>('[data-role="primary"]');
    if (btn) btn.disabled = busy;
  }

  showLobby(room: RoomView, handlers: { onStart(): void; onLeave(): void }): void {
    this.hideHud();
    const isHost = room.hostId === room.youId;
    const link = `${location.origin}/r/${room.code}`;

    const linkInput = h('input', { class: 'input', type: 'text', readonly: true, value: link, 'aria-label': 'Einladungslink' });
    linkInput.addEventListener('focus', () => linkInput.select());
    const copyBtn = h('button', { class: 'btn', type: 'button' }, 'Link kopieren');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        linkInput.select();
        document.execCommand('copy');
      }
      copyBtn.textContent = 'Kopiert!';
      window.setTimeout(() => (copyBtn.textContent = 'Link kopieren'), 1600);
    });

    const slots = [0, 1].map((i) => {
      const p = room.players[i];
      if (!p) return h('li', { class: 'slot empty' }, 'Warte auf Gegner ...');
      const tags: string[] = [];
      if (p.id === room.hostId) tags.push('Ersteller');
      if (p.id === room.youId) tags.push('du');
      const li = h('li', { class: `slot color${i}` }, h('span', { class: 'swatch' }), h('span', { class: 'pname' }, p.name));
      if (tags.length) li.append(h('span', { class: 'ptag' }, `(${tags.join(', ')})`));
      return li;
    });

    const ready = room.players.length >= 2;
    const startBtn = h(
      'button',
      { class: 'btn primary', type: 'button', disabled: !ready, onClick: handlers.onStart },
      ready ? 'Kampf starten' : 'Warte auf Gegner ...',
    );

    const card = h(
      'div',
      { class: 'card lobby' },
      h('h2', { class: 'heading' }, 'Raum ', h('span', { class: 'code' }, room.code)),
      h('p', { class: 'hint' }, 'Schick diesen Link an deinen Freund:'),
      h('div', { class: 'row' }, linkInput, copyBtn),
      h('ul', { class: 'slots' }, ...slots),
      isHost ? startBtn : h('p', { class: 'hint center' }, ready ? 'Warte, bis der Ersteller den Kampf startet ...' : 'Warte auf Gegner ...'),
      h('button', { class: 'btn link', type: 'button', onClick: handlers.onLeave }, 'Raum verlassen'),
    );
    this.setScreen(h('div', { class: 'screen' }, card));
  }

  showDisconnected(onReload: () => void): void {
    this.hideHud();
    this.setScreen(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'card' },
          h('h2', { class: 'heading' }, 'Verbindung verloren'),
          h('p', { class: 'hint center' }, 'Die Verbindung zum Server wurde getrennt.'),
          h('button', { class: 'btn primary', type: 'button', onClick: onReload }, 'Neu laden'),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ Kampf-Anzeige

  showHud(handlers: HudHandlers): void {
    this.setScreen(null);
    this.hideHud();
    this.hadPointerLock = false;

    this.staminaFill = h('div', { class: 'stamina-fill' });
    this.staminaBox = h('div', { class: 'stamina', role: 'progressbar', 'aria-label': 'Ausdauer' }, this.staminaFill);
    this.lockBadge = h('div', { class: 'lock-badge hidden' }, 'Fokus auf Gegner');
    this.banner = h('div', { class: 'banner' }, 'Klicke ins Bild, um die Maus zu fangen. Esc öffnet das Menü.');
    this.pauseCard = h(
      'div',
      { class: 'card pause hidden' },
      h('h2', { class: 'heading' }, 'Menü'),
      h('p', { class: 'hint center' }, 'Der Kampf läuft weiter!'),
      h('button', { class: 'btn primary', type: 'button', onClick: handlers.onResume }, 'Weiter'),
      h('button', { class: 'btn', type: 'button', onClick: handlers.onToLobby }, 'Zurück zur Lobby'),
      h('button', { class: 'btn link', type: 'button', onClick: handlers.onLeave }, 'Raum verlassen'),
    );
    const controls = h(
      'div',
      { class: 'controls' },
      h('strong', {}, 'Steuerung'),
      h('span', {}, 'W A S D  bewegen'),
      h('span', {}, 'Shift  rennen (kostet Ausdauer)'),
      h('span', {}, 'Maus  umschauen'),
      h('span', {}, 'Mausrad-Klick  Fokus auf Gegner'),
      h('span', {}, 'Esc  Menü'),
    );
    this.hud = h('div', { class: 'hud' }, h('div', { class: 'crosshair' }), controls, this.lockBadge, this.staminaBox, this.banner, this.pauseCard);
    this.root.append(this.hud);
  }

  hideHud(): void {
    this.hud?.remove();
    this.hud = null;
    this.staminaFill = null;
    this.staminaBox = null;
    this.lockBadge = null;
    this.banner = null;
    this.pauseCard = null;
  }

  setStamina(value: number, exhausted: boolean): void {
    if (!this.staminaFill || !this.staminaBox) return;
    const pct = Math.max(0, Math.min(100, value));
    this.staminaFill.style.width = `${pct}%`;
    this.staminaBox.classList.toggle('exhausted', exhausted);
    this.staminaBox.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  setLockOn(active: boolean): void {
    this.lockBadge?.classList.toggle('hidden', !active);
  }

  setPointerLock(locked: boolean): void {
    if (!this.banner || !this.pauseCard) return;
    if (locked) {
      this.hadPointerLock = true;
      this.banner.classList.add('hidden');
      this.pauseCard.classList.add('hidden');
    } else if (this.hadPointerLock) {
      this.banner.classList.add('hidden');
      this.pauseCard.classList.remove('hidden');
    } else {
      this.banner.classList.remove('hidden');
    }
  }

  // ------------------------------------------------------------ Hinweise

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 4000);
  }
}
