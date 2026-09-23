export function readRestReply(data, question, previousMessageId) {
  const last = data.messages?.at(-1);
  if (!last || typeof last.text !== 'string' || !last.text.trim()
      || last.role === 'user' || last.text === question
      || (previousMessageId && last.id === previousMessageId)) {
    throw new Error('Work IQ returned no new assistant text. Inspect the response; no answer was substituted.');
  }
  return {
    text: last.text,
    citations: last.attributions || [],
    sensitivity: last.sensitivityLabel?.displayName,
    messageId: last.id,
  };
}

export function rest(request) {
  let conversationId;
  let lastMessageId;
  return {
    async connect(signal) {
      const data = await request('/rest/conversations', { body: {}, signal });
      if (typeof data.id !== 'string' || !data.id) throw new Error('REST returned no conversation ID.');
      conversationId = data.id;
      return { description: 'Conversation created', conversationId };
    },
    async send(question, signal) {
      if (!conversationId) await this.connect(signal);
      const data = await request(`/rest/conversations/${encodeURIComponent(conversationId)}/chat`, {
        body: {
          message: { text: question },
          locationHint: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        },
        signal,
      });
      const reply = readRestReply(data, question, lastMessageId);
      lastMessageId = reply.messageId;
      return { ...reply, conversationId };
    },
    reset() { conversationId = undefined; lastMessageId = undefined; },
  };
}
