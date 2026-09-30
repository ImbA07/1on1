// Umwandlung zwischen dem Simulations-Zustand und dem, was ueber das Netz geht.
import type { NetPlayerState } from './protocol.js';
import type { SimState } from './sim.js';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function simToNet(id: string, s: SimState, ack: number, ownHp: boolean): NetPlayerState {
  const n: NetPlayerState = {
    id,
    x: r3(s.x),
    z: r3(s.z),
    yaw: r3(s.yaw),
    // Ausdauer und Pause bewusst ungerundet: Der Client muss exakt gleich weiterrechnen
    st: s.stamina,
    ex: s.exhausted,
    rd: s.regenDelay,
    sp: s.sprinting,
    ack,
    ac: s.act,
    d: s.dir,
    at: s.actT,
    sg: s.staggerT,
    dz: s.dazeT,
    am: s.armT,
    lg: s.legT,
    dn: s.down,
    dt: s.downT,
    rv: s.revived,
    hd: s.hitDone,
    pa: s.prevAtk,
    pb: s.prevBlk,
    kx: r3(s.kx),
    kz: r3(s.kz),
  };
  if (ownHp) n.hp = s.hp;
  return n;
}

/** Uebernimmt den Server-Zustand in die (vorhergesagte) Simulation. */
export function applyNet(s: SimState, n: NetPlayerState): void {
  s.x = n.x;
  s.z = n.z;
  s.yaw = n.yaw;
  s.stamina = n.st;
  s.exhausted = n.ex;
  s.regenDelay = n.rd;
  s.sprinting = n.sp;
  s.act = n.ac;
  s.dir = n.d;
  s.actT = n.at;
  s.staggerT = n.sg;
  s.dazeT = n.dz;
  s.armT = n.am;
  s.legT = n.lg;
  s.down = n.dn;
  s.downT = n.dt;
  s.revived = n.rv;
  s.hitDone = n.hd;
  s.prevAtk = n.pa;
  s.prevBlk = n.pb;
  s.kx = n.kx;
  s.kz = n.kz;
  if (n.hp !== undefined) s.hp = n.hp;
}
