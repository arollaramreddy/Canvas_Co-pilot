const express = require("express");
const cors = require("cors");
const pdf = require("pdf-parse");
const crypto = require("crypto");
const path = require("path");
const { Annotation, StateGraph, START, END } = require("@langchain/langgraph");
const { db, FEATURE_CATALOG } = require("./lib/db");
const {
  computeInterventionScore,
  generateAutonomousReviewPlan,
  persistAutonomousReviewPlan,
} = require("./lib/intelligence");
const { attachMcpHttpRoutes } = require("./lib/mcp");
const {
  GLOBAL_INBOX_SCOPE,
  listRecentEvents,
  listWorkflowJobs,
  syncCanvasStateToEvents,
  syncInboxStateToEvents,
} = require("./lib/state-sync");
const { processQueuedAgentJobs } = require("./lib/agent-workers");
const { buildLangGraphRuntimeState } = require("./lib/langgraph-runtime");
const {
  GENERATED_ROOT,
  ensureLessonAudioDir,
  generateLessonSlideAudio,
} = require("./lib/lesson-audio");
const {
  buildReplyDraftPrompt,
  classifyMessageIntent,
  getCourseFacts,
} = require("./lib/curated-autonomous-message-agent");
require("dotenv").config();

const app = express();
const PORT = 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
ensureLessonAudioDir();
app.use("/generated", express.static(GENERATED_ROOT));

const CANVAS_BASE_URL =
  process.env.CANVAS_BASE_URL || "https://canvas.asu.edu/api/v1";
const CANVAS_OAUTH_AUTHORIZE_URL =
  process.env.CANVAS_OAUTH_AUTHORIZE_URL || "https://canvas.asu.edu/login/oauth2/auth";
const CANVAS_OAUTH_TOKEN_URL =
  process.env.CANVAS_OAUTH_TOKEN_URL || "https://canvas.asu.edu/login/oauth2/token";
const CANVAS_CLIENT_ID = process.env.CANVAS_CLIENT_ID;
const CANVAS_CLIENT_SECRET = process.env.CANVAS_CLIENT_SECRET;
const CANVAS_OAUTH_REDIRECT_URI =
  process.env.CANVAS_OAUTH_REDIRECT_URI || `${BACKEND_URL}/api/auth/callback`;

const sessionStore = new Map();
const oauthStateStore = new Map();
let agentWorkerBusy = false;
let autonomousMonitorBusy = false;

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader.split(";").reduce((acc, pair) => {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
}

function getSession(req) {
  const cookies = parseCookies(req);
  return cookies.canvas_session ? sessionStore.get(cookies.canvas_session) : null;
}

function getCanvasAccessToken(req) {
  const session = getSession(req);
  return session?.accessToken || null;
}

function setSessionCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `canvas_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${isProd ? "; Secure" : ""}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "canvas_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
}

function upsertUser(user) {
  db.prepare(`
    INSERT INTO users (id, name, email, avatar_url, last_login_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      avatar_url = excluded.avatar_url,
      last_login_at = excluded.last_login_at
  `).run(String(user.id), user.name || "", user.email || "", user.avatar_url || "", new Date().toISOString());
}

function recordSessionStart(sessionId, user, authMode) {
  upsertUser(user);
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, user_id, login_at, auth_mode, last_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, String(user.id), new Date().toISOString(), authMode, "/");
}

function recordSessionEnd(sessionId) {
  if (!sessionId) return;
  db.prepare(`
    UPDATE sessions
    SET logout_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), sessionId);
}

function getSessionContext(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.canvas_session || null;
  const session = sessionId ? sessionStore.get(sessionId) : null;
  return {
    sessionId,
    userId: session?.user?.id ? String(session.user.id) : null,
    session,
  };
}

