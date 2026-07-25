export interface PipelineMetrics {
  accepted: number;
  processed: number;
  dropped: number;
  outOfOrder: number;
  queued: number;
  processing: boolean;
  lastLatencyMs: number;
  maxLatencyMs: number;
}

/** Single-consumer bounded queue for native telemetry. */
export class BoundedFramePipeline<T extends { timestamp: number }> {
  private readonly queue: Array<{ value: T; acceptedAt: number }> = [];
  private draining = false;
  private lastTimestamp = -Infinity;
  private idleWaiters: Array<() => void> = [];
  private metrics: PipelineMetrics = { accepted: 0, processed: 0, dropped: 0, outOfOrder: 0, queued: 0, processing: false, lastLatencyMs: 0, maxLatencyMs: 0 };

  constructor(private readonly capacity: number, private readonly consume: (value: T) => Promise<void>, private readonly maximumQueueAgeMs = Infinity) {
    if (!Number.isInteger(capacity) || capacity < 2) throw new Error("Pipeline capacity must be at least two frames");
    if (maximumQueueAgeMs <= 0) throw new Error("Maximum queue age must be positive");
  }

  push(value: T): boolean {
    if (!Number.isFinite(value.timestamp)) return false;
    if (value.timestamp <= this.lastTimestamp || this.queue.some(item => item.value.timestamp >= value.timestamp)) {
      this.metrics.outOfOrder++; return false;
    }
    this.metrics.accepted++;
    if (this.queue.length >= this.capacity) {
      // Keep current state fresh: discard the oldest waiting frame, never the
      // frame already being consumed.
      this.queue.shift(); this.metrics.dropped++;
    }
    this.queue.push({ value, acceptedAt: Date.now() });
    this.metrics.queued = this.queue.length;
    if (!this.draining) void this.drain();
    return true;
  }

  snapshot(): PipelineMetrics { return { ...this.metrics, queued: this.queue.length, processing: this.draining }; }

  async idle(): Promise<void> {
    if (!this.draining && !this.queue.length) return;
    await new Promise<void>(resolve => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    this.draining = true; this.metrics.processing = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!; this.metrics.queued = this.queue.length;
        if (Date.now() - item.acceptedAt > this.maximumQueueAgeMs) { this.metrics.dropped++; continue; }
        if (item.value.timestamp <= this.lastTimestamp) { this.metrics.outOfOrder++; continue; }
        this.lastTimestamp = item.value.timestamp;
        await this.consume(item.value);
        const latency = Math.max(0, Date.now() - item.acceptedAt);
        this.metrics.processed++; this.metrics.lastLatencyMs = latency; this.metrics.maxLatencyMs = Math.max(this.metrics.maxLatencyMs, latency);
      }
    } finally {
      this.draining = false; this.metrics.processing = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}
