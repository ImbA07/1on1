import type { NetEvent, NetMatch, PlayerInfo, Phase, RoomSettings } from '../shared/protocol.js';
import { MAX_NAME_LENGTH } from '../shared/protocol.js';
import { Act, ZONE_NAMES, counterDir } from '../shared/weapons.js';
import type { CombatView } from './game.js';

export interface RoomView {
  code: string;
  youId: string;
  hostId: string;
  phase: Phase;
  players: PlayerInfo[];
  settings?: RoomSettings;
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
  onPractice(name: string): void;
  onJoin(code: string, name: string): void;
  onOwnGame?(): void;
}

export interface HudHandlers {
  onResume(): void;
  onToLobby(): void;
  onLeave(): void;
  onRematch(): void;
  practice: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Ein Ring-Abschnitt (Winkel in Grad, 0 = rechts, -90 = oben). */
function sectorPath(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number): string {
  const p = (r: number, a: number): string => {
    const t = (a * Math.PI) / 180;
    return `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
  };
  return `M ${p(r2, a1)} A ${r2} ${r2} 0 0 1 ${p(r2, a2)} L ${p(r1, a2)} A ${r1} ${r1} 0 0 0 ${p(r1, a1)} Z`;
}

// Mitte der drei Richtungs-Abschnitte (Grad): oben, links, rechts
const WEDGE_CENTERS = [-90, 200, -20];

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

  // Kampf-Anzeigen
  private wedges: SVGPathElement[] = [];
  private hints: SVGPathElement[] = [];
  private ring: HTMLElement | null = null;
  private ringLabel: HTMLElement | null = null;
  private vignette: HTMLElement | null = null;
  private zoneBox: HTMLElement | null = null;
  private zoneShapes: SVGElement[] = [];
  private callout: HTMLElement | null = null;
  private lastChance: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private bigEl: HTMLElement | null = null;
  private endCard: HTMLElement | null = null;
  private players: PlayerInfo[] = [];
  private youId = '';
  private handlers: HudHandlers | null = null;
  private lastRingKey = '';
  private lastVig = '';
  private lastLC = '';
  private zoneTimer: number | undefined;
  private calloutTimer: number | undefined;
  private hitFlashTimer: number | undefined;
  private fightBannerUntil = 0;
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

    const submit = (practice = false): void => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = 'Bitte gib zuerst deinen Namen ein.';
        nameInput.focus();
        return;
      }
      errorEl.textContent = '';
      if (opts.inviteCode) opts.onJoin(opts.inviteCode, name);
      else if (practice) opts.onPractice(name);
      else opts.onCreate(name);
    };
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(false);
    });

    const primary = h(
      'button',
      { class: 'btn primary', type: 'button', onClick: () => submit(false) },
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
      opts.inviteCode
        ? null
        : h(
            'button',
            { class: 'btn', type: 'button', 'data-role': 'practice', onClick: () => submit(true) },
            'Training gegen die Puppe',
          ),
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
    this.screen?.querySelectorAll<HTMLButtonElement>('[data-role="primary"], [data-role="practice"]').forEach((b) => {
      b.disabled = busy;
    });
  }

  showLobby(
    room: RoomView,
    handlers: { onStart(): void; onLeave(): void; onSettings(rounds: number): void },
  ): void {
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

    // Einstellungen: Ersteller waehlt, der Gast sieht sie nur
    const rounds = room.settings?.rounds ?? 3;
    const roundBtns = [1, 3, 5].map((n) =>
      h(
        'button',
        {
          class: `seg${rounds === n ? ' on' : ''}`,
          type: 'button',
          disabled: !isHost,
          'aria-pressed': String(rounds === n),
          onClick: () => handlers.onSettings(n),
        },
        n === 1 ? '1 Runde' : `Best of ${n}`,
      ),
    );
    const settingsBox = h('div', { class: 'settings' }, h('span', { class: 'label-inline' }, 'Runden'), h('div', { class: 'segs' }, ...roundBtns));

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
      settingsBox,
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

  showHud(handlers: HudHandlers, players: PlayerInfo[], youId: string): void {
    this.setScreen(null);
    this.hideHud();
    this.hadPointerLock = false;
    this.handlers = handlers;
    this.players = players;
    this.youId = youId;
    this.lastRingKey = '';
    this.lastVig = '';
    this.lastLC = '';
    this.fightBannerUntil = 0;

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
      handlers.practice ? null : h('button', { class: 'btn', type: 'button', onClick: handlers.onToLobby }, 'Zurück zur Lobby'),
      h('button', { class: 'btn link', type: 'button', onClick: handlers.onLeave }, handlers.practice ? 'Training beenden' : 'Raum verlassen'),
    );
    const controls = h(
      'div',
      { class: 'controls' },
      h('strong', {}, 'Steuerung'),
      h('span', {}, 'W A S D  bewegen, Shift  rennen'),
      h('span', {}, 'Linke Maustaste halten  ausholen'),
      h('span', {}, 'Maus dabei nach oben / links / rechts  Richtung'),
      h('span', {}, 'Taste loslassen  zuschlagen'),
      h('span', {}, 'Rechte Maustaste halten  blocken'),
      h('span', {}, 'Block-Taste beim Ausholen  Finte'),
      h('span', {}, 'Mausrad-Klick  Fokus auf Gegner'),
      h('span', {}, 'Esc  Menü'),
    );

    // Richtungsring: zeigt gewaehlte Richtung und Zustand von Angriff/Block
    const ringSvg = svg('svg', { viewBox: '0 0 100 100', class: 'ring-svg', 'aria-hidden': 'true' });
    this.wedges = [];
    this.hints = [];
    WEDGE_CENTERS.forEach((c, i) => {
      const w = svg('path', { class: `wedge w${i}`, d: sectorPath(50, 50, 20, 40, c - 33, c + 33) });
      ringSvg.append(w);
      this.wedges.push(w);
    });
    WEDGE_CENTERS.forEach((c, i) => {
      const hnt = svg('path', { class: `hint-arc h${i}`, d: sectorPath(50, 50, 42.5, 47, c - 33, c + 33) });
      ringSvg.append(hnt);
      this.hints.push(hnt);
    });
    ringSvg.append(svg('circle', { cx: '50', cy: '50', r: '3', class: 'ring-dot' }));
    this.ringLabel = h('div', { class: 'ring-label' });
    this.ring = h('div', { class: 'ring idle' }, ringSvg, this.ringLabel);

    this.vignette = h('div', { class: 'vignette' });
    this.callout = h('div', { class: 'callout' });
    this.lastChance = h('div', { class: 'last-chance hidden' });
    this.scoreEl = h('div', { class: 'score' });
    this.bigEl = h('div', { class: 'big hidden' });

    // Treffer-Silhouette (blitzt kurz auf, wenn man getroffen wurde)
    const body = svg('svg', { viewBox: '0 0 60 110', class: 'zone-svg', 'aria-hidden': 'true' });
    const shapes: Array<[string, SVGElement]> = [
      ['head', svg('circle', { cx: '30', cy: '12', r: '9' })],
      ['torso', svg('rect', { x: '18', y: '24', width: '24', height: '32', rx: '4' })],
      ['arm', svg('path', { d: 'M12 26 L18 26 L18 58 L12 58 Z M42 26 L48 26 L48 58 L42 58 Z' })],
      ['leg', svg('path', { d: 'M19 58 L29 58 L28 104 L20 104 Z M31 58 L41 58 L40 104 L32 104 Z' })],
    ];
    this.zoneShapes = shapes.map(([cls, el]) => {
      el.setAttribute('class', `zone zone-${cls}`);
      body.append(el);
      return el;
    });
    this.zoneBox = h('div', { class: 'zone-box' }, body);

    this.hud = h(
      'div',
      { class: 'hud' },
      this.vignette,
      h('div', { class: 'crosshair' }),
      controls,
      this.scoreEl,
      this.lockBadge,
      this.lastChance,
      this.callout,
      this.bigEl,
      this.zoneBox,
      this.ring,
      this.staminaBox,
      this.banner,
      this.pauseCard,
    );
    this.root.append(this.hud);
  }

  // ------------------------------------------------------------ Kampf: Ring, Effekte, Runde

  private nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? '?';
  }

  updateCombat(v: CombatView): void {
    if (!this.ring) return;

    // Richtungsring
    const own = v.act === Act.WINDUP || v.act === Act.STRIKE || v.act === Act.RECOVERY || v.act === Act.BLOCK;
    const shown = v.atkHeld || v.blkHeld || own ? (v.act === Act.IDLE || v.act === Act.STAGGER ? v.selDir : v.dir) : -1;
    const prog = v.act === Act.WINDUP ? Math.min(1, v.actT / Math.max(1, v.need)) : 0;
    const state =
      v.act === Act.WINDUP ? 'wind' : v.act === Act.STRIKE ? 'strike' : v.act === Act.RECOVERY ? 'recover' : v.act === Act.BLOCK ? 'block' : v.act === Act.STAGGER ? 'stagger' : 'idle';
    const oppHint = v.oppAct === Act.WINDUP ? counterDir(v.oppDir) : -1;
    const key = `${state}|${shown}|${prog.toFixed(2)}|${v.atkHeld ? 1 : 0}${v.blkHeld ? 1 : 0}|${oppHint}|${v.canAct ? 1 : 0}`;
    if (key !== this.lastRingKey) {
      this.lastRingKey = key;
      this.ring.className = `ring ${state}${v.canAct ? '' : ' off'}${oppHint >= 0 ? ' hinting' : ''}${v.atkHeld || v.blkHeld ? ' held' : ''}`;
      this.ring.style.setProperty('--p', prog.toFixed(2));
      this.wedges.forEach((w, i) => w.classList.toggle('sel', i === shown));
      this.hints.forEach((a, i) => a.classList.toggle('on', i === oppHint));
      this.ringLabel!.textContent =
        state === 'wind' ? (prog >= 1 ? 'Bereit: loslassen' : 'Ausholen') : state === 'block' ? 'Block' : state === 'stagger' ? 'Taumeln' : '';
    }

    // Bildschirmrand: je weniger Leben, desto roter (kein Lebensbalken!)
    const vig = Math.pow(1 - v.hpFrac, 1.4) * 0.9;
    const vk = vig.toFixed(2);
    if (vk !== this.lastVig) {
      this.lastVig = vk;
      this.vignette!.style.setProperty('--v', vk);
    }

    // Letzte Chance
    let lc = '';
    if (v.down) lc = `Letzte Chance! Triff oder blocke im letzten Moment. ${Math.ceil(v.downT / 30)}`;
    else if (v.oppDown) lc = `Der Gegner liegt am Boden. Setze den Todesstoß! ${Math.ceil(v.oppDownT / 30)}`;
    if (lc !== this.lastLC) {
      this.lastLC = lc;
      this.lastChance!.textContent = lc;
      this.lastChance!.classList.toggle('hidden', lc === '');
      this.lastChance!.classList.toggle('own', v.down);
    }
  }

  private showCallout(text: string, kind: string): void {
    if (!this.callout) return;
    this.callout.textContent = text;
    this.callout.className = `callout show ${kind}`;
    window.clearTimeout(this.calloutTimer);
    this.calloutTimer = window.setTimeout(() => this.callout?.classList.remove('show'), 900);
  }

  showEvents(events: NetEvent[], youId: string): void {
    for (const e of events) {
      if (e.k === 'hit') {
        if (e.d === youId) {
          // Getroffen: Zone kurz anzeigen, Rand blitzt rot
          this.zoneShapes.forEach((el) => el.classList.remove('on'));
          this.zoneShapes[e.z]?.classList.add('on');
          this.zoneBox?.classList.add('show');
          window.clearTimeout(this.zoneTimer);
          this.zoneTimer = window.setTimeout(() => this.zoneBox?.classList.remove('show'), 1600);
          this.vignette?.classList.add('flash');
          window.clearTimeout(this.hitFlashTimer);
          this.hitFlashTimer = window.setTimeout(() => this.vignette?.classList.remove('flash'), 260);
          this.showCallout(`Getroffen: ${ZONE_NAMES[e.z] ?? ''}`, 'bad');
        } else if (e.a === youId) {
          this.showCallout(e.fin ? 'Todesstoß!' : `Treffer: ${ZONE_NAMES[e.z] ?? ''}`, 'good');
        }
      } else if (e.k === 'block') {
        if (e.d === youId) this.showCallout('Geblockt', 'good');
        else if (e.a === youId) this.showCallout('Geblockt!', 'bad');
      } else if (e.k === 'parry') {
        if (e.d === youId) this.showCallout('PERFECT BLOCK', 'perfect');
        else if (e.a === youId) this.showCallout('Pariert! Du taumelst', 'bad');
      } else if (e.k === 'break') {
        if (e.d === youId) this.showCallout('Block durchbrochen!', 'bad');
        else this.showCallout('Block durchbrochen', 'good');
      } else if (e.k === 'revive') {
        this.showCallout(e.id === youId ? 'Du stehst wieder!' : 'Der Gegner steht wieder auf', e.id === youId ? 'good' : 'bad');
      }
    }
  }

  updateMatch(m: NetMatch, youId: string): void {
    if (!this.scoreEl || !this.bigEl) return;
    this.youId = youId;
    const [a, b] = m.ids;
    const pips = (wins: number): string => '●'.repeat(wins) + '○'.repeat(Math.max(0, m.rw - wins));
    this.scoreEl.replaceChildren(
      h('span', { class: 'pname color0' }, this.nameOf(a)),
      h('span', { class: 'pips' }, pips(m.wins[0])),
      h('span', { class: 'round' }, `Runde ${m.round}`),
      h('span', { class: 'pips' }, pips(m.wins[1])),
      h('span', { class: 'pname color1' }, this.nameOf(b)),
    );

    // Grosse Mitteilung: Countdown / "Kampf!" / Rundengewinner
    let text = '';
    let cls = '';
    if (m.ph === 'countdown') {
      text = String(Math.max(1, m.tm));
      cls = 'count';
    } else if (m.ph === 'fight') {
      if (performance.now() < this.fightBannerUntil) text = 'Kampf!';
      else {
        this.fightBannerUntil = performance.now() + 1100;
        text = 'Kampf!';
        window.setTimeout(() => {
          if (this.bigEl && this.bigEl.textContent === 'Kampf!') this.bigEl.classList.add('hidden');
        }, 1100);
      }
      cls = 'go';
    } else if (m.ph === 'roundEnd') {
      const w = m.ld >= 0 ? m.ids[m.ld] : '';
      text = w === youId ? 'Runde gewonnen!' : `Runde für ${this.nameOf(w ?? '')}`;
      cls = w === youId ? 'win' : 'lose';
    } else if (m.ph === 'matchEnd') {
      text = '';
    }
    this.bigEl.textContent = text;
    this.bigEl.className = `big ${cls}${text ? '' : ' hidden'}`;

    // Ergebnis-Bildschirm
    this.endCard?.remove();
    this.endCard = null;
    if (m.ph === 'matchEnd' && m.stats && this.hud) {
      this.endCard = this.buildEndCard(m, youId);
      this.hud.append(this.endCard);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  private buildEndCard(m: NetMatch, youId: string): HTMLElement {
    const won = m.ld >= 0 && m.ids[m.ld] === youId;
    const stats = m.stats!;
    const row = (label: string, f: (i: number) => string): HTMLElement =>
      h('tr', {}, h('th', {}, label), h('td', {}, f(0)), h('td', {}, f(1)));
    const zones = (i: number): string => {
      const z = stats[i]!.zones;
      return `${z[0]} / ${z[1]} / ${z[2]} / ${z[3]}`;
    };
    const table = h(
      'table',
      { class: 'stats' },
      h('tr', {}, h('th', {}), h('th', { class: 'color0' }, this.nameOf(stats[0]!.id)), h('th', { class: 'color1' }, this.nameOf(stats[1]!.id))),
      row('Runden gewonnen', (i) => String(m.wins[i]!)),
      row('Treffer', (i) => String(stats[i]!.hits)),
      row('Schaden verursacht', (i) => String(Math.round(stats[i]!.damage))),
      row('Schaden erhalten', (i) => String(Math.round(stats[i]!.taken))),
      row('Geblockt', (i) => String(stats[i]!.blocks)),
      row('Perfect Blocks', (i) => String(stats[i]!.parries)),
      row('Kopf / Torso / Arm / Bein', zones),
    );
    const voted = m.rm.includes(youId);
    const handlers = this.handlers!;
    return h(
      'div',
      { class: 'card end' },
      h('h2', { class: 'heading' }, won ? 'Sieg!' : `Sieg für ${this.nameOf(m.ld >= 0 ? m.ids[m.ld]! : '')}`),
      table,
      h('button', { class: 'btn primary', type: 'button', disabled: voted, onClick: () => handlers.onRematch() }, voted ? 'Warte auf Gegner ...' : 'Revanche'),
      handlers.practice ? null : h('button', { class: 'btn', type: 'button', onClick: handlers.onToLobby }, 'Zurück zur Lobby'),
      h('button', { class: 'btn link', type: 'button', onClick: handlers.onLeave }, handlers.practice ? 'Training beenden' : 'Raum verlassen'),
    );
  }

  hideHud(): void {
    this.hud?.remove();
    this.hud = null;
    this.ring = null;
    this.ringLabel = null;
    this.vignette = null;
    this.zoneBox = null;
    this.callout = null;
    this.lastChance = null;
    this.scoreEl = null;
    this.bigEl = null;
    this.endCard = null;
    this.wedges = [];
    this.hints = [];
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
    } else if (this.hadPointerLock && !this.endCard) {
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
