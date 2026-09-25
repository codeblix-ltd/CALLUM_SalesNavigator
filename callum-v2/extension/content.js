chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.kind !== 'CALLUM_V2_PRIMITIVE' || sender.id !== chrome.runtime.id) return;
  (async () => {
    const { command, config } = message;
    CallumConfig.validate(config);
    if (command?.type === 'INSPECT_PROFILE') return { commandId: command.id, status: 'observed', facts: await CallumAdapter.observe(config, command) };
    if (command?.type === 'EXECUTE_CONNECT') return { commandId: command.id, ...(await CallumAdapter.connect(config, command)) };
    return { commandId: command?.id, status: 'not_submitted', facts: { diagnosticCode: 'ACTION_UNAVAILABLE' } };
  })().then(respond).catch(() => respond({ commandId: message.command?.id, status: 'uncertain', facts: { diagnosticCode: 'UNEXPECTED_BROWSER_STATE' } }));
  return true;
});
