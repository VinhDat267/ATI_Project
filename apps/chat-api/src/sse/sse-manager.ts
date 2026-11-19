import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isUuid } from '../db/repositories/uuid.js';

const CLOSED_CONVERSATION_GRACE_MS = 5 * 60_000;
const conversationKey = (id: string) => isUuid(id) ? id.toLowerCase() : id;

export interface SSEEvent {
  id: number;
  event: string;
  data: any;
  timestamp: number;
}

export class SSEManager {
  private readonly epoch = randomUUID();
  private seqMap = new Map<string, number>();
  private bufferMap = new Map<string, SSEEvent[]>();
  private clientsMap = new Map<string, Set<Response>>();
  private recentlyClosed = new Map<string, number>();
  private maxBufferSize = 100;

  emitEvent(convId: string, eventName: string, data: any): SSEEvent {
    convId = conversationKey(convId);
    const currentSeq = (this.seqMap.get(convId) || 0) + 1;
    const sseEvent: SSEEvent = {
      id: currentSeq,
      event: eventName,
      data,
      timestamp: Date.now(),
    };
    if (this.isConversationClosed(convId)) return sseEvent;
    this.seqMap.set(convId, currentSeq);

    // Store in circular buffer (supersede older buffered plan previews when emitting a new one)
    if (eventName === 'plan' || eventName === 'plan_preview') {
      this.clearPlanEvents(convId);
    }
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
    convId = conversationKey(convId);
    const buffer = this.bufferMap.get(convId);
    if (!buffer) {
      return [];
    }
    return buffer.filter((e) => e.id > lastEventId);
  }

  clearPlanEvents(convId: string, planId?: string): void {
    convId = conversationKey(convId);
    const buffer = this.bufferMap.get(convId);
    if (!buffer) {
      return;
    }
    this.bufferMap.set(
      convId,
      buffer.filter((e) => {
        if (e.event !== 'plan' && e.event !== 'plan_preview') {
          return true;
        }
        if (!planId) {
          return false;
        }
        let payload = e.data;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = null;
          }
        }
        return !(
          payload?.planId === planId ||
          payload?.plan?.id === planId ||
          payload?.id === planId
        );
      })
    );
  }

  getMissedEventsForCursor(convId: string, cursor: string | undefined): SSEEvent[] {
    const [epoch, sequence] = (cursor || '').split(':');
    if (epoch !== this.epoch || !sequence || !/^\d+$/.test(sequence)) {
      return this.getMissedEvents(convId, 0);
    }
    return this.getMissedEvents(convId, Number(sequence));
  }

  addClient(convId: string, res: Response): () => void {
    convId = conversationKey(convId);
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
    convId = conversationKey(convId);
    const clients = this.clientsMap.get(convId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.clientsMap.delete(convId);
      }
    }
  }

  getClientCount(convId: string): number {
    return this.clientsMap.get(conversationKey(convId))?.size || 0;
  }

  closeConversation(convId: string): void {
    convId = conversationKey(convId);
    const now = Date.now();
    for (const [id, expires] of this.recentlyClosed) {
      if (expires > now) break;
      this.recentlyClosed.delete(id);
    }
    this.recentlyClosed.set(convId, now + CLOSED_CONVERSATION_GRACE_MS);
    const clients = this.clientsMap.get(convId);
    this.clientsMap.delete(convId);
    this.bufferMap.delete(convId);
    this.seqMap.delete(convId);
    for (const client of clients ?? []) client.end();
  }

  isConversationClosed(convId: string): boolean {
    return (this.recentlyClosed.get(conversationKey(convId)) ?? 0) > Date.now();
  }

  formatSSE(event: SSEEvent): string {
    const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    return `id: ${this.epoch}:${event.id}\nevent: ${event.event}\ndata: ${dataStr}\n\n`;
  }
}
