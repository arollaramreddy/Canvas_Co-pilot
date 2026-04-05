const express = require("express");
const cors = require("cors");
const pdf = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk").default;
require("dotenv").config();

const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const CANVAS_TOKEN = process.env.CANVAS_TOKEN;
const CANVAS_BASE_URL = normalizeCanvasBaseUrl(
  process.env.CANVAS_BASE_URL || "https://canvas.asu.edu/api/v1"
);

function normalizeCanvasBaseUrl(baseUrl) {
  const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "https://canvas.asu.edu/api/v1";
  }

  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

// Anthropic client (lazy – only created when needed)
let anthropic = null;
function getAnthropic() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_anthropic_api_key_here") {
      throw new Error("ANTHROPIC_API_KEY is not set in .env file");
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

// ── Canvas API helpers ────────────────────────────────────

// Single-page Canvas request
async function canvasRequest(path) {
  const url = `${CANVAS_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
  });

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Canvas API error (${res.status})`);
    error.status = res.status;
    error.detail = text;
    throw error;
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    const error = new Error(
      "Canvas returned HTML instead of JSON. Check CANVAS_BASE_URL and make sure it points to your Canvas site or API root."
    );
    error.status = 502;
    error.detail = text.slice(0, 300);
    throw error;
  }

  return res.json();
}

// Paginated Canvas request – follows Link: <...>; rel="next"
async function canvasRequestAll(path, maxPages = 10) {
  let url = `${CANVAS_BASE_URL}${path}`;
  let all = [];

  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });

    if (!res.ok) {
      const text = await res.text();
      const error = new Error(`Canvas API error (${res.status})`);
      error.status = res.status;
      error.detail = text;
      throw error;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      const error = new Error(
        "Canvas returned HTML instead of JSON. Check CANVAS_BASE_URL and make sure it points to your Canvas site or API root."
      );
      error.status = 502;
      error.detail = text.slice(0, 300);
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
async function downloadCanvasFile(fileUrl) {
  const res = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
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

function stripHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateLabel(dateInput) {
  if (!dateInput) return "TBD";
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePlanPreferences(input = {}) {
  const focusDays = Array.isArray(input.focusDays)
    ? input.focusDays.filter(Boolean)
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const startDate = input.startDate || new Date().toISOString().slice(0, 10);
  const endDate = input.endDate || startDate;

  return {
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    hoursPerWeek: Math.max(1, Math.min(40, safeNumber(input.hoursPerWeek, 8))),
    sessionMinutes: Math.max(20, Math.min(240, safeNumber(input.sessionMinutes, 60))),
    focusDays: focusDays.length > 0 ? focusDays : ["Mon", "Tue", "Wed", "Thu", "Fri"],
    priorities: Array.isArray(input.priorities) ? input.priorities.filter(Boolean) : [],
    selectedModuleIds: Array.isArray(input.selectedModuleIds)
      ? input.selectedModuleIds.map((value) => String(value))
      : [],
    includeAssignments: input.includeAssignments !== false,
    objective: (input.objective || "General study plan").trim(),
    pace: input.pace || "balanced",
  };
}

function enumerateWeeklyRanges(startDate, endDate) {
  const ranges = [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [{ label: "Week 1", startDate, endDate }];
  }

  let cursor = new Date(start);
  let index = 1;
  while (cursor <= end && index <= 16) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd > end) {
      weekEnd.setTime(end.getTime());
    }

    ranges.push({
      label: `Week ${index} • ${formatDateLabel(weekStart)} - ${formatDateLabel(weekEnd)}`,
      startDate: weekStart.toISOString().slice(0, 10),
      endDate: weekEnd.toISOString().slice(0, 10),
    });

    cursor.setDate(cursor.getDate() + 7);
    index += 1;
  }

  return ranges.length > 0 ? ranges : [{ label: "Week 1", startDate, endDate }];
}

function buildFallbackStudyPlan({
  courseName,
  syllabusText,
  assignments,
  preferences,
  scopedModules = [],
}) {
  const cleanSyllabus = stripHtml(syllabusText || "");
  const sentences = cleanSyllabus.split(/(?<=[.!?])\s+/).filter(Boolean);
  const overview = sentences.slice(0, 3).join(" ") || `Study plan for ${courseName}.`;
  const sortedAssignments = [...assignments]
    .filter((assignment) => assignment.due_at)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 6);
  const weeklyRanges = enumerateWeeklyRanges(preferences.startDate, preferences.endDate);
  const moduleNames = scopedModules.map((module) => module.name).filter(Boolean);

  const weeklyHours = preferences.hoursPerWeek;
  const sessionCount = Math.max(
    1,
    Math.round((weeklyHours * 60) / preferences.sessionMinutes)
  );
  const sessionsPerDay = Math.max(
    1,
    Math.ceil(sessionCount / preferences.focusDays.length)
  );

  const priorityText =
    preferences.priorities.length > 0
      ? `Prioritize ${preferences.priorities.join(", ")}.`
      : "Balance understanding, revision, and assignment progress.";

  return {
    overview: `${overview} This plan covers ${formatDateLabel(preferences.startDate)} to ${formatDateLabel(preferences.endDate)} for ${preferences.objective.toLowerCase()}.`,
    recommendations: [
      `Study about ${weeklyHours} hours per week in ${preferences.sessionMinutes}-minute sessions.`,
      `Use ${preferences.focusDays.join(", ")} as your main study days with roughly ${sessionsPerDay} focused block(s) each day across the full date range.`,
      priorityText,
      moduleNames.length > 0
        ? `Focus only on these modules: ${moduleNames.join(", ")}.`
        : "Use all available modules and related materials in scope.",
    ],
    weeklyPlan: weeklyRanges.map((range, index) => ({
      day: range.label,
      focus: index === 0
        ? `Set up your ${preferences.objective.toLowerCase()} strategy and preview key topics`
        : index === weeklyRanges.length - 1
          ? "Consolidate, self-test, and close remaining weak spots"
          : "Work through the scoped material and reinforce understanding",
      tasks: [
        moduleNames[index]
          ? `Focus on module: ${moduleNames[index]}.`
          : "Review notes, readings, and course pages in your chosen scope.",
        "Create or refine flashcards from the highest-yield concepts.",
        sortedAssignments[index]
          ? `Make progress on "${sortedAssignments[index].name}" before ${formatDateLabel(sortedAssignments[index].due_at)}.`
          : `Complete one focused study block on the hardest topic during ${range.label}.`,
      ],
    })),
    milestones: sortedAssignments.map((assignment) => ({
      title: assignment.name,
      dueDate: assignment.due_at,
      reason: `Assignment worth ${assignment.points_possible ?? "?"} points is due ${formatDateLabel(assignment.due_at)}.`,
    })),
    customTips: [
      "Turn each module into 3 to 5 recall questions.",
      "Reserve one session each week only for practice and self-testing.",
      "Update this plan after new announcements or due dates appear in Canvas.",
    ],
  };
}

