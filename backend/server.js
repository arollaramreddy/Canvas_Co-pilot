const express = require("express");
const cors = require("cors");
const pdf = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk").default;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { execFile } = require("child_process");
require("dotenv").config();

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3001;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const FRONTEND_ORIGINS = (
  process.env.FRONTEND_ORIGIN || DEFAULT_ALLOWED_ORIGINS.join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const GENERATED_ROOT = path.join(__dirname, "generated");
const GENERATED_VIDEO_DIR = path.join(GENERATED_ROOT, "videos");
const GENERATED_AUDIO_DIR = path.join(GENERATED_ROOT, "audio");
const GENERATED_SCRIPT_DIR = path.join(GENERATED_ROOT, "scripts");

fs.mkdirSync(GENERATED_VIDEO_DIR, { recursive: true });
fs.mkdirSync(GENERATED_AUDIO_DIR, { recursive: true });
fs.mkdirSync(GENERATED_SCRIPT_DIR, { recursive: true });

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || FRONTEND_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);
app.use(express.json({ limit: "5mb" }));
app.use("/generated", express.static(GENERATED_ROOT));

const CANVAS_TOKEN = process.env.CANVAS_TOKEN;
const CANVAS_BASE_URL =
  process.env.CANVAS_BASE_URL || "https://canvas.asu.edu/api/v1";
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || "";

let anthropic = null;
let remotionBundleLocation = null;

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "also", "am", "an",
  "and", "any", "are", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "could", "did", "do", "does",
  "doing", "down", "during", "each", "few", "for", "from", "further", "had",
  "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself",
  "just", "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of",
  "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out",
  "over", "own", "same", "she", "should", "so", "some", "such", "than", "that",
  "the", "their", "theirs", "them", "themselves", "then", "there", "these",
  "they", "this", "those", "through", "to", "too", "under", "until", "up", "very",
  "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom",
  "why", "will", "with", "you", "your", "yours", "yourself", "yourselves",
]);

const VOICE_OPTIONS = ["Samantha", "Allison", "Ava", "Daniel", "Alex"];

function getAnthropic() {
  if (!anthropic) {
    if (
      !process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY === "your_anthropic_api_key_here"
    ) {
      throw new Error("ANTHROPIC_API_KEY is not set in .env file");
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function sanitizeSlug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function hashContent(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex").slice(0, 10);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimSentence(text, maxLength = 220) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxLength) return clean;
  const clipped = clean.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 60 ? lastSpace : maxLength).trim()}...`;
}

function splitIntoParagraphs(text) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitIntoSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35);
}

function tokenize(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function buildFrequencyMap(text) {
  const map = new Map();
  for (const word of tokenize(text)) {
    map.set(word, (map.get(word) || 0) + 1);
  }
  return map;
}

function topKeywords(text, limit = 10) {
  return [...buildFrequencyMap(text).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function bestSentences(text, limit = 5) {
  const sentences = splitIntoSentences(text);
  const freq = buildFrequencyMap(text);
  const scored = sentences.map((sentence, index) => {
    const words = tokenize(sentence);
    const score = words.reduce((sum, word) => sum + (freq.get(word) || 0), 0) / Math.max(words.length, 1);
    return { sentence, index, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => trimSentence(entry.sentence));
}

function extractHeadings(text, limit = 6) {
  const lines = normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const headings = [];
  for (const line of lines) {
    const shortEnough = line.length >= 8 && line.length <= 90;
    const looksLikeHeading =
      shortEnough &&
      !/[.!?]$/.test(line) &&
      (line === line.toUpperCase() || /^[A-Z0-9][A-Za-z0-9 ,:/()-]+$/.test(line));
    if (looksLikeHeading) headings.push(line);
    if (headings.length >= limit) break;
  }
  return headings;
}

function buildLocalSummary(text, title = "Course PDF") {
  const clean = normalizeWhitespace(text);
  if (!clean) {
    return {
      source: "fallback",
      summary: "No extractable text found in this PDF.",
      keyPoints: [],
      definitions: [],
      examTopics: [],
      studyNotes: [],
    };
  }

  const summarySentences = bestSentences(clean, 4);
  const headings = extractHeadings(clean, 5);
  const keywords = topKeywords(clean, 8);
  const paragraphs = splitIntoParagraphs(clean).slice(0, 10);
  const definitions = paragraphs
    .flatMap((paragraph) => splitIntoSentences(paragraph).slice(0, 2))
    .filter((sentence) => /\b(is|refers to|defined as|means)\b/i.test(sentence))
    .slice(0, 4)
    .map((sentence) => trimSentence(sentence, 160));

  const examTopics = headings.length ? headings.slice(0, 5) : keywords.slice(0, 5).map(capitalizePhrase);
  const studyNotes = summarySentences.slice(0, 3);

  const markdown = [
    `## Summary`,
    summarySentences.map((sentence) => `- ${sentence}`).join("\n"),
    ``,
    `## Key Points`,
    (headings.length ? headings : keywords.map(capitalizePhrase).slice(0, 6))
      .map((item) => `- ${trimSentence(item, 80)}`)
      .join("\n"),
    ``,
    `## Important Definitions`,
    (definitions.length ? definitions : ["No clear glossary-style definitions were detected, so focus on the summary and key points."])
      .map((item) => `- ${item}`)
      .join("\n"),
    ``,
    `## Likely Exam Topics`,
    examTopics.map((item) => `- ${item}`).join("\n"),
    ``,
    `## Quick Study Notes`,
    studyNotes.map((item) => `- ${item}`).join("\n"),
  ].join("\n");

  return {
    source: "fallback",
    summary: markdown,
    keyPoints: headings.length ? headings : keywords.map(capitalizePhrase).slice(0, 6),
    definitions,
    examTopics,
    studyNotes,
    title,
  };
}

