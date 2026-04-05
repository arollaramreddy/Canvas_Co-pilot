/**
 * Worker process: builds an animated lesson package (TTS audio for each scene)
 * and marks the job as ready. The frontend AnimatedLessonPlayer renders the
 * lesson using Lottie + audio — no Remotion/video encoding needed.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { withDatabaseRetry } = require("../lib/db");
const { generateLessonSlideAudio } = require("../lib/lesson-audio");
const {
  buildAnimatedLessonPackage,
  formatMemoryUsage,
  getAnimatedVideoJob,
  updateAnimatedVideoJob,
} = require("../lib/animated-lesson");

const [, , jobId, backendUrl] = process.argv;

function readJob() {
  return withDatabaseRetry((db) => getAnimatedVideoJob(db, jobId));
}

function patchJob(patch) {
  return withDatabaseRetry((db) => updateAnimatedVideoJob(db, jobId, patch));
}

function failJob(error) {
  if (!jobId) return;
  try {
    patchJob({
      status: "failed",
      progressMessage: "Animated video generation failed",
      errorText: String(error?.message || error).slice(0, 2000),
    });
  } catch (updateError) {
    console.error("[animated-video-worker] failed to persist error", updateError);
  }
}

process.on("uncaughtException", (error) => {
  console.error("[animated-video-worker] uncaughtException", error);
  failJob(error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("[animated-video-worker] unhandledRejection", error);
  failJob(error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});

async function main() {
  if (!jobId || !backendUrl) {
    throw new Error("jobId and backendUrl are required");
  }

  const job = readJob();
  if (!job) {
    throw new Error(`Animated video job ${jobId} was not found`);
  }

  // Guard: do not re-process terminal jobs
  if (job.status === "ready" || job.status === "failed") {
    console.log(`[animated-video-worker] job ${jobId} already ${job.status}, skipping`);
    return;
  }

  const lesson = job.lesson;
  if (!lesson || !Array.isArray(lesson.slides) || !lesson.slides.length) {
    throw new Error("Animated video job is missing lesson slides");
  }

  console.log(`[animated-video-worker] start job ${jobId}`, formatMemoryUsage());

  // ── Stage 1: Build lesson package (TTS audio for each scene) ──
  patchJob({
    status: "rendering",
    progressMessage: "Generating narration audio",
    errorText: null,
  });
  console.log(`[animated-video-worker] TTS started for job ${jobId}`);

  let lessonPackage;
  try {
    lessonPackage = await buildAnimatedLessonPackage({
      lesson,
      backendUrl,
      generateLessonSlideAudio,
    });
  } catch (ttsError) {
    throw new Error(`TTS/package build failed: ${ttsError.message}`);
  }

  console.log(`[animated-video-worker] TTS complete, ${lessonPackage.scenes.length} scenes`);

  // ── Stage 2: Mark ready (no Remotion render needed) ───────────
  // The AnimatedLessonPlayer renders scenes client-side using Lottie + audio.
  try {
    const readyPackage = {
      ...lessonPackage,
      renderStatus: "ready",
    };

    const readyResult = patchJob({
      status: "ready",
      progressMessage: "Animated lesson is ready",
      lessonPackageJson: JSON.stringify(readyPackage),
      videoUrl: null,
      videoFileName: null,
      errorText: null,
      readyAt: new Date().toISOString(),
    });

    console.log(
      `[animated-video-worker] job completed ${jobId}: ${readyResult?.status || "unknown"}`
    );
  } catch (error) {
    console.error(
      `[animated-video-worker] final DB update failed for job ${jobId}`,
      error,
      formatMemoryUsage()
    );
    throw new Error(`Final save failed: ${error.message}`);
  }

  console.log(`[animated-video-worker] finished job ${jobId}`, formatMemoryUsage());
}

(async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error("[animated-video-worker] fatal error", error);
    failJob(error);
    process.exit(1);
  }
})();
