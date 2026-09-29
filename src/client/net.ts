import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

type MessageHandler = (msg: ServerMessage) => void;

export class Net {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  onMessage: MessageHandler = () => {};
  onClose: () => void = () => {};

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Baut die Verbindung auf. Mehrfache Aufrufe teilen sich denselben Versuch. */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let opened = false;
      let keepAlive: number | undefined;

      const failTimer = window.setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, 20000); // kostenlose Server brauchen nach dem "Schlafen" etwas laenger

      ws.onopen = () => {
        opened = true;
        window.clearTimeout(failTimer);
        // Verbindung wach halten (Hosting-Dienste trennen sonst ruhige Verbindungen)
        keepAlive = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage));
        }, 15000);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(failTimer);
        reject(new Error('connect'));
      };
      ws.onmessage = (ev) => {
        // Nachrichten einer alten, schon ersetzten Verbindung ignorieren
        if (this.ws !== ws) return;
        try {
          this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
        } catch {
          // kaputte Nachricht ignorieren
        }
      };
      ws.onclose = () => {
        window.clearTimeout(failTimer);
        window.clearInterval(keepAlive);
        const wasCurrent = this.ws === ws;
        if (wasCurrent) this.ws = null;
        // Nur melden, wenn die Verbindung vorher stand (Fehlschlaege meldet connect() selbst)
        if (opened && wasCurrent) this.onClose();
      };
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Beendet die Verbindung absichtlich (meldet dabei kein "Verbindung verloren"). */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