async function resolveCourseSyllabus(courseId) {
  const course = await canvasRequest(
    `/courses/${courseId}?include[]=syllabus_body&include[]=term`
  );

  const directHtml = course.syllabus_body || "";
  const directText = stripHtml(directHtml);
  if (directText) {
    return {
      course,
      syllabusHtml: directHtml,
      syllabusText: directText,
      source: "course.syllabus_body",
    };
  }

  try {
    const frontPage = await canvasRequest(`/courses/${courseId}/front_page`);
    const frontPageHtml = frontPage.body || "";
    const frontPageText = stripHtml(frontPageHtml);
    const frontPageTitle = (frontPage.title || "").toLowerCase();
    if (
      frontPageText &&
      (frontPageTitle.includes("syllabus") || frontPageTitle.includes("course information"))
    ) {
      return {
        course,
        syllabusHtml: frontPageHtml,
        syllabusText: frontPageText,
        source: "front_page",
      };
    }
  } catch {
    // Front page is optional.
  }

  try {
    const pages = await canvasRequestAll(`/courses/${courseId}/pages?per_page=100`);
    const syllabusCandidate = pages.find((page) => {
      const title = (page.title || "").toLowerCase();
      const url = (page.url || "").toLowerCase();
      return (
        title.includes("syllabus") ||
        url.includes("syllabus") ||
        title.includes("course information")
      );
    });

    if (syllabusCandidate?.url) {
      const pageDetail = await canvasRequest(
        `/courses/${courseId}/pages/${encodeURIComponent(syllabusCandidate.url)}`
      );
      const pageHtml = pageDetail.body || "";
      const pageText = stripHtml(pageHtml);
      if (pageText) {
        return {
          course,
          syllabusHtml: pageHtml,
          syllabusText: pageText,
          source: "course_page",
        };
      }
    }
  } catch {
    // Pages lookup is best-effort.
  }

  return {
    course,
    syllabusHtml: "",
    syllabusText: "",
    source: "none",
  };
}

