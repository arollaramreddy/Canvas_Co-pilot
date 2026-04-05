const { Annotation, StateGraph, START, END } = require("@langchain/langgraph");
const { assertRuntimeState, summarizeRuntimeState } = require("./contracts/runtime-state-contract");
const { createAgentResult } = require("./contracts/agent-result-contract");
const { runParseAndResearchAgent } = require("./agent-1-parse-and-research");
const { runSummarizeByPreferenceAgent } = require("./agent-2-summarize-by-preference");
const { runCreateFlashcardsAgent } = require("./agent-3-create-flashcards");
const { runCreateQuizzesAgent } = require("./agent-4-create-quizzes");
const { runCreateVideoPlanAgent } = require("./agent-5-create-video-plan");
const { runCreateStudyPlanAgent } = require("./agent-6-create-study-plan");
const { runStateChangeDeciderAgent } = require("./agent-7-state-change-decider");
const { runGradeInterventionAgent } = require("./agent-8-grade-intervention");

const AgentWorkflowState = Annotation.Root({
  runtimeState: Annotation(),
  options: Annotation(),
  results: Annotation(),
  orchestration: Annotation(),
});

function buildWorkflowGraph() {
  return new StateGraph(AgentWorkflowState)
    .addNode("orchestrator_boot", async (state) => {
      const validation = assertRuntimeState(state.runtimeState);
      if (!validation.valid) {
        throw new Error(`Invalid runtime state: ${validation.errors.join(", ")}`);
      }

      return {
        results: {},
        orchestration: createAgentResult({
          agentId: "agent_8_orchestrator",
          agentName: "Agent 8: Orchestrator",
          status: "running",
          summary: "Bootstrapped the agentic workflow from the shared LangGraph runtime state.",
          outputs: {
            runtimeSummary: summarizeRuntimeState(state.runtimeState),
            requestedAgents: state.options?.requestedAgents || [
              "agent_7_state_change_decider",
              "agent_8_grade_intervention",
              "agent_1_parse_and_research",
              "agent_2_summarize_by_preference",
              "agent_6_create_study_plan",
              "agent_3_create_flashcards",
              "agent_4_create_quizzes",
              "agent_5_create_video_plan",
            ],
          },
        }),
      };
    })
    .addNode("agent_7_state_change_decider", async (state) => ({
      results: {
        ...state.results,
        agent_7_state_change_decider: await runStateChangeDeciderAgent({
          runtimeState: state.runtimeState,
        }),
      },
    }))
    .addNode("agent_1_parse_and_research", async (state) => ({
      results: {
        ...state.results,
        agent_1_parse_and_research: await runParseAndResearchAgent({
          runtimeState: state.runtimeState,
          dependencies: state.options?.dependencies || {},
        }),
      },
    }))
    .addNode("agent_8_grade_intervention", async (state) => ({
      results: {
        ...state.results,
        agent_8_grade_intervention: await runGradeInterventionAgent({
          runtimeState: state.runtimeState,
          previousResults: state.results,
        }),
      },
    }))
    .addNode("agent_2_summarize_by_preference", async (state) => ({
      results: {
        ...state.results,
        agent_2_summarize_by_preference: await runSummarizeByPreferenceAgent({
          runtimeState: state.runtimeState,
          previousResults: state.results,
        }),
      },
    }))
    .addNode("agent_6_create_study_plan", async (state) => ({
      results: {
        ...state.results,
        agent_6_create_study_plan: await runCreateStudyPlanAgent({
          runtimeState: state.runtimeState,
          previousResults: state.results,
        }),
      },
    }))
    .addNode("agent_3_create_flashcards", async (state) => ({
      results: {
        ...state.results,
        agent_3_create_flashcards: await runCreateFlashcardsAgent({
          runtimeState: state.runtimeState,
          previousResults: state.results,
        }),
      },
    }))
    .addNode("agent_4_create_quizzes", async (state) => ({
      results: {
        ...state.results,
        agent_4_create_quizzes: await runCreateQuizzesAgent({
          runtimeState: state.runtimeState,
          previousResults: state.results,
        }),
      },
    }))
    .addNode("agent_5_create_video_plan", async (state) => ({
      results: {
        ...state.results,
        agent_5_create_video_plan: await runCreateVideoPlanAgent({
          runtimeState: state.runtimeState,
          previousResults: state.results,
        }),
      },
    }))
    .addNode("orchestrator_finalize", async (state) => ({
      orchestration: createAgentResult({
        agentId: "agent_8_orchestrator",
        agentName: "Agent 8: Orchestrator",
        status: "ready_for_team_implementation",
        summary: "Completed the orchestrated workflow skeleton for state-aware decisions, grade interventions, parse, summarize, study plans, flashcards, quizzes, and video generation.",
        outputs: {
          completedAgents: Object.keys(state.results || {}),
          nextStep:
            "Each teammate can now implement their assigned agent file without changing the runtime contract or orchestration graph.",
        },
      }),
    }))
    .addEdge(START, "orchestrator_boot")
    .addEdge("orchestrator_boot", "agent_7_state_change_decider")
    .addEdge("agent_7_state_change_decider", "agent_8_grade_intervention")
    .addEdge("agent_8_grade_intervention", "agent_1_parse_and_research")
    .addEdge("agent_1_parse_and_research", "agent_2_summarize_by_preference")
    .addEdge("agent_2_summarize_by_preference", "agent_6_create_study_plan")
    .addEdge("agent_6_create_study_plan", "agent_3_create_flashcards")
    .addEdge("agent_3_create_flashcards", "agent_4_create_quizzes")
    .addEdge("agent_4_create_quizzes", "agent_5_create_video_plan")
    .addEdge("agent_5_create_video_plan", "orchestrator_finalize")
    .addEdge("orchestrator_finalize", END)
    .compile();
}

async function runAgenticWorkflowScaffold({ runtimeState, options = {} }) {
  const graph = buildWorkflowGraph();
  const result = await graph.invoke({
    runtimeState,
    options,
  });

  return {
    orchestration: result.orchestration,
    results: result.results || {},
  };
}

module.exports = {
  buildWorkflowGraph,
  runAgenticWorkflowScaffold,
};
