function summarizeRuntimeState(runtimeState = {}) {
  const canvas = runtimeState.canvas || {};
  const workspace = canvas.normalizedWorkspace || {};

  return {
    meta: runtimeState.meta || {},
    request: runtimeState.request || {},
    user: {
      userId: runtimeState.meta?.userId || null,
      preferences: runtimeState.memory?.preferences || {},
    },
    canvas: {
      selectedCourse: canvas.courseState?.course || null,
      selectedModule: canvas.selectedModule || null,
      selectedTopic: canvas.selectedTopic || null,
      topicText: canvas.topicText || "",
      signals: canvas.signals || {},
      totals: {
        courses: (workspace.courses || []).length,
        modules: (workspace.modules || []).length,
        items: (workspace.moduleItems || []).length,
        assignments: (workspace.assignments || []).length,
        discussions: (workspace.discussions || []).length,
        announcements: (workspace.announcements || []).length,
        messages: (workspace.messages || []).length,
      },
    },
    intelligence: runtimeState.intelligence || {},
    telemetry: runtimeState.telemetry || {},
  };
}

function assertRuntimeState(runtimeState = {}) {
  const errors = [];

  if (!runtimeState.meta) errors.push("meta is missing");
  if (!runtimeState.request) errors.push("request is missing");
  if (!runtimeState.canvas) errors.push("canvas is missing");
  if (!runtimeState.memory) errors.push("memory is missing");
  if (!runtimeState.telemetry) errors.push("telemetry is missing");
  if (!runtimeState.intelligence) errors.push("intelligence is missing");
  if (!runtimeState.agentRegistry) errors.push("agentRegistry is missing");

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  assertRuntimeState,
  summarizeRuntimeState,
};
