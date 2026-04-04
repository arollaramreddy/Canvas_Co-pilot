const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const pdf = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk").default;
const textToSpeech = require("@google-cloud/text-to-speech");
require("dotenv").config();

const app = express();
const PORT = 3001;

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5175";
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5176",
  "http://127.0.0.1:5177",
  FRONTEND_ORIGIN,
];

const GENERATED_AUDIO_DIR = path.join(__dirname, "generated", "audio");
const GENERATED_VIDEO_DIR = path.join(__dirname, "generated", "videos");
fs.mkdirSync(GENERATED_AUDIO_DIR, { recursive: true });
fs.mkdirSync(GENERATED_VIDEO_DIR, { recursive: true });

app.use("/audio", express.static(GENERATED_AUDIO_DIR));
app.use("/videos", express.static(GENERATED_VIDEO_DIR));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS origin not allowed: ${origin}`));
      }
    },
  })
);
app.use(express.json());

const CANVAS_TOKEN = process.env.CANVAS_TOKEN;
const CANVAS_BASE_URL =
  process.env.CANVAS_BASE_URL || "https://canvas.asu.edu/api/v1";

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

let ttsClient = null;
function getTtsClient() {
  if (!ttsClient) {
    ttsClient = new textToSpeech.TextToSpeechClient();
  }
  return ttsClient;
}

async function synthesizeSpeech(text, filename) {
  if (!text || !text.trim()) {
    throw new Error("No text provided for speech synthesis.");
  }

  const client = getTtsClient();
  const request = {
    input: { text },
    voice: {
      languageCode: "en-US",
      name: "en-US-Wavenet-F",
      ssmlGender: "FEMALE",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 1.0,
      pitch: 0,
    },
  };

  const [response] = await client.synthesizeSpeech(request);
  const outputPath = path.join(GENERATED_AUDIO_DIR, filename);
  await fs.promises.writeFile(outputPath, response.audioContent, "binary");
  return outputPath;
}

function getVideoFilename(topic) {
  const safeTopic = (topic || "study-video").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 80);
  return `${safeTopic}-${Date.now()}.mp4`;
}

function runRemotionRender(entryFile, compositionId, props, outputFilename) {
  return new Promise((resolve, reject) => {
    const frontendDir = path.join(__dirname, "..", "frontend");
    const outputPath = path.join(GENERATED_VIDEO_DIR, outputFilename);
    const args = [
      "remotion",
      "render",
      entryFile,
      compositionId,
      outputPath,
      "--props",
      JSON.stringify(props),
      "--overwrite",
      "--quiet",
    ];

    const child = execFile("npx", args, {
      cwd: frontendDir,
      maxBuffer: 1024 * 1024 * 20,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
      } else {
        resolve(outputPath);
      }
    });

    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

function createLocalVideoScript(content = "", topic = "Study Material", style = "medium") {
  const durationSeconds = style === "short" ? 90 : style === "long" ? 240 : 180;
  const title = `Study Video: ${topic}`;
  const sanitized = content.replace(/\s+/g, " ").trim();
  const sentences = sanitized
    .split(/[.?!]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const headline = sentences.slice(0, 2).join(". ") || "Study the key concepts.";
  const bullets = sentences.slice(1, 4).map((s) => {
    const text = s.replace(/\.$/, "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  while (bullets.length < 3) {
    bullets.push("Review the main concept.");
  }

  return {
    title,
    duration: durationSeconds,
    scenes: [
      {
        type: "title",
        heading: topic,
        subtitle: "Quick review of the most important ideas",
        durationSeconds: 4,
      },
      {
        type: "content",
        heading: "Main Points",
        bullets,
        narration: headline,
        durationSeconds: 20,
      },
      {
        type: "summary",
        heading: "Key Takeaways",
        bullets: bullets.slice(0, 3),
        narration: `Remember these core ideas about ${topic}.`,
        durationSeconds: 10,
      },
    ],
    totalNarration: `${title}. ${headline}`,
  };
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
app.get("/api/file-text", extractTextHandler);
app.get("/api/extract-text", extractTextHandler);

async function extractTextHandler(req, res) {
  const { fileId, courseId } = req.query;
  if (!fileId || !courseId) {
    return res.status(400).json({ error: "fileId and courseId are required" });
  }

  if (textCache.has(fileId)) {
    return res.json({ fileId, text: textCache.get(fileId), cached: true });
  }

  try {
    const file = await canvasRequest(`/courses/${courseId}/files/${fileId}`);
    if (!file.url) {
      return res.status(404).json({ error: "File has no download URL" });
    }

    const isPdf =
      (file.content_type || "").includes("pdf") ||
      (file.filename || "").toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return res.status(400).json({ error: "Only PDF files can be extracted" });
    }

    const buffer = await downloadCanvasFile(file.url);
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

    textCache.set(fileId, text);
    res.json({
      fileId,
      text,
      pages: text.split(/\f/).length,
      chars: text.length,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Failed to extract text: ${err.message}` });
  }
}

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

