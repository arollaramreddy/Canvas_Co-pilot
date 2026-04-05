const { createAgentResult } = require("./contracts/agent-result-contract");

function normalizePercent(entry) {
  if (entry?.percent !== undefined && entry?.percent !== null) {
    return Math.round(Number(entry.percent));
  }

  if (
    entry?.score !== undefined &&
    entry?.score !== null &&
    entry?.points_possible
  ) {
    return Math.round((Number(entry.score) / Number(entry.points_possible)) * 100);
  }

  return null;
}

function buildImprovementFocus(percent, studyStyle) {
  if (percent === null) {
    return {
      diagnosis: "The score changed, but the percentage is not available yet.",
      improvementAreas: ["Fetch the graded rubric or professor feedback before creating support."],
      supportMode: "pending_grade_details",
    };
  }

  if (percent < 70) {
    return {
      diagnosis: "The student is below target and likely needs concept rebuilding before more practice.",
      improvementAreas: [
        "Identify the exact concept chain that broke during the graded work.",
        "Re-explain the topic using simpler steps and real-world examples.",
        "Schedule near-term recovery blocks before the next related assessment.",
      ],
      supportMode: studyStyle === "visual" ? "visual_recovery" : "guided_recovery",
    };
  }

  if (percent < 85) {
    return {
      diagnosis: "The student is doing reasonably well but still has correctable weak spots.",
      improvementAreas: [
        "Pinpoint the partial-understanding areas and reinforce them with examples.",
        "Use a short study plan refresh instead of a full recovery workflow.",
        "Lock in the topic with quiz practice and spaced review.",
      ],
      supportMode: "reinforcement",
    };
  }

  return {
    diagnosis: "The student performed strongly and should shift from recovery to reinforcement or advancement.",
    improvementAreas: [
      "Preserve mastery with a lighter review cadence.",
      "Offer challenge problems or deeper applications instead of remedial content.",
      "Reallocate study time to weaker topics elsewhere in the course.",
    ],
    supportMode: "advance_or_reinforce",
  };
}

function buildVideoBrief(assignment, focus) {
  return {
    title: `Interactive recovery lesson for ${assignment?.name || "graded work"}`,
    objective:
      focus.supportMode === "advance_or_reinforce"
        ? "Reinforce the strong result with advanced examples and deeper real-world applications."
        : "Explain the missed concept using real-world scenarios, worked examples, and step-by-step teaching.",
    sceneIdeas: [
      "Start with a quick diagnosis of what the score means.",
      "Relate the concept to a familiar real-world use case.",
      "Walk through one correct worked example.",
      "End with a short self-check or reflection question.",
    ],
  };
}

function buildStudyPlanAdjustment(assignment, percent) {
  if (percent === null) {
    return {
      priority: "medium",
      action: "Wait for grade detail and keep the topic in watch mode.",
    };
  }

  if (percent < 70) {
    return {
      priority: "high",
      action: `Move ${assignment?.name || "this topic"} to the top of the study plan and schedule recovery sessions this week.`,
    };
  }

  if (percent < 85) {
    return {
      priority: "medium",
      action: `Add one reinforcement block for ${assignment?.name || "this topic"} before the next related deadline.`,
    };
  }

  return {
    priority: "low",
    action: `Reduce review intensity for ${assignment?.name || "this topic"} and shift effort to weaker areas.`,
  };
}

function buildGradeInterventions(runtimeState = {}) {
  const performance = runtimeState?.intelligence?.performance || {};
  const studyStyle = runtimeState?.memory?.preferences?.studyStyle || "visual";
  const lowScores = performance.lowScores || [];
  const moderateScores = performance.moderateScores || [];
  const strongScores = (runtimeState?.canvas?.courseState?.assignments || [])
    .filter((assignment) => assignment.score !== null && assignment.score !== undefined && assignment.points_possible)
    .map((assignment) => ({
      ...assignment,
      percent: normalizePercent(assignment),
    }))
    .filter((assignment) => assignment.percent >= 85)
    .slice(0, 3);

  const candidates = [...lowScores.slice(0, 3), ...moderateScores.slice(0, 2), ...strongScores.slice(0, 2)];

  return candidates.map((assignment) => {
    const percent = normalizePercent(assignment);
    const focus = buildImprovementFocus(percent, studyStyle);

    return {
      assignment: {
        id: assignment.id,
        name: assignment.name,
        score: assignment.score,
        points_possible: assignment.points_possible,
        percent,
        due_at: assignment.due_at || null,
      },
      diagnosis: focus.diagnosis,
      improvementAreas: focus.improvementAreas,
      studyPlanAdjustment: buildStudyPlanAdjustment(assignment, percent),
      curatedVideoLearning: buildVideoBrief(assignment, focus),
      recommendedAgents:
        percent !== null && percent < 70
          ? [
              "agent_7_state_change_decider",
              "agent_1_parse_and_research",
              "agent_2_summarize_by_preference",
              "agent_6_create_study_plan",
              "agent_5_create_video_plan",
            ]
          : percent !== null && percent < 85
            ? [
                "agent_2_summarize_by_preference",
                "agent_6_create_study_plan",
                "agent_4_create_quizzes",
              ]
            : [
                "agent_6_create_study_plan",
                "agent_5_create_video_plan",
              ],
    };
  });
}

async function runGradeInterventionAgent({
  runtimeState,
  previousResults = {},
}) {
  const interventions = buildGradeInterventions(runtimeState);
  const primaryIntervention = interventions[0] || null;

  return createAgentResult({
    agentId: "agent_8_grade_intervention",
    agentName: "Agent 8: Grade Intervention",
    status: "ready_for_team_implementation",
    summary: primaryIntervention
      ? `Prepared ${interventions.length} score-based intervention candidate(s) from current Canvas performance state.`
      : "No graded-score intervention is needed yet, so the agent remains in watch mode.",
    outputs: {
      primaryIntervention,
      interventions,
      basedOn: {
        lowScores: runtimeState?.intelligence?.performance?.lowScores?.length || 0,
        moderateScores: runtimeState?.intelligence?.performance?.moderateScores?.length || 0,
        gradedAssignments: runtimeState?.intelligence?.performance?.gradedAssignments || 0,
      },
    },
    handoff: primaryIntervention
      ? {
          reason: `The highest-priority graded item is ${primaryIntervention.assignment.name}.`,
          nextAgents: primaryIntervention.recommendedAgents,
        }
      : null,
    notes: previousResults?.agent_7_state_change_decider
      ? ["This agent can consume decisions from Agent 7 for event-aware grade support."]
      : [],
  });
}

module.exports = {
  buildGradeInterventions,
  runGradeInterventionAgent,
};