function capitalizePhrase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function buildSceneNarration({ heading, sourceSentences, mode }) {
  const intro = mode === "detailed" ? "Here is the deeper idea to focus on." : "Here is the key idea.";
  const body = sourceSentences.slice(0, mode === "detailed" ? 3 : 2).join(" ");
  return trimSentence(`${heading}. ${intro} ${body}`, mode === "detailed" ? 420 : 280);
}

function estimateSecondsFromText(text, min = 6) {
  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
  return Math.max(min, Math.ceil(words / 2.5));
}

function buildFallbackStoryboard({ text, title, mode = "quick", webContext = [] }) {
  const clean = normalizeWhitespace(text);
  const sentences = splitIntoSentences(clean);
  const headings = extractHeadings(clean, 8);
  const keywords = topKeywords(clean, 12);
  const summarySentences = bestSentences(clean, mode === "detailed" ? 6 : 4);
  const desiredScenes = mode === "detailed" ? 6 : 4;
  const sceneCount = Math.min(6, Math.max(3, desiredScenes));
  const bucketSize = Math.max(1, Math.floor(sentences.length / sceneCount));

  const scenes = Array.from({ length: sceneCount }).map((_, index) => {
    const start = index * bucketSize;
    const chunk = sentences.slice(start, start + bucketSize + 1);
    const heading = headings[index] || capitalizePhrase(keywords[index] || `Key Idea ${index + 1}`);
    const keyword = keywords[index] || tokenize(heading)[0] || "education";
    const webNote = webContext[index]?.summary ? ` Public context: ${trimSentence(webContext[index].summary, 130)}` : "";
    const narration = buildSceneNarration({
      heading,
      sourceSentences: chunk.length ? chunk : summarySentences,
      mode,
    });
    const bullets = [
      heading,
      ...(chunk.length ? chunk.slice(0, mode === "detailed" ? 3 : 2) : summarySentences.slice(0, 2)),
    ]
      .map((item) => trimSentence(item, 80))
      .slice(0, mode === "detailed" ? 4 : 3);

    return {
      id: index + 1,
      title: heading,
      narration: `${narration}${webNote}`,
      onScreenText: bullets,
      keyword,
      captions: trimSentence(narration, 150),
      durationSeconds: estimateSecondsFromText(narration, mode === "detailed" ? 8 : 6),
      visualStyle: ["kinetic", "spotlight", "diagram", "timeline", "callout", "contrast"][index % 6],
    };
  });

  return {
    title: trimSentence(title || headings[0] || "Lesson Video", 100),
    mode,
    summary: summarySentences.join(" "),
    source: "fallback",
    scenes,
  };
}

