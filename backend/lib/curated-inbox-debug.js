async function buildInboxDebugSnapshot({ buildInboxState, accessToken }) {
  const inboxState = await buildInboxState(accessToken);
  return {
    syncedAt: inboxState.syncedAt,
    totalMessages: (inboxState.messages || []).length,
    messages: (inboxState.messages || []).map((message) => ({
      id: message.id,
      subject: message.subject,
      last_author_name: message.last_author_name,
      last_message_at: message.last_message_at,
      message_count: message.message_count,
      preview: String(message.last_message || "").slice(0, 240),
      workflow_state: message.workflow_state || null,
    })),
  };
}

module.exports = {
  buildInboxDebugSnapshot,
};