function logActivity(req, eventType, payload = {}) {
  const context = getSessionContext(req);
  db.prepare(`
    INSERT INTO activity_events (session_id, user_id, event_type, path, entity_type, entity_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.sessionId,
    context.userId,
    eventType,
    payload.path || req.path || "",
    payload.entityType || null,
    payload.entityId ? String(payload.entityId) : null,
    JSON.stringify(payload)
  );

  if (context.sessionId && payload.path) {
    db.prepare(`UPDATE sessions SET last_path = ? WHERE id = ?`).run(payload.path, context.sessionId);
  }
}

function saveWorkflowRunRecord(run) {
  const summary = run.workflow?.overview || run.workflow?.title || "";
  db.prepare(`
    INSERT OR REPLACE INTO workflow_runs
    (id, session_id, user_id, course_id, module_id, topic_id, workflow_type, status, summary, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.runId,
    run.sessionId || null,
    run.userId || null,
    run.courseId ? String(run.courseId) : null,
    run.moduleId ? String(run.moduleId) : null,
    run.topicId ? String(run.topicId) : null,
    run.workflowType,
    run.status,
    summary,
    JSON.stringify(run)
  );

  const insertArtifact = db.prepare(`
    INSERT INTO workflow_artifacts (workflow_run_id, artifact_type, title, content_json)
    VALUES (?, ?, ?, ?)
  `);

  const assets = run.workflow?.assets || {};
  Object.entries(assets).forEach(([artifactType, content]) => {
    insertArtifact.run(run.runId, artifactType, `${run.workflow?.title || "Workflow"} - ${artifactType}`, JSON.stringify(content));
  });
}

function saveDerivedIntelligence(run) {
  const workflow = run.workflow || {};
  const userId = run.userId || null;
  const courseId = run.courseId ? String(run.courseId) : null;
  const moduleId = run.moduleId ? String(run.moduleId) : null;
  const topicId = run.topicId ? String(run.topicId) : null;

  const insertGap = db.prepare(`
    INSERT INTO learning_gaps
    (workflow_run_id, user_id, course_id, module_id, topic_id, gap_title, severity, evidence, recommendation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const gap of workflow.knowledge_gaps || []) {
    insertGap.run(
      run.runId,
      userId,
      courseId,
      moduleId,
      topicId,
      gap.title || gap.topic || "Gap",
      gap.severity || "medium",
      gap.evidence || "",
      gap.recommendation || ""
    );
  }

  const insertSession = db.prepare(`
    INSERT INTO review_sessions
    (workflow_run_id, user_id, course_id, title, scheduled_for, duration_minutes, goal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const session of workflow.review_schedule || []) {
    insertSession.run(
      run.runId,
      userId,
      courseId,
      session.title || "Review session",
      session.when || session.scheduled_for || null,
      Number(session.duration_minutes || 30),
      session.goal || ""
    );
  }

  const insertAction = db.prepare(`
    INSERT INTO autonomous_actions
    (workflow_run_id, user_id, course_id, action_type, title, detail, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const action of workflow.autonomous_actions || []) {
    insertAction.run(
      run.runId,
      userId,
      courseId,
      action.type || "study_action",
      action.title || "Action",
      action.detail || "",
      action.status || "proposed"
    );
  }
}

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL_SUMMARY = process.env.OPENAI_MODEL_SUMMARY || "gpt-4.1-mini";
const OPENAI_MODEL_AGENT = process.env.OPENAI_MODEL_AGENT || "gpt-4.1";
const OPENAI_MODEL_LESSON = process.env.OPENAI_MODEL_LESSON || "gpt-4.1";

function getOpenAIKey() {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "your_openai_api_key_here") {
    throw new Error("OPENAI_API_KEY is not set in .env file");
  }
  return process.env.OPENAI_API_KEY;
}

async function createOpenAIResponse(payload) {
  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || "OpenAI request failed");
  }

  return data;
}

function extractResponseText(response) {
  if (response.output_text) {
    return response.output_text;
  }

  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text)
    .join("\n\n")
    .trim();
}

// ── Canvas API helpers ────────────────────────────────────

// Single-page Canvas request
async function canvasRequest(path, accessToken) {
  if (!accessToken) {
    const error = new Error("No Canvas access token available");
    error.status = 401;
    throw error;
  }
  const url = `${CANVAS_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Canvas API error (${res.status})`);
    error.status = res.status;
    error.detail = text;
    throw error;
  }

  return res.json();
}

// Paginated Canvas request – follows Link: <...>; rel="next"
async function canvasRequestAll(path, maxPages = 10, accessToken) {
  if (!accessToken) {
    const error = new Error("No Canvas access token available");
    error.status = 401;
    throw error;
  }
  let url = `${CANVAS_BASE_URL}${path}`;
  let all = [];

  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      const error = new Error(`Canvas API error (${res.status})`);
      error.status = res.status;
      error.detail = text;
      throw error;
    }

    const data = await res.json();
    all = all.concat(data);

    // Check for next page in Link header
    const link = res.headers.get("link");
    if (!link) break;

    const next = link.split(",").find((s) => s.includes('rel="next"'));
    if (!next) break;

    const match = next.match(/<([^>]+)>/);
    if (!match) break;

    url = match[1]; // absolute URL from Canvas
  }

  return all;
}

// Download a file from Canvas (follows redirects, returns Buffer)
async function downloadCanvasFile(fileUrl, accessToken) {
  if (!accessToken) {
    throw new Error("No Canvas access token available");
  }
  const res = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// In-memory cache for extracted PDF text (fileId -> text)
const textCache = new Map();
const workspaceSnapshotCache = new Map();
const workflowRunStore = new Map();

function makeWorkspaceCacheKey(courseId, accessToken) {
  return `${courseId}:${String(accessToken || "").slice(-12)}`;
}

function safeJsonParseObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Could not parse JSON object from model response");
  }
  return JSON.parse(match[0]);
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildFallbackMessageDraft(message, runtimeState) {
  const intent = classifyMessageIntent(message, runtimeState);
  const courseFacts = getCourseFacts(runtimeState);
  const text = `${message?.subject || ""}\n${message?.last_message || ""}`;
  const normalizedText = normalizeMatchText(text);

  const matchedAssignment =
    courseFacts.gradedAssignments.find((assignment) => {
      const normalizedName = normalizeMatchText(assignment.name);
      return normalizedName && normalizedText.includes(normalizedName);
    }) ||
    courseFacts.gradedAssignments.find((assignment) => {
      const digitMatch = normalizedText.match(/assignment(\d+)/);
      return digitMatch ? normalizeMatchText(assignment.name).includes(digitMatch[1]) : false;
    }) ||
    courseFacts.gradedAssignments[0] ||
    null;

  let draft = "Hi, I just checked Canvas and I’ll follow up with the details shortly.";
  const usedState = [];

  if (intent.asksForGrade && matchedAssignment) {
    const scorePart =
      matchedAssignment.points_possible
        ? `${matchedAssignment.score}/${matchedAssignment.points_possible}`
        : `${matchedAssignment.score}`;
    const percentPart =
      matchedAssignment.percent !== null && matchedAssignment.percent !== undefined
        ? ` (${matchedAssignment.percent}%)`
        : "";
    draft = `Hi, I checked Canvas and I received ${scorePart}${percentPart} on ${matchedAssignment.name}.`;
    usedState.push(`assignment score for ${matchedAssignment.name}`);
  } else if (intent.asksForAssignment && courseFacts.upcomingAssignments[0]) {
    const nextAssignment = courseFacts.upcomingAssignments[0];
    draft = `Hi, I checked Canvas and the next assignment I can see is ${nextAssignment.name}${nextAssignment.due_at ? `, due ${nextAssignment.due_at}` : ""}.`;
    usedState.push(`upcoming assignment ${nextAssignment.name}`);
  } else if (intent.isCourseRelated) {
    draft = "Hi, I checked Canvas and I can see the course details there. I can share the exact item once I confirm which assignment or grade you mean.";
    usedState.push("course-aware Canvas workspace state");
  }

  return {
    summary: "Fallback reply generated from Canvas state.",
    classification: intent,
    draft,
    whyThisReply: [
      "The message asks for course-related information.",
      "A fallback reply was generated directly from available Canvas state.",
    ],
    usedState,
  };
}

function isAssignmentCompleted(assignment) {
  const submission = assignment?.submission || assignment;
  return Boolean(
    submission?.submitted_at ||
      submission?.score !== null && submission?.score !== undefined ||
      submission?.grade ||
      ["submitted", "graded", "complete", "completed"].includes(
        String(submission?.workflow_state || submission?.submission_status || "").toLowerCase()
      )
  );
}

async function getCourseDetails(courseId, accessToken) {
  const course = await canvasRequest(`/courses/${courseId}`, accessToken);
  return {
    id: course.id,
    name: course.name,
    code: course.course_code,
    enrollment_term_id: course.enrollment_term_id,
  };
}

async function getEnrichedModuleItems(courseId, moduleId, accessToken) {
  const items = await canvasRequestAll(
    `/courses/${courseId}/modules/${moduleId}/items?per_page=100`,
    10,
    accessToken
  );

  return Promise.all(
    items.map(async (item) => {
      if (item.type === "File" && item.content_id) {
        try {
          const file = await canvasRequest(
            `/courses/${courseId}/files/${item.content_id}`,
            accessToken
          );
          return {
            id: file.id,
            module_item_id: item.id,
            content_id: item.content_id,
            display_name: file.display_name,
            filename: file.filename,
            size: file.size,
            content_type: file.content_type || "",
            url: file.url,
            created_at: file.created_at,
            type: "File",
            is_pdf:
              (file.content_type || "").includes("pdf") ||
              (file.filename || "").toLowerCase().endsWith(".pdf"),
          };
        } catch {
          return {
            id: item.content_id,
            module_item_id: item.id,
            content_id: item.content_id,
            display_name: item.title,
            type: "File",
            is_pdf: (item.title || "").toLowerCase().endsWith(".pdf"),
            error: "Could not fetch file details",
          };
        }
      }

      return {
        id: item.id,
        module_item_id: item.id,
        content_id: item.content_id || null,
        display_name: item.title,
        external_url: item.external_url,
        html_url: item.html_url,
        page_url: item.page_url,
        type: item.type,
        completion_requirement: item.completion_requirement || null,
        is_pdf: false,
      };
    })
  );
}

async function buildWorkspaceState(courseId, accessToken, options = {}) {
  const cacheKey = makeWorkspaceCacheKey(courseId, accessToken);
  const cached = workspaceSnapshotCache.get(cacheKey);
  const maxAgeMs = 1000 * 60 * 5;
  if (!options.force && cached && Date.now() - cached.createdAt < maxAgeMs) {
    return cached.data;
  }

  const [course, assignments, modules, discussions, announcements, conversations] = await Promise.all([
    getCourseDetails(courseId, accessToken),
    canvasRequestAll(
      `/courses/${courseId}/assignments?per_page=50&order_by=due_at&include[]=submission`,
      10,
      accessToken
    ),
    canvasRequestAll(
      `/courses/${courseId}/modules?per_page=50&include[]=items_count`,
      10,
      accessToken
    ),
    canvasRequestAll(
      `/courses/${courseId}/discussion_topics?per_page=30&only_announcements=false`,
      10,
      accessToken
    ).catch(() => []),
    canvasRequestAll(
      `/announcements?context_codes[]=course_${courseId}&per_page=20`,
      10,
      accessToken
    ).catch(() => []),
    canvasRequestAll(
      `/conversations?scope=inbox&filter[]=course_${courseId}&per_page=20`,
      10,
      accessToken
    ).catch(() => []),
  ]);

  const enrichedModules = await Promise.all(
    modules.map(async (module) => {
      const items = await getEnrichedModuleItems(courseId, module.id, accessToken);
      return {
        id: module.id,
        name: module.name,
        position: module.position,
        items_count: module.items_count,
        state: module.state,
        items,
      };
    })
  );

  const state = {
    syncedAt: new Date().toISOString(),
    course,
    assignments: assignments.map((a) => ({
      id: a.id,
      name: a.name,
      due_at: a.due_at,
      points_possible: a.points_possible,
      html_url: a.html_url,
      score: a.submission?.score ?? null,
      grade: a.submission?.grade ?? null,
      submitted_at: a.submission?.submitted_at || null,
      missing: Boolean(a.submission?.missing),
      submission_status: a.submission?.workflow_state || null,
      is_completed: isAssignmentCompleted(a),
    })),
    discussions: discussions.map((discussion) => ({
      id: discussion.id,
      title: discussion.title,
      posted_at: discussion.posted_at || discussion.created_at || null,
      author_name: discussion.author?.display_name || discussion.author_name || null,
      unread_count: discussion.unread_count ?? 0,
      html_url: discussion.html_url || null,
    })),
    announcements: announcements.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      posted_at: announcement.posted_at || announcement.created_at || null,
      author_name: announcement.author?.display_name || announcement.author_name || null,
      html_url: announcement.html_url || null,
    })),
    messages: conversations.map((conversation) => ({
      id: conversation.id,
      subject: conversation.subject || conversation.last_message || "Message",
      last_message_at: conversation.last_message_at || conversation.updated_at || null,
      message_count: conversation.message_count ?? 0,
      last_author_name: conversation.last_authored_message_author || null,
      workflow_state: conversation.workflow_state || null,
    })),
    modules: enrichedModules,
    stats: {
      modules: enrichedModules.length,
      assignments: assignments.length,
      discussions: discussions.length,
      announcements: announcements.length,
      messages: conversations.length,
      materials: enrichedModules.reduce((count, module) => count + module.items.length, 0),
      pdfs: enrichedModules.reduce(
        (count, module) => count + module.items.filter((item) => item.is_pdf).length,
        0
      ),
      gradedAssignments: assignments.filter((assignment) => assignment.submission?.score !== null && assignment.submission?.score !== undefined).length,
      lowScoreAssignments: assignments.filter((assignment) => {
        const score = assignment.submission?.score;
        const points = assignment.points_possible;
        return score !== null && score !== undefined && points ? (Number(score) / Number(points)) * 100 < 70 : false;
      }).length,
    },
  };

  workspaceSnapshotCache.set(cacheKey, { createdAt: Date.now(), data: state });
  return state;
}

async function listActiveCanvasCourses(accessToken) {
  const courses = await canvasRequestAll(
    "/courses?per_page=20&enrollment_state=active",
    10,
    accessToken
  );

  return courses.map((course) => ({
    id: String(course.id),
    name: course.name,
    code: course.course_code,
  }));
}

async function enrichConversationAuthor(conversation, accessToken, currentUser = null) {
  try {
    const detail = await canvasRequest(
      `/conversations/${conversation.id}?include[]=messages&include[]=participants`,
      accessToken
    );
    const messages = Array.isArray(detail?.messages) ? detail.messages : [];
    const latestMessage = messages[messages.length - 1] || null;
    const participants = Array.isArray(detail?.participants) ? detail.participants : [];
    const participantById = new Map(
      participants
        .filter((participant) => participant?.id !== undefined && participant?.id !== null)
        .map((participant) => [String(participant.id), participant])
    );

    const lastAuthorId =
      latestMessage?.author_id !== undefined && latestMessage?.author_id !== null
        ? String(latestMessage.author_id)
        : null;
    const lastAuthorName =
      latestMessage?.author?.display_name ||
      latestMessage?.author?.name ||
      latestMessage?.author_name ||
      (lastAuthorId ? participantById.get(lastAuthorId)?.name : null) ||
      conversation.last_authored_message_author ||
      null;
    const sentByCurrentUser =
      lastAuthorId && currentUser?.id ? String(currentUser.id) === String(lastAuthorId) : false;

    return {
      last_author_id: lastAuthorId,
      last_author_name: lastAuthorName,
      sent_by_current_user: sentByCurrentUser,
    };
  } catch {
    return {
      last_author_id: null,
      last_author_name: conversation.last_authored_message_author || null,
      sent_by_current_user: false,
    };
  }
}

async function buildInboxState(accessToken, currentUser = null) {
  const conversations = await canvasRequestAll(
    "/conversations?scope=inbox&per_page=30",
    10,
    accessToken
  ).catch(() => []);
  const authorMeta = await Promise.all(
    conversations.map((conversation) => enrichConversationAuthor(conversation, accessToken, currentUser))
  );

  return {
    syncedAt: new Date().toISOString(),
    messages: conversations.map((conversation, index) => ({
      id: conversation.id,
      subject: conversation.subject || conversation.last_message || "Message",
      last_message: conversation.last_message || "",
      last_message_at: conversation.last_message_at || conversation.updated_at || null,
      message_count: conversation.message_count ?? 0,
      last_author_id: authorMeta[index]?.last_author_id || null,
      last_author_name: authorMeta[index]?.last_author_name || null,
      sent_by_current_user: Boolean(authorMeta[index]?.sent_by_current_user),
      workflow_state: conversation.workflow_state || null,
    })),
  };
}

async function runAutonomousCanvasMonitor() {
  const activeSessions = Array.from(sessionStore.entries())
    .map(([sessionId, session]) => ({
      sessionId,
      session,
      userId: session?.user?.id ? String(session.user.id) : null,
    }))
    .filter((entry) => entry.userId && entry.session?.accessToken);

  for (const active of activeSessions) {
    try {
      const courses = await listActiveCanvasCourses(active.session.accessToken);
      const watchCourses = courses.slice(0, 6);

      const inboxState = await buildInboxState(active.session.accessToken, active.session.user);
      const inboxSync = syncInboxStateToEvents({
        db,
        userId: active.userId,
        state: inboxState,
      });

      if (inboxSync.detectedEvents.length || inboxSync.queuedJobs.length) {
        db.prepare(`
          INSERT INTO activity_events (session_id, user_id, event_type, path, entity_type, entity_id, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          active.sessionId,
          active.userId,
          "autonomous_inbox_sync",
          "/internal/autonomous-monitor",
          "inbox",
          GLOBAL_INBOX_SCOPE,
          JSON.stringify({
            detectedEvents: inboxSync.detectedEvents.length,
            queuedJobs: inboxSync.queuedJobs.length,
          })
        );
      }

      for (const course of watchCourses) {
        const state = await buildWorkspaceState(course.id, active.session.accessToken, { force: true });
        const syncResult = syncCanvasStateToEvents({
          db,
          userId: active.userId,
          courseId: course.id,
          state,
        });

        if (syncResult.detectedEvents.length || syncResult.queuedJobs.length) {
          db.prepare(`
            INSERT INTO activity_events (session_id, user_id, event_type, path, entity_type, entity_id, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            active.sessionId,
            active.userId,
            "autonomous_monitor_sync",
            "/internal/autonomous-monitor",
            "course",
            String(course.id),
            JSON.stringify({
              detectedEvents: syncResult.detectedEvents.length,
              queuedJobs: syncResult.queuedJobs.length,
              courseName: course.name,
            })
          );
        }
      }
    } catch (error) {
      console.error(`Autonomous monitor failed for user ${active.userId}:`, error.message);
    }
  }
}

async function ensureTopicText(courseId, topic, accessToken) {
  if (!topic || topic.type !== "File" || !topic.is_pdf) {
    return "";
  }

  const cacheKey = String(topic.id);
  if (textCache.has(cacheKey)) {
    return textCache.get(cacheKey);
  }

  const file = await canvasRequest(`/courses/${courseId}/files/${topic.id}`, accessToken);
  if (!file.url) return "";

  const buffer = await downloadCanvasFile(file.url, accessToken);
  const pdfData = await pdf(buffer);
  const text = pdfData.text || "";
  if (text) textCache.set(cacheKey, text);
  return text;
}

function buildWorkflowPrompt({ workflowType, runtimeState }) {
  const state = runtimeState.canvas.courseState;
  const selectedModule = runtimeState.canvas.selectedModule;
  const selectedTopic = runtimeState.canvas.selectedTopic;
  const topicText = runtimeState.canvas.topicText;
  const preferences = runtimeState.memory.preferences;
  const dueSoon = runtimeState.canvas.signals.dueSoon;
  const workflowLabels = {
    course_brief: "course command brief",
    module_mastery: "module mastery pack",
    topic_deep_dive: "topic deep dive",
    deadline_rescue: "deadline rescue plan",
    exam_sprint: "exam sprint plan",
    catch_up: "catch-up recovery plan",
    grade_recovery: "grade recovery intervention",
    assignment_rescue: "assignment rescue workflow",
    support_handoff: "support handoff workflow",
  };
  const workflowLabel = workflowLabels[workflowType] || workflowType;

  return `You are building an industry-grade agentic study workflow for a student.
Return ONLY valid JSON with this exact shape:
{
  "title": "short title",
  "workflow_type": "course_brief | module_mastery | topic_deep_dive | deadline_rescue | exam_sprint | catch_up | grade_recovery | assignment_rescue | support_handoff",
  "overview": "2-4 sentence summary",
  "state_summary": [
    "short bullet",
    "short bullet"
  ],
  "agent_team": [
    {
      "role": "Planner",
      "mission": "what this agent is responsible for",
      "output": "what it produced"
    }
  ],
  "stages": [
    { "name": "State sync", "status": "completed", "detail": "what happened" },
    { "name": "Reasoning", "status": "completed", "detail": "what happened" },
    { "name": "Assets", "status": "completed", "detail": "what happened" }
  ],
  "assets": {
    "summary": "markdown summary",
    "study_plan": {
      "horizon": "3 days | 7 days | until exam",
      "sessions": [
        { "title": "session title", "duration_minutes": 30, "goal": "what to achieve" }
      ]
    },
    "quiz_questions": [
      { "question": "text", "answer": "text", "difficulty": "easy | medium | hard" }
    ],
    "flashcards": [
      { "front": "text", "back": "text" }
    ],
    "curated_resources": [
      { "title": "resource title", "reason": "why it helps", "format": "pdf | note | video | web" }
    ],
    "video_plan": {
      "should_generate": true,
      "reason": "why",
      "hook": "opening line",
      "scenes": ["scene 1", "scene 2", "scene 3"]
    }
  },
  "student_command_center": {
    "focus_now": ["short action", "short action"],
    "watchlist": ["short risk", "short risk"],
    "wins": ["short win", "short win"]
  },
  "knowledge_gaps": [
    {
      "title": "gap name",
      "severity": "low | medium | high",
      "evidence": "why this gap exists",
      "recommendation": "what to do next"
    }
  ],
  "review_schedule": [
    {
      "title": "review block title",
      "when": "ISO date or relative phrase",
      "duration_minutes": 30,
      "goal": "what to review"
    }
  ],
  "autonomous_actions": [
    {
      "type": "review | reminder | intervention | resource",
      "title": "action title",
      "detail": "specific action details",
      "status": "proposed"
    }
  ],
  "agent_handoffs": [
    {
      "from": "agent name",
      "to": "agent name",
      "reason": "why the handoff happened",
      "expected_outcome": "what should happen next"
    }
  ],
  "support_plan": {
    "trigger": "what caused support to activate",
    "interventions": ["short intervention", "short intervention"],
    "recommended_materials": ["resource type", "resource type"],
    "success_signal": "what improvement should be monitored"
  },
  "automation_opportunities": [
    "short automation idea",
    "short automation idea"
  ],
  "next_actions": [
    "short action",
    "short action"
  ],
  "agent_notes": "1 short paragraph"
}

Rules:
- Keep outputs concise but high signal.
- study_plan should feel actionable and time-boxed.
- quiz_questions: 4 to 6 items.
- flashcards: 4 to 8 items.
- curated_resources should recommend targeted learning support based on student state.
- stages must reflect a real workflow.
- agent_team must include 3 to 4 specialized agents with distinct roles.
- When marks are weak or assignments are missing, include specialized agents like Performance Watcher, Recovery Planner, Concept Rebuilder, Resource Curator, or Support Handoff.
- automation_opportunities should identify high-value ways agents can save the student time.
- student_command_center should feel proactive, not generic.
- knowledge_gaps should reflect likely weak spots inferred from course state and study mode.
- review_schedule should propose 3 to 5 study blocks.
- autonomous_actions should sound like things a strong study copilot would do next without waiting.
- agent_handoffs must show how one agent activates another in response to the student's situation.
- support_plan must explain how the system helps the student rebound after weak performance.
- Adapt to the student preference.

Workflow requested: ${workflowLabel}
Student preference: ${preferences?.studyStyle || "visual"}

Canvas course state:
${JSON.stringify({
    course: state.course,
    stats: state.stats,
    dueSoon,
    performance: {
      gradedAssignments: runtimeState.canvas.signals.lowScores,
    },
    selectedModule: selectedModule
      ? {
          id: selectedModule.id,
          name: selectedModule.name,
          items_count: selectedModule.items_count,
          items: selectedModule.items.slice(0, 15).map((item) => ({
            id: item.id,
            display_name: item.display_name,
            type: item.type,
            is_pdf: item.is_pdf,
          })),
        }
      : null,
    selectedTopic: selectedTopic
      ? {
          id: selectedTopic.id,
          display_name: selectedTopic.display_name,
          type: selectedTopic.type,
          is_pdf: selectedTopic.is_pdf,
        }
      : null,
    telemetry: {
      recentStateEvents: runtimeState.telemetry.courseEvents.slice(0, 8),
      queueSignals: runtimeState.telemetry.queueSignals,
    },
    intelligence: {
      intervention: runtimeState.intelligence.intervention,
      learningGaps: runtimeState.memory.learningGaps.slice(0, 6),
      recommendations: runtimeState.intelligence.recommendations.slice(0, 6),
    },
  }, null, 2)}

${topicText ? `Professor-posted topic material excerpt:\n${topicText.slice(0, 18000)}` : "No extracted topic text was available."}`;
}

function buildPlannerPrompt({ workflowType, runtimeState }) {
  const state = runtimeState.canvas.courseState;
  const selectedModule = runtimeState.canvas.selectedModule;
  const selectedTopic = runtimeState.canvas.selectedTopic;
  const preferences = runtimeState.memory.preferences;

  return `You are the planner agent in a LangGraph multi-agent study system.
Return ONLY valid JSON:
{
  "workflow_type": "${workflowType}",
  "objective": "one sentence objective",
  "priority_order": ["first priority", "second priority", "third priority"],
  "agent_roles": [
    { "role": "Planner", "responsibility": "what this agent owns" },
    { "role": "Performance Watcher", "responsibility": "monitor grades, missing work, and downward trends" },
    { "role": "Concept Rebuilder", "responsibility": "repair weak understanding with layered explanations" },
    { "role": "Resource Curator", "responsibility": "collect targeted study support and richer material" },
    { "role": "Support Handoff", "responsibility": "activate the next best agent when the student still needs help" }
  ],
  "student_risks": ["risk 1", "risk 2"],
  "focus_window": "short description"
}

Student preference: ${preferences?.studyStyle || "visual"}
Course: ${state.course.name}
Stats: ${JSON.stringify(state.stats)}
Selected module: ${selectedModule ? selectedModule.name : "none"}
Selected topic: ${selectedTopic ? selectedTopic.display_name : "none"}
Recent event triggers: ${JSON.stringify(runtimeState.telemetry.eventSignals.dominantTriggers)}
Queue state: ${JSON.stringify(runtimeState.telemetry.queueSignals)}
Current intervention: ${JSON.stringify(runtimeState.intelligence.intervention)}`;
}

const WorkflowGraphState = Annotation.Root({
  request: Annotation(),
  accessToken: Annotation(),
  sessionId: Annotation(),
  userId: Annotation(),
  runtimeState: Annotation(),
  plannerOutput: Annotation(),
  workflowResult: Annotation(),
});

const workflowGraph = new StateGraph(WorkflowGraphState)
  .addNode("sync_canvas_state", async (state) => {
    const runtimeState = await buildLangGraphRuntimeState({
      db,
      request: state.request,
      accessToken: state.accessToken,
      sessionId: state.sessionId,
      userId: state.userId,
      listActiveCanvasCourses,
      buildWorkspaceState,
      buildInboxState,
      ensureTopicText,
      computeInterventionScore,
    });

    return { runtimeState };
  })
  .addNode("planner_agent", async (state) => {
    const response = await createOpenAIResponse({
      model: OPENAI_MODEL_AGENT,
      input: buildPlannerPrompt({
        workflowType: state.request.workflowType,
        runtimeState: state.runtimeState,
      }),
    });

    return {
      plannerOutput: safeJsonParseObject(extractResponseText(response) || ""),
    };
  })
  .addNode("specialist_agents", async (state) => {
    const response = await createOpenAIResponse({
      model: OPENAI_MODEL_AGENT,
      input: `${buildWorkflowPrompt({
        workflowType: state.request.workflowType,
        runtimeState: state.runtimeState,
      })}

Planner output:
${JSON.stringify(state.plannerOutput, null, 2)}

You are now the specialist agent team. Use the planner output to finalize the workflow response.`,
    });

    return {
      workflowResult: safeJsonParseObject(extractResponseText(response) || ""),
    };
  })
  .addEdge(START, "sync_canvas_state")
  .addEdge("sync_canvas_state", "planner_agent")
  .addEdge("planner_agent", "specialist_agents")
  .addEdge("specialist_agents", END)
  .compile();

attachMcpHttpRoutes(app, {
  db,
  canvasRequest: (pathname) => canvasRequest(pathname, null),
  canvasRequestAll: (pathname) => canvasRequestAll(pathname, 10, null),
  buildWorkspaceState: (courseId) => buildWorkspaceState(courseId, null),
  computeInterventionScore,
  listRecentEvents,
  listWorkflowJobs,
});

setInterval(async () => {
  if (autonomousMonitorBusy) return;
  autonomousMonitorBusy = true;
  try {
    await runAutonomousCanvasMonitor();
  } catch (error) {
    console.error("Autonomous Canvas monitor failed:", error.message);
  } finally {
    autonomousMonitorBusy = false;
  }
}, 60000);

setInterval(() => {
  if (agentWorkerBusy) return;
  agentWorkerBusy = true;
  try {
    processQueuedAgentJobs({
      db,
      computeInterventionScore,
      generateAutonomousReviewPlan,
      persistAutonomousReviewPlan,
      limit: 3,
    });
  } catch (error) {
    console.error("Agent worker loop failed:", error.message);
  } finally {
    agentWorkerBusy = false;
  }
}, 15000);

// ── Existing Endpoints ────────────────────────────────────

app.get("/api/auth/config", (req, res) => {
  res.json({
    oauthEnabled: Boolean(CANVAS_CLIENT_ID && CANVAS_CLIENT_SECRET),
    tokenLoginEnabled: true,
    redirectUri: CANVAS_OAUTH_REDIRECT_URI,
  });
});

app.post("/api/auth/token-login", async (req, res) => {
  const { accessToken } = req.body || {};

  if (!accessToken || !String(accessToken).trim()) {
    return res.status(400).json({ error: "accessToken is required" });
  }

  try {
    const token = String(accessToken).trim();
    const user = await canvasRequest("/users/self", token);
    const sessionId = crypto.randomBytes(24).toString("hex");

    sessionStore.set(sessionId, {
      accessToken: token,
      createdAt: Date.now(),
      authMode: "token",
      user: {
        id: user.id,
        name: user.name,
        email: user.primary_email || user.login_id || "N/A",
        avatar_url: user.avatar_url,
      },
    });
    recordSessionStart(sessionId, {
      id: user.id,
      name: user.name,
      email: user.primary_email || user.login_id || "N/A",
      avatar_url: user.avatar_url,
    }, "token");

    setSessionCookie(res, sessionId);
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.primary_email || user.login_id || "N/A",
        avatar_url: user.avatar_url,
      },
      authMode: "token",
    });
  } catch (err) {
    res.status(err.status || 401).json({
      error:
        err.status === 401
          ? "Invalid Canvas access token"
          : `Canvas login failed: ${err.message}`,
    });
  }
});

app.get("/api/auth/login", (req, res) => {
  if (!CANVAS_CLIENT_ID || !CANVAS_CLIENT_SECRET) {
    return res.status(500).json({
      error:
        "Canvas OAuth is not configured. Set CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, and CANVAS_OAUTH_REDIRECT_URI in backend/.env.",
    });
  }

  const state = crypto.randomBytes(16).toString("hex");
  oauthStateStore.set(state, { createdAt: Date.now() });
  const authorizeUrl = new URL(CANVAS_OAUTH_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", CANVAS_CLIENT_ID);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", CANVAS_OAUTH_REDIRECT_URI);
  authorizeUrl.searchParams.set("state", state);

  res.redirect(authorizeUrl.toString());
});

app.get("/api/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/?authError=${encodeURIComponent(String(error))}`);
  }

  if (!code || !state || !oauthStateStore.has(String(state))) {
    return res.redirect(`${FRONTEND_URL}/?authError=invalid_callback`);
  }

  oauthStateStore.delete(String(state));

  try {
    const tokenResponse = await fetch(CANVAS_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CANVAS_CLIENT_ID,
        client_secret: CANVAS_CLIENT_SECRET,
        redirect_uri: CANVAS_OAUTH_REDIRECT_URI,
        code: String(code),
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || "Failed to exchange OAuth code");
    }

    const user = await canvasRequest("/users/self", tokenData.access_token);
    const sessionId = crypto.randomBytes(24).toString("hex");
    sessionStore.set(sessionId, {
      accessToken: tokenData.access_token,
      createdAt: Date.now(),
      authMode: "oauth",
      user: {
        id: user.id,
        name: user.name,
        email: user.primary_email || user.login_id || "N/A",
        avatar_url: user.avatar_url,
      },
    });
    recordSessionStart(sessionId, {
      id: user.id,
      name: user.name,
      email: user.primary_email || user.login_id || "N/A",
      avatar_url: user.avatar_url,
    }, "oauth");
    setSessionCookie(res, sessionId);
    res.redirect(`${FRONTEND_URL}/`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/?authError=${encodeURIComponent(err.message)}`);
  }
});

app.get("/api/auth/me", async (req, res) => {
  const session = getSession(req);

  if (session?.user) {
    return res.json({
      authenticated: true,
      user: session.user,
      authMode: session.authMode || "token",
    });
  }

  return res.status(401).json({ authenticated: false, error: "No authenticated session" });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.canvas_session) {
    recordSessionEnd(cookies.canvas_session);
    sessionStore.delete(cookies.canvas_session);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

// 1. Test login – verify token by fetching current user
app.get("/api/test-login", async (req, res) => {
  const accessToken = getCanvasAccessToken(req);
  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "No Canvas token available. Log in first." });
  }

  try {
    const user = await canvasRequest("/users/self", accessToken);
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.primary_email || user.login_id || "N/A",
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error:
        err.status === 401
          ? "Invalid or expired Canvas token"
          : `Canvas API error: ${err.message}`,
    });
  }
});

// 2. List courses
app.get("/api/courses", async (req, res) => {
  try {
    const accessToken = getCanvasAccessToken(req);
    const courses = await canvasRequestAll(
      "/courses?per_page=50&enrollment_state=active",
      10,
      accessToken
    );
    res.json(
      courses.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.course_code,
        enrollment_term_id: c.enrollment_term_id,
      }))
    );
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to fetch courses: ${err.message}` });
  }
});

// 3. Assignments for a course
app.get("/api/courses/:courseId/assignments", async (req, res) => {
  try {
    const accessToken = getCanvasAccessToken(req);
    const assignments = await canvasRequestAll(
      `/courses/${req.params.courseId}/assignments?per_page=50&order_by=due_at&include[]=submission`,
      10,
      accessToken
    );
    res.json(
      assignments.map((a) => ({
        id: a.id,
        name: a.name,
        due_at: a.due_at,
        points_possible: a.points_possible,
        html_url: a.html_url,
        score: a.submission?.score ?? null,
        grade: a.submission?.grade ?? null,
        submitted_at: a.submission?.submitted_at || null,
        missing: Boolean(a.submission?.missing),
        submission_status: a.submission?.workflow_state || null,
        is_completed: isAssignmentCompleted(a),
      }))
    );
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to fetch assignments: ${err.message}` });
  }
});

// 4. Files for a course
app.get("/api/courses/:courseId/files", async (req, res) => {
  try {
    const accessToken = getCanvasAccessToken(req);
    const files = await canvasRequest(
      `/courses/${req.params.courseId}/files?per_page=20`,
      accessToken
    );
    res.json(
      files.map((f) => ({
        id: f.id,
        display_name: f.display_name,
        size: f.size,
        url: f.url,
        created_at: f.created_at,
      }))
    );
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to fetch files: ${err.message}` });
  }
});

