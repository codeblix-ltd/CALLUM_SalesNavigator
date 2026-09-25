import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

const configCode=await readFile(new URL('../extension/config.js',import.meta.url),'utf8');
const adapterCode=await readFile(new URL('../extension/adapter.js',import.meta.url),'utf8');
function fixture(body, url='https://www.linkedin.com/in/qa-test/') {
  const { window }=parseHTML(`<html><body>${body}</body></html>`);
  window.HTMLElement.prototype.getClientRects=function(){return [1]};
  const sandbox={document:window.document,location:{href:url},URL,Date,setTimeout,Event:window.Event,getComputedStyle:()=>({visibility:'visible'})};
  sandbox.globalThis=sandbox;
  vm.createContext(sandbox);vm.runInContext(configCode,sandbox);vm.runInContext(adapterCode,sandbox);
  return {adapter:sandbox.CallumAdapter,document:window.document};
}
const command={targetProfileKey:'qa-test',payload:{expectedName:'QA Test'}};
const page=action=>`<main><section class="pv-top-card"><h1>QA Test</h1><span>· 2nd</span>${action}</section><aside><button aria-label="Connect">Other person</button></aside></main>`;

test('direct Connect scoped to the target card and bullet degree',async()=>{
  const {adapter}=fixture(page('<button aria-label="Invite QA Test to connect">Connect</button>'));
  const x=await adapter.observe(DEFAULT_CONFIG,command);
  assert.equal(x.profileMatched,true);assert.equal(x.connectAvailable,true);assert.equal(x.relationship,'second');
  const bullet=fixture('<main><section class="pv-top-card"><h1>QA Test</h1><span>• 3rd</span><button aria-label="Connect">Connect</button></section></main>');
  assert.equal((await bullet.adapter.observe(DEFAULT_CONFIG,command)).relationship,'third');
});
test('Pending and Connected prevent Connect despite unrelated recommendation',async()=>{
  const pending=fixture(page('<button aria-label="Pending">Pending</button>'));
  const p=await pending.adapter.observe(DEFAULT_CONFIG,command);
  assert.equal(p.pendingVisible,true);assert.equal(p.connectAvailable,false);
  const connected=fixture('<main><section class="pv-top-card"><h1>QA Test</h1><span>· 1st</span><button aria-label="Message">Message</button></section></main>');
  const c=await connected.adapter.observe(DEFAULT_CONFIG,command);
  assert.equal(c.connectedVisible,true);assert.equal(c.connectAvailable,false);
  const inMail=fixture(page('<button aria-label="Message">Message</button>'));
  assert.equal((await inMail.adapter.observe(DEFAULT_CONFIG,command)).connectedVisible,false);
});
test('wrong target heading or URL and hydration block actions',async()=>{
  const wrong=fixture(page('<button aria-label="Connect">Connect</button>'),'https://www.linkedin.com/in/another/');
  assert.equal((await wrong.adapter.observe(DEFAULT_CONFIG,command)).profileMatched,false);
  const heading=fixture('<main><section class="pv-top-card"><h1>Different Person</h1><button>Connect</button></section></main>');
  assert.equal((await heading.adapter.observe(DEFAULT_CONFIG,command)).profileMatched,false);
  const hydrating=fixture('<main><h1>QA Test</h1></main>');
  const h=await hydrating.adapter.observe(DEFAULT_CONFIG,command);
  assert.equal(h.pageReady,false);assert.equal(h.diagnosticCode,'PAGE_HYDRATING');
});
test('localized action labels are data-driven',async()=>{
  const {adapter}=fixture(page('<button>Se connecter</button>'));
  assert.equal((await adapter.observe(DEFAULT_CONFIG,command)).connectAvailable,true);
});
test('current section and H2 profile layout stays identity scoped',async()=>{
  const {adapter}=fixture('<main><section><h2>QA (Jay) Test</h2><button aria-label="Connect">Connect</button></section><section><button aria-label="Connect">Recommendation</button></section></main>');
  const x=await adapter.observe(DEFAULT_CONFIG,command);
  assert.equal(x.profileMatched,true);assert.equal(x.connectAvailable,true);
});
test('one logical send confirms visible Pending and refuses second send',async()=>{
  const {adapter,document}=fixture(page('<button id="connect" aria-label="Connect">Connect</button>'));
  let sends=0;
  document.getElementById('connect').click=()=>{
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    const send=document.createElement('button');send.textContent='Send';send.click=()=>{
      sends++;const button=document.getElementById('connect');button.setAttribute('aria-label','Pending');button.textContent='Pending';dialog.remove();
    };dialog.append(send);document.body.append(dialog);
  };
  const first=await adapter.connect(DEFAULT_CONFIG,command);
  assert.equal(first.status,'confirmed');assert.equal(sends,1);
  const second=await adapter.connect(DEFAULT_CONFIG,command);
  assert.equal(second.status,'not_submitted');assert.equal(sends,1);
});
test('opening an invite dialog without a Send button is not a submission',async()=>{
  const {adapter,document}=fixture(page('<button id="connect" aria-label="Connect">Connect</button>'));
  document.getElementById('connect').click=()=>{
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    dialog.textContent='Add a note';document.body.append(dialog);
  };
  const result=await adapter.connect(DEFAULT_CONFIG,command);
  assert.equal(result.status,'not_submitted');
  assert.equal(result.facts.diagnosticCode,'ACTION_UNAVAILABLE');
});
test('recent post observation returns bounded URLs without post text',async()=>{
  const url='https://www.linkedin.com/feed/update/urn:li:activity:123456789';
  const html=`<main><section class="pv-top-card"><h1>QA Test</h1></section>
    <section data-urn="urn:li:activity:123456789"><a href="${url}?tracking=1">Post</a><button aria-label="Comment">Comment</button><p>Private post content must not leave the page</p></section></main>`;
  const {adapter}=fixture(html);
  const facts=await adapter.inspectCommentState(DEFAULT_CONFIG,{...command,payload:{...command.payload,postUrl:url}});
  assert.equal(facts.profileMatched,true);
  assert.equal(facts.targetPostPresent,true);
  assert.equal(facts.commentBoxAvailable,true);
  assert.deepEqual(Array.from(facts.postUrls),[url]);
  assert.equal(JSON.stringify(facts).includes('Private post content'),false);
  const none=fixture('<main><section class="pv-top-card"><h1>QA Test</h1></section></main>');
  assert.equal((await none.adapter.inspectCommentState(DEFAULT_CONFIG,command)).diagnosticCode,'NO_RECENT_POSTS');
  const cards=Array.from({length:6},(_,i)=>`<section data-urn="urn:li:activity:${100+i}"><a href="https://www.linkedin.com/feed/update/urn:li:activity:${100+i}">Post</a>${i<5?'<button aria-label="Comment">Comment</button>':''}</section>`).join('');
  const sixth=fixture(`<main><section class="pv-top-card"><h1>QA Test</h1></section>${cards}</main>`);
  const late=await sixth.adapter.inspectCommentState(DEFAULT_CONFIG,{...command,payload:{...command.payload,postUrl:'https://www.linkedin.com/feed/update/urn:li:activity:105'}});
  assert.equal(late.targetPostPresent,true);
  assert.equal(late.commentBoxAvailable,false);
  assert.equal(late.postUrls.length,5);
  assert.equal(late.postUrls.includes('https://www.linkedin.com/feed/update/urn:li:activity:105'),true);
});
test('approved comment targets one authored post and confirms only the signed-in actor',async()=>{
  const post='https://www.linkedin.com/feed/update/urn:li:activity:123456789';
  const html=`<header><a href="/in/qa-actor/">Me</a></header><main><section class="pv-top-card"><h1>QA Test</h1></section>
    <section data-urn="urn:li:activity:123456789"><a class="update-components-actor__meta-link" href="/in/qa-test/">QA Test</a><a href="${post}">Post</a>
    <button id="open" aria-label="Comment">Comment</button><div id="comments"></div></section></main>`;
  const {adapter,document}=fixture(html);
  const target=document.querySelector('[data-urn]');let submits=0;
  document.getElementById('open').click=()=>{
    if(target.querySelector('[contenteditable]'))return;
    const editor=document.createElement('div');editor.setAttribute('contenteditable','true');editor.setAttribute('role','textbox');
    const button=document.createElement('button');button.className='comments-comment-box__submit-button';button.textContent='Post';
    button.click=()=>{submits++;const item=document.createElement('div');item.className='comments-comment-item';
      item.innerHTML=`<a href="/in/qa-actor/">Actor</a><div class="comments-comment-item__main-content">${editor.textContent}</div>`;
      document.getElementById('comments').append(item);};
    target.append(editor,button);
  };
  const command={targetProfileKey:'qa-test',payload:{expectedName:'QA Test',postUrl:post,actorProfileKey:'qa-actor',approvedText:'Thanks for sharing this update.'}};
  const before=await adapter.inspectCommentState(DEFAULT_CONFIG,command);
  assert.equal(before.targetPostAuthoredByLead,true);assert.equal(before.viewerMatched,true);
  const otherComment=document.createElement('div');otherComment.className='comments-comment-item';
  otherComment.innerHTML='<a href="/in/someone-else/">Other</a><div class="comments-comment-item__main-content">Thanks for sharing this update.</div>';
  document.getElementById('comments').append(otherComment);
  assert.equal((await adapter.inspectCommentState(DEFAULT_CONFIG,command)).ownCommentPresent,false);
  const result=await adapter.comment(DEFAULT_CONFIG,command);
  assert.equal(result.status,'confirmed');assert.equal(result.facts.commentPostcondition,true);assert.equal(submits,1);
  const again=await adapter.comment(DEFAULT_CONFIG,command);
  assert.equal(again.status,'not_submitted');assert.equal(again.facts.ownCommentPresent,true);assert.equal(submits,1);
  const differentActor=fixture(html.replace('/in/qa-actor/','/in/another-actor/'));
  assert.equal((await differentActor.adapter.comment(DEFAULT_CONFIG,command)).status,'not_submitted');
  const differentAuthor=fixture(html.replace('class="update-components-actor__meta-link" href="/in/qa-test/"','class="update-components-actor__meta-link" href="/in/another-person/"'));
  assert.equal((await differentAuthor.adapter.comment(DEFAULT_CONFIG,command)).status,'not_submitted');
});
test('a comment submit with missing postcondition becomes uncertain and never clicks twice',async()=>{
  const post='https://www.linkedin.com/feed/update/urn:li:activity:555';
  const html=`<header><a href="/in/qa-actor/">Me</a></header><main><section class="pv-top-card"><h1>QA Test</h1></section>
    <section data-urn="urn:li:activity:555"><a class="update-components-actor__meta-link" href="/in/qa-test/">QA Test</a><a href="${post}">Post</a>
    <button aria-label="Comment">Comment</button><div contenteditable="true" role="textbox"></div><button class="comments-comment-box__submit-button">Post</button></section></main>`;
  const {adapter,document}=fixture(html);let submits=0;document.querySelector('.comments-comment-box__submit-button').click=()=>submits++;
  const command={targetProfileKey:'qa-test',payload:{expectedName:'QA Test',postUrl:post,actorProfileKey:'qa-actor',approvedText:'Approved comment.'}};
  const result=await adapter.comment({...DEFAULT_CONFIG,waitMs:250},command);
  assert.equal(result.status,'uncertain');assert.equal(submits,1);
});
test('contact info is identity and first-degree scoped to the target dialog',async()=>{
  const html='<main><section class="pv-top-card"><h1>QA Test</h1><span>· 1st</span><a id="contact" href="/in/qa-test/overlay/contact-info/">Contact info</a></section></main>';
  const {adapter,document}=fixture(html);
  document.getElementById('contact').click=()=>{
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    dialog.innerHTML='<h2>Contact info</h2><a href="mailto:qa@example.com?subject=x">Email</a>';
    document.body.append(dialog);
  };
  const facts=await adapter.extractContactInfo(DEFAULT_CONFIG,command);
  assert.equal(facts.profileMatched,true);
  assert.equal(facts.contactEmail,'qa@example.com');
  assert.equal(facts.contactInfoOpened,true);
  const second=fixture(html.replace('· 1st','· 2nd'));
  assert.equal((await second.adapter.extractContactInfo(DEFAULT_CONFIG,command)).diagnosticCode,'ACTION_UNAVAILABLE');
  const wrong=fixture(html.replace('/in/qa-test/overlay/','/in/another/overlay/'));
  assert.equal((await wrong.adapter.extractContactInfo(DEFAULT_CONFIG,command)).diagnosticCode,'PROFILE_MISMATCH');
});
test('sent invitation inspection requires matching profile, name and conservative age',async()=>{
  const manager='https://www.linkedin.com/mynetwork/invitation-manager/sent/';
  const card=(slug,name,age)=>`<div role="listitem"><a href="/in/${slug}/">${name}</a><p>${age}</p><button aria-label="Withdraw invitation sent to ${name}">Withdraw</button></div>`;
  const html=`<main><h1>Sent invitations</h1>${card('other-person','Other Person','Sent 70 days ago')}${card('qa-test','QA Test','Sent 5 weeks ago')}</main>`;
  const {adapter}=fixture(html,manager);
  const facts=await adapter.inspectPendingInvitation(DEFAULT_CONFIG,command);
  assert.equal(facts.profileMatched,true);
  assert.equal(facts.invitationFound,true);
  assert.equal(facts.invitationAgeDays,35);
  assert.equal(facts.invitationWithdrawAvailable,true);
  assert.equal(facts.diagnosticCode,'OK');
  assert.equal(JSON.stringify(facts).includes('Other Person'),false);
  const recent=fixture(`<main><h1>Sent</h1>${card('qa-test','QA Test','Sent 29 days ago')}</main>`,manager);
  assert.equal((await recent.adapter.inspectPendingInvitation(DEFAULT_CONFIG,command)).diagnosticCode,'INVITATION_TOO_RECENT');
  const unknown=fixture(`<main><h1>Sent</h1>${card('qa-test','QA Test','Recently sent')}</main>`,manager);
  assert.equal((await unknown.adapter.inspectPendingInvitation(DEFAULT_CONFIG,command)).invitationAgeDays,null);
  const wrong=fixture(`<main><h1>Sent</h1>${card('qa-test','Someone Else','Sent 60 days ago')}</main>`,manager);
  assert.equal((await wrong.adapter.inspectPendingInvitation(DEFAULT_CONFIG,command)).invitationFound,false);
  const wrongPage=fixture(html,'https://www.linkedin.com/in/qa-test/');
  assert.equal((await wrongPage.adapter.inspectPendingInvitation(DEFAULT_CONFIG,command)).pageReady,false);
});
test('one targeted old invitation is withdrawn through one confirmed dialog',async()=>{
  const manager='https://www.linkedin.com/mynetwork/invitation-manager/sent/';
  const html='<main><h1>Sent invitations</h1><div role="listitem" id="other"><a href="/in/other-person/">Other Person</a><p>Sent 90 days ago</p><button>Withdraw</button></div><div role="listitem" id="target"><a href="/in/qa-test/">QA Test</a><p>Sent 35 days ago</p><button id="start" aria-label="Withdraw invitation sent to QA Test">Withdraw</button></div></main>';
  const {adapter,document}=fixture(html,manager);
  let starts=0,confirms=0;
  document.getElementById('start').click=()=>{
    starts++;
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    dialog.innerHTML='<h2>Withdraw invitation</h2><button aria-label="Withdraw">Withdraw</button>';
    dialog.querySelector('button').click=()=>{confirms++;document.getElementById('target').remove();dialog.remove()};
    document.body.append(dialog);
  };
  const first=await adapter.withdraw(DEFAULT_CONFIG,command);
  assert.equal(first.status,'confirmed');
  assert.equal(first.facts.withdrawalPostcondition,true);
  assert.equal(starts,1);assert.equal(confirms,1);
  assert.ok(document.getElementById('other'));
  const second=await adapter.withdraw(DEFAULT_CONFIG,command);
  assert.equal(second.status,'not_submitted');
  assert.equal(starts,1);assert.equal(confirms,1);
});
test('young or ambiguous invitations never reach confirmation',async()=>{
  const manager='https://www.linkedin.com/mynetwork/invitation-manager/sent/';
  const young=fixture('<main><h1>Sent</h1><div role="listitem"><a href="/in/qa-test/">QA Test</a><p>Sent 29 days ago</p><button id="start" aria-label="Withdraw">Withdraw</button></div></main>',manager);
  let clicks=0;young.document.getElementById('start').click=()=>clicks++;
  assert.equal((await young.adapter.withdraw(DEFAULT_CONFIG,command)).status,'not_submitted');
  assert.equal(clicks,0);
  const ambiguous=fixture('<main><h1>Sent</h1><div role="listitem"><a href="/in/qa-test/">QA Test</a><p>Sent 31 days ago</p><button aria-label="Withdraw">Withdraw</button></div><div role="listitem"><a href="/in/qa-test/">QA Test</a><p>Sent 31 days ago</p><button aria-label="Withdraw">Withdraw</button></div></main>',manager);
  assert.equal((await ambiguous.adapter.withdraw(DEFAULT_CONFIG,command)).status,'not_submitted');
  const uncertain=fixture('<main><h1>Sent</h1><div role="listitem"><a href="/in/qa-test/">QA Test</a><p>Sent 31 days ago</p><button id="start" aria-label="Withdraw">Withdraw</button></div></main>',manager);
  uncertain.document.getElementById('start').click=()=>clicks++;
  const result=await uncertain.adapter.withdraw({...DEFAULT_CONFIG,waitMs:250},command);
  assert.equal(result.status,'uncertain');
  assert.equal(clicks,1);
  assert.equal(result.facts.withdrawalPostcondition,undefined);
});
