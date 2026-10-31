import type { Frame } from './protocol/types';

export type WriteFn = (bytes: Uint8Array) => Promise<void>;

/**
 * Serialises BLE writes with a minimum gap between them. Pending frames with the same key
 * are coalesced (only the newest is sent), so dragging a colour wheel never floods the controller.
 */
export class CommandQueue {
  private pending: Frame[] = [];
  private running = false;
  private lastSent = new Map<string, string>();
  sentCount = 0;
  droppedCount = 0;

  constructor(
    private write: WriteFn,
    private minGapMs = 25,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Queue a frame. `force` bypasses duplicate suppression (e.g. after reconnect). */
  push(frame: Frame, force = false): void {
    const sig = Array.from(frame.bytes).join(',');
    if (!force && this.lastSent.get(frame.key) === sig && !this.pending.some((p) => p.key === frame.key)) {
      this.droppedCount++;
      return;
    }
    const idx = this.pending.findIndex((p) => p.key === frame.key);
    if (idx >= 0) {
      this.pending[idx] = frame;
      this.droppedCount++;
    } else {
      this.pending.push(frame);
    }
    void this.drain();
  }

  /** Forget what was sent so the next frames go out even if identical. */
  resetDedup(): void {
    this.lastSent.clear();
  }

  clear(): void {
    this.pending = [];
  }

  get size(): number {
    return this.pending.length;
  }

  async idle(): Promise<void> {
    while (this.running || this.pending.length) await this.sleep(5);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const f = this.pending.shift()!;
        try {
          await this.write(f.bytes);
          this.lastSent.set(f.key, Array.from(f.bytes).join(','));
          this.sentCount++;
        } catch {
          // The controller layer handles reconnection; drop the frame and keep the queue alive.
          this.lastSent.delete(f.key);
        }
        if (this.pending.length) await this.sleep(this.minGapMs);
      }
    } finally {
      this.running = false;
    }
  }
}