// ── New Endpoints: Modules & AI ───────────────────────────

// 5. List modules for a course (with item count)
app.get("/api/modules", async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: "courseId is required" });

  try {
    const accessToken = getCanvasAccessToken(req);
    const modules = await canvasRequestAll(
      `/courses/${courseId}/modules?per_page=50&include[]=items_count`,
      10,
      accessToken
    );
    res.json(
      modules.map((m) => ({
        id: m.id,
        name: m.name,
        position: m.position,
        items_count: m.items_count,
        state: m.state,
      }))
    );
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to fetch modules: ${err.message}` });
  }
});

// 6. List files inside a module (professor-uploaded files only)
app.get("/api/module-files", async (req, res) => {
  const { courseId, moduleId } = req.query;
  if (!courseId || !moduleId) {
    return res.status(400).json({ error: "courseId and moduleId are required" });
  }

  try {
    const accessToken = getCanvasAccessToken(req);
    const items = await canvasRequestAll(
      `/courses/${courseId}/modules/${moduleId}/items?per_page=100`,
      10,
      accessToken
    );

    // Filter to only File and ExternalUrl types (professor uploads)
    // Ignore: Assignment, Discussion, Quiz, SubHeader, Page (student-facing)
    const fileItems = items.filter(
      (item) => item.type === "File" || item.type === "ExternalUrl"
    );

    // For File items, fetch file metadata to get URL and content type
    const enriched = await Promise.all(
      fileItems.map(async (item) => {
        if (item.type === "File" && item.content_id) {
          try {
            const file = await canvasRequest(
              `/courses/${courseId}/files/${item.content_id}`,
              accessToken
            );
            return {
              id: file.id,
              module_item_id: item.id,
              display_name: file.display_name,
              filename: file.filename,
              size: file.size,
              content_type: file.content_type || "",
              url: file.url,
              created_at: file.created_at,
              type: "File",
              is_pdf:
                (file.content_type || "").includes("pdf") ||
                (file.filename || "").toLowerCase().endsWith(".pdf"),
            };
          } catch {
            return {
              id: item.content_id,
              module_item_id: item.id,
              display_name: item.title,
              type: "File",
              is_pdf: (item.title || "").toLowerCase().endsWith(".pdf"),
              error: "Could not fetch file details",
            };
          }
        }

        // External URL
        return {
          id: item.id,
          module_item_id: item.id,
          display_name: item.title,
          external_url: item.external_url,
          type: "ExternalUrl",
          is_pdf: false,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to fetch module files: ${err.message}` });
  }
});

