const ScoutApi = (() => {
  const AUTH_KEY = "callumScoutAuth";
  const config = globalThis.LEADS_EXTENSION_CONFIG;
  const ACTION_TIMEOUT_MS = 45_000;
  const AI_ACTIONS = new Set([
    "scouts:classifyLanguages",
    "scouts:draftComment",
    "scouts:draftConnectionNote",
  ]);
  let refreshPromise = null;
  const inFlightReads = new Map();
  const aiRequests = new Map();
  const READ_ACTIONS = new Set(["scouts:getDashboard", "scouts:getScoutOperations", "scouts:getLeadProgress"]);

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
      throw new Error("We couldn’t sign you in. Try again.");
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

  async function authenticatedAction(path, args = {}, options = {}) {
    if (options.expectedUsername) {
      return authenticatedRequest(path, args, "action", null, options.expectedUsername);
    }
    if (AI_ACTIONS.has(path)) {
      const auth = await getAuth();
      const key = JSON.stringify([auth?.username, auth?.token, path, args]);
      if (!aiRequests.has(key)) {
        aiRequests.set(key, runAiJob(path, args, auth).finally(() => aiRequests.delete(key)));
      }
      return aiRequests.get(key);
    }
    if (READ_ACTIONS.has(path)) {
      const auth = await getAuth();
      const key = JSON.stringify([auth?.token, path, args]);
      if (!inFlightReads.has(key)) {
        inFlightReads.set(key, authenticatedRequest(path, args).finally(() => inFlightReads.delete(key)));
      }
      return inFlightReads.get(key);
    }
    return authenticatedRequest(path, args);
  }

  async function runAiJob(path, args, startingAuth) {
    if (!startingAuth?.token) throw new Error("Sign in is required.");
    const deadline = Date.now() + 120_000;
    let timer;
    try {
      return await Promise.race([
        waitForAiJob(path, args, startingAuth, deadline),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The writing service is taking longer than usual. Wait a minute, then press Resume.")), 120_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function waitForAiJob(path, args, startingAuth, deadline) {
    let delayMs = 2_000;
    let receipt;
    let waitingForEarlierJob = false;
    while (Date.now() < deadline) {
      const current = await getAuth();
      if (!current?.token || current.username !== startingAuth.username) throw new Error("Your session changed. Sign in again.");
      if (!receipt) {
        try {
          receipt = await authenticatedRequest(path.replace("scouts:", "scoutAi:"), args, "action", deadline, startingAuth.username);
          waitingForEarlierJob = false;
        } catch (error) {
          if (!/AI check is already running/i.test(error.message)) throw error;
          receipt = await authenticatedRequest("scoutAiJobs:active", {}, "query", deadline, startingAuth.username);
          waitingForEarlierJob = true;
          if (!receipt) { await new Promise(resolve => setTimeout(resolve, 1_000)); continue; }
        }
      }
      const job = await authenticatedRequest("scoutAiJobs:get", receipt, "query", deadline, startingAuth.username);
      if (waitingForEarlierJob && (job.status !== "pending" || (job.expiresAt && Date.now() >= job.expiresAt))) {
        // The prior result belongs to another stage. Never return it as this
        // request's output. Submit our original arguments after it settles.
        receipt = null;
        continue;
      }
      if (job.status === "complete") return JSON.parse(job.result);
      if (job.status === "failed") throw new Error(cleanError(job.error));
      if (job.expiresAt && Date.now() >= job.expiresAt) throw new Error("The AI job timed out. Please retry.");
      await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, Math.max(0, deadline - Date.now()))));
      delayMs = Math.min(10_000, Math.round(delayMs * 1.5));
    }
    throw new Error("The writing service is taking longer than usual. Wait a minute, then press Resume.");
  }

  async function authenticatedRequest(path, args = {}, kind = "action", deadline = null, expectedUsername = null) {
    const auth = await getAuth();
    const assertExpected = value => {
      if (expectedUsername && value?.username !== expectedUsername) throw new Error("Your session changed. Sign in again.");
    };
    assertExpected(auth);
    if (!auth?.token || !auth.refreshToken) {
      throw new Error("Sign in is required.");
    }
    try {
      return await callAction(path, args, auth.token, kind, deadline);
    } catch (firstError) {
      if (!looksLikeAuthError(firstError)) {
        throw firstError;
      }
      const recoveredAuth = await recoverAuthentication(auth);
      assertExpected(recoveredAuth);
      try {
        return await callAction(path, args, recoveredAuth.token, kind, deadline);
      } catch (retryError) {
        if (!looksLikeAuthError(retryError)) throw retryError;

        const latestAuth = await getAuth();
        if (isDifferentSession(latestAuth, recoveredAuth)) {
          assertExpected(latestAuth);
          return callAction(path, args, latestAuth.token, kind, deadline);
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

  async function callAction(path, args = {}, token, kind = "action", deadline = null) {
    const convexUrl = config?.CONVEX_URL;
    if (!convexUrl || convexUrl.includes("your-deployment")) {
      throw new Error(
        "Callum Scout is not ready yet. Ask your manager for help.",
      );
    }
    const headers = {
      "Content-Type": "application/json",
      "Convex-Client": "callum-scout-extension-0.6.0",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeoutMs = deadline === null ? ACTION_TIMEOUT_MS : Math.min(ACTION_TIMEOUT_MS, deadline - Date.now());
    if (timeoutMs <= 0) throw new Error("The writing service is taking longer than usual. Wait a minute, then press Resume.");
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let payload;
    try {
      response = await fetch(`${convexUrl}/api/${kind}`, {
        method: "POST",
        headers,
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          path,
          format: "convex_encoded_json",
          args: [args],
        }),
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      if (error?.name === "AbortError") {
        throw requestError(
          `Callum Scout took longer than ${Math.round(timeoutMs / 1_000)} seconds to respond. Check your internet and retry this lead.`,
          408,
        );
      }
      if (/failed to fetch|networkerror|network request failed/i.test(String(error))) {
        throw requestError(
          "Callum Scout lost its internet connection. Check your connection and retry this lead.",
          0,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!payload) {
      throw requestError(
        "We couldn’t reach Callum Scout. Try again.",
        response.status,
      );
    }
    if (payload.status === "error") {
      throw requestError(cleanError(payload.errorMessage), response.status);
    }
    if (!response.ok || payload.status !== "success") {
      throw requestError(
        "Callum Scout did not respond. Try again.",
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
    const message = String(value || "Something went wrong. Try again.")
      .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
      .replace(/^(?:Uncaught (?:Error|ConvexError):\s*)+/, "")
      .split("\n")[0];

    if (/invalid.*(?:credential|password|account)|wrong.*(?:password|username)/i.test(message)) {
      return "Your username or password is wrong.";
    }
    if (/account.*(?:disabled|not active|not authorized)/i.test(message)) {
      return "You can’t use this account. Ask your manager for help.";
    }
    if (/sign in is required/i.test(message)) {
      return "Please sign in.";
    }
    if (/engagement limit/i.test(message)) {
      return "You’ve used all your likes for today.";
    }
    if (/connection-request limit/i.test(message)) {
      return "You’ve sent all your connection requests for today.";
    }
    if (/post activity requires|post text must/i.test(message)) {
      return "We couldn’t read this post. Try again.";
    }
    if (/not available for post engagement|must complete engagement|reserved connection-request|cannot move a lead|status is recorded by/i.test(message)) {
      return "This lead is no longer ready. Refresh the extension and try again.";
    }
    if (/accepted assigned lead can expose contact info/i.test(message)) {
      return "This lead is not ready for contact info yet.";
    }
    if (/valid https linkedin|linkedin url must|post permalink/i.test(message)) {
      return "This LinkedIn link does not work.";
    }
    if (/gateway.*(?:timed out|could not complete|HTTP 5|busy)|writing service|fetch failed|service unavailable/i.test(message)) {
      return "The writing service is temporarily unavailable. Wait a minute, then press Resume.";
    }
    if (/codex gateway|convex|cockroach_database_url/i.test(message)) {
      return "Callum Scout isn’t ready. Ask your manager for help.";
    }
    return message;
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
    authenticatedQuery: (path, args = {}) => authenticatedRequest(path, args, "query"),
    authenticatedMutation: (path, args = {}) => authenticatedRequest(path, args, "mutation"),
  };
})();

globalThis.ScoutApi = ScoutApi;