async function generateStudyPlanWithAI({
  courseName,
  syllabusText,
  assignments,
  preferences,
  scopedModules = [],
}) {
  let ai = null;
  try {
    ai = getAnthropic();
  } catch {
    return buildFallbackStudyPlan({
      courseName,
      syllabusText,
      assignments,
      preferences,
      scopedModules,
    });
  }

  const assignmentSummary = assignments
    .slice(0, 12)
    .map((assignment) => ({
      name: assignment.name,
      due_at: assignment.due_at,
      points_possible: assignment.points_possible,
    }));
  const moduleSummary = scopedModules.map((module) => ({
    id: module.id,
    name: module.name,
    position: module.position,
  }));

  const prompt = `Create a student-friendly study plan in valid JSON.

Return an object with keys:
- overview: string
- recommendations: string[]
- weeklyPlan: { day: string, focus: string, tasks: string[] }[]
- milestones: { title: string, dueDate: string | null, reason: string }[]
- customTips: string[]

Course: ${courseName}
Preferences: ${JSON.stringify(preferences)}
Assignments: ${JSON.stringify(assignmentSummary)}
Scoped modules: ${JSON.stringify(moduleSummary)}
Syllabus: ${stripHtml(syllabusText).slice(0, 12000)}

Rules:
- Keep recommendations concise.
- Build the weekly plan across the full startDate to endDate range, not just one week.
- Match the plan to the provided objective and selected modules.
- Make milestones practical and tied to due dates when available.
- If selected modules are provided, concentrate only on that portion of the course.
- Return JSON only.`;

  const message = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1800,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = message.content[0]?.text || "";
  try {
    return JSON.parse(rawText);
  } catch {
    return buildFallbackStudyPlan({
      courseName,
      syllabusText,
      assignments,
      preferences,
      scopedModules,
    });
  }
}

// ── Existing Endpoints ────────────────────────────────────

