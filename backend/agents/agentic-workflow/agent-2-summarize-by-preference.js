const { createPendingResult } = require("./contracts/agent-result-contract");

async function runSummarizeByPreferenceAgent({
  runtimeState,
  previousResults = {},
}) {
  const preferences = runtimeState?.memory?.preferences || {};
  const studyStyle = preferences.studyStyle || "visual";

  return createPendingResult(
    "agent_2_summarize_by_preference",
    "Agent 2: Summarize by Preference",
    `Ready to summarize the grounded material in a ${studyStyle}-oriented format based on the student preference profile.`
  );
}

module.exports = {
  runSummarizeByPreferenceAgent,
};
