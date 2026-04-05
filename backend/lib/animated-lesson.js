const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");
const { GENERATED_ROOT } = require("./lesson-audio");

const ANIMATED_LESSON_DIR = path.join(GENERATED_ROOT, "animated-lessons");
const DEFAULT_FPS = 30;
const MAX_SCENES = 8;
const MAX_CAPTION_GROUPS = 2;
const MAX_HIGHLIGHT_WORDS = 4;
const MAX_BULLETS_PER_SCENE = 3;
const MAX_DURATION_SECONDS = 12;
const TERMINAL_STATUSES = new Set(["ready", "failed"]);
const WORKER_SCRIPT = path.join(__dirname, "..", "workers", "animated-video-render-job.js");

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function ensureAnimatedLessonDir() {
  fs.mkdirSync(ANIMATED_LESSON_DIR, { recursive: true });
  return ANIMATED_LESSON_DIR;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAnimationId(text) {
  const value = normalizeText(text).toLowerCase();
  if (/(summary|takeaway|recap|conclusion|remember)/.test(value)) return "summary";
  if (/(graph|chart|plot|trend|curve|axis|distribution)/.test(value)) return "graph";
  if (/(data|dataset|metric|measurement|analysis|evidence)/.test(value)) return "data";
  if (/(ai|model|algorithm|machine learning|neural|prediction)/.test(value)) return "ai";
  return "intro";
}

function extractHighlightWords(text) {
  const matches = normalizeText(text)
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 5);

  const priority = matches.filter((word) =>
    /data|model|graph|summary|system|pattern|result|signal|concept|method|process/i.test(word)
  );

  return Array.from(new Set([...(priority || []), ...matches])).slice(0, MAX_HIGHLIGHT_WORDS);
}

function splitNarrationIntoCaptions(text) {
  const sentences = normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (!sentences.length) return [];

  const groups = [];
  for (let index = 0; index < sentences.length; index += 2) {
    groups.push(sentences.slice(index, index + 2).join(" "));
  }
  return groups.slice(0, MAX_CAPTION_GROUPS);
}

function estimateDurationSeconds(slide) {
  const declared = Number(slide?.duration_seconds || 0);
  if (declared > 0) return Math.min(MAX_DURATION_SECONDS, declared);
  const words = normalizeText(slide?.narration).split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_DURATION_SECONDS, Math.max(6, Math.ceil(words / 2.6)));
}

function mapJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    sourceFileId: row.source_file_id,
    title: row.title || "",
    status: row.status || "queued",
    progressMessage: row.progress_message || "",
    lesson: parseJson(row.lesson_json, null),
    lessonPackage: parseJson(row.lesson_package_json, null),
    videoUrl: row.video_url || null,
    videoFileName: row.video_file_name || null,
    error: row.error_text || "",
    readyAt: row.ready_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round((usage.rss / 1024 / 1024) * 10) / 10,
    heapUsedMb: Math.round((usage.heapUsed / 1024 / 1024) * 10) / 10,
    externalMb: Math.round((usage.external / 1024 / 1024) * 10) / 10,
  };
}

function getAnimatedVideoJob(db, jobId, userId = null) {
  const row = userId
    ? db
        .prepare(
          `SELECT * FROM animated_video_jobs WHERE id = ? AND user_id = ? LIMIT 1`
        )
        .get(String(jobId), String(userId))
    : db.prepare(`SELECT * FROM animated_video_jobs WHERE id = ? LIMIT 1`).get(String(jobId));
  return mapJobRow(row);
}

function updateAnimatedVideoJob(db, jobId, patch) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE animated_video_jobs
    SET
      status = COALESCE(?, status),
      progress_message = COALESCE(?, progress_message),
      lesson_json = COALESCE(?, lesson_json),
      lesson_package_json = COALESCE(?, lesson_package_json),
      video_url = COALESCE(?, video_url),
      video_file_name = COALESCE(?, video_file_name),
      error_text = ?,
      ready_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.status || null,
    patch.progressMessage || null,
    patch.lessonJson || null,
    patch.lessonPackageJson || null,
    patch.videoUrl || null,
    patch.videoFileName || null,
    patch.errorText ?? null,
    patch.readyAt || null,
    now,
    String(jobId)
  );
  return getAnimatedVideoJob(db, jobId);
}

function createAnimatedVideoJob(db, { userId, sourceFileId = null, title = "", lesson }) {
  const id = crypto.randomBytes(12).toString("hex");
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO animated_video_jobs (
      id,
      user_id,
      source_file_id,
      title,
      status,
      progress_message,
      lesson_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(userId),
    sourceFileId ? String(sourceFileId) : null,
    title || lesson?.title || "Animated lesson",
    "queued",
    "Queued for background rendering",
    JSON.stringify(lesson),
    now
  );
  return getAnimatedVideoJob(db, id);
}

