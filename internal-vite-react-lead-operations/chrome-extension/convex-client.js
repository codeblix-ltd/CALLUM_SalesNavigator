const ScoutApi = (() => {
  const AUTH_KEY = "callumScoutAuth";
  const config = globalThis.LEADS_EXTENSION_CONFIG;

  async function signIn(username, password) {
    const result = await callAction("auth:signIn", {
      provider: "password",
      params: {
        username: String(username).trim().toLowerCase(),
        password,
        flow: "signIn",
      },
    });
    if (!result?.tokens?.token || !result.tokens.refreshToken) {
      throw new Error("Sign-in did not return a session.");
    }
    const auth = {
      token: result.tokens.token,
      refreshToken: result.tokens.refreshToken,
      username: String(username).trim().toLowerCase(),
    };
    await chrome.storage.local.set({ [AUTH_KEY]: auth });
    return auth;
  }

  async function signOut() {
    const auth = await getAuth();
    try {
      if (auth?.token) {
        await callAction("auth:signOut", {}, auth.token);
      }
    } finally {
      await chrome.storage.local.remove(AUTH_KEY);
    }
  }

  async function authenticatedAction(path, args = {}) {
    let auth = await getAuth();
    if (!auth?.token || !auth.refreshToken) {
      throw new Error("Sign in is required.");
    }
    try {
      return await callAction(path, args, auth.token);
    } catch (firstError) {
      if (!looksLikeAuthError(firstError)) {
        throw firstError;
      }
      try {
        auth = await refresh(auth);
        return await callAction(path, args, auth.token);
      } catch {
        await chrome.storage.local.remove(AUTH_KEY);
        throw firstError;
      }
    }
  }

  async function refresh(auth) {
    const result = await callAction("auth:signIn", {
      refreshToken: auth.refreshToken,
    });
    if (!result?.tokens?.token || !result.tokens.refreshToken) {
      throw new Error("Your session expired. Sign in again.");
    }
    const refreshed = {
      ...auth,
      token: result.tokens.token,
      refreshToken: result.tokens.refreshToken,
    };
    await chrome.storage.local.set({ [AUTH_KEY]: refreshed });
    return refreshed;
  }

  async function getAuth() {
    const values = await chrome.storage.local.get(AUTH_KEY);
    return values[AUTH_KEY] ?? null;
  }

  async function callAction(path, args = {}, token) {
    const convexUrl = config?.CONVEX_URL;
    if (!convexUrl || convexUrl.includes("your-deployment")) {
      throw new Error(
        "Extension is not configured. Run npm run extension:config.",
      );
    }
    const headers = {
      "Content-Type": "application/json",
      "Convex-Client": "callum-scout-extension-0.2.0",
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
      throw new Error(`Convex returned an invalid response (${response.status}).`);
    }
    if (payload.status === "error") {
      throw new Error(cleanError(payload.errorMessage));
    }
    if (!response.ok || payload.status !== "success") {
      throw new Error(`Convex request failed (${response.status}).`);
    }
    return payload.value;
  }

  function cleanError(value) {
    return String(value || "Request failed.")
      .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
      .replace(/^(?:Uncaught (?:Error|ConvexError):\s*)+/, "")
      .split("\n")[0];
  }

  function looksLikeAuthError(error) {
    return /auth|sign in|token|session|identity/i.test(String(error));
  }

  return {
    getAuth,
    signIn,
    signOut,
    authenticatedAction,
  };
})();

globalThis.ScoutApi = ScoutApi;
