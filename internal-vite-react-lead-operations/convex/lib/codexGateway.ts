type GatewayRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
};

export async function requestCodexGateway<T>(
  pathname: string,
  options: GatewayRequestOptions = {},
): Promise<T> {
  const baseUrl = process.env.CODEX_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.CODEX_GATEWAY_SHARED_SECRET?.trim();
  if (!baseUrl || !secret) {
    throw new Error(
      "The Codex gateway is not configured. Set CODEX_GATEWAY_URL and CODEX_GATEWAY_SHARED_SECRET in Convex.",
    );
  }
  let url: URL;
  try {
    url = new URL(`${baseUrl}${pathname}`);
  } catch {
    throw new Error("CODEX_GATEWAY_URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new Error("CODEX_GATEWAY_URL must use HTTPS.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 25_000,
  );
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${secret}`,
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `Codex gateway returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The Codex gateway request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