async function tryAnthropicText(prompt, model = "claude-haiku-4-5-20251001", maxTokens = 2200) {
  try {
    const ai = getAnthropic();
    const message = await ai.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return {
      ok: true,
      text: message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim(),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

async function summarizeWithFallback(text, title) {
  const truncated = normalizeWhitespace(text).slice(0, 30000);
  const prompt = `You are a study assistant. Summarize the following course material from "${title || "a PDF"}".

Provide:
1. **Summary** (2-4 sentences)
2. **Key Points** (bullet list, max 8)
3. **Important Definitions** (if any)
4. **Likely Exam Topics** (bullet list, max 5)
5. **Quick Study Notes** (2-3 short takeaways)

Be concise and student-friendly. Use markdown formatting.

---
${truncated}`;

  const aiResult = await tryAnthropicText(prompt, "claude-haiku-4-5-20251001", 1500);
  if (aiResult.ok && aiResult.text) {
    return {
      source: "claude",
      summary: aiResult.text,
      fallbackUsed: false,
    };
  }

  const fallback = buildLocalSummary(text, title);
  return {
    source: "fallback",
    summary: fallback.summary,
    fallbackUsed: true,
    warning: aiResult.error ? `Claude unavailable, using local fallback: ${aiResult.error.message}` : undefined,
  };
}

async function summarizeModuleWithFallback(text, title, fileCount) {
  const truncated = normalizeWhitespace(text).slice(0, 40000);
  const prompt = `You are a study assistant. Summarize the following course module "${title || "Module"}".
It contains ${fileCount} PDF file(s).

Provide:
1. **Module Overview** (3-5 sentences covering all files)
2. **Key Concepts** (bullet list, max 10)
3. **Important Definitions** (if any)
4. **Likely Exam Topics** (bullet list, max 7)
5. **Study Notes** (key takeaways for exam prep)
6. **Per-File Summaries** (one short paragraph per file)

Be concise and student-friendly. Use markdown formatting.

---
${truncated}`;

  const aiResult = await tryAnthropicText(prompt, "claude-haiku-4-5-20251001", 2000);
  if (aiResult.ok && aiResult.text) {
    return {
      source: "claude",
      summary: aiResult.text,
      fallbackUsed: false,
    };
  }

  const fallback = buildLocalSummary(text, title);
  const moduleSummary = [
    `## Module Overview`,
    fallback.studyNotes.map((line) => `- ${line}`).join("\n"),
    ``,
    `## Key Concepts`,
    fallback.keyPoints.map((line) => `- ${line}`).join("\n"),
    ``,
    `## Important Definitions`,
    (fallback.definitions.length ? fallback.definitions : ["No strong glossary-style definitions were detected in the extracted text."])
      .map((line) => `- ${line}`)
      .join("\n"),
    ``,
    `## Likely Exam Topics`,
    fallback.examTopics.map((line) => `- ${line}`).join("\n"),
    ``,
    `## Study Notes`,
    fallback.studyNotes.map((line) => `- ${line}`).join("\n"),
    ``,
    `## Per-File Summaries`,
    `- Built with the local fallback summarizer from ${fileCount} PDF file(s).`,
  ].join("\n");

  return {
    source: "fallback",
    summary: moduleSummary,
    fallbackUsed: true,
    warning: aiResult.error ? `Claude unavailable, using local fallback: ${aiResult.error.message}` : undefined,
  };
}

async function searchWikipedia(topic) {
  const trimmed = normalizeWhitespace(topic).slice(0, 100);
  if (!trimmed) return [];

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      trimmed
    )}&utf8=&format=json&srlimit=3`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const pages = searchData?.query?.search || [];

    const summaries = [];
    for (const page of pages.slice(0, 2)) {
      const title = page.title;
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: { "User-Agent": "CanvasStudyAssistant/1.0" },
      });
      if (!summaryRes.ok) continue;
      const summaryData = await summaryRes.json();
      summaries.push({
        title: summaryData.title || title,
        summary: summaryData.extract || "",
        url: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      });
    }
    return summaries.filter((item) => item.summary);
  } catch {
    return [];
  }
}

async function buildStoryboardWithFallback({ text, title, mode = "quick", enrichWeb = true }) {
  const clean = normalizeWhitespace(text);
  const baseKeywords = topKeywords(clean, 6);
  const webContext = enrichWeb ? await searchWikipedia(baseKeywords.slice(0, 2).join(" ")) : [];

  const prompt = `You are creating a narrated educational explainer video from a PDF.

Return ONLY valid JSON:
{
  "title": "lesson title",
  "mode": "${mode}",
  "summary": "1 paragraph summary",
  "scenes": [
    {
      "id": 1,
      "title": "scene title",
      "narration": "spoken narration",
      "onScreenText": ["short bullet", "short bullet"],
      "keyword": "pexels search term",
      "captions": "short subtitle text",
      "durationSeconds": 10,
      "visualStyle": "kinetic"
    }
  ]
}

Rules:
- Create ${mode === "detailed" ? "6" : "4"} scenes total
- Stay grounded in the supplied PDF content
- Each scene should feel distinct
- onScreenText should have 2 to 4 short phrases
- keyword should be concrete enough for stock footage
- captions should be concise
- narration should sound natural out loud

Optional public web context:
${webContext.map((item) => `- ${item.title}: ${trimSentence(item.summary, 180)}`).join("\n") || "- none"}

Source title: ${title || "Course PDF"}

PDF content:
${clean.slice(0, 22000)}`;

  const aiResult = await tryAnthropicText(prompt, "claude-sonnet-4-6", 2600);
  if (aiResult.ok && aiResult.text) {
    const jsonMatch = aiResult.text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? safeJsonParse(jsonMatch[0]) : null;
    if (parsed?.scenes?.length) {
      return {
        storyboard: normalizeStoryboard(parsed, mode),
        source: "claude",
        fallbackUsed: false,
        webContext,
      };
    }
  }

  return {
    storyboard: normalizeStoryboard(
      buildFallbackStoryboard({ text: clean, title, mode, webContext }),
      mode
    ),
    source: "fallback",
    fallbackUsed: true,
    warning: aiResult.error ? `Claude unavailable, using local storyboard fallback: ${aiResult.error.message}` : undefined,
    webContext,
  };
}

function normalizeStoryboard(storyboard, mode = "quick") {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const normalizedScenes = scenes
    .slice(0, mode === "detailed" ? 6 : 4)
    .map((scene, index) => {
      const narration = normalizeWhitespace(scene.narration || scene.captions || scene.title || `Scene ${index + 1}`);
      const durationSeconds = Math.max(
        mode === "detailed" ? 8 : 6,
        Number(scene.durationSeconds) || estimateSecondsFromText(narration, mode === "detailed" ? 8 : 6)
      );
      return {
        id: scene.id || index + 1,
        title: trimSentence(scene.title || `Scene ${index + 1}`, 80),
        narration,
        onScreenText: Array.isArray(scene.onScreenText)
          ? scene.onScreenText.map((item) => trimSentence(item, 70)).slice(0, 4)
          : [trimSentence(scene.title || `Scene ${index + 1}`, 70)],
        keyword: trimSentence(scene.keyword || tokenize(narration)[0] || "education", 40),
        captions: trimSentence(scene.captions || narration, 150),
        durationSeconds,
        visualStyle: scene.visualStyle || ["kinetic", "spotlight", "diagram", "timeline", "contrast", "callout"][index % 6],
      };
    });

  return {
    title: trimSentence(storyboard?.title || "Lesson Video", 100),
    mode,
    summary: trimSentence(storyboard?.summary || normalizedScenes.map((scene) => scene.title).join(". "), 240),
    scenes: normalizedScenes,
  };
}

function ensureCanvasToken() {
  if (!CANVAS_TOKEN) {
    const error = new Error("CANVAS_TOKEN is not set in .env file");
    error.status = 500;
    throw error;
  }
}

async function canvasRequest(pathname) {
  ensureCanvasToken();
  const url = `${CANVAS_BASE_URL}${pathname}`;
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

async function canvasRequestAll(pathname, maxPages = 10) {
  ensureCanvasToken();
  let url = `${CANVAS_BASE_URL}${pathname}`;
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

    const link = res.headers.get("link");
    if (!link) break;

    const next = link.split(",").find((item) => item.includes('rel="next"'));
    if (!next) break;

    const match = next.match(/<([^>]+)>/);
    if (!match) break;

    url = match[1];
  }

  return all;
}

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

const textCache = new Map();

async function getFileText(fileId, courseId) {
  const key = String(fileId);
  if (textCache.has(key)) {
    const cached = textCache.get(key);
    return { ...cached, cached: true };
  }

  const file = await canvasRequest(`/courses/${courseId}/files/${fileId}`);
  if (!file.url) {
    const error = new Error("File has no download URL");
    error.status = 404;
    throw error;
  }

  const isPdf =
    (file.content_type || "").includes("pdf") ||
    (file.filename || "").toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    const error = new Error("Only PDF files can be extracted");
    error.status = 400;
    throw error;
  }

  const buffer = await downloadCanvasFile(file.url);

  let text = "";
  try {
    const pdfData = await pdf(buffer);
    text = pdfData.text || "";
  } catch {
    return {
      fileId: key,
      text: "",
      warning: "Could not extract text – the PDF may be scanned or image-based.",
    };
  }

  if (!text.trim()) {
    return {
      fileId: key,
      text: "",
      warning: "PDF appears to be empty or scanned with no extractable text.",
    };
  }

  const payload = {
    fileId: key,
    fileName: file.display_name || file.filename || key,
    text,
    pages: text.split(/\f/).length,
    chars: text.length,
  };
  textCache.set(key, payload);
  return payload;
}

async function fetchModuleTexts(courseId, moduleId) {
  const items = await canvasRequestAll(
    `/courses/${courseId}/modules/${moduleId}/items?per_page=100`
  );
  const fileItems = items.filter((item) => item.type === "File" && item.content_id);

  const texts = [];
  for (const item of fileItems) {
    try {
      const extracted = await getFileText(item.content_id, courseId);
      if (extracted.text) {
        texts.push({ name: item.title || extracted.fileName, text: extracted.text });
      }
    } catch {
      // skip unreadable PDFs
    }
  }
  return texts;
}

async function searchPexelsVideos(query) {
  if (!PEXELS_API_KEY) {
    return {
      query,
      source: "fallback",
      results: [],
      warning: "PEXELS_API_KEY is missing, using animated fallback backgrounds.",
    };
  }

  try {
    const response = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`,
      {
        headers: { Authorization: PEXELS_API_KEY },
      }
    );

    if (!response.ok) {
      return {
        query,
        source: "fallback",
        results: [],
        warning: `Pexels request failed with status ${response.status}.`,
      };
    }

    const data = await response.json();
    const results = (data.videos || [])
      .map((video) => {
        const bestFile = (video.video_files || [])
          .filter((file) => file.width >= 640 && file.link)
          .sort((a, b) => (a.width * a.height) - (b.width * b.height))[0];
        if (!bestFile) return null;
        return {
          id: video.id,
          width: bestFile.width,
          height: bestFile.height,
          duration: video.duration,
          url: bestFile.link,
          image: video.image,
          photographer: video.user?.name || "Pexels",
          photographerUrl: video.user?.url || "",
        };
      })
      .filter(Boolean);

    if (!results.length) {
      return {
        query,
        source: "fallback",
        results: [],
        warning: `No Pexels clips found for "${query}".`,
      };
    }

    return { query, source: "pexels", results };
  } catch (error) {
    return {
      query,
      source: "fallback",
      results: [],
      warning: `Pexels search failed: ${error.message}`,
    };
  }
}

