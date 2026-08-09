export function describeHttpFailure(status) {
  const code = Number(status);
  if (code === 429) {
    return "Mailmeteor rate limit detected (HTTP 429).";
  }
  if (Number.isFinite(code) && code >= 400) {
    return `Mailmeteor returned HTTP ${code}.`;
  }
  return null;
}

export function isRateLimitMessage(value) {
  return /rate.?limit|too many requests|try again later|quota|\b429\b/i.test(String(value || ""));
}

export function isTransientFailure(status, error, outcome = "error") {
  const code = Number(status);
  if ([408, 425, 429].includes(code) || (code >= 500 && code <= 599)) return true;
  if (outcome === "timeout") return true;

  return /rate.?limit|too many requests|try again later|quota|temporar(?:y|ily)|timed?\s*out|network|connection (?:reset|closed|failed)|failed to fetch|net::err_|http (?:408|425|429|5\d\d)\b/i.test(
    String(error || ""),
  );
}

export function retryDelayMs(retryNumber) {
  const delays = [15_000, 30_000, 60_000];
  const index = Math.max(0, Math.min(delays.length - 1, Math.trunc(Number(retryNumber) || 1) - 1));
  return delays[index];
}