app.get("/api/workspace-state", async (req, res) => {
  const { courseId, force } = req.query;
  if (!courseId) {
    return res.status(400).json({ error: "courseId is required" });
  }

  try {
    const accessToken = getCanvasAccessToken(req);
    const state = await buildWorkspaceState(courseId, accessToken, {
      force: force === "true",
    });
    logActivity(req, "workspace_state_sync", {
      path: req.path,
      entityType: "course",
      entityId: courseId,
      force: force === "true",
    });
    res.json(state);
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to build workspace state: ${err.message}` });
  }
});

app.post("/api/state-sync", async (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId } = req.body || {};
    if (!courseId) {
      return res.status(400).json({ error: "courseId is required" });
    }

    const accessToken = getCanvasAccessToken(req);
    const state = await buildWorkspaceState(courseId, accessToken, { force: true });
    const syncResult = syncCanvasStateToEvents({
      db,
      userId: context.userId,
      courseId,
      state,
    });

    logActivity(req, "canvas_state_synced", {
      path: req.path,
      entityType: "course",
      entityId: courseId,
      detectedEvents: syncResult.detectedEvents.length,
      queuedJobs: syncResult.queuedJobs.length,
    });

    res.json({
      success: true,
      course: state.course,
      snapshotId: syncResult.snapshotId,
      previousSnapshotId: syncResult.previousSnapshotId,
      detectedEvents: syncResult.detectedEvents,
      queuedJobs: syncResult.queuedJobs,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to sync course state: ${err.message}` });
  }
});

