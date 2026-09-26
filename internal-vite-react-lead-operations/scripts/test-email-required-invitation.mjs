import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const content = readFileSync(new URL('../chrome-extension/content.js', import.meta.url), 'utf8');
const helper = content.slice(
  content.indexOf('function invitationRequiresEmail('),
  content.indexOf('function getInvitationRecipient('),
);
assert(helper, 'email-required helper must exist');
const scope = {};
vm.runInNewContext(helper, scope);
const dialog = text => ({ textContent: text, querySelector: () => null });
assert.equal(scope.invitationRequiresEmail(dialog('To verify this member knows you, please enter their email to connect. You can also include a personal note.')), true);
assert.equal(scope.invitationRequiresEmail(dialog('Add a note to your invitation? Connect with Bob Jordan.')), false);
assert.equal(scope.invitationRequiresEmail(dialog('Enter a personal note to connect with Bob Jordan.')), false);

const module = { exports: {} };
const rulesSource = readFileSync(new URL('../convex/lib/profileLinkReview.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(rulesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports });
const rules = module.exports;
assert.match(rules.LINKEDIN_EMAIL_REQUIRED_ERROR, /email address.*No request was sent/i);
assert.match(rules.leadNeedsReviewSql(), /LinkedIn requires the person''s email address/);
assert.match(content, /invitationRequiresEmail\(invitationDialog\)[\s\S]{0,250}LinkedIn requires the person's email address/);
const stateError = 'The connection state could not be confirmed. Nothing was sent for this lead.';
const recipientError = 'We couldn’t check that the request is for Bob Jordan. Nothing was sent.';
assert.equal(rules.isUncompletedConnectionAction('failed', stateError), true);
assert.equal(rules.isUncompletedConnectionAction('failed', recipientError), true);
assert.equal(rules.isUncompletedConnectionAction('failed', rules.LINKEDIN_EMAIL_REQUIRED_ERROR), true);
assert.equal(rules.isUncompletedConnectionAction('connection_requested', stateError), false);
assert.equal(rules.isUncompletedConnectionAction('failed', 'LinkedIn now shows this profile as connected. No request was sent.'), false);
console.log('PASS: LinkedIn email-required invitation is recognized, not mistaken for a recipient mismatch, and held for review');
