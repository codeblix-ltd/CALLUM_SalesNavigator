const ScoutApi = (() => {
  const AUTH_KEY = "callumScoutAuth";
  const config = globalThis.LEADS_EXTENSION_CONFIG;
  let refreshPromise = null;

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
    const auth = await getAuth();
    if (!auth?.token || !auth.refreshToken) {
      throw new Error("Sign in is required.");
    }
    try {
      return await callAction(path, args, auth.token);
    } catch (firstError) {
      if (!looksLikeAuthError(firstError)) {
        throw firstError;
      }
      const recoveredAuth = await recoverAuthentication(auth);
      try {
        return await callAction(path, args, recoveredAuth.token);
      } catch (retryError) {
        if (!looksLikeAuthError(retryError)) throw retryError;

        const latestAuth = await getAuth();
        if (isDifferentSession(latestAuth, recoveredAuth)) {
          return callAction(path, args, latestAuth.token);
        }
        await clearAuthIfUnchanged(recoveredAuth);
        throw new Error("Your session expired. Sign in again.");
      }
    }
  }

  async function recoverAuthentication(staleAuth) {
    const latestAuth = await getAuth();
    if (isDifferentSession(latestAuth, staleAuth)) {
      return latestAuth;
    }

    try {
      return await refreshOnce(latestAuth || staleAuth);
    } catch {
      // Another extension context may have rotated the refresh token while this
      // one was retrying. Prefer that new session instead of deleting it.
      const racedAuth = await getAuth();
      if (isDifferentSession(racedAuth, staleAuth)) {
        return racedAuth;
      }
      await clearAuthIfUnchanged(staleAuth);
      throw new Error("Your session expired. Sign in again.");
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
    const currentAuth = await getAuth();
    if (isDifferentSession(currentAuth, auth)) {
      return currentAuth;
    }
    await chrome.storage.local.set({ [AUTH_KEY]: refreshed });
    return refreshed;
  }

  function isDifferentSession(left, right) {
    return Boolean(
      left?.token &&
        left.refreshToken &&
        (left.token !== right?.token || left.refreshToken !== right?.refreshToken),
    );
  }

  async function clearAuthIfUnchanged(expectedAuth) {
    const currentAuth = await getAuth();
    if (
      currentAuth?.token === expectedAuth?.token &&
      currentAuth?.refreshToken === expectedAuth?.refreshToken
    ) {
      await chrome.storage.local.remove(AUTH_KEY);
    }
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
      "Convex-Client": "callum-scout-extension-0.5.0",
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
      throw requestError(
        `Convex returned an invalid response (${response.status}).`,
        response.status,
      );
    }
    if (payload.status === "error") {
      throw requestError(cleanError(payload.errorMessage), response.status);
    }
    if (!response.ok || payload.status !== "success") {
      throw requestError(
        `Convex request failed (${response.status}).`,
        response.status,
      );
    }
    return payload.value;
  }

  function requestError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function cleanError(value) {
    return String(value || "Request failed.")
      .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
      .replace(/^(?:Uncaught (?:Error|ConvexError):\s*)+/, "")
      .split("\n")[0];
  }

  function looksLikeAuthError(error) {
    return (
      error?.status === 401 ||
      error?.status === 403 ||
      /auth|sign in|token|session|identity|\b401\b|\b403\b/i.test(String(error))
    );
  }

  return {
    getAuth,
    signIn,
    signOut,
    authenticatedAction,
  };
})();

globalThis.ScoutApi = ScoutApi;