app.post("/api/autonomous-monitor/run", async (req, res) => {
  try {
    await runAutonomousCanvasMonitor();
    const processed = processQueuedAgentJobs({
      db,
      computeInterventionScore,
      generateAutonomousReviewPlan,
      persistAutonomousReviewPlan,
      limit: 10,
    });

    res.json({
      success: true,
      processed,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to run autonomous monitor: ${err.message}` });
  }
});

app.get("/api/autonomous-monitor/status", (_req, res) => {
  res.json({
    running: autonomousMonitorBusy,
    activeSessions: Array.from(sessionStore.values()).filter((session) => session?.accessToken).length,
    monitorIntervalMs: 60000,
    workerIntervalMs: 15000,
  });
});

app.get("/api/state-events", (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId, limit } = req.query;
    const events = listRecentEvents(db, context.userId, courseId || null, Number(limit || 30));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: `Failed to load state events: ${err.message}` });
  }
});

app.get("/api/workflow-jobs", (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId, limit } = req.query;
    const jobs = listWorkflowJobs(db, context.userId, courseId || null, Number(limit || 30));
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: `Failed to load workflow jobs: ${err.message}` });
  }
});

app.get("/api/langgraph/runtime-state", async (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId, moduleId, topicId, workflowType = "course_brief" } = req.query;

    const accessToken = getCanvasAccessToken(req);
    const runtimeState = await buildLangGraphRuntimeState({
      db,
      request: {
        courseId,
        moduleId: moduleId || null,
        topicId: topicId || null,
        workflowType,
        preferences: {},
      },
      accessToken,
      sessionId: context.sessionId,
      userId: context.userId,
      listActiveCanvasCourses,
      buildWorkspaceState,
      buildInboxState,
      ensureTopicText,
      computeInterventionScore,
    });

    res.json(runtimeState);
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to build LangGraph runtime state: ${err.message}` });
  }
});

app.post("/api/agent-workers/process", (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { limit = 5 } = req.body || {};
    const processed = processQueuedAgentJobs({
      db,
      computeInterventionScore,
      generateAutonomousReviewPlan,
      persistAutonomousReviewPlan,
      limit: Number(limit) || 5,
    });

    logActivity(req, "agent_workers_processed", {
      path: req.path,
      processedCount: processed.length,
    });

    res.json({
      success: true,
      processed,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to process agent workers: ${err.message}` });
  }
});

app.get("/api/platform/features", (req, res) => {
  res.json({
    total: FEATURE_CATALOG.length,
    live: FEATURE_CATALOG.filter((feature) => feature.status === "live").length,
    features: FEATURE_CATALOG,
  });
});

app.get("/api/messages", async (req, res) => {
  try {
    const accessToken = getCanvasAccessToken(req);
    const context = getSessionContext(req);
    const inbox = await buildInboxState(accessToken, context.session?.user || null);
    const limit = Number(req.query.limit || 10);
    res.json((inbox.messages || []).slice(0, limit));
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to load messages: ${err.message}` });
  }
});

