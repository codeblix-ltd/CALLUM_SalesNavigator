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
  const postUrl = raw => {
    try {
      const url=new URL(raw,location.href);
      if(url.protocol!=='https:' || !['linkedin.com','www.linkedin.com'].includes(url.hostname))return null;
      if(!/^\/(?:feed\/update\/urn:li:activity:\d+|posts\/[a-z0-9_%.-]+)\/?$/i.test(url.pathname))return null;
      return `https://www.linkedin.com${url.pathname.replace(/\/$/,'')}`;
    }catch{return null;}
  };
  async function inspectCommentState(config, command) {
    const ctx=context(config,command);
    if(!ctx.matched)return {profileMatched:false,profileKey:ctx.currentKey,pageReady:!!ctx.heading,diagnosticCode:'PROFILE_MISMATCH'};
    if(!ctx.scope || !config.postScope || !config.postLink || !config.commentButton)return {profileMatched:true,profileKey:ctx.currentKey,pageReady:false,diagnosticCode:'PAGE_HYDRATING'};
    const nodes=[...new Set(config.postScope.flatMap(selector=>{try{return [...document.querySelectorAll(selector)].filter(visible)}catch{return []}}))].slice(0,20);
    const postUrls=[];let commentBoxAvailable=false;
    const target=postUrl(command.payload?.postUrl||'');let targetPostPresent=false;
    for(const node of nodes){
      const anchor=first(node,config.postLink);
      const urn=node.getAttribute('data-urn')||node.querySelector('[data-urn*="urn:li:activity:"]')?.getAttribute('data-urn');
      const url=postUrl(anchor?.getAttribute('href')||'') || (/(?:^|\b)urn:li:activity:\d+/.test(urn||'') ? postUrl(`/feed/update/${(urn||'').match(/urn:li:activity:\d+/)[0]}`) : null);
      if(!url || postUrls.includes(url))continue;
      if(url===target)targetPostPresent=true;
      if(postUrls.length<5)postUrls.push(url);
      else if(url===target)postUrls[4]=url;
      const available=!!first(node,config.commentButton);
      if(target){if(url===target)commentBoxAvailable=available;}
      else commentBoxAvailable ||= available;
    }
    return {profileMatched:true,profileKey:ctx.currentKey,pageReady:true,postUrls,
      targetPostPresent,commentBoxAvailable,
      diagnosticCode:postUrls.length?'OK':'NO_RECENT_POSTS'};
  }
  async function extractContactInfo(config, command) {
    const ctx=context(config,command);
    if(!ctx.matched)return {profileMatched:false,profileKey:ctx.currentKey,pageReady:!!ctx.heading,diagnosticCode:'PROFILE_MISMATCH'};
    if(!ctx.scope || !config.contactLink || !config.contactDialog || !config.contactEmail || !config.labels.contactInfo)return {profileMatched:true,profileKey:ctx.currentKey,pageReady:false,diagnosticCode:'PAGE_HYDRATING'};
    if(relationship(ctx.scope,config)!=='first')return {profileMatched:true,profileKey:ctx.currentKey,pageReady:true,diagnosticCode:'ACTION_UNAVAILABLE'};
    const link=first(ctx.scope,config.contactLink)||labelled(ctx.scope,config.labels.contactInfo);
    if(!link)return {profileMatched:true,profileKey:ctx.currentKey,pageReady:true,diagnosticCode:'ACTION_UNAVAILABLE'};
    const href=link.getAttribute('href');
    if(href){
      try{
        const target=new URL(href,location.href);
        if(!['linkedin.com','www.linkedin.com'].includes(target.hostname) || !target.pathname.toLowerCase().startsWith(`/in/${ctx.currentKey}/`))return {profileMatched:true,profileKey:ctx.currentKey,pageReady:true,diagnosticCode:'PROFILE_MISMATCH'};
      }catch{return {profileMatched:true,profileKey:ctx.currentKey,pageReady:true,diagnosticCode:'PROFILE_MISMATCH'};}
    }
    link.click();
    const end=Date.now()+config.waitMs;let dialog=null;
    while(Date.now()<end){
      const candidates=config.contactDialog.flatMap(selector=>{try{return [...document.querySelectorAll(selector)].filter(visible)}catch{return []}});
      dialog=candidates.find(node=>{
        const heading=node.querySelector('h1,h2,[role="heading"]');
        return heading && config.labels.contactInfo.some(label=>norm(heading.textContent)===norm(label));
      })||null;
      if(dialog)break;
      await new Promise(r=>setTimeout(r,250));
    }
    if(!dialog)return {profileMatched:true,profileKey:ctx.currentKey,pageReady:false,diagnosticCode:'PAGE_HYDRATING'};
    const mailto=first(dialog,config.contactEmail)?.getAttribute('href')||'';
    let contactEmail=null;
    try{contactEmail=decodeURIComponent(mailto.replace(/^mailto:/i,'').split('?')[0]).trim().toLowerCase()}catch{}
    if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contactEmail||'')||contactEmail.length>254)contactEmail=null;
    return {profileMatched:true,profileKey:ctx.currentKey,pageReady:true,contactInfoOpened:true,contactEmail,
      diagnosticCode:contactEmail?'OK':'CONTACT_INFO_EMPTY'};
  }
  function invitationAgeDays(card,config) {
    const candidates=config.invitationAge.flatMap(selector=>{try{return [...card.querySelectorAll(selector)].filter(visible)}catch{return []}});
    for(const node of candidates){
      const words=norm(node.textContent).split(' ');
      if(words.length!==4 || !config.labels.invitationSent.some(x=>norm(x)===words[0]) || !config.labels.invitationAgo.some(x=>norm(x)===words[3]))continue;
      const amount=/^\d{1,3}$/.test(words[1])?Number(words[1]):words[1]==='a'||words[1]==='an'?1:null;
      if(amount===null)continue;
      for(const [unit,days] of [['invitationDay',1],['invitationWeek',7],['invitationMonth',30],['invitationYear',365]]){
        if(config.labels[unit].some(x=>norm(x)===words[2]))return Math.min(amount*days,3650);
      }
    }
    return null;
  }
  function matchingInvitationCards(config,command,main) {
    const cards=[...new Set(config.invitationCard.flatMap(selector=>{try{return [...main.querySelectorAll(selector)].filter(visible)}catch{return []}}))].slice(0,100);
    const matches=[];
    for(const card of cards){
      const anchors=[...new Set(config.invitationProfile.flatMap(selector=>{try{return [...card.querySelectorAll(selector)].filter(visible)}catch{return []}}))];
      const profiles=anchors.map(anchor=>{try{return {anchor,profileKey:key(new URL(anchor.getAttribute('href'),location.href).href)}}catch{return null}}).filter(Boolean);
      const keys=[...new Set(profiles.map(x=>x.profileKey).filter(Boolean))];
      if(keys.length!==1 || keys[0]!==norm(command.targetProfileKey))continue;
      const anchor=profiles.find(x=>x.profileKey===keys[0])?.anchor;
      if(!anchor || !nameMatches(anchor.textContent,command.payload?.expectedName))continue;
      matches.push(card);
    }
    return matches;
  }
  async function inspectPendingInvitation(config,command) {
    CallumConfig.validate(config);
    let url;
    try{url=new URL(location.href)}catch{}
    const manager=url?.protocol==='https:' && ['linkedin.com','www.linkedin.com'].includes(url.hostname) &&
      /^\/mynetwork\/invitation-manager\/sent\/?$/i.test(url.pathname);
    if(!manager)return {profileMatched:false,profileKey:null,pageReady:false,diagnosticCode:'PROFILE_MISMATCH'};
    const main=document.querySelector('main');
    const marker=main && config.invitationPage.flatMap(selector=>{try{return [...main.querySelectorAll(selector)].filter(visible)}catch{return []}})
      .some(node=>config.labels.invitationPage.some(label=>norm(node.textContent)===norm(label)||norm(node.textContent).startsWith(`${norm(label)} `)));
    if(!marker)return {profileMatched:false,profileKey:null,pageReady:false,diagnosticCode:'PAGE_HYDRATING'};
    const matches=matchingInvitationCards(config,command,main);
    if(matches.length!==1)return {profileMatched:false,profileKey:null,pageReady:true,invitationFound:false,invitationNameMatched:false,
      diagnosticCode:matches.length?'UNEXPECTED_BROWSER_STATE':'INVITATION_NOT_FOUND'};
    const card=matches[0];
    const ageDays=invitationAgeDays(card,config);
    const withdraw=first(card,config.invitationWithdraw)||labelled(card,config.labels.invitationWithdraw);
    return {profileMatched:true,profileKey:norm(command.targetProfileKey),pageReady:true,invitationFound:true,invitationNameMatched:true,
      invitationAgeDays:ageDays,invitationWithdrawAvailable:!!withdraw,
      diagnosticCode:ageDays===null?'INVITATION_AGE_UNKNOWN':ageDays<30?'INVITATION_TOO_RECENT':withdraw?'OK':'ACTION_UNAVAILABLE'};
  }
  function visibleWithdrawDialogs(config) {
    return [...new Set(config.withdrawDialog.flatMap(selector=>{try{return [...document.querySelectorAll(selector)].filter(visible)}catch{return []}}))];
  }
  function matchingWithdrawDialog(config) {
    return visibleWithdrawDialogs(config).find(dialog=>{
      const heading=dialog.querySelector('h1,h2,[role="heading"]');
      return heading && config.labels.withdrawDialog.some(label=>norm(heading.textContent).startsWith(norm(label)));
    })||null;
  }
  async function withdraw(config,command) {
    const before=await inspectPendingInvitation(config,command);
    const safe=before.profileMatched && before.pageReady && before.invitationFound && before.invitationNameMatched &&
      before.invitationWithdrawAvailable && before.invitationAgeDays>=30;
    if(!safe)return {status:'not_submitted',facts:{...before,withdrawalTargetVerified:false}};
    if(visibleWithdrawDialogs(config).length)return {status:'uncertain',facts:{...before,withdrawalTargetVerified:true,diagnosticCode:'WITHDRAW_DIALOG_UNKNOWN'}};
    const cards=matchingInvitationCards(config,command,document.querySelector('main'));
    if(cards.length!==1)return {status:'not_submitted',facts:{...before,withdrawalTargetVerified:false,diagnosticCode:'PROFILE_MISMATCH'}};
    const button=first(cards[0],config.invitationWithdraw)||labelled(cards[0],config.labels.invitationWithdraw);
    if(!button)return {status:'not_submitted',facts:{...before,withdrawalTargetVerified:false,diagnosticCode:'ACTION_UNAVAILABLE'}};
    button.click();
    const deadline=Date.now()+config.waitMs;let dialog=null;
    while(Date.now()<deadline){dialog=matchingWithdrawDialog(config);if(dialog)break;await new Promise(r=>setTimeout(r,250));}
    if(!dialog)return {status:'uncertain',facts:{...before,withdrawalTargetVerified:true,diagnosticCode:'WITHDRAW_DIALOG_UNKNOWN'}};
    const confirm=first(dialog,config.withdrawConfirm)||labelled(dialog,config.labels.withdrawConfirm);
    if(!confirm)return {status:'uncertain',facts:{...before,withdrawalTargetVerified:true,withdrawalConfirmationOpened:true,diagnosticCode:'ACTION_UNAVAILABLE'}};
    confirm.click();
    const end=Date.now()+config.waitMs;
    while(Date.now()<end){
      const after=await inspectPendingInvitation(config,command);
      if(after.pageReady && !after.invitationFound && !matchingWithdrawDialog(config))return {status:'confirmed',facts:{...before,invitationFound:false,
        invitationWithdrawAvailable:false,withdrawalTargetVerified:true,withdrawalConfirmationOpened:true,withdrawalPostcondition:true,diagnosticCode:'OK'}};
      await new Promise(r=>setTimeout(r,250));
    }
    return {status:'uncertain',facts:{...before,withdrawalTargetVerified:true,withdrawalConfirmationOpened:true,diagnosticCode:'POSTCONDITION_UNKNOWN'}};
  }
  return { observe, connect, inspectCommentState, extractContactInfo, inspectPendingInvitation, withdraw, key };
})();
