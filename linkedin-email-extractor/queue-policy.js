export const RATE_LIMIT_RETRY_DELAY_MS = 180_000;

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

export function isRateLimitFailure(status, error) {
  return Number(status) === 429 || isRateLimitMessage(error);
}

export function rateLimitAction(rateLimitRetryCount) {
  return Number(rateLimitRetryCount || 0) < 1 ? "retry" : "pause";
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

export function isLinkedInUrlError(error) {
  const text = String(error || "");
  return (
    /could not resolve linkedin url/i.test(text) ||
    /redirected to a non-profile page/i.test(text) ||
    /non-profile page/i.test(text) ||
    /not a valid linkedin profile url/i.test(text) ||
    /invalid linkedin url/i.test(text)
  );
}

export function shouldPauseQueueOnError(status, error) {
  if (!["error", "timeout"].includes(status)) return false;
  if (isLinkedInUrlError(error)) return false;
  return true;
}