app.post("/api/messages/:messageId/draft-reply", async (req, res) => {
  try {
    const accessToken = getCanvasAccessToken(req);
    const sessionContext = getSessionContext(req);
    const runtimeState = await buildLangGraphRuntimeState({
      db,
      request: {
        workflowType: "message_reply",
        preferences: {},
      },
      accessToken,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
      listActiveCanvasCourses,
      buildWorkspaceState,
      buildInboxState,
      ensureTopicText,
      computeInterventionScore,
    });
    const message = (runtimeState?.canvas?.inboxState?.messages || []).find(
      (item) => String(item.id) === String(req.params.messageId)
    );

    if (!message) {
      return res.status(404).json({ error: "Message not found in inbox" });
    }

    let payload;
    try {
      const response = await createOpenAIResponse({
        model: OPENAI_MODEL_AGENT,
        input: buildReplyDraftPrompt({
          message,
          runtimeState,
          preferences: runtimeState?.memory?.preferences || {},
        }),
      });
      payload = safeJsonParseObject(extractResponseText(response) || "");
    } catch {
      payload = buildFallbackMessageDraft(message, runtimeState);
    }

    res.json({
      messageId: message.id,
      subject: message.subject,
      summary: payload.summary || "",
      classification: payload.classification || null,
      whyThisReply: payload.whyThisReply || [],
      usedState: payload.usedState || [],
      draft: payload.draft || "",
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to draft reply: ${err.message}` });
  }
});

app.post("/api/messages/:messageId/send-reply", async (req, res) => {
  try {
    const accessToken = getCanvasAccessToken(req);
    const { body } = req.body || {};
    if (!body || !String(body).trim()) {
      return res.status(400).json({ error: "body is required" });
    }

    const response = await fetch(`${CANVAS_BASE_URL}/conversations/${req.params.messageId}/add_message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        body: String(body).trim(),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.error || "Failed to send reply");
    }

    logActivity(req, "message_reply_sent", {
      path: req.path,
      entityType: "message",
      entityId: req.params.messageId,
    });

    res.json({ success: true, messageId: req.params.messageId, result: data });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to send reply: ${err.message}` });
  }
});

app.post("/api/activity", (req, res) => {
  try {
    const payload = req.body || {};
    logActivity(req, payload.eventType || "ui_event", payload);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to log activity: ${err.message}` });
  }
});

app.get("/api/activity/summary", (req, res) => {
  try {
    const context = getSessionContext(req);
    const filters = [];
    const values = [];

    if (context.userId) {
      filters.push("user_id = ?");
      values.push(context.userId);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const totalEvents = db.prepare(`SELECT COUNT(*) as count FROM activity_events ${where}`).get(...values)?.count || 0;
    const sessions = db.prepare(`SELECT COUNT(*) as count FROM sessions ${where ? "WHERE user_id = ?" : ""}`).get(...(context.userId ? [context.userId] : []))?.count || 0;
    const recentEvents = db.prepare(`
      SELECT event_type, path, entity_type, entity_id, created_at
      FROM activity_events
      ${where}
      ORDER BY id DESC
      LIMIT 12
    `).all(...values);
    const recentRuns = db.prepare(`
      SELECT id, workflow_type, status, summary, created_at
      FROM workflow_runs
      ${where}
      ORDER BY created_at DESC
      LIMIT 8
    `).all(...values);

    res.json({ totalEvents, sessions, recentEvents, recentRuns });
  } catch (err) {
    res.status(500).json({ error: `Failed to load activity summary: ${err.message}` });
  }
});

app.get("/api/student-intelligence", (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const knowledgeGaps = db.prepare(`
      SELECT gap_title, severity, evidence, recommendation, created_at
      FROM learning_gaps
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 12
    `).all(context.userId);

    const reviewSessions = db.prepare(`
      SELECT title, scheduled_for, duration_minutes, goal, status, created_at
      FROM review_sessions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 12
    `).all(context.userId);

    const autonomousActions = db.prepare(`
      SELECT action_type, title, detail, status, created_at
      FROM autonomous_actions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 12
    `).all(context.userId);

    const intervention = computeInterventionScore({
      db,
      userId: context.userId,
    });

    res.json({
      knowledgeGaps,
      reviewSessions,
      autonomousActions,
      intervention,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to load student intelligence: ${err.message}` });
  }
});

app.get("/api/intervention-score", async (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId } = req.query;
    const accessToken = getCanvasAccessToken(req);
    const canvasState = courseId ? await buildWorkspaceState(courseId, accessToken) : null;
    const intervention = computeInterventionScore({
      db,
      userId: context.userId,
      courseId: courseId || null,
      canvasState,
    });

    res.json(intervention);
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to compute intervention score: ${err.message}` });
  }
});

app.get("/api/performance-insights", async (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ error: "courseId is required" });
    }

    const accessToken = getCanvasAccessToken(req);
    const canvasState = await buildWorkspaceState(courseId, accessToken);
    const intervention = computeInterventionScore({
      db,
      userId: context.userId,
      courseId,
      canvasState,
    });

    res.json({
      course: canvasState.course,
      performance: intervention.performance,
      supportNetwork: intervention.autonomousSupportNetwork,
      recommendations: intervention.recommendations,
      metrics: intervention.metrics,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to load performance insights: ${err.message}` });
  }
});

app.post("/api/autonomous-review/trigger", async (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId } = req.body || {};
    if (!courseId) {
      return res.status(400).json({ error: "courseId is required" });
    }

    const accessToken = getCanvasAccessToken(req);
    const canvasState = await buildWorkspaceState(courseId, accessToken, { force: true });
    const intervention = computeInterventionScore({
      db,
      userId: context.userId,
      courseId,
      canvasState,
    });
    const plan = generateAutonomousReviewPlan({
      db,
      userId: context.userId,
      courseId,
      canvasState,
      intervention,
    });

    persistAutonomousReviewPlan({
      db,
      userId: context.userId,
      courseId,
      reviewSessions: plan.reviewSessions,
      autonomousActions: plan.autonomousActions,
    });

    logActivity(req, "autonomous_review_triggered", {
      path: req.path,
      entityType: "course",
      entityId: courseId,
      interventionLevel: intervention.level,
      interventionScore: intervention.score,
    });

    res.json({
      success: true,
      intervention,
      ...plan,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to trigger autonomous review: ${err.message}` });
  }
});

app.post("/api/autonomous-support-system", async (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }

    const { courseId } = req.body || {};
    if (!courseId) {
      return res.status(400).json({ error: "courseId is required" });
    }

    const accessToken = getCanvasAccessToken(req);
    const canvasState = await buildWorkspaceState(courseId, accessToken, { force: true });
    const intervention = computeInterventionScore({
      db,
      userId: context.userId,
      courseId,
      canvasState,
    });
    const reviewPlan = generateAutonomousReviewPlan({
      db,
      userId: context.userId,
      courseId,
      canvasState,
      intervention,
    });

    const recommendedWorkflowTypes = [];
    if (intervention.performance?.lowScores?.length) {
      recommendedWorkflowTypes.push("grade_recovery", "support_handoff");
    }
    if (intervention.performance?.missingAssignments?.length) {
      recommendedWorkflowTypes.push("assignment_rescue");
    }
    if (!recommendedWorkflowTypes.length) {
      recommendedWorkflowTypes.push("course_brief", "exam_sprint");
    }

    res.json({
      intervention,
      autonomousSupportNetwork: intervention.autonomousSupportNetwork,
      reviewPlan,
      recommendedWorkflowTypes,
      nextBestAgent:
        intervention.autonomousSupportNetwork?.team?.find((agent) => agent.status === "active") ||
        intervention.autonomousSupportNetwork?.team?.[0] ||
        null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to build autonomous support system: ${err.message}` });
  }
});

app.post("/api/preferences", (req, res) => {
  try {
    const context = getSessionContext(req);
    if (!context.userId) {
      return res.status(401).json({ error: "No authenticated session" });
    }
    const preferences = req.body || {};
    db.prepare(`
      INSERT INTO preferences (user_id, preferences_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        preferences_json = excluded.preferences_json,
        updated_at = excluded.updated_at
    `).run(context.userId, JSON.stringify(preferences), new Date().toISOString());
    logActivity(req, "preferences_saved", { path: req.path, preferences });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save preferences: ${err.message}` });
  }
});

