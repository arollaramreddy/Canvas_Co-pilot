const { createPendingResult } = require("./contracts/agent-result-contract");

async function runCreateStudyPlanAgent({
  runtimeState,
  previousResults = {},
}) {
  const selectedCourse = runtimeState?.canvas?.courseState?.course || null;
  const dueSoon = runtimeState?.canvas?.signals?.dueSoon || [];
  const studyStyle = runtimeState?.memory?.preferences?.studyStyle || "visual";

  return createPendingResult(
    "agent_6_create_study_plan",
    "Agent 6: Create Study Plan",
    `Ready to build a study plan for ${selectedCourse?.name || "the selected course"} using ${dueSoon.length} near-term deadlines and a ${studyStyle}-oriented study preference.`
  );
}

module.exports = {
  runCreateStudyPlanAgent,
};