function selectVoice() {
  return process.env.LOCAL_TTS_VOICE || VOICE_OPTIONS[0];
}

async function getAudioDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/afinfo", [filePath]);
    const match = stdout.match(/estimated duration:\s+([0-9.]+)/i);
    if (match) return Number(match[1]);
  } catch {
    // ignore and use rough estimate
  }
  return null;
}

async function generateAudioTracks({ scenes, jobId, force = false }) {
  const audioTracks = [];
  const warnings = [];

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const fileBase = `${jobId}-scene-${index + 1}`;
    const aiffPath = path.join(GENERATED_AUDIO_DIR, `${fileBase}.aiff`);
    const m4aPath = path.join(GENERATED_AUDIO_DIR, `${fileBase}.m4a`);
    const publicUrl = `${API_BASE_URL}/generated/audio/${path.basename(m4aPath)}`;

    if (!force && fs.existsSync(m4aPath)) {
      const durationSeconds =
        (await getAudioDurationSeconds(m4aPath)) || estimateSecondsFromText(scene.narration, scene.durationSeconds);
      audioTracks.push({
        ...scene,
        audioUrl: publicUrl,
        durationSeconds: Math.max(scene.durationSeconds, Math.ceil(durationSeconds)),
        audioSource: "local-tts-cache",
      });
      continue;
    }

    try {
      await execFileAsync("/usr/bin/say", [
        "-v",
        selectVoice(),
        "-r",
        String(process.env.LOCAL_TTS_RATE || 178),
        "-o",
        aiffPath,
        scene.narration,
      ]);

      await execFileAsync("/usr/bin/afconvert", [
        "-f",
        "m4af",
        "-d",
        "aac",
        aiffPath,
        m4aPath,
      ]);

      const durationSeconds =
        (await getAudioDurationSeconds(m4aPath)) || estimateSecondsFromText(scene.narration, scene.durationSeconds);
      audioTracks.push({
        ...scene,
        audioUrl: publicUrl,
        durationSeconds: Math.max(scene.durationSeconds, Math.ceil(durationSeconds)),
        audioSource: "local-tts",
      });
    } catch (error) {
      warnings.push(`Audio generation failed for scene ${index + 1}: ${error.message}`);
      audioTracks.push({
        ...scene,
        audioUrl: null,
        audioSource: "subtitle-only",
      });
    } finally {
      if (fs.existsSync(aiffPath)) {
        fs.unlinkSync(aiffPath);
      }
    }
  }

  return { scenes: audioTracks, warnings };
}