// 7. Extract text from a PDF file
app.get("/api/file-text", async (req, res) => {
  const { fileId, courseId } = req.query;
  if (!fileId || !courseId) {
    return res.status(400).json({ error: "fileId and courseId are required" });
  }

  // Return cached text if available
  if (textCache.has(fileId)) {
    return res.json({ fileId, text: textCache.get(fileId), cached: true });
  }

  try {
    const accessToken = getCanvasAccessToken(req);
    // Get file metadata (includes download URL)
    const file = await canvasRequest(`/courses/${courseId}/files/${fileId}`, accessToken);

    if (!file.url) {
      return res.status(404).json({ error: "File has no download URL" });
    }

    const isPdf =
      (file.content_type || "").includes("pdf") ||
      (file.filename || "").toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return res
        .status(400)
        .json({ error: "Only PDF files can be extracted" });
    }

    // Download the PDF
    const buffer = await downloadCanvasFile(file.url, accessToken);

    // Extract text
    let text = "";
    try {
      const pdfData = await pdf(buffer);
      text = pdfData.text || "";
    } catch (pdfErr) {
      return res.json({
        fileId,
        text: "",
        warning: "Could not extract text – the PDF may be scanned/image-based",
      });
    }

    if (!text.trim()) {
      return res.json({
        fileId,
        text: "",
        warning: "PDF appears to be empty or scanned (no extractable text)",
      });
    }

    // Cache the extracted text
    textCache.set(fileId, text);

    res.json({
      fileId,
      text,
      pages: text.split(/\f/).length, // form-feed page breaks
      chars: text.length,
    });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to extract text: ${err.message}` });
  }
});

// 8. Summarize a single file
app.post("/api/summarize-file", async (req, res) => {
  const { fileId, courseId, fileName } = req.body;
  if (!fileId || !courseId) {
    return res.status(400).json({ error: "fileId and courseId are required" });
  }

  try {
    const accessToken = getCanvasAccessToken(req);
    // Get the text (from cache or extract)
    let text = textCache.get(String(fileId));
    if (!text) {
      const file = await canvasRequest(`/courses/${courseId}/files/${fileId}`, accessToken);
      if (!file.url) return res.status(404).json({ error: "No download URL" });

      const buffer = await downloadCanvasFile(file.url, accessToken);
      const pdfData = await pdf(buffer);
      text = pdfData.text || "";
      if (text) textCache.set(String(fileId), text);
    }

    if (!text || !text.trim()) {
      return res.json({
        fileId,
        summary: "No extractable text found in this PDF.",
      });
    }

    // Truncate very long texts to ~30k chars to stay within context limits
    const truncated = text.length > 30000 ? text.slice(0, 30000) + "\n\n[... truncated]" : text;

    const response = await createOpenAIResponse({
      model: OPENAI_MODEL_SUMMARY,
      input: `You are a study assistant. Summarize the following course material from "${fileName || "a PDF"}".

Provide:
1. **Summary** (2-4 sentences)
2. **Key Points** (bullet list, max 8)
3. **Important Definitions** (if any)
4. **Likely Exam Topics** (bullet list, max 5)
5. **Quick Study Notes** (2-3 short takeaways)

Be concise and student-friendly. Use markdown formatting.

---
${truncated}`,
    });

    const summary = extractResponseText(response) || "No summary generated.";

    res.json({ fileId, fileName, summary });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Summarization failed: ${err.message}` });
  }
});

