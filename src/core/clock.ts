import type { ActorId, HybridTimestamp } from "./types.js";

export const ZERO_TIMESTAMP: HybridTimestamp = {
  wallTime: 0,
  logical: 0,
  actor: "system",
};

export function compareTimestamps(a: HybridTimestamp, b: HybridTimestamp): number {
  if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
  if (a.logical !== b.logical) return a.logical - b.logical;
  return a.actor.localeCompare(b.actor);
}

export function tick(
  previous: HybridTimestamp,
  actor: ActorId,
  now = Date.now(),
): HybridTimestamp {
  const wallTime = Math.max(now, previous.wallTime);
  return {
    wallTime,
    logical: wallTime === previous.wallTime ? previous.logical + 1 : 0,
    actor,
  };
}

export function observe(
  local: HybridTimestamp,
  remote: HybridTimestamp,
  actor: ActorId,
  now = Date.now(),
): HybridTimestamp {
  const wallTime = Math.max(now, local.wallTime, remote.wallTime);
  let logical = 0;

  if (wallTime === local.wallTime && wallTime === remote.wallTime) {
    logical = Math.max(local.logical, remote.logical) + 1;
  } else if (wallTime === local.wallTime) {
    logical = local.logical + 1;
  } else if (wallTime === remote.wallTime) {
    logical = remote.logical + 1;
  }

  return { wallTime, logical, actor };
}