function claimQueuedAnimatedVideoJobs(db, limit = 1) {
  const jobs = db
    .prepare(`
      SELECT *
      FROM animated_video_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit);

  const claim = db.prepare(`
    UPDATE animated_video_jobs
    SET status = 'rendering', progress_message = ?, updated_at = ?
    WHERE id = ? AND status = 'queued'
  `);

  return jobs
    .filter((job) =>
      claim.run("Preparing render worker", new Date().toISOString(), job.id).changes
    )
    .map((job) => getAnimatedVideoJob(db, job.id));
}

async function buildAnimatedLessonPackage({
  lesson,
  backendUrl,
  generateLessonSlideAudio,
}) {
  ensureAnimatedLessonDir();
  const scenes = [];
  let totalFrames = 0;

  for (const [index, slide] of (lesson?.slides || []).slice(0, MAX_SCENES).entries()) {
    const narration = normalizeText(slide?.narration);
    if (!narration) continue;

    const audio =
      slide?.audio_url
        ? { url: slide.audio_url }
        : await generateLessonSlideAudio({
            lessonTitle: lesson?.title || "animated-lesson",
            slideId: slide?.id || index + 1,
            text: narration,
            backendUrl,
          });

    const durationSeconds = estimateDurationSeconds(slide);
    const durationInFrames = Math.max(DEFAULT_FPS * 4, Math.round(durationSeconds * DEFAULT_FPS));
    totalFrames += durationInFrames;

    scenes.push({
      id: String(slide?.id || index + 1),
      order: index,
      type: slide?.type || "concept",
      heading: slide?.heading || slide?.term || lesson?.title || `Scene ${index + 1}`,
      subheading: slide?.subheading || slide?.definition || "",
      bullets: Array.isArray(slide?.bullets) ? slide.bullets.slice(0, MAX_BULLETS_PER_SCENE) : [],
      example: slide?.example || "",
      narration,
      captionGroups: splitNarrationIntoCaptions(narration),
      highlightWords: extractHighlightWords(`${slide?.heading || ""} ${narration}`),
      animationId: detectAnimationId(`${slide?.heading || ""} ${narration}`),
      durationSeconds,
      durationInFrames,
      audioUrl: audio.url,
    });
  }

  return {
    title: lesson?.title || "Animated lesson",
    subject: lesson?.subject || "Course lesson",
    estimated_minutes:
      lesson?.estimated_minutes || Math.max(1, Math.round(totalFrames / DEFAULT_FPS / 60)),
    fps: DEFAULT_FPS,
    compositionId: "AnimatedLessonVideo",
    totalFrames: totalFrames || DEFAULT_FPS * 8,
    scenes,
    renderStatus: "queued",
    style: "lottie_explainer",
  };
}

function startAnimatedVideoRenderProcess(jobId, backendUrl) {
  const child = fork(WORKER_SCRIPT, [String(jobId), String(backendUrl)], {
    cwd: path.join(__dirname, ".."),
    detached: true,
    stdio: "ignore",
    execArgv: ["--max-old-space-size=512"],
    env: { ...process.env },
  });
  child.unref();
  child.on("error", (err) => {
    console.error(`[animated-video] worker process error for job ${jobId}:`, err.message);
  });
  return child.pid;
}

async function processQueuedAnimatedVideoJobs({
  db,
  backendUrl,
  limit = 1,
}) {
  const jobs = claimQueuedAnimatedVideoJobs(db, limit);
  const results = [];

  for (const job of jobs) {
    try {
      // Guard: skip if somehow already terminal
      if (TERMINAL_STATUSES.has(job.status)) {
        results.push(job);
        continue;
      }
      const childPid = startAnimatedVideoRenderProcess(job.id, backendUrl);
      console.log(`[animated-video] spawned worker pid=${childPid} for job ${job.id}`);
      results.push(
        updateAnimatedVideoJob(db, job.id, {
          status: "rendering",
          progressMessage: "Render worker started",
          errorText: null,
        })
      );
    } catch (error) {
      console.error(`[animated-video] job ${job.id} spawn failed: ${error.message}`);
      results.push(
        updateAnimatedVideoJob(db, job.id, {
          status: "failed",
          progressMessage: "Animated video generation failed",
          errorText: error.message || "Animated video generation failed",
        })
      );
    }
  }

  return results;
}

// Recover jobs stuck in "rendering" or "encoding" for longer than 10 minutes
function recoverStaleAnimatedVideoJobs(db, staleMinutes = 10) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  const stale = db
    .prepare(`
      SELECT id FROM animated_video_jobs
      WHERE status IN ('rendering', 'encoding')
        AND updated_at < ?
    `)
    .all(cutoff);

  for (const row of stale) {
    updateAnimatedVideoJob(db, row.id, {
      status: "failed",
      progressMessage: "Worker timed out",
      errorText: `Job was stuck in rendering for more than ${staleMinutes} minutes and was marked failed`,
    });
    console.warn(`[animated-video] recovered stale job ${row.id}`);
  }
  return stale.length;
}

module.exports = {
  TERMINAL_STATUSES,
  buildAnimatedLessonPackage,
  createAnimatedVideoJob,
  detectAnimationId,
  formatMemoryUsage,
  getAnimatedVideoJob,
  updateAnimatedVideoJob,
  processQueuedAnimatedVideoJobs,
  recoverStaleAnimatedVideoJobs,
};
