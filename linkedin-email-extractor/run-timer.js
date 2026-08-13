export function getRunDurationMs(state, now = Date.now()) {
  const startedAt = Number(state?.createdAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;

  const completedAt = Number(state?.completedAt);
  const updatedAt = Number(state?.updatedAt);
  const endedAt = Number.isFinite(completedAt) && completedAt >= startedAt
    ? completedAt
    : state?.running
      ? now
      : Number.isFinite(updatedAt) && updatedAt >= startedAt
        ? updatedAt
        : now;

  return Math.max(0, endedAt - startedAt);
}

export function formatRunDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
