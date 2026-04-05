const { createAgentResult } = require("./contracts/agent-result-contract");

function toPercent(score, pointsPossible) {
  if (score === null || score === undefined || !pointsPossible) return null;
  return Math.round((Number(score) / Number(pointsPossible)) * 100);
}

function getRecentGradeEvents(runtimeState = {}) {
  const courseEvents = runtimeState?.telemetry?.courseEvents || [];
  return courseEvents.filter((event) => event.event_type === "grade_released");
}

function getAssignmentMap(runtimeState = {}) {
  return runtimeState?.canvas?.normalizedWorkspace?.byId?.assignments || {};
}

function buildGradeRecommendations(assignment, percent, preferences = {}) {
  const studyStyle = preferences.studyStyle || "visual";
  const recommendations = [];

  if (percent < 70) {
    recommendations.push("Start a recovery loop with concept rebuild, extra worked examples, and a short practice set.");
    recommendations.push("Refresh the study plan so the weak topic gets the first review slot this week.");
    recommendations.push(
      studyStyle === "visual"
        ? "Generate a visual explainer or interactive lesson before attempting more practice."
        : "Generate a concise explanation first, then follow with targeted practice."
    );
  } else if (percent < 85) {
    recommendations.push("Treat this as a moderate gap and schedule one reinforcement session before the next assessment.");
    recommendations.push("Generate flashcards and a short quiz to lock in the missed concepts.");
    recommendations.push("Compare this graded work against professor material to identify the exact concept drift.");
  } else {
    recommendations.push("Mark this topic as healthy and shift into reinforcement instead of recovery.");
    recommendations.push("Generate a challenge quiz or advanced examples to preserve momentum.");
    recommendations.push("Use the strong score to reduce time on this topic and move effort to weaker areas.");
  }

  if (assignment?.due_at) {
    recommendations.push("Check surrounding deadlines so the recommendation fits the current workload.");
  }

  return recommendations;
}

function buildGradeDecision(event, assignment, preferences = {}) {
  const percent =
    toPercent(
      assignment?.score ?? event?.payload?.score ?? event?.score,
      assignment?.points_possible ?? event?.payload?.points_possible ?? event?.points_possible
    ) ?? 0;

  const band = percent < 70 ? "low_score" : percent < 85 ? "medium_score" : "high_score";
  const actionMode =
    band === "low_score" ? "recovery" : band === "medium_score" ? "reinforcement" : "advance";

  return {
    type: "grade_decision",
    band,
    actionMode,
    assignment: assignment
      ? {
          id: assignment.id,
          name: assignment.name,
          score: assignment.score,
          points_possible: assignment.points_possible,
          percent,
          due_at: assignment.due_at || null,
          course_id: assignment.course_id || null,
          course_name: assignment.course_name || null,
        }
      : {
          id: event?.entity_id || null,
          name: event?.payload?.assignment_name || event?.title || "Recently graded work",
          score: event?.payload?.score ?? null,
          points_possible: event?.payload?.points_possible ?? null,
          percent,
          due_at: null,
          course_id: event?.course_id || null,
          course_name: event?.payload?.course_name || null,
        },
    recommendations: buildGradeRecommendations(assignment, percent, preferences),
    nextAgents:
      band === "low_score"
        ? [
            "agent_1_parse_and_research",
            "agent_2_summarize_by_preference",
            "agent_6_create_study_plan",
            "agent_3_create_flashcards",
            "agent_4_create_quizzes",
            "agent_5_create_video_plan",
          ]
        : band === "medium_score"
          ? [
              "agent_2_summarize_by_preference",
              "agent_6_create_study_plan",
              "agent_3_create_flashcards",
              "agent_4_create_quizzes",
            ]
          : [
              "agent_6_create_study_plan",
              "agent_4_create_quizzes",
            ],
  };
}

