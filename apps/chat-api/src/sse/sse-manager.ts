import type { Response } from 'express';

export interface SSEEvent {
  id: number;
  event: string;
  data: any;
  timestamp: number;
}

export class SSEManager {
  private seqMap = new Map<string, number>();
  private bufferMap = new Map<string, SSEEvent[]>();
  private clientsMap = new Map<string, Set<Response>>();
  private maxBufferSize = 100;

  emitEvent(convId: string, eventName: string, data: any): SSEEvent {
    const currentSeq = (this.seqMap.get(convId) || 0) + 1;
    this.seqMap.set(convId, currentSeq);

    const sseEvent: SSEEvent = {
      id: currentSeq,
      event: eventName,
      data,
      timestamp: Date.now(),
    };

    // Store in circular buffer
    let buffer = this.bufferMap.get(convId);
    if (!buffer) {
      buffer = [];
      this.bufferMap.set(convId, buffer);
    }
    buffer.push(sseEvent);
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }

    // Broadcast to active clients
    const clients = this.clientsMap.get(convId);
    if (clients) {
      const payload = this.formatSSE(sseEvent);
      for (const client of clients) {
        try {
          client.write(payload);
        } catch {
          clients.delete(client);
        }
      }
    }

    return sseEvent;
  }

  getMissedEvents(convId: string, lastEventId: number): SSEEvent[] {
    const buffer = this.bufferMap.get(convId);
    if (!buffer) {
      return [];
    }
    return buffer.filter((e) => e.id > lastEventId);
  }

  addClient(convId: string, res: Response): () => void {
    let clients = this.clientsMap.get(convId);
    if (!clients) {
      clients = new Set<Response>();
      this.clientsMap.set(convId, clients);
    }
    clients.add(res);

    return () => {
      this.removeClient(convId, res);
    };
  }

  removeClient(convId: string, res: Response): void {
    const clients = this.clientsMap.get(convId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.clientsMap.delete(convId);
      }
    }
  }

  getClientCount(convId: string): number {
    return this.clientsMap.get(convId)?.size || 0;
  }

  formatSSE(event: SSEEvent): string {
    const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    return `id: ${event.id}\nevent: ${event.event}\ndata: ${dataStr}\n\n`;
  }
}
