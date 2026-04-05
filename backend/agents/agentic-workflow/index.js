const { runParseAndResearchAgent } = require("./agent-1-parse-and-research");
const { runSummarizeByPreferenceAgent } = require("./agent-2-summarize-by-preference");
const { runCreateFlashcardsAgent } = require("./agent-3-create-flashcards");
const { runCreateQuizzesAgent } = require("./agent-4-create-quizzes");
const { runCreateVideoPlanAgent } = require("./agent-5-create-video-plan");
const { runCreateStudyPlanAgent } = require("./agent-6-create-study-plan");
const { runStateChangeDeciderAgent } = require("./agent-7-state-change-decider");
const { buildWorkflowGraph, runAgenticWorkflowScaffold } = require("./agent-6-orchestrator");

const AGENT_REGISTRY = [
  {
    id: "agent_1_parse_and_research",
    name: "Agent 1: Parse and Research",
    file: "agent-1-parse-and-research.js",
    responsibility: "Parse course material and fetch relevant external context.",
  },
  {
    id: "agent_2_summarize_by_preference",
    name: "Agent 2: Summarize by Preference",
    file: "agent-2-summarize-by-preference.js",
    responsibility: "Summarize grounded data based on student preference.",
  },
  {
    id: "agent_3_create_flashcards",
    name: "Agent 3: Create Flashcards",
    file: "agent-3-create-flashcards.js",
    responsibility: "Create flashcards from the learning package.",
  },
  {
    id: "agent_4_create_quizzes",
    name: "Agent 4: Create Quizzes",
    file: "agent-4-create-quizzes.js",
    responsibility: "Create quizzes from the learning package.",
  },
  {
    id: "agent_5_create_video_plan",
    name: "Agent 5: Create Video",
    file: "agent-5-create-video-plan.js",
    responsibility: "Prepare the video/interactive lesson handoff.",
  },
  {
    id: "agent_6_create_study_plan",
    name: "Agent 6: Create Study Plan",
    file: "agent-6-create-study-plan.js",
    responsibility: "Create a study plan from deadlines, preferences, and existing course state.",
  },
  {
    id: "agent_7_state_change_decider",
    name: "Agent 7: State Change Decider",
    file: "agent-7-state-change-decider.js",
    responsibility: "Watch Canvas state changes and performance signals, then decide what support workflow should happen next.",
  },
  {
    id: "agent_8_orchestrator",
    name: "Agent 8: Orchestrator",
    file: "agent-6-orchestrator.js",
    responsibility: "Orchestrate the full agentic workflow.",
  },
];

module.exports = {
  AGENT_REGISTRY,
  buildWorkflowGraph,
  runAgenticWorkflowScaffold,
  runStateChangeDeciderAgent,
  runCreateStudyPlanAgent,
  runCreateFlashcardsAgent,
  runCreateQuizzesAgent,
  runCreateVideoPlanAgent,
  runParseAndResearchAgent,
  runSummarizeByPreferenceAgent,
};