async function getRemotionDependencies() {
  try {
    const bundler = require("@remotion/bundler");
    const renderer = require("@remotion/renderer");
    return {
      bundle: bundler.bundle,
      getCompositions: renderer.getCompositions,
      renderMedia: renderer.renderMedia,
      openBrowser: renderer.openBrowser,
    };
  } catch (error) {
    const wrapped = new Error(
      'Remotion dependencies are not installed in `backend/`. Run `npm --prefix backend install` before generating videos.'
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function ensureRemotionBundle() {
  if (remotionBundleLocation) return remotionBundleLocation;
  const { bundle } = await getRemotionDependencies();
  const entryPoint = path.join(__dirname, "remotion", "index.jsx");
  remotionBundleLocation = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });
  return remotionBundleLocation;
}

async function renderVideo({ jobId, title, mode, scenes, sourceName, warnings = [] }) {
  const { getCompositions, renderMedia } = await getRemotionDependencies();
  const serveUrl = await ensureRemotionBundle();
  const fps = 30;
  const sceneWithFrames = [];
  let cursor = 0;

  for (const scene of scenes) {
    const durationFrames = Math.max(90, Math.round((scene.durationSeconds || 6) * fps));
    sceneWithFrames.push({
      ...scene,
      durationFrames,
      startFrame: cursor,
    });
    cursor += durationFrames;
  }

  const inputProps = {
    title,
    subtitle: mode === "detailed" ? "Detailed lesson video" : "Quick 2-minute lesson",
    mode,
    sourceName,
    fps,
    totalFrames: cursor,
    scenes: sceneWithFrames,
  };

  const compositions = await getCompositions(serveUrl, {
    inputProps,
  });
  const composition = compositions.find((item) => item.id === "LessonVideo");
  if (!composition) {
    throw new Error('Remotion composition "LessonVideo" was not found.');
  }

  const outputPath = path.join(GENERATED_VIDEO_DIR, `${jobId}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    imageFormat: "jpeg",
    audioCodec: "aac",
    overwrite: true,
  });

  const manifest = {
    title,
    mode,
    sourceName,
    scenes: sceneWithFrames,
    warnings,
    videoUrl: `${API_BASE_URL}/generated/videos/${jobId}.mp4`,
    videoPath: outputPath,
  };

  fs.writeFileSync(
    path.join(GENERATED_SCRIPT_DIR, `${jobId}.render.json`),
    JSON.stringify(manifest, null, 2)
  );

  return manifest;
}

async function buildVideoPackage({
  fileId,
  courseId,
  title,
  text,
  storyboard,
  mode = "quick",
  enrichWeb = true,
  force = false,
}) {
  const warnings = [];
  const sourceText = normalizeWhitespace(
    text || (await getFileText(fileId, courseId)).text || ""
  );

  if (!sourceText) {
    const error = new Error("The selected PDF did not contain extractable text.");
    error.status = 422;
    throw error;
  }

  const storyboardResult = storyboard
    ? { storyboard: normalizeStoryboard(storyboard, mode), source: "client-cache", fallbackUsed: false, webContext: [] }
    : await buildStoryboardWithFallback({ text: sourceText, title, mode, enrichWeb });

  if (storyboardResult.warning) warnings.push(storyboardResult.warning);

  const sceneVideos = [];
  for (const scene of storyboardResult.storyboard.scenes) {
    const videoSearch = await searchPexelsVideos(scene.keyword || scene.title);
    if (videoSearch.warning) warnings.push(videoSearch.warning);
    sceneVideos.push({
      ...scene,
      backgroundVideoUrl: videoSearch.results[0]?.url || null,
      backgroundImage: videoSearch.results[0]?.image || null,
      backgroundSource: videoSearch.results[0] ? "pexels" : "animated-fallback",
      backgroundAttribution: videoSearch.results[0]
        ? {
            photographer: videoSearch.results[0].photographer,
            photographerUrl: videoSearch.results[0].photographerUrl,
          }
        : null,
    });
  }

  const jobId = `${sanitizeSlug(title || "lesson")}-${mode}-${hashContent(`${fileId || "text"}-${sourceText.slice(0, 3000)}`)}`;

  const audioResult = await generateAudioTracks({
    scenes: sceneVideos,
    jobId,
    force,
  });
  warnings.push(...audioResult.warnings);

  const scriptPath = path.join(GENERATED_SCRIPT_DIR, `${jobId}.json`);
  const scriptPayload = {
    jobId,
    title: storyboardResult.storyboard.title,
    mode,
    source: storyboardResult.source,
    fallbackUsed: storyboardResult.fallbackUsed,
    warnings,
    webContext: storyboardResult.webContext,
    storyboard: {
      ...storyboardResult.storyboard,
      scenes: audioResult.scenes,
    },
  };
  fs.writeFileSync(scriptPath, JSON.stringify(scriptPayload, null, 2));

  const renderResult = await renderVideo({
    jobId,
    title: storyboardResult.storyboard.title,
    mode,
    scenes: audioResult.scenes,
    sourceName: title || "Canvas PDF",
    warnings,
  });

  return {
    ...scriptPayload,
    scriptUrl: `${API_BASE_URL}/generated/scripts/${jobId}.json`,
    videoUrl: renderResult.videoUrl,
    downloadUrl: renderResult.videoUrl,
    scenePreview: audioResult.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      keyword: scene.keyword,
      caption: scene.captions,
      hasBackgroundVideo: Boolean(scene.backgroundVideoUrl),
      hasAudio: Boolean(scene.audioUrl),
    })),
  };
}

// Existing endpoints

app.get("/api/test-login", async (req, res) => {
  if (!CANVAS_TOKEN) {
    return res.status(500).json({ error: "CANVAS_TOKEN is not set in .env file" });
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

app.get("/api/courses", async (req, res) => {
  try {
    const courses = await canvasRequestAll(
      "/courses?per_page=50&enrollment_state=active"
    );
    res.json(
      courses.map((course) => ({
        id: course.id,
        name: course.name,
        code: course.course_code,
        enrollment_term_id: course.enrollment_term_id,
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Failed to fetch courses: ${err.message}`,
    });
  }
});

