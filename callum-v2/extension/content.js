chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.kind !== 'CALLUM_V2_PRIMITIVE' || sender.id !== chrome.runtime.id) return;
  (async () => {
    const { command, config } = message;
    CallumConfig.validate(config);
    if (command?.type === 'INSPECT_PROFILE') return { commandId: command.id, status: 'observed', facts: await CallumAdapter.observe(config, command) };
    if (command?.type === 'INSPECT_COMMENT_STATE') return { commandId: command.id, status: 'observed', facts: await CallumAdapter.inspectCommentState(config, command) };
    if (command?.type === 'EXTRACT_CONTACT_INFO') return { commandId: command.id, status: 'observed', facts: await CallumAdapter.extractContactInfo(config, command) };
    if (command?.type === 'INSPECT_PENDING_INVITATION') return { commandId: command.id, status: 'observed', facts: await CallumAdapter.inspectPendingInvitation(config, command) };
    if (command?.type === 'EXECUTE_CONNECT') return { commandId: command.id, ...(await CallumAdapter.connect(config, command)) };
    return { commandId: command?.id, status: 'not_submitted', facts: { diagnosticCode: 'ACTION_UNAVAILABLE' } };
  })().then(respond).catch(() => respond({ commandId: message.command?.id, status: message.command?.type === 'EXECUTE_CONNECT' ? 'uncertain' : 'observed', facts: { diagnosticCode: 'UNEXPECTED_BROWSER_STATE' } }));
  return true;
});
