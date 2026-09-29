import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

type MessageHandler = (msg: ServerMessage) => void;

export class Net {
  private ws: WebSocket | null = null;
  private keepAlive: number | undefined;
  onMessage: MessageHandler = () => {};
  onClose: () => void = () => {};

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;

      const failTimer = window.setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, 20000); // kostenlose Server brauchen nach dem "Schlafen" etwas laenger

      let opened = false;
      ws.onopen = () => {
        opened = true;
        window.clearTimeout(failTimer);
        // Verbindung wach halten (Hosting-Dienste trennen sonst ruhige Verbindungen)
        this.keepAlive = window.setInterval(() => this.send({ t: 'ping' }), 15000);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(failTimer);
        reject(new Error('connect'));
      };
      ws.onmessage = (ev) => {
        try {
          this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
        } catch {
          // kaputte Nachricht ignorieren
        }
      };
      ws.onclose = () => {
        window.clearTimeout(failTimer);
        window.clearInterval(this.keepAlive);
        if (this.ws === ws) this.ws = null;
        // Nur melden, wenn die Verbindung vorher stand (Fehlschlaege meldet connect() selbst)
        if (opened) this.onClose();
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
  }
}