app.get("/api/courses/:courseId/assignments", async (req, res) => {
  try {
    const assignments = await canvasRequestAll(
      `/courses/${req.params.courseId}/assignments?per_page=50&order_by=due_at`
    );
    res.json(
      assignments.map((assignment) => ({
        id: assignment.id,
        name: assignment.name,
        due_at: assignment.due_at,
        points_possible: assignment.points_possible,
        html_url: assignment.html_url,
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Failed to fetch assignments: ${err.message}`,
    });
  }
});

app.get("/api/courses/:courseId/files", async (req, res) => {
  try {
    const files = await canvasRequest(
      `/courses/${req.params.courseId}/files?per_page=20`
    );
    res.json(
      files.map((file) => ({
        id: file.id,
        display_name: file.display_name,
        size: file.size,
        url: file.url,
        created_at: file.created_at,
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Failed to fetch files: ${err.message}`,
    });
  }
});

app.get("/api/modules", async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: "courseId is required" });

  try {
    const modules = await canvasRequestAll(
      `/courses/${courseId}/modules?per_page=50&include[]=items_count`
    );
    res.json(
      modules.map((module) => ({
        id: module.id,
        name: module.name,
        position: module.position,
        items_count: module.items_count,
        state: module.state,
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Failed to fetch modules: ${err.message}`,
    });
  }
});

app.get("/api/module-files", async (req, res) => {
  const { courseId, moduleId } = req.query;
  if (!courseId || !moduleId) {
    return res.status(400).json({ error: "courseId and moduleId are required" });
  }

  try {
    const items = await canvasRequestAll(
      `/courses/${courseId}/modules/${moduleId}/items?per_page=100`
    );

    const fileItems = items.filter(
      (item) => item.type === "File" || item.type === "ExternalUrl"
    );

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
    res.status(err.status || 500).json({
      error: `Failed to fetch module files: ${err.message}`,
    });
  }
});

async function handleExtractTextRequest(req, res) {
  const { fileId, courseId } = req.query;
  if (!fileId || !courseId) {
    return res.status(400).json({ error: "fileId and courseId are required" });
  }

  try {
    const data = await getFileText(fileId, courseId);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Failed to extract text: ${err.message}`,
    });
  }
}

app.get("/api/file-text", handleExtractTextRequest);
app.get("/api/extract-text", handleExtractTextRequest);

app.post("/api/summarize-file", async (req, res) => {
  const { fileId, courseId, fileName } = req.body;
  if (!fileId || !courseId) {
    return res.status(400).json({ error: "fileId and courseId are required" });
  }

  try {
    const extracted = await getFileText(fileId, courseId);
    if (!extracted.text) {
      return res.json({
        fileId,
        summary: "No extractable text found in this PDF.",
        source: "fallback",
        fallbackUsed: true,
      });
    }

    const summary = await summarizeWithFallback(extracted.text, fileName || extracted.fileName);
    res.json({
      fileId,
      fileName: fileName || extracted.fileName,
      summary: summary.summary,
      source: summary.source,
      fallbackUsed: summary.fallbackUsed,
      warning: summary.warning,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Summarization failed: ${err.message}`,
    });
  }
});

app.post("/api/summarize-module", async (req, res) => {
  const { courseId, moduleId, moduleName } = req.body;
  if (!courseId || !moduleId) {
    return res.status(400).json({ error: "courseId and moduleId are required" });
  }

  try {
    const texts = await fetchModuleTexts(courseId, moduleId);
    if (!texts.length) {
      return res.json({
        moduleId,
        moduleName,
        summary: "No extractable PDF content found in this module.",
        fileCount: 0,
        source: "fallback",
      });
    }

    const combined = texts
      .map((item) => `--- ${item.name} ---\n${item.text}`)
      .join("\n\n")
      .slice(0, 40000);
    const summary = await summarizeModuleWithFallback(combined, moduleName, texts.length);

    res.json({
      moduleId,
      moduleName,
      summary: summary.summary,
      fileCount: texts.length,
      source: summary.source,
      fallbackUsed: summary.fallbackUsed,
      warning: summary.warning,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Module summarization failed: ${err.message}`,
    });
  }
});

app.get("/api/search-web", async (req, res) => {
  const { topic } = req.query;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const results = await searchWikipedia(topic);
  res.json({
    topic,
    count: results.length,
    results,
    source: "wikipedia",
    warning: results.length ? null : "No public web context found, continuing without enrichment.",
  });
});

app.post("/api/generate-script", async (req, res) => {
  const { fileId, courseId, title, text, mode = "quick", enrichWeb = true } = req.body;
  if ((!fileId || !courseId) && !text) {
    return res.status(400).json({ error: "Provide either text or fileId + courseId." });
  }

  try {
    const extractedText = text || (await getFileText(fileId, courseId)).text;
    if (!extractedText?.trim()) {
      return res.status(422).json({
        error: "The selected PDF did not contain extractable text.",
      });
    }

    const storyboard = await buildStoryboardWithFallback({
      text: extractedText,
      title,
      mode,
      enrichWeb,
    });

    const tempScriptId = `${sanitizeSlug(title || "lesson")}-${mode}-${hashContent(extractedText.slice(0, 3000))}-preview`;
    const scriptPayload = {
      jobId: tempScriptId,
      title: storyboard.storyboard.title,
      mode,
      source: storyboard.source,
      fallbackUsed: storyboard.fallbackUsed,
      warning: storyboard.warning,
      webContext: storyboard.webContext,
      storyboard: storyboard.storyboard,
    };
    fs.writeFileSync(
      path.join(GENERATED_SCRIPT_DIR, `${tempScriptId}.json`),
      JSON.stringify(scriptPayload, null, 2)
    );

    res.json({
      ...scriptPayload,
      scriptUrl: `${API_BASE_URL}/generated/scripts/${tempScriptId}.json`,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: `Script generation failed: ${err.message}`,
    });
  }
});

app.get("/api/search-video", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });
  const result = await searchPexelsVideos(query);
  res.json(result);
});