// ── Web Knowledge & Video Endpoints ──────────────────────

// In-memory cache for web search results
const webCache = new Map();

// 10. Search the web for supporting knowledge (free sources only)
app.get("/api/search-web", async (req, res) => {
  const { topic } = req.query;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const cacheKey = topic.toLowerCase().trim();
  if (webCache.has(cacheKey)) {
    return res.json({ ...webCache.get(cacheKey), cached: true });
  }

  const results = [];

  // 1. Wikipedia summary (primary free source)
  try {
    const wikiRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
    );
    if (wikiRes.ok) {
      const wiki = await wikiRes.json();
      if (wiki.extract && wiki.type !== "disambiguation") {
        results.push({
          source: "Wikipedia",
          title: wiki.title,
          summary: wiki.extract,
          url: wiki.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(topic)}`,
          type: "encyclopedia",
        });
      }
    }
  } catch { /* non-critical */ }

  // 2. Wikipedia search for related articles
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=3&format=json`
    );
    if (searchRes.ok) {
      const [, titles, , urls] = await searchRes.json();
      for (let i = 0; i < titles.length; i++) {
        if (results.find((r) => r.title === titles[i])) continue;
        try {
          const summRes = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[i])}`
          );
          if (summRes.ok) {
            const data = await summRes.json();
            if (data.extract && data.type !== "disambiguation") {
              results.push({
                source: "Wikipedia",
                title: data.title,
                summary: data.extract,
                url: urls[i],
                type: "encyclopedia",
              });
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* non-critical */ }

  // 3. DuckDuckGo Instant Answer API (free, no key)
  try {
    const ddgRes = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1&skip_disambig=1`
    );
    if (ddgRes.ok) {
      const ddg = await ddgRes.json();
      if (ddg.Abstract) {
        results.push({
          source: ddg.AbstractSource || "DuckDuckGo",
          title: ddg.Heading || topic,
          summary: ddg.Abstract,
          url: ddg.AbstractURL || "",
          type: "reference",
        });
      }
      if (ddg.RelatedTopics) {
        for (const rt of ddg.RelatedTopics.slice(0, 3)) {
          if (rt.Text) {
            results.push({
              source: "DuckDuckGo",
              title: rt.FirstURL?.split("/").pop()?.replace(/_/g, " ") || "Related",
              summary: rt.Text,
              url: rt.FirstURL || "",
              type: "related",
            });
          }
        }
      }
    }
  } catch { /* non-critical */ }

  const response = { topic, results, resultCount: results.length };
  webCache.set(cacheKey, response);
  res.json(response);
});

// 11. Enrich a topic by combining Canvas content with web knowledge
app.post("/api/enrich-topic", async (req, res) => {
  const { canvasSummary, webResults, topic, moduleName } = req.body;
  if (!canvasSummary && !webResults) {
    return res.status(400).json({ error: "canvasSummary or webResults required" });
  }

  try {
    const webContext = (webResults || [])
      .map((r) => `[${r.source}] ${r.title}: ${r.summary}`)
      .join("\n\n");

    const ai = getAnthropic();
    const message = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: `You are a study tutor. Combine the following Canvas course material with online knowledge to create an enriched study guide for "${topic || moduleName || "this topic"}".

## Canvas Course Material (from professor):
${canvasSummary || "No Canvas summary available."}

## Online Knowledge (from the web):
${webContext || "No additional web sources found."}

Create an enriched study guide with:
1. **Enhanced Summary** (combine Canvas + web knowledge, 4-6 sentences)
2. **Key Concepts Explained** (explain each in beginner-friendly terms, max 8)
3. **Important Definitions** (with clear, simple explanations)
4. **Likely Exam Topics** (what a professor would test, max 7)
5. **Study Notes** (concise takeaways for review)
6. **Additional Context from the Web** (what the web sources add beyond the lecture)

For each point, add a source label: [Canvas] or [Web] or [Combined].
Use markdown formatting. Be concise and student-friendly.`,
        },
      ],
    });

    const enrichedSummary = message.content[0]?.text || "No enrichment generated.";
    res.json({ topic, enrichedSummary });
  } catch (err) {
    res.status(500).json({ error: `Enrichment failed: ${err.message}` });
  }
});

