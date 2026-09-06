const buckets = [1, 5, 10, 25, 50, 100, 250, 500];

export class MetricsRegistry {
  activeConnections = 0;
  acceptedOperations = 0;
  duplicateOperations = 0;
  rejectedMessages = 0;
  replayedOperations = 0;
  private readonly batchLatencyCounts = new Map(buckets.map((bucket) => [bucket, 0]));
  private batchLatencyTotalMs = 0;
  private batchLatencySamples = 0;

  observeBatchLatency(milliseconds: number): void {
    this.batchLatencyTotalMs += milliseconds;
    this.batchLatencySamples += 1;
    for (const bucket of buckets) {
      if (milliseconds <= bucket) this.batchLatencyCounts.set(bucket, this.batchLatencyCounts.get(bucket)! + 1);
    }
  }

  render(): string {
    const lines = [
      "# HELP converge_websocket_connections Current WebSocket connections.",
      "# TYPE converge_websocket_connections gauge",
      `converge_websocket_connections ${this.activeConnections}`,
      "# HELP converge_operations_accepted_total Operations durably accepted.",
      "# TYPE converge_operations_accepted_total counter",
      `converge_operations_accepted_total ${this.acceptedOperations}`,
      "# HELP converge_operations_duplicate_total Duplicate operation retries ignored.",
      "# TYPE converge_operations_duplicate_total counter",
      `converge_operations_duplicate_total ${this.duplicateOperations}`,
      "# HELP converge_messages_rejected_total Invalid or rate-limited messages rejected.",
      "# TYPE converge_messages_rejected_total counter",
      `converge_messages_rejected_total ${this.rejectedMessages}`,
      "# HELP converge_operations_replayed_total Operations replayed after reconnect.",
      "# TYPE converge_operations_replayed_total counter",
      `converge_operations_replayed_total ${this.replayedOperations}`,
      "# HELP converge_batch_persist_duration_ms Operation-batch persistence latency.",
      "# TYPE converge_batch_persist_duration_ms histogram",
      ...buckets.map((bucket) => `converge_batch_persist_duration_ms_bucket{le="${bucket}"} ${this.batchLatencyCounts.get(bucket)}`),
      `converge_batch_persist_duration_ms_bucket{le="+Inf"} ${this.batchLatencySamples}`,
      `converge_batch_persist_duration_ms_sum ${this.batchLatencyTotalMs.toFixed(3)}`,
      `converge_batch_persist_duration_ms_count ${this.batchLatencySamples}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}
