import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "../src/server/metrics";
import { TokenBucket } from "../src/server/rate-limit";

describe("transport safeguards", () => {
  it("rejects work beyond the burst capacity", () => {
    const bucket = new TokenBucket(10, 5, 1_000);
    expect(bucket.take(8, 1_000)).toBe(true);
    expect(bucket.take(3, 1_000)).toBe(false);
  });

  it("refills tokens over elapsed time without exceeding capacity", () => {
    const bucket = new TokenBucket(10, 5, 1_000);
    expect(bucket.take(10, 1_000)).toBe(true);
    expect(bucket.take(5, 2_000)).toBe(true);
    expect(bucket.take(6, 2_000)).toBe(false);
  });

  it("renders Prometheus counters and histograms", () => {
    const metrics = new MetricsRegistry();
    metrics.activeConnections = 2;
    metrics.acceptedOperations = 7;
    metrics.observeBatchLatency(4);
    const output = metrics.render();
    expect(output).toContain("converge_websocket_connections 2");
    expect(output).toContain("converge_operations_accepted_total 7");
    expect(output).toContain('converge_batch_persist_duration_ms_bucket{le="5"} 1');
  });
});