// 9. Summarize all PDFs in a module
app.post("/api/summarize-module", async (req, res) => {
  const { courseId, moduleId, moduleName } = req.body;
  if (!courseId || !moduleId) {
    return res
      .status(400)
      .json({ error: "courseId and moduleId are required" });
  }

  try {
    const accessToken = getCanvasAccessToken(req);
    // Fetch module items
    const items = await canvasRequestAll(
      `/courses/${courseId}/modules/${moduleId}/items?per_page=100`,
      10,
      accessToken
    );

    const fileItems = items.filter((item) => item.type === "File" && item.content_id);

    // Collect text from all PDFs in this module
    const texts = [];
    for (const item of fileItems) {
      try {
        const cached = textCache.get(String(item.content_id));
        if (cached) {
          texts.push({ name: item.title, text: cached });
          continue;
        }

        const file = await canvasRequest(
          `/courses/${courseId}/files/${item.content_id}`,
          accessToken
        );
        const isPdf =
          (file.content_type || "").includes("pdf") ||
          (file.filename || "").toLowerCase().endsWith(".pdf");

        if (!isPdf || !file.url) continue;

        const buffer = await downloadCanvasFile(file.url, accessToken);
        const pdfData = await pdf(buffer);
        const text = pdfData.text || "";
        if (text) {
          textCache.set(String(item.content_id), text);
          texts.push({ name: item.title, text });
        }
      } catch {
        // Skip files that can't be processed
      }
    }

    if (texts.length === 0) {
      return res.json({
        moduleId,
        moduleName,
        summary: "No extractable PDF content found in this module.",
        fileCount: 0,
      });
    }

    // Combine texts with file headers, truncate to ~40k chars total
    let combined = texts
      .map((t) => `--- ${t.name} ---\n${t.text}`)
      .join("\n\n");
    if (combined.length > 40000) {
      combined = combined.slice(0, 40000) + "\n\n[... truncated]";
    }

    const response = await createOpenAIResponse({
      model: OPENAI_MODEL_SUMMARY,
      input: `You are a study assistant. Summarize the following course module "${moduleName || "Module"}".
It contains ${texts.length} PDF file(s).

Provide:
1. **Module Overview** (3-5 sentences covering all files)
2. **Key Concepts** (bullet list, max 10)
3. **Important Definitions** (if any)
4. **Likely Exam Topics** (bullet list, max 7)
5. **Study Notes** (key takeaways for exam prep)
6. **Per-File Summaries** (one short paragraph per file)

Be concise and student-friendly. Use markdown formatting.

---
${combined}`,
    });

    const summary = extractResponseText(response) || "No summary generated.";

    res.json({
      moduleId,
      moduleName,
      summary,
      fileCount: texts.length,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Module summarization failed: ${err.message}` });
  }
});

app.post("/api/agentic-workflow", async (req, res) => {
  const { courseId, moduleId, topicId, workflowType = "course_brief", preferences = {} } = req.body || {};
  if (!courseId) {
    return res.status(400).json({ error: "courseId is required" });
  }

  try {
    logActivity(req, "workflow_requested", {
      path: req.path,
      entityType: "course",
      entityId: courseId,
      workflowType,
      moduleId,
      topicId,
    });
    const accessToken = getCanvasAccessToken(req);
    const runId = crypto.randomBytes(12).toString("hex");
    const sessionContext = getSessionContext(req);
    const graphState = await workflowGraph.invoke({
      request: {
        courseId,
        moduleId: moduleId || null,
        topicId: topicId || null,
        workflowType,
        preferences,
      },
      accessToken,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
    });

    const runtimeState = graphState.runtimeState;
    const state = runtimeState.canvas.courseState;
    const selectedModule = runtimeState.canvas.selectedModule;
    const selectedTopic = runtimeState.canvas.selectedTopic;
    const parsed = graphState.workflowResult;
    const workflow = {
      runId,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
      status: "completed",
      createdAt: new Date().toISOString(),
      courseId,
      moduleId: moduleId || null,
      topicId: topicId || null,
      workflowType,
      canvasState: {
        syncedAt: state.syncedAt,
        course: state.course,
        stats: state.stats,
        upcomingAssignments: state.assignments
          .filter((assignment) => assignment.due_at && !assignment.is_completed)
          .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
          .slice(0, 5),
      },
      runtimeState: {
        meta: runtimeState.meta,
        request: runtimeState.request,
        memory: runtimeState.memory,
        telemetry: runtimeState.telemetry,
        intelligence: runtimeState.intelligence,
        agentRegistry: runtimeState.agentRegistry,
        canvas: {
          selectedModule,
          selectedTopic,
          signals: runtimeState.canvas.signals,
          inboxState: runtimeState.canvas.inboxState,
          courseState: {
            syncedAt: state.syncedAt,
            course: state.course,
            stats: state.stats,
          },
        },
      },
      planner: graphState.plannerOutput,
      workflow: parsed,
    };

    workflowRunStore.set(runId, workflow);
    saveWorkflowRunRecord(workflow);
    saveDerivedIntelligence(workflow);
    logActivity(req, "workflow_completed", {
      path: req.path,
      entityType: "workflow_run",
      entityId: runId,
      workflowType,
      courseId,
      moduleId,
      topicId,
    });
    res.json(workflow);
  } catch (err) {
    res.status(500).json({ error: `Agentic workflow failed: ${err.message}` });
  }
});

app.get("/api/agentic-workflow/:runId", (req, res) => {
  const run = workflowRunStore.get(req.params.runId);
  if (!run) {
    return res.status(404).json({ error: "Workflow run not found" });
  }
  res.json(run);
});

// ── Agent Tools ───────────────────────────────────────────

const AGENT_TOOLS = [
  {
    name: "list_modules",
    description: "List all modules in the course. Always call this first to understand course structure before doing anything else.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_module_files",
    description: "Get the files and PDFs inside a specific module. Use this after list_modules to find what files are available.",
    input_schema: {
      type: "object",
      properties: {
        module_id: { type: "string", description: "The numeric module ID from list_modules" },
        module_name: { type: "string", description: "Module name for context" }
      },
      required: ["module_id"]
    }
  },
  {
    name: "extract_pdf",
    description: "Download and extract the full text content from a PDF file. Use this to actually READ course material. Returns up to 25000 characters of text.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "The numeric file ID" },
        file_name: { type: "string", description: "File name for context" }
      },
      required: ["file_id"]
    }
  },
  {
    name: "list_assignments",
    description: "Get all assignments for the course with their due dates and point values.",
    input_schema: { type: "object", properties: {}, required: [] }
  }
];

const OPENAI_AGENT_TOOLS = AGENT_TOOLS.map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.input_schema,
}));

const AGENT_SYSTEM_PROMPT = `You are an autonomous study agent for a Canvas LMS course.
You have tools to explore course structure, read module files, extract PDF content, and check assignments.

Your workflow:
1. ALWAYS start by calling list_modules to understand course structure
2. Call get_module_files on relevant modules to find PDFs
3. Call extract_pdf on important files to read the actual content
4. Call list_assignments to understand deadlines when making study plans
5. Synthesize everything into a comprehensive, actionable response

Be thorough — read multiple PDFs if the task requires understanding course content.
Prioritize files that look most important based on their names and module context.`;

async function executeTool(name, input, courseId) {
  if (name === "list_modules") {
    const accessToken = courseId.__token;
    const modules = await canvasRequestAll(
      `/courses/${courseId.id || courseId}/modules?per_page=50&include[]=items_count`,
      10,
      accessToken
    );
    return modules.map((m) => ({
      id: String(m.id),
      name: m.name,
      items_count: m.items_count,
      state: m.state,
    }));
  }

  if (name === "get_module_files") {
    const accessToken = courseId.__token;
    const items = await canvasRequestAll(
      `/courses/${courseId.id || courseId}/modules/${input.module_id}/items?per_page=100`,
      10,
      accessToken
    );
    const fileItems = items.filter((item) => item.type === "File");
    const enriched = await Promise.all(
      fileItems.map(async (item) => {
        if (!item.content_id) return null;
        try {
          const file = await canvasRequest(
            `/courses/${courseId.id || courseId}/files/${item.content_id}`,
            accessToken
          );
          return {
            id: String(file.id),
            name: file.display_name || file.filename,
            is_pdf:
              (file.content_type || "").includes("pdf") ||
              (file.filename || "").toLowerCase().endsWith(".pdf"),
            size: file.size,
          };
        } catch {
          return {
            id: String(item.content_id),
            name: item.title,
            is_pdf: (item.title || "").toLowerCase().endsWith(".pdf"),
            size: null,
          };
        }
      })
    );
    return enriched.filter(Boolean);
  }

  if (name === "extract_pdf") {
    const accessToken = courseId.__token;
    const fileIdStr = String(input.file_id);

    // Check cache first
    if (textCache.has(fileIdStr)) {
      const text = textCache.get(fileIdStr);
      return {
        file_name: input.file_name || fileIdStr,
        chars: text.length,
        text: text.slice(0, 25000) + (text.length > 25000 ? "\n...[truncated]" : ""),
      };
    }

    // Fetch metadata and download
    const file = await canvasRequest(`/courses/${courseId.id || courseId}/files/${fileIdStr}`, accessToken);
    if (!file.url) throw new Error("File has no download URL");

    const buffer = await downloadCanvasFile(file.url, accessToken);
    const pdfData = await pdf(buffer);
    const text = pdfData.text || "";

    if (text) textCache.set(fileIdStr, text);

    return {
      file_name: file.display_name || input.file_name || fileIdStr,
      chars: text.length,
      text: text.slice(0, 25000) + (text.length > 25000 ? "\n...[truncated]" : ""),
    };
  }

  if (name === "list_assignments") {
    const accessToken = courseId.__token;
    const assignments = await canvasRequestAll(
      `/courses/${courseId.id || courseId}/assignments?per_page=50&order_by=due_at`,
      10,
      accessToken
    );
    return assignments.map((a) => ({
      name: a.name,
      due_at: a.due_at,
      points_possible: a.points_possible,
    }));
  }

  throw new Error(`Unknown tool: ${name}`);
}

function makeToolPreview(name, input, result) {
  if (name === "list_modules") {
    const names = result.slice(0, 3).map((m) => m.name).join(", ");
    const more = result.length > 3 ? `, +${result.length - 3} more` : "";
    return `Found ${result.length} modules: ${names}${more}`;
  }
  if (name === "get_module_files") {
    const names = result.slice(0, 3).map((f) => f.name).join(", ");
    const more = result.length > 3 ? `, +${result.length - 3} more` : "";
    return `Found ${result.length} files in ${input.module_name || "module"}: ${names}${more}`;
  }
  if (name === "extract_pdf") {
    const kb = Math.round(result.chars / 1000);
    return `Extracted ${kb}k chars from ${result.file_name}`;
  }
  if (name === "list_assignments") {
    const next = result.find((a) => a.due_at && new Date(a.due_at) > new Date());
    if (next) {
      const date = new Date(next.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `Found ${result.length} assignments, next due: ${next.name} on ${date}`;
    }
    return `Found ${result.length} assignments`;
  }
  return "Done";
}

// ── Agent SSE Endpoint ────────────────────────────────────

app.post("/api/agent", async (req, res) => {
  const { task, courseId } = req.body;

  if (!task || !courseId) {
    return res.status(400).json({ error: "task and courseId are required" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    logActivity(req, "agent_run_started", {
      path: req.path,
      entityType: "course",
      entityId: courseId,
      taskPreview: String(task).slice(0, 160),
    });
    const accessToken = getCanvasAccessToken(req);
    const MAX_ITERATIONS = 12;
    let previousResponseId = null;
    let input = task;

    for (let step = 0; step < MAX_ITERATIONS; step++) {
      sendEvent({ type: "thinking", step });

      const response = await createOpenAIResponse({
        model: OPENAI_MODEL_AGENT,
        instructions: AGENT_SYSTEM_PROMPT,
        tools: OPENAI_AGENT_TOOLS,
        input,
        previous_response_id: previousResponseId || undefined,
      });

      const toolUseBlocks = (response.output || []).filter((item) => item.type === "function_call");
      const answerText = extractResponseText(response);

      if (toolUseBlocks.length === 0) {
        if (answerText) {
          sendEvent({ type: "answer", text: answerText });
        }
        break;
      }

      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        let parsedInput = {};
        try {
          parsedInput = JSON.parse(toolBlock.arguments || "{}");
        } catch {
          parsedInput = {};
        }

        sendEvent({
          type: "tool_call",
          tool: toolBlock.name,
          input: parsedInput,
        });

        let resultContent;
        let success = true;
        let preview = "";

        try {
          const result = await executeTool(toolBlock.name, parsedInput, {
            id: courseId,
            __token: accessToken,
          });
          resultContent = JSON.stringify(result);
          preview = makeToolPreview(toolBlock.name, parsedInput, result);
        } catch (err) {
          success = false;
          resultContent = JSON.stringify({ error: err.message });
          preview = `Error: ${err.message}`;
        }

        sendEvent({
          type: "tool_result",
          tool: toolBlock.name,
          success,
          preview,
        });

        toolResults.push({
          type: "function_call_output",
          call_id: toolBlock.call_id,
          output: resultContent,
        });
      }

      previousResponseId = response.id;
      input = toolResults;
    }

    sendEvent({ type: "done" });
    logActivity(req, "agent_run_completed", {
      path: req.path,
      entityType: "course",
      entityId: courseId,
    });
  } catch (err) {
    sendEvent({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

// ── Generate Video Lesson ─────────────────────────────────

app.post("/api/generate-lesson", async (req, res) => {
  const { text, title } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const truncated = text.length > 22000 ? text.slice(0, 22000) + "\n...[truncated]" : text;

    const response = await createOpenAIResponse({
      model: OPENAI_MODEL_LESSON,
      input: `You are an expert educator creating a narrated video lesson from course material.

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:

{
  "title": "concise lesson title",
  "subject": "subject area in 3-5 words",
  "estimated_minutes": 7,
  "slides": [
    {
      "id": 1,
      "type": "title",
      "heading": "Lesson Title",
      "subheading": "What students will learn",
      "narration": "Natural 2-3 sentence spoken welcome. Should sound like a teacher, not a robot.",
      "duration_seconds": 7
    },
    {
      "id": 2,
      "type": "concept",
      "heading": "Concept Name",
      "bullets": ["Key point one", "Key point two", "Key point three"],
      "narration": "Natural 3-5 sentence spoken explanation. Flow like a professor speaking to students, don't just read the bullets.",
      "duration_seconds": 20
    },
    {
      "id": 3,
      "type": "definition",
      "term": "Technical Term",
      "definition": "Clear one-sentence definition.",
      "example": "Concrete real-world example (optional)",
      "narration": "Natural 2-3 sentence spoken explanation including why this term matters.",
      "duration_seconds": 14
    },
    {
      "id": 4,
      "type": "example",
      "heading": "Example or Application",
      "bullets": ["Step or detail one", "Step or detail two", "Step or detail three"],
      "narration": "Walk through the example naturally, 3-4 sentences.",
      "duration_seconds": 18
    },
    {
      "id": 999,
      "type": "summary",
      "heading": "Key Takeaways",
      "bullets": ["Most important insight 1", "Most important insight 2", "Most important insight 3", "Most important insight 4"],
      "narration": "Natural 2-3 sentence wrap-up. Tell students what to remember.",
      "duration_seconds": 16
    }
  ]
}

Rules:
- Generate exactly 8-14 slides
- First slide: type "title". Last slide: type "summary"
- Mix concept, definition, example slides based on actual content
- Narration sounds NATURAL when spoken aloud — conversational, not bullet-reading
- Bullets: max 4 per slide, short phrases only (5-8 words each)
- duration_seconds ≈ narration word count ÷ 2.3
- Focus on the most important ideas from the material

Material title: "${title || "Course Material"}"

Content:
${truncated}`
    });

    const raw = extractResponseText(response) || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse lesson JSON from response");

    const lesson = JSON.parse(jsonMatch[0]);
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: `Lesson generation failed: ${err.message}` });
  }
});

app.post("/api/generate-lesson-audio", async (req, res) => {
  const { lessonTitle, slideId, narration } = req.body || {};
  if (!narration) {
    return res.status(400).json({ error: "narration is required" });
  }

  try {
    const audio = await generateLessonSlideAudio({
      lessonTitle: lessonTitle || "lesson",
      slideId: slideId || "slide",
      text: narration,
      backendUrl: BACKEND_URL,
    });

    res.json({
      success: true,
      audioUrl: audio.url,
      fileName: path.basename(audio.filePath),
    });
  } catch (err) {
    res.status(500).json({ error: `Lesson audio generation failed: ${err.message}` });
  }
});

// ── Start ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Backend running → http://localhost:${PORT}`);
  console.log("Canvas auth mode: session token from successful login");
  console.log(
    `OpenAI key: ${process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_openai_api_key_here" ? "loaded" : "MISSING – set OPENAI_API_KEY in .env for AI features"}`
  );
});