// 12. Generate a video script from enriched content
app.post("/api/generate-script", async (req, res) => {
  const { enrichedSummary, topic, moduleName, style } = req.body;
  if (!enrichedSummary) {
    return res.status(400).json({ error: "enrichedSummary is required" });
  }

  const duration =
    style === "short" ? "1-2 minutes" : style === "long" ? "4-5 minutes" : "2-3 minutes";

  try {
    const ai = getAnthropic();
    const message = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: `Create a ${duration} educational video script for "${topic || moduleName || "this topic"}".

Based on this study material:
${enrichedSummary}

Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "title": "Video title",
  "duration": "${duration}",
  "scenes": [
    {
      "type": "title",
      "heading": "Main title",
      "subtitle": "Short subtitle",
      "durationSeconds": 4
    },
    {
      "type": "content",
      "heading": "Section heading",
      "bullets": ["Point 1", "Point 2", "Point 3"],
      "narration": "What to say during this scene",
      "durationSeconds": 15
    },
    {
      "type": "definition",
      "term": "Key Term",
      "definition": "Clear explanation",
      "narration": "What to say",
      "durationSeconds": 10
    },
    {
      "type": "summary",
      "heading": "Key Takeaways",
      "bullets": ["Takeaway 1", "Takeaway 2"],
      "narration": "Closing narration",
      "durationSeconds": 10
    }
  ],
  "totalNarration": "Full narration script for the entire video"
}

Include 4-7 scenes total. Keep on-screen text concise (max 8 words per bullet). Make narration natural and educational.`,
        },
      ],
    });

    let scriptText = message.content[0]?.text || "";
    // Strip markdown fences if present
    scriptText = scriptText
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let script;
    try {
      script = JSON.parse(scriptText);
    } catch {
      return res.json({
        topic,
        script: null,
        rawScript: scriptText,
        error: "Script generation returned non-JSON. Raw text included.",
      });
    }

    res.json({ topic, script });
  } catch (err) {
    console.warn("Anthropic script generation failed, using local fallback:", err.message);
    const fallbackScript = createLocalVideoScript(
      enrichedSummary,
      topic || moduleName || "Study Material",
      style
    );
    res.json({ topic, script: fallbackScript, fallback: true });
  }
});

// 12. Generate narration audio via Google Cloud TTS
app.post("/api/generate-audio", async (req, res) => {
  const { text, filename } = req.body;
  if (!text) {
    return res.status(400).json({ error: "text is required for audio generation" });
  }

  try {
    const safeFilename = (filename || `tts-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "-");
    const fileName = `${safeFilename}.mp3`;
    await synthesizeSpeech(text, fileName);
    const fullAudioUrl = `${req.protocol}://${req.get("host")}/audio/${fileName}`;
    res.json({ audioUrl: fullAudioUrl, filename: fileName });
  } catch (err) {
    res.status(500).json({ error: `Audio generation failed: ${err.message}` });
  }
});

// 13. Generate Remotion-ready video scene data with frame calculations
app.post("/api/generate-video", async (req, res) => {
  const { script, topic, audioUrl, renderFile } = req.body;
  if (!script || !script.scenes) {
    return res.status(400).json({ error: "script with scenes is required" });
  }

  const FPS = 30;
  let currentFrame = 0;
  const scenes = script.scenes.map((scene, index) => {
    const durationFrames = (scene.durationSeconds || 10) * FPS;
    const sceneData = {
      ...scene,
      id: `scene-${index}`,
      startFrame: currentFrame,
      durationFrames,
      durationSeconds: scene.durationSeconds || 10,
    };
    currentFrame += durationFrames;
    return sceneData;
  });

  const videoData = {
    topic,
    fps: FPS,
    totalDurationFrames: currentFrame,
    totalDurationSeconds: currentFrame / FPS,
    scenes,
    narration: script.totalNarration || "",
    audioUrl: audioUrl || null,
  };

  if (!renderFile) {
    return res.json(videoData);
  }

  try {
    if (!audioUrl) {
      return res.status(400).json({ error: "audioUrl is required to render a video file" });
    }

    const outputFilename = getVideoFilename(topic);
    const entryFile = path.join("src", "VideoComposition.jsx");
    await runRemotionRender(entryFile, "StudyVideo", { videoData, audioUrl }, outputFilename);

    const fullVideoUrl = `${req.protocol}://${req.get("host")}/videos/${outputFilename}`;
    res.json({
      ...videoData,
      videoUrl: fullVideoUrl,
    });
  } catch (err) {
    res.status(500).json({ error: `Video render failed: ${err.message}` });
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