app.post("/api/generate-audio", async (req, res) => {
  const { scenes, title = "lesson-audio", force = false } = req.body;
  if (!Array.isArray(scenes) || !scenes.length) {
    return res.status(400).json({ error: "scenes array is required" });
  }

  try {
    const jobId = `${sanitizeSlug(title)}-${hashContent(JSON.stringify(scenes))}`;
    const audio = await generateAudioTracks({
      scenes: normalizeStoryboard({ scenes, title }).scenes,
      jobId,
      force,
    });
    res.json({
      jobId,
      scenes: audio.scenes,
      warnings: audio.warnings,
      source: audio.warnings.length ? "mixed" : "local-tts",
    });
  } catch (err) {
    res.status(500).json({
      error: `Audio generation failed: ${err.message}`,
    });
  }
});

const AGENT_TOOLS = [
  {
    name: "list_modules",
    description: "List all modules in the course. Always call this first to understand course structure before doing anything else.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_module_files",
    description: "Get the files and PDFs inside a specific module. Use this after list_modules to find what files are available.",
    input_schema: {
      type: "object",
      properties: {
        module_id: { type: "string", description: "The numeric module ID from list_modules" },
        module_name: { type: "string", description: "Module name for context" },
      },
      required: ["module_id"],
    },
  },
  {
    name: "extract_pdf",
    description: "Download and extract the full text content from a PDF file. Use this to actually READ course material. Returns up to 25000 characters of text.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "The numeric file ID" },
        file_name: { type: "string", description: "File name for context" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "list_assignments",
    description: "Get all assignments for the course with their due dates and point values.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
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
    return modules.map((module) => ({
      id: String(module.id),
      name: module.name,
      items_count: module.items_count,
      state: module.state,
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
    const extracted = await getFileText(input.file_id, courseId);
    return {
      file_name: input.file_name || extracted.fileName || input.file_id,
      chars: extracted.text?.length || 0,
      text: `${(extracted.text || "").slice(0, 25000)}${
        (extracted.text || "").length > 25000 ? "\n...[truncated]" : ""
      }`,
    };
  }

  if (name === "list_assignments") {
    const assignments = await canvasRequestAll(
      `/courses/${courseId}/assignments?per_page=50&order_by=due_at`
    );
    return assignments.map((assignment) => ({
      name: assignment.name,
      due_at: assignment.due_at,
      points_possible: assignment.points_possible,
    }));
  }

  throw new Error(`Unknown tool: ${name}`);
}

function makeToolPreview(name, input, result) {
  if (name === "list_modules") {
    const names = result.slice(0, 3).map((module) => module.name).join(", ");
    const more = result.length > 3 ? `, +${result.length - 3} more` : "";
    return `Found ${result.length} modules: ${names}${more}`;
  }
  if (name === "get_module_files") {
    const names = result.slice(0, 3).map((file) => file.name).join(", ");
    const more = result.length > 3 ? `, +${result.length - 3} more` : "";
    return `Found ${result.length} files in ${input.module_name || "module"}: ${names}${more}`;
  }
  if (name === "extract_pdf") {
    const kb = Math.round(result.chars / 1000);
    return `Extracted ${kb}k chars from ${result.file_name}`;
  }
  if (name === "list_assignments") {
    const next = result.find((assignment) => assignment.due_at && new Date(assignment.due_at) > new Date());
    if (next) {
      const date = new Date(next.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `Found ${result.length} assignments, next due: ${next.name} on ${date}`;
    }
    return `Found ${result.length} assignments`;
  }
  return "Done";
}

app.post("/api/agent", async (req, res) => {
  const { task, courseId } = req.body;
  if (!task || !courseId) {
    return res.status(400).json({ error: "task and courseId are required" });
  }

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
    const maxIterations = 12;

    for (let step = 0; step < maxIterations; step++) {
      sendEvent({ type: "thinking", step });

      const response = await ai.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: AGENT_SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      });

      const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");
      const textBlocks = response.content.filter((block) => block.type === "text");

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        const answerText = textBlocks.map((block) => block.text).join("\n\n").trim();
        if (answerText) sendEvent({ type: "answer", text: answerText });
        break;
      }

      messages.push({ role: "assistant", content: response.content });

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

      messages.push({ role: "user", content: toolResults });
      if (response.stop_reason !== "tool_use") break;
    }

    sendEvent({ type: "done" });
  } catch (err) {
    sendEvent({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

app.post("/api/generate-video", async (req, res) => {
  const {
    fileId,
    courseId,
    title,
    text,
    storyboard,
    mode = "quick",
    enrichWeb = true,
    force = false,
  } = req.body;

  if ((!fileId || !courseId) && !text && !storyboard) {
    return res.status(400).json({
      error: "Provide either fileId + courseId or inline text/storyboard.",
    });
  }

  try {
    const videoPackage = await buildVideoPackage({
      fileId,
      courseId,
      title,
      text,
      storyboard,
      mode,
      enrichWeb,
      force,
    });
    res.json(videoPackage);
  } catch (err) {
    const message = err.message.includes("Remotion dependencies are not installed")
      ? `${err.message} The rest of the page will keep working, but video rendering is unavailable until dependencies are installed.`
      : err.message;
    res.status(err.status || 500).json({
      error: `Video generation failed: ${message}`,
    });
  }
});

// Backwards-compatible endpoint name used by the old UI
app.post("/api/generate-lesson", async (req, res) => {
  const { text, title, mode = "quick" } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const storyboard = await buildStoryboardWithFallback({
      text,
      title,
      mode,
      enrichWeb: true,
    });
    res.json({
      title: storyboard.storyboard.title,
      subject: topKeywords(text, 3).map(capitalizePhrase).join(" · "),
      estimated_minutes: Math.ceil(
        storyboard.storyboard.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) / 60
      ),
      slides: storyboard.storyboard.scenes.map((scene, index) => ({
        id: scene.id,
        type: index === storyboard.storyboard.scenes.length - 1 ? "summary" : index % 3 === 1 ? "definition" : "concept",
        heading: scene.title,
        term: scene.title,
        definition: scene.onScreenText?.[0],
        bullets: scene.onScreenText,
        narration: scene.narration,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: `Lesson generation failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running -> http://localhost:${PORT}`);
  console.log(
    `Canvas token: ${CANVAS_TOKEN ? "loaded" : "MISSING - set CANVAS_TOKEN in .env"}`
  );
  console.log(
    `Anthropic key: ${
      process.env.ANTHROPIC_API_KEY &&
      process.env.ANTHROPIC_API_KEY !== "your_anthropic_api_key_here"
        ? "loaded"
        : "MISSING - local fallback will be used"
    }`
  );
  console.log(
    `Pexels key: ${PEXELS_API_KEY ? "loaded" : "MISSING - animated fallback backgrounds will be used"}`
  );
});
