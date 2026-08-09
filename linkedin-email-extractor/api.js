import { EXTENSION_CONFIG } from "./config.js";

const AUTH_KEY = "mailmeteorAdminAuth";
let refreshPromise = null;

export const WorkEmailApi = Object.freeze({
  getAuth,
  signIn,
  signOut,
  authenticatedAction,
});

async function signIn(username, password) {
  const params = {
    username: String(username).trim().toLowerCase(),
    password: String(password),
    flow: "signIn",
  };
  let result;
  try {
    result = await callAction("auth:signIn", { provider: "admin", params });
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    result = await callAction("auth:signIn", {
      provider: "admin",
      params: { ...params, flow: "signUp" },
    });
  }
  if (!result?.tokens?.token || !result.tokens.refreshToken) {
    throw new Error("Administrator sign-in did not return a session.");
  }
  const auth = {
    token: result.tokens.token,
    refreshToken: result.tokens.refreshToken,
    username: params.username,
  };
  await chrome.storage.local.set({ [AUTH_KEY]: auth });
  return auth;
}

async function signOut() {
  const auth = await getAuth();
  try {
    if (auth?.token) await callAction("auth:signOut", {}, auth.token);
  } finally {
    await chrome.storage.local.remove(AUTH_KEY);
  }
}

async function authenticatedAction(path, args = {}) {
  const auth = await getAuth();
  if (!auth?.token || !auth.refreshToken) {
    throw new Error("Administrator sign-in is required before using the database.");
  }
  try {
    return await callAction(path, args, auth.token);
  } catch (firstError) {
    if (!looksLikeAuthError(firstError)) throw firstError;
    const recovered = await refreshOnce(auth);
    try {
      return await callAction(path, args, recovered.token);
    } catch (retryError) {
      if (!looksLikeAuthError(retryError)) throw retryError;
      await clearAuthIfUnchanged(recovered);
      throw new Error("Your administrator session expired. Sign in again.");
    }
  }
}

function refreshOnce(auth) {
  if (!refreshPromise) {
    refreshPromise = refresh(auth).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function refresh(auth) {
  const latest = await getAuth();
  if (isDifferentSession(latest, auth)) return latest;
  const result = await callAction("auth:signIn", { refreshToken: auth.refreshToken });
  if (!result?.tokens?.token || !result.tokens.refreshToken) {
    throw new Error("Your administrator session expired. Sign in again.");
  }
  const refreshed = {
    ...auth,
    token: result.tokens.token,
    refreshToken: result.tokens.refreshToken,
  };
  const current = await getAuth();
  if (isDifferentSession(current, auth)) return current;
  await chrome.storage.local.set({ [AUTH_KEY]: refreshed });
  return refreshed;
}

async function getAuth() {
  const values = await chrome.storage.local.get(AUTH_KEY);
  return values[AUTH_KEY] ?? null;
}

async function clearAuthIfUnchanged(expected) {
  const current = await getAuth();
  if (
    current?.token === expected?.token &&
    current?.refreshToken === expected?.refreshToken
  ) {
    await chrome.storage.local.remove(AUTH_KEY);
  }
}

function isDifferentSession(left, right) {
  return Boolean(
    left?.token &&
      left.refreshToken &&
      (left.token !== right?.token || left.refreshToken !== right?.refreshToken),
  );
}

async function callAction(path, args = {}, token) {
  const convexUrl = EXTENSION_CONFIG.CONVEX_URL;
  if (!convexUrl || convexUrl.includes("your-deployment")) {
    throw new Error("The lead database connection is not configured.");
  }
  const headers = {
    "Content-Type": "application/json",
    "Convex-Client": "mailmeteor-work-email-extension-2.0.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${convexUrl}/api/action`, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({
      path,
      format: "convex_encoded_json",
      args: [args],
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!payload) {
    throw requestError("The lead database did not return a readable response.", response.status);
  }
  if (payload.status === "error") {
    throw requestError(cleanError(payload.errorMessage), response.status);
  }
  if (!response.ok || payload.status !== "success") {
    throw requestError("The lead database request failed.", response.status);
  }
  return payload.value;
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanError(value) {
  return String(value || "The lead database request failed.")
    .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
    .replace(/^(?:Uncaught (?:Error|ConvexError):\s*)+/, "")
    .split("\n")[0];
}

function looksLikeAuthError(error) {
  return (
    error?.status === 401 ||
    error?.status === 403 ||
    /auth|sign in|token|session|identity|administrator|\b401\b|\b403\b/i.test(String(error))
  );
}

function isRateLimitError(error) {
  return error?.status === 429 || /rate.?limit|too many requests|\b429\b/i.test(String(error));
}
