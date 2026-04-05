const { createPendingResult } = require("./contracts/agent-result-contract");

async function runParseAndResearchAgent({
  runtimeState,
  dependencies = {},
}) {
  const selectedCourse = runtimeState?.canvas?.courseState?.course || null;
  const selectedModule = runtimeState?.canvas?.selectedModule || null;
  const selectedTopic = runtimeState?.canvas?.selectedTopic || null;
  const topicText = runtimeState?.canvas?.topicText || "";

  return createPendingResult(
    "agent_1_parse_and_research",
    "Agent 1: Parse and Research",
    selectedTopic
      ? `Ready to parse ${selectedTopic.display_name} from ${selectedCourse?.name || "the course"} and fetch relevant external context.`
      : `Ready to parse newly posted material from ${selectedModule?.name || selectedCourse?.name || "the selected course"} and fetch relevant external context.`
  );
}

module.exports = {
  runParseAndResearchAgent,
};
