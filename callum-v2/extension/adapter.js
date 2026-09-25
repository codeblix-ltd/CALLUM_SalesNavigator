globalThis.CallumAdapter = (() => {
  const norm = x => String(x || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const tokens = x => norm(x).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  const nameMatches = (shown,expected) => { const a=tokens(shown),b=tokens(expected);return b.length>0 && b.every(t=>a.includes(t)); };
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const first = (root, selectors) => { for (const selector of selectors) { try { const el = [...root.querySelectorAll(selector)].find(visible); if (el) return el; } catch {} } return null; };
  const labelled = (root, labels) => [...root.querySelectorAll('button,a,[role="button"],[role="menuitem"]')].find(el => visible(el) && labels.some(label => {
    const text = norm(el.getAttribute('aria-label') || el.textContent);
    return text === norm(label) || text.startsWith(`${norm(label)} `);
  })) || null;
  const key = raw => { try { const u = new URL(raw); return ['linkedin.com','www.linkedin.com'].includes(u.hostname) && u.protocol === 'https:' && /^\/in\/[a-z0-9_%.-]+\/?$/i.test(u.pathname) ? decodeURIComponent(u.pathname.split('/')[2]).toLowerCase() : null; } catch { return null; } };
  function context(config, command) {
    CallumConfig.validate(config);
    const currentKey = key(location.href), expectedKey = norm(command.targetProfileKey);
    const expectedName = command.payload?.expectedName;
    const headings=config.profileHeading.flatMap(selector=>{try{return [...document.querySelectorAll(selector)].filter(visible)}catch{return []}});
    const heading=expectedName?headings.find(el=>nameMatches(el.textContent,expectedName)):headings[0];
    const scopes=config.actionScope.flatMap(selector=>{try{return [...document.querySelectorAll(selector)].filter(visible)}catch{return []}});
    const scope=scopes.find(el=>heading&&el.contains(heading))||null;
    return { currentKey, matched: currentKey === expectedKey && !!heading, heading, scope };
  }
  function actions(scope, config) {
    if (!scope) return { connect: null, more: null, pending: null, connected: null };
    return {
      connect: first(scope, config.connect) || labelled(scope, config.labels.connect),
      more: first(scope, config.more) || labelled(scope, config.labels.more),
      pending: first(scope, config.pending) || labelled(scope, config.labels.pending),
      connected: first(scope, config.connected) || labelled(scope, config.labels.connected)
    };
  }
  function actionMenu(more) {
    const controlled=more?.getAttribute('aria-controls');
    if(controlled){const element=document.getElementById(controlled);if(visible(element))return element;}
    return [...document.querySelectorAll('[role="menu"],[role="listbox"]')].filter(visible).at(-1)||null;
  }
  function relationship(scope, config) {
    if (!scope) return 'unknown';
    const badges = [...scope.querySelectorAll('span,div')].filter(visible).map(x => norm(x.textContent)).filter(x => x.length <= 15);
    for (let i = 0; i < 3; i++) if (badges.some(x => x.replace(/^[·•]\s*/, '') === norm(config.degree[i]))) return ['first','second','third'][i];
    return 'unknown';
  }
  async function observe(config, command) {
    const ctx = context(config, command);
    if (!ctx.matched) return { profileMatched: false, profileKey: ctx.currentKey, relationship: 'unknown', connectAvailable: false, pendingVisible: false, connectedVisible: false, pageReady: !!ctx.heading, diagnosticCode: 'PROFILE_MISMATCH' };
    if (!ctx.scope) return { profileMatched: true, profileKey: ctx.currentKey, relationship: 'unknown', connectAvailable: false, pendingVisible: false, connectedVisible: false, pageReady: false, diagnosticCode: 'PAGE_HYDRATING' };
    let state = actions(ctx.scope, config);
    if (!state.connect && !state.pending && !state.connected && state.more) {
      state.more.click();
      await new Promise(r => setTimeout(r, Math.min(config.waitMs, 500)));
      const menu = actionMenu(state.more);
      if (menu) state = { ...state, connect: labelled(menu, config.labels.connect), pending: labelled(menu, config.labels.pending) };
    }
    const pendingVisible = !!state.pending;
    const relationshipState = relationship(ctx.scope, config);
    const connectedVisible = !!state.connected && relationshipState === 'first';
    const connectAvailable = !!state.connect && !pendingVisible && !connectedVisible;
    return { profileMatched: true, profileKey: ctx.currentKey, relationship: relationshipState, connectAvailable,
      pendingVisible, connectedVisible, pageReady: true, diagnosticCode: pendingVisible ? 'ALREADY_PENDING' : connectedVisible ? 'ALREADY_CONNECTED' : connectAvailable ? 'OK' : 'ACTION_UNAVAILABLE' };
  }
  async function connect(config, command) {
    const before = await observe(config, command);
    if (!before.profileMatched || !before.pageReady || before.pendingVisible || before.connectedVisible || !before.connectAvailable) return { status: 'not_submitted', facts: before };
    const ctx = context(config, command);
    let action = actions(ctx.scope, config).connect;
    if (!action) {
      const menu = actionMenu(actions(ctx.scope, config).more);
      action = menu && labelled(menu, config.labels.connect);
    }
    if (!action) return { status: 'not_submitted', facts: { ...before, connectAvailable: false, diagnosticCode: 'ACTION_UNAVAILABLE' } };
    action.click();
    await new Promise(r => setTimeout(r, 300));
    const dialog = first(document, ['[role="dialog"]', '.artdeco-modal']);
    if (dialog) {
      const send = labelled(dialog, config.labels.send);
      if (!send) return { status: 'not_submitted', facts: { ...before, diagnosticCode: 'ACTION_UNAVAILABLE' } };
      send.click();
    }
    const end = Date.now() + config.waitMs;
    while (Date.now() < end) {
      const after = await observe(config, command);
      if (after.pendingVisible) return { status: 'confirmed', facts: { ...after, diagnosticCode: 'OK' } };
      await new Promise(r => setTimeout(r, 250));
    }
    return { status: 'uncertain', facts: { ...before, connectAvailable: false, diagnosticCode: 'POSTCONDITION_UNKNOWN' } };
  }
  return { observe, connect, key };
})();