// 1. Test login – verify token by fetching current user
app.get("/api/test-login", async (req, res) => {
  if (!CANVAS_TOKEN) {
    return res
      .status(500)
      .json({ error: "CANVAS_TOKEN is not set in .env file" });
  }

  try {
    const user = await canvasRequest("/users/self");
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
    const courses = await canvasRequestAll(
      "/courses?per_page=50&enrollment_state=active"
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
    const assignments = await canvasRequestAll(
      `/courses/${req.params.courseId}/assignments?per_page=50&order_by=due_at`
    );
    res.json(
      assignments.map((a) => ({
        id: a.id,
        name: a.name,
        due_at: a.due_at,
        points_possible: a.points_possible,
        html_url: a.html_url,
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
    const files = await canvasRequest(
      `/courses/${req.params.courseId}/files?per_page=20`
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

app.get("/api/courses/:courseId/syllabus", async (req, res) => {
  try {
    const syllabusData = await resolveCourseSyllabus(req.params.courseId);
    const { course, syllabusHtml, syllabusText, source } = syllabusData;
    res.json({
      courseId: course.id,
      courseName: course.name,
      courseCode: course.course_code,
      termName: course.term?.name || null,
      syllabusHtml,
      syllabusText,
      source,
      hasSyllabus: Boolean(syllabusText),
    });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Failed to fetch syllabus: ${err.message}` });
  }
});

// ── New Endpoints: Modules & AI ───────────────────────────

// 5. List modules for a course (with item count)
app.get("/api/modules", async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: "courseId is required" });

  try {
    const modules = await canvasRequestAll(
      `/courses/${courseId}/modules?per_page=50&include[]=items_count`
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
    const items = await canvasRequestAll(
      `/courses/${courseId}/modules/${moduleId}/items?per_page=100`
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
              `/courses/${courseId}/files/${item.content_id}`
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
    // Get file metadata (includes download URL)
    const file = await canvasRequest(`/courses/${courseId}/files/${fileId}`);

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
    const buffer = await downloadCanvasFile(file.url);

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
    // Get the text (from cache or extract)
    let text = textCache.get(String(fileId));
    if (!text) {
      const file = await canvasRequest(`/courses/${courseId}/files/${fileId}`);
      if (!file.url) return res.status(404).json({ error: "No download URL" });

      const buffer = await downloadCanvasFile(file.url);
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

    const ai = getAnthropic();
    const message = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `You are a study assistant. Summarize the following course material from "${fileName || "a PDF"}".

Provide:
1. **Summary** (2-4 sentences)
2. **Key Points** (bullet list, max 8)
3. **Important Definitions** (if any)
4. **Likely Exam Topics** (bullet list, max 5)
5. **Quick Study Notes** (2-3 short takeaways)

Be concise and student-friendly. Use markdown formatting.

---
${truncated}`,
        },
      ],
    });

    const summary = message.content[0]?.text || "No summary generated.";

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
    // Fetch module items
    const items = await canvasRequestAll(
      `/courses/${courseId}/modules/${moduleId}/items?per_page=100`
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
          `/courses/${courseId}/files/${item.content_id}`
        );
        const isPdf =
          (file.content_type || "").includes("pdf") ||
          (file.filename || "").toLowerCase().endsWith(".pdf");

        if (!isPdf || !file.url) continue;

        const buffer = await downloadCanvasFile(file.url);
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

    const ai = getAnthropic();
    const message = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are a study assistant. Summarize the following course module "${moduleName || "Module"}".
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
        },
      ],
    });

    const summary = message.content[0]?.text || "No summary generated.";

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
    const modules = await canvasRequestAll(
      `/courses/${courseId}/modules?per_page=50&include[]=items_count`
    );
    return modules.map((m) => ({
      id: String(m.id),
      name: m.name,
      items_count: m.items_count,
      state: m.state,
    }));
  }

  if (name === "get_module_files") {
    const items = await canvasRequestAll(
      `/courses/${courseId}/modules/${input.module_id}/items?per_page=100`
    );
    const fileItems = items.filter((item) => item.type === "File");
    const enriched = await Promise.all(
      fileItems.map(async (item) => {
        if (!item.content_id) return null;
        try {
          const file = await canvasRequest(
            `/courses/${courseId}/files/${item.content_id}`
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
    const file = await canvasRequest(`/courses/${courseId}/files/${fileIdStr}`);
    if (!file.url) throw new Error("File has no download URL");

    const buffer = await downloadCanvasFile(file.url);
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
    const assignments = await canvasRequestAll(
      `/courses/${courseId}/assignments?per_page=50&order_by=due_at`
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
    const ai = getAnthropic();
    const messages = [{ role: "user", content: task }];
    const MAX_ITERATIONS = 12;

    for (let step = 0; step < MAX_ITERATIONS; step++) {
      sendEvent({ type: "thinking", step });

      const response = await ai.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: AGENT_SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      });

      // Collect tool use blocks and text blocks
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      const textBlocks = response.content.filter((b) => b.type === "text");

      // If no tool calls: extract final answer text
      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        const answerText = textBlocks.map((b) => b.text).join("\n\n").trim();
        if (answerText) {
          sendEvent({ type: "answer", text: answerText });
        }
        break;
      }

      // Add assistant message with all content blocks
      messages.push({ role: "assistant", content: response.content });

      // Execute all tool calls and collect results
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        sendEvent({
          type: "tool_call",
          tool: toolBlock.name,
          input: toolBlock.input,
        });

        let resultContent;
        let success = true;
        let preview = "";

        try {
          const result = await executeTool(toolBlock.name, toolBlock.input, courseId);
          resultContent = JSON.stringify(result);
          preview = makeToolPreview(toolBlock.name, toolBlock.input, result);
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
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: resultContent,
        });
      }

      // Add user message with all tool results
      messages.push({ role: "user", content: toolResults });

      // If stop_reason was tool_use, continue loop; otherwise break
      if (response.stop_reason !== "tool_use") break;
    }

    sendEvent({ type: "done" });
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
    const ai = getAnthropic();
    const truncated = text.length > 22000 ? text.slice(0, 22000) + "\n...[truncated]" : text;

    const message = await ai.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: `You are an expert educator creating a narrated video lesson from course material.

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
      }]
    });

    const raw = message.content[0]?.text || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse lesson JSON from response");

    const lesson = JSON.parse(jsonMatch[0]);
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ error: `Lesson generation failed: ${err.message}` });
  }
});

app.post("/api/study-plan", async (req, res) => {
  const { courseId, preferences = {} } = req.body;
  if (!courseId) {
    return res.status(400).json({ error: "courseId is required" });
  }

  try {
    const normalizedPreferences = normalizePlanPreferences(preferences);
    const [syllabusData, assignments, modules] = await Promise.all([
      resolveCourseSyllabus(courseId),
      canvasRequestAll(`/courses/${courseId}/assignments?per_page=50&order_by=due_at`),
      canvasRequestAll(`/courses/${courseId}/modules?per_page=100`),
    ]);

    const { course, syllabusText, source } = syllabusData;
    const scopedModules =
      normalizedPreferences.selectedModuleIds.length > 0
        ? modules.filter((module) =>
            normalizedPreferences.selectedModuleIds.includes(String(module.id))
          )
        : modules;
    const plan = await generateStudyPlanWithAI({
      courseName: course.name,
      syllabusText,
      assignments,
      preferences: normalizedPreferences,
      scopedModules,
    });

    res.json({
      courseId: course.id,
      courseName: course.name,
      syllabusText,
      syllabusSource: source,
      hasSyllabus: Boolean(syllabusText),
      preferences: normalizedPreferences,
      scopedModules: scopedModules.map((module) => ({
        id: module.id,
        name: module.name,
        position: module.position,
      })),
      plan,
    });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: `Study plan generation failed: ${err.message}` });
  }
});

// ── Start ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Backend running → http://localhost:${PORT}`);
  console.log(
    `Canvas token: ${CANVAS_TOKEN ? "loaded" : "MISSING – set CANVAS_TOKEN in .env"}`
  );
  console.log(
    `Anthropic key: ${process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "your_anthropic_api_key_here" ? "loaded" : "MISSING – set ANTHROPIC_API_KEY in .env for AI summaries"}`
  );
});
