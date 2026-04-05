const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const databasePath = path.join(dataDir, "copilot.db");

function applyPragmas(database) {
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=15000;
    PRAGMA synchronous=NORMAL;
    PRAGMA temp_store=FILE;
    PRAGMA foreign_keys=ON;
    PRAGMA wal_autocheckpoint=100;
  `);
}

function initializeSchema(database) {
  database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    avatar_url TEXT,
    last_login_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    login_at TEXT,
    logout_at TEXT,
    auth_mode TEXT,
    last_path TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id TEXT,
    event_type TEXT,
    path TEXT,
    entity_type TEXT,
    entity_id TEXT,
    payload_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    user_id TEXT,
    course_id TEXT,
    module_id TEXT,
    topic_id TEXT,
    workflow_type TEXT,
    status TEXT,
    summary TEXT,
    result_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS workflow_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_run_id TEXT,
    artifact_type TEXT,
    title TEXT,
    content_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS preferences (
    user_id TEXT PRIMARY KEY,
    preferences_json TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS learning_gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_run_id TEXT,
    user_id TEXT,
    course_id TEXT,
    module_id TEXT,
    topic_id TEXT,
    gap_title TEXT,
    severity TEXT,
    evidence TEXT,
    recommendation TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS review_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_run_id TEXT,
    user_id TEXT,
    course_id TEXT,
    title TEXT,
    scheduled_for TEXT,
    duration_minutes INTEGER,
    goal TEXT,
    status TEXT DEFAULT 'suggested',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS autonomous_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_run_id TEXT,
    user_id TEXT,
    course_id TEXT,
    action_type TEXT,
    title TEXT,
    detail TEXT,
    status TEXT DEFAULT 'proposed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS canvas_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    course_id TEXT,
    snapshot_type TEXT,
    snapshot_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS canvas_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    course_id TEXT,
    event_type TEXT,
    entity_type TEXT,
    entity_id TEXT,
    title TEXT,
    detail_json TEXT,
    status TEXT DEFAULT 'detected',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS workflow_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    course_id TEXT,
    source_event_id INTEGER,
    job_type TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'queued',
    payload_json TEXT,
    result_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS material_pipeline_items (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    course_id TEXT,
    source_event_id INTEGER,
    material_entity_id TEXT,
    course_name TEXT,
    module_id TEXT,
    module_name TEXT,
    material_title TEXT,
    status TEXT DEFAULT 'new',
    summary_preview TEXT,
    summary_markdown TEXT,
    cleaned_text TEXT,
    narration_script TEXT,
    lesson_json TEXT,
    audio_manifest_json TEXT,
    video_payload_json TEXT,
    error_text TEXT,
    ready_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_material_pipeline_unique
  ON material_pipeline_items(user_id, course_id, material_entity_id);

  CREATE TABLE IF NOT EXISTS animated_video_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    source_file_id TEXT,
    title TEXT,
    status TEXT DEFAULT 'queued',
    progress_message TEXT,
    lesson_json TEXT,
    lesson_package_json TEXT,
    video_url TEXT,
    video_file_name TEXT,
    error_text TEXT,
    ready_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  `);
}

function openDatabase() {
  const database = new DatabaseSync(databasePath);
  applyPragmas(database);
  initializeSchema(database);
  return database;
}

function closeDatabase(database) {
  if (database && typeof database.close === "function") {
    database.close();
  }
}

function withDatabase(callback) {
  const database = openDatabase();
  try {
    return callback(database);
  } finally {
    closeDatabase(database);
  }
}

async function withDatabaseAsync(callback) {
  const database = openDatabase();
  try {
    return await callback(database);
  } finally {
    closeDatabase(database);
  }
}

// Lazy singleton for backward compat – prefer withDatabase() for writes
let _sharedDb = null;
function getSharedDb() {
  if (!_sharedDb) {
    _sharedDb = openDatabase();
  }
  return _sharedDb;
}

// Safe wrapper that retries on SQLITE_BUSY / database-is-locked errors
function withDatabaseRetry(callback, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const database = openDatabase();
    try {
      return callback(database);
    } catch (err) {
      closeDatabase(database);
      if (attempt < retries - 1 && /database is locked|SQLITE_BUSY/i.test(String(err?.message || err))) {
        const delay = 100 * Math.pow(2, attempt);
        const end = Date.now() + delay;
        while (Date.now() < end) { /* busy-wait for sync code */ }
        continue;
      }
      throw err;
    } finally {
      // close is safe to call multiple times
      closeDatabase(database);
    }
  }
}

async function withDatabaseAsyncRetry(callback, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const database = openDatabase();
    try {
      return await callback(database);
    } catch (err) {
      closeDatabase(database);
      if (attempt < retries - 1 && /database is locked|SQLITE_BUSY/i.test(String(err?.message || err))) {
        await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    } finally {
      closeDatabase(database);
    }
  }
}

