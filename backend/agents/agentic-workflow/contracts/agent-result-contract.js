function createAgentResult({
  agentId,
  agentName,
  status = "ready",
  summary = "",
  outputs = {},
  handoff = null,
  notes = [],
}) {
  return {
    agentId,
    agentName,
    status,
    summary,
    outputs,
    handoff,
    notes,
    generatedAt: new Date().toISOString(),
  };
}

function createPendingResult(agentId, agentName, summary) {
  return createAgentResult({
    agentId,
    agentName,
    status: "pending_implementation",
    summary,
  });
}

module.exports = {
  createAgentResult,
  createPendingResult,
};
