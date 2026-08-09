export function describeHttpFailure(status) {
  const code = Number(status);
  if (code === 429) {
    return "Mailmeteor rate limit detected (HTTP 429). The queue is paused at this lead.";
  }
  if (Number.isFinite(code) && code >= 400) {
    return `Mailmeteor returned HTTP ${code}. The queue is paused at this lead.`;
  }
  return null;
}

export function isRateLimitMessage(value) {
  return /rate.?limit|too many requests|try again later|quota|\b429\b/i.test(String(value || ""));
}