const FEATURE_CATALOG = [
  { id: "course_brief", group: "planning", title: "Course Brief", status: "live" },
  { id: "catch_up", group: "planning", title: "Catch-up Recovery", status: "live" },
  { id: "deadline_rescue", group: "planning", title: "Deadline Rescue", status: "live" },
  { id: "exam_sprint", group: "planning", title: "Exam Sprint", status: "live" },
  { id: "module_mastery", group: "learning", title: "Module Mastery", status: "live" },
  { id: "topic_deep_dive", group: "learning", title: "Topic Deep Dive", status: "live" },
  { id: "pdf_reader", group: "learning", title: "Professor PDF Reader", status: "live" },
  { id: "summary_engine", group: "learning", title: "Summary Engine", status: "live" },
  { id: "video_plan", group: "learning", title: "Video Lesson Planner", status: "live" },
  { id: "flashcards", group: "assessment", title: "Flashcard Builder", status: "live" },
  { id: "quiz_builder", group: "assessment", title: "Quiz Builder", status: "live" },
  { id: "study_plan", group: "planning", title: "Study Plan Generator", status: "live" },
  { id: "agent_team", group: "agents", title: "Multi-Agent Workflow", status: "live" },
  { id: "canvas_state", group: "data", title: "Canvas State Sync", status: "live" },
  { id: "clickstream", group: "data", title: "Clickstream Logging", status: "live" },
  { id: "session_timeline", group: "data", title: "Session Timeline", status: "live" },
  { id: "workflow_history", group: "data", title: "Workflow History", status: "live" },
  { id: "artifact_store", group: "data", title: "Artifact Store", status: "live" },
  { id: "preferences_memory", group: "personalization", title: "Preference Memory", status: "live" },
  { id: "learning_style", group: "personalization", title: "Learning Style Adaptation", status: "live" },
  { id: "focus_now", group: "personalization", title: "Focus Now Panel", status: "live" },
  { id: "watchlist", group: "personalization", title: "Risk Watchlist", status: "live" },
  { id: "automation_ideas", group: "automation", title: "Automation Opportunities", status: "live" },
  { id: "gap_detection", group: "analytics", title: "Knowledge Gap Detection", status: "live" },
  { id: "review_sessions", group: "automation", title: "Review Session Scheduling", status: "live" },
  { id: "autonomous_actions", group: "automation", title: "Autonomous Action Planning", status: "live" },
  { id: "study_calendar", group: "automation", title: "Study Calendar Suggestions", status: "live" },
  { id: "intervention_engine", group: "agents", title: "Intervention Engine", status: "live" },
  { id: "intervention_score", group: "analytics", title: "Intervention Scoring", status: "live" },
  { id: "autonomous_review_orchestrator", group: "automation", title: "Autonomous Review Orchestrator", status: "live" },
  { id: "grade_recovery", group: "agents", title: "Grade Recovery Agent", status: "live" },
  { id: "performance_watcher", group: "analytics", title: "Performance Watcher", status: "live" },
  { id: "support_handoff", group: "agents", title: "Support Handoff Agent", status: "live" },
  { id: "resource_curator", group: "agents", title: "Resource Curator Agent", status: "live" },
  { id: "concept_rebuilder", group: "agents", title: "Concept Rebuilder Agent", status: "live" },
  { id: "assignment_recovery", group: "automation", title: "Assignment Recovery Planning", status: "live" },
  { id: "exam_recovery", group: "automation", title: "Exam Recovery Planning", status: "live" },
  { id: "state_sync", group: "platform", title: "Canvas State Sync Engine", status: "live" },
  { id: "state_diff", group: "platform", title: "Canvas Diff Detection", status: "live" },
  { id: "event_bus", group: "platform", title: "Learning Event Bus", status: "live" },
  { id: "workflow_queue", group: "platform", title: "Autonomous Workflow Queue", status: "live" },
  { id: "material_ingestion", group: "agents", title: "Material Ingestion Agent", status: "live" },
  { id: "discussion_digest", group: "agents", title: "Discussion Digest Agent", status: "live" },
  { id: "study_plan_agent", group: "agents", title: "Study Plan Agent", status: "live" },
  { id: "adaptive_quiz_agent", group: "agents", title: "Adaptive Quiz Agent", status: "live" },
  { id: "curated_flashcards", group: "agents", title: "Curated Flashcards Agent", status: "live" },
  { id: "memory_recall", group: "agents", title: "Memory Recall", status: "live" },
  { id: "mcp_server", group: "integration", title: "MCP Server", status: "live" },
  { id: "mcp_http_gateway", group: "integration", title: "MCP Streamable HTTP Gateway", status: "live" },
  { id: "engagement_analytics", group: "analytics", title: "Engagement Analytics", status: "live" },
  { id: "recent_activity", group: "analytics", title: "Recent Activity Feed", status: "live" },
  { id: "session_heatmap", group: "analytics", title: "Session Heatmap", status: "planned" },
  { id: "agent_notifications", group: "automation", title: "Agent Notifications", status: "planned" },
  { id: "autonomous_checkins", group: "automation", title: "Autonomous Check-ins", status: "planned" }
];

module.exports = {
  closeDatabase,
  dataDir,
  get db() { return getSharedDb(); },
  databasePath,
  FEATURE_CATALOG,
  openDatabase,
  withDatabase,
  withDatabaseAsync,
  withDatabaseRetry,
  withDatabaseAsyncRetry,
};