function buildStateChangeDecisions(runtimeState = {}) {
  const preferences = runtimeState?.memory?.preferences || {};
  const assignmentMap = getAssignmentMap(runtimeState);
  const recentGradeEvents = getRecentGradeEvents(runtimeState);
  const lowScores = runtimeState?.intelligence?.performance?.lowScores || [];
  const moderateScores = runtimeState?.intelligence?.performance?.moderateScores || [];
  const missingAssignments = runtimeState?.intelligence?.performance?.missingAssignments || [];
  const globalEvents = runtimeState?.telemetry?.globalEvents || [];
  const newMessages = globalEvents.filter((event) =>
    ["new_message_received", "message_reply_received"].includes(event.event_type)
  );
  const courseEvents = runtimeState?.telemetry?.courseEvents || [];
  const newMaterial = courseEvents.filter((event) =>
    ["new_material_posted", "new_module_posted"].includes(event.event_type)
  );

  const gradeDecisions = recentGradeEvents.map((event) => {
    const assignment = assignmentMap[String(event.entity_id)] || assignmentMap[String(event.assignment_id)] || null;
    return buildGradeDecision(event, assignment, preferences);
  });

  const fallbackLowScoreDecisions =
    gradeDecisions.length === 0
      ? lowScores.slice(0, 3).map((assignment) =>
          buildGradeDecision(
            {
              entity_id: assignment.id,
              payload: {
                score: assignment.score,
                points_possible: assignment.points_possible,
                assignment_name: assignment.name,
                course_name: assignment.course_name,
              },
            },
            assignment,
            preferences
          )
        )
      : [];

  const decisions = [
    ...gradeDecisions,
    ...fallbackLowScoreDecisions,
    ...(moderateScores[0]
      ? [
          {
            type: "reinforcement_window",
            assignment: moderateScores[0],
            recommendations: [
              `Schedule one short reinforcement block for ${moderateScores[0].name}.`,
              "Generate a concise summary plus a short quiz before the next graded item.",
            ],
            nextAgents: [
              "agent_2_summarize_by_preference",
              "agent_4_create_quizzes",
            ],
          },
        ]
      : []),
    ...(missingAssignments[0]
      ? [
          {
            type: "missing_assignment_rescue",
            assignment: missingAssignments[0],
            recommendations: [
              `Create an assignment rescue plan for ${missingAssignments[0].name}.`,
              "Break the work into a smallest-next-step checklist and reorder the study plan around it.",
            ],
            nextAgents: [
              "agent_6_create_study_plan",
              "agent_1_parse_and_research",
            ],
          },
        ]
      : []),
    ...(newMaterial[0]
      ? [
          {
            type: "new_material_support",
            event: newMaterial[0],
            recommendations: [
              "Parse the newly posted material and fetch relevant external context.",
              "Prepare a student-tailored summary and learning assets before the student asks.",
            ],
            nextAgents: [
              "agent_1_parse_and_research",
              "agent_2_summarize_by_preference",
              "agent_5_create_video_plan",
            ],
          },
        ]
      : []),
    ...(newMessages[0]
      ? [
          {
            type: "message_support",
            event: newMessages[0],
            recommendations: [
              "Classify the inbox request and decide whether it needs course-state grounding.",
              "Draft a reply the student can verify and send.",
            ],
            nextAgents: ["message_agent"],
          },
        ]
      : []),
  ];

  return decisions;
}

async function runStateChangeDeciderAgent({
  runtimeState,
}) {
  const decisions = buildStateChangeDecisions(runtimeState);
  const primaryDecision = decisions[0] || null;

  return createAgentResult({
    agentId: "agent_7_state_change_decider",
    agentName: "Agent 7: State Change Decider",
    status: "ready_for_team_implementation",
    summary: primaryDecision
      ? `Detected ${decisions.length} decision candidate(s) from Canvas state changes and student performance.`
      : "No urgent state change required a recommendation, so the agent is in monitoring mode.",
    outputs: {
      monitoringTargets: [
        "grade_released",
        "assignment_marked_missing",
        "new_material_posted",
        "new_module_posted",
        "new_message_received",
        "message_reply_received",
      ],
      primaryDecision,
      decisions,
    },
    handoff: primaryDecision
      ? {
          reason: `The current highest-priority trigger is ${primaryDecision.type}.`,
          nextAgents: primaryDecision.nextAgents || [],
        }
      : {
          reason: "No high-priority trigger detected.",
          nextAgents: [],
        },
  });
}

module.exports = {
  buildStateChangeDecisions,
  runStateChangeDeciderAgent,
};
