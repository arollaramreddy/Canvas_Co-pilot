const crypto = require("crypto");
const { parseJsonResponse } = require("./json-response");

const MATERIAL_JOB_TYPES = new Set(["material_ingestion", "video_generation_candidate"]);

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function cleanExtractedText(rawText) {
  const lines = String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const counts = new Map();
  for (const line of lines) {
    counts.set(line, (counts.get(line) || 0) + 1);
  }

  const filtered = [];
  let previous = "";

  for (const line of lines) {
    const lower = line.toLowerCase();
    const repeatedOften = (counts.get(line) || 0) > 3 && line.length < 120;
    const isPageNoise =
      /^page\s+\d+(\s+of\s+\d+)?$/i.test(line) ||
      /^\d+\s*$/.test(line) ||
      /^chapter\s+\d+$/i.test(line) ||
      /^figure\s+\d+([.:]\d+)?$/i.test(line);
    const isCopyrightNoise =
      /copyright|all rights reserved|isbn|printed in|publisher|elsevier|pearson|mcgraw[- ]hill|wiley|thomson/i.test(
        lower
      );

    if (repeatedOften || isPageNoise || isCopyrightNoise) {
      continue;
    }

    if (line === previous) continue;
    filtered.push(line);
    previous = line;
  }

  return filtered.join("\n");
}

function buildNarrationScript(lesson) {
  return (lesson?.slides || [])
    .map((slide, index) => {
      const label = slide.heading || slide.term || `Slide ${index + 1}`;
      return `${label}: ${slide.narration || ""}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function deriveSummaryPreview(summary) {
  return String(summary || "")
    .replace(/[#*_`>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function getEventRecord(db, eventId) {
  if (!eventId) return null;
  const row = db
    .prepare(`
      SELECT id, event_type, entity_type, entity_id, title, detail_json, created_at
      FROM canvas_events
      WHERE id = ?
    `)
    .get(Number(eventId));

  return row ? { ...row, detail: parseJson(row.detail_json, {}) } : null;
}

function getPipelineItemByEntity(db, userId, courseId, materialEntityId) {
  return (
    db
      .prepare(`
        SELECT *
        FROM material_pipeline_items
        WHERE user_id = ? AND course_id = ? AND material_entity_id = ?
        LIMIT 1
      `)
      .get(String(userId), String(courseId), String(materialEntityId)) || null
  );
}

function getPipelineItemById(db, itemId) {
  return db.prepare(`SELECT * FROM material_pipeline_items WHERE id = ? LIMIT 1`).get(String(itemId)) || null;
}

function upsertPipelineItem(db, values) {
  const now = new Date().toISOString();
  const existing = getPipelineItemByEntity(db, values.userId, values.courseId, values.materialEntityId);

  if (existing) {
    db.prepare(`
      UPDATE material_pipeline_items
      SET
        source_event_id = COALESCE(?, source_event_id),
        course_name = COALESCE(?, course_name),
        module_id = COALESCE(?, module_id),
        module_name = COALESCE(?, module_name),
        material_title = COALESCE(?, material_title),
        status = COALESCE(?, status),
        error_text = COALESCE(?, error_text),
        updated_at = ?
      WHERE id = ?
    `).run(
      values.sourceEventId || null,
      values.courseName || null,
      values.moduleId || null,
      values.moduleName || null,
      values.materialTitle || null,
      values.status || null,
      values.errorText || null,
      now,
      existing.id
    );
    return getPipelineItemById(db, existing.id);
  }

  const id = crypto.randomBytes(12).toString("hex");
  db.prepare(`
    INSERT INTO material_pipeline_items (
      id,
      user_id,
      course_id,
      source_event_id,
      material_entity_id,
      course_name,
      module_id,
      module_name,
      material_title,
      status,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(values.userId),
    String(values.courseId),
    values.sourceEventId || null,
    String(values.materialEntityId),
    values.courseName || "",
    values.moduleId || null,
    values.moduleName || "",
    values.materialTitle || "",
    values.status || "new",
    now
  );
  return getPipelineItemById(db, id);
}

function updatePipelineItem(db, itemId, patch) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE material_pipeline_items
    SET
      status = COALESCE(?, status),
      summary_preview = COALESCE(?, summary_preview),
      summary_markdown = COALESCE(?, summary_markdown),
      cleaned_text = COALESCE(?, cleaned_text),
      narration_script = COALESCE(?, narration_script),
      lesson_json = COALESCE(?, lesson_json),
      audio_manifest_json = COALESCE(?, audio_manifest_json),
      video_payload_json = COALESCE(?, video_payload_json),
      error_text = ?,
      ready_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.status || null,
    patch.summaryPreview || null,
    patch.summaryMarkdown || null,
    patch.cleanedText || null,
    patch.narrationScript || null,
    patch.lessonJson || null,
    patch.audioManifestJson || null,
    patch.videoPayloadJson || null,
    patch.errorText ?? null,
    patch.readyAt || null,
    now,
    itemId
  );
  return getPipelineItemById(db, itemId);
}

function claimQueuedMaterialJobs(db, limit = 2) {
  const jobs = db
    .prepare(`
      SELECT id, user_id, course_id, source_event_id, job_type, priority, status, payload_json, created_at, updated_at
      FROM workflow_jobs
      WHERE status = 'queued'
        AND job_type IN ('material_ingestion', 'video_generation_candidate')
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          ELSE 3
        END,
        created_at ASC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => ({
      ...row,
      payload: parseJson(row.payload_json, {}),
    }));

  const claim = db.prepare(`
    UPDATE workflow_jobs
    SET status = 'running', updated_at = ?
    WHERE id = ? AND status = 'queued'
  `);

  return jobs.filter((job) => claim.run(new Date().toISOString(), job.id).changes);
}

function completeJob(db, jobId, result) {
  db.prepare(`
    UPDATE workflow_jobs
    SET status = 'completed', result_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(result), new Date().toISOString(), jobId);
}

function failJob(db, jobId, error) {
  db.prepare(`
    UPDATE workflow_jobs
    SET status = 'failed', result_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify({ error: error.message || String(error) }), new Date().toISOString(), jobId);
}

function registerMaterialItemsFromEvents(db, events) {
  const created = [];
  for (const event of events || []) {
    if (event.eventType !== "new_material_posted") continue;
    if (!event.detail?.isPdf) continue;
    const item = upsertPipelineItem(db, {
      userId: event.userId,
      courseId: event.courseId,
      sourceEventId: event.id,
      materialEntityId: event.entityId,
      courseName: event.detail?.courseName || `Course ${event.courseId}`,
      moduleId: event.detail?.moduleId || null,
      moduleName: event.detail?.moduleName || "Module",
      materialTitle: event.title || "New material",
      status: "new",
      errorText: null,
    });
    created.push(item);
  }
  return created;
}

function buildSummaryPrompt({ courseName, moduleName, materialTitle, cleanedText }) {
  return `You are preparing a polished dashboard summary for a student.
Return ONLY valid JSON:
{
  "preview": "1 short sentence under 160 characters",
  "summary_markdown": "clean markdown summary"
}

Rules:
- Never include OCR garbage, page numbers, copyright notices, repeated headers, or textbook boilerplate.
- Write a clean student-facing summary.
- Use this markdown structure:
## Summary
2-4 concise sentences

## Key Points
- point
- point
- point

## Why It Matters
2-3 concise sentences

Course: ${courseName}
Module: ${moduleName}
Material: ${materialTitle}

Content:
${cleanedText.slice(0, 22000)}`;
}

function buildLessonPrompt({ courseName, moduleName, materialTitle, cleanedText }) {
  return `You are an expert teaching agent creating a polished narrated lesson package for a dashboard.
Return ONLY valid JSON:
{
  "title": "concise lesson title",
  "subject": "subject area in 3-5 words",
  "estimated_minutes": 6,
  "slides": [
    {
      "id": 1,
      "type": "title",
      "heading": "Lesson title",
      "subheading": "What this material covers",
      "narration": "Natural spoken intro",
      "duration_seconds": 8
    },
    {
      "id": 2,
      "type": "concept",
      "heading": "Important idea",
      "bullets": ["short bullet", "short bullet", "short bullet"],
      "narration": "Natural teaching explanation",
      "duration_seconds": 20
    },
    {
      "id": 999,
      "type": "summary",
      "heading": "Key takeaways",
      "bullets": ["short bullet", "short bullet", "short bullet", "short bullet"],
      "narration": "Natural wrap-up",
      "duration_seconds": 14
    }
  ]
}

Rules:
- 8 to 12 slides total.
- First slide must be title. Last slide must be summary.
- Keep bullets short and clean.
- Narration must sound like a teacher, not copied text.
- Do not include OCR fragments, copyright lines, page numbers, or textbook boilerplate.
- The lesson should feel polished enough to watch directly from a dashboard.

Course: ${courseName}
Module: ${moduleName}
Material: ${materialTitle}

Content:
${cleanedText.slice(0, 22000)}`;
}

async function processMaterialJob({
  db,
  job,
  resolveAccessTokenForUser,
  canvasRequest,
  downloadCanvasFile,
  createOpenAIResponse,
  extractResponseText,
  generateLessonSlideAudio,
  backendUrl,
  repairJson,
}) {
  const event = getEventRecord(db, job.source_event_id);
  const detail = event?.detail || job.payload?.detail || {};
  const isPdf = Boolean(detail.isPdf);
  const materialEntityId = event?.entity_id || job.payload?.entityId || null;
  if (!materialEntityId || !isPdf) {
    return {
      skipped: true,
      reason: "Job does not target a PDF material item",
      eventType: event?.event_type || job.payload?.eventType || null,
    };
  }

  const pipelineItem = upsertPipelineItem(db, {
    userId: job.user_id,
    courseId: job.course_id,
    sourceEventId: job.source_event_id,
    materialEntityId,
    courseName: detail.courseName || `Course ${job.course_id}`,
    moduleId: detail.moduleId || null,
    moduleName: detail.moduleName || "Module",
    materialTitle: event?.title || job.payload?.title || "New material",
    status: "processing",
    errorText: null,
  });

  if (pipelineItem.status === "ready" && job.job_type === "video_generation_candidate") {
    return {
      skipped: true,
      reason: "Material already processed",
      pipelineItemId: pipelineItem.id,
    };
  }

  const accessToken = resolveAccessTokenForUser(job.user_id);
  if (!accessToken) {
    throw new Error("No active Canvas session token found for material pipeline");
  }

  const file = await canvasRequest(`/courses/${job.course_id}/files/${materialEntityId}`, accessToken);
  if (!file?.url) {
    throw new Error("Material file has no download URL");
  }

  const buffer = await downloadCanvasFile(file.url, accessToken);
  const pdfData = await require("pdf-parse")(buffer);
  const rawText = pdfData.text || "";
  const cleanedText = cleanExtractedText(rawText);

  if (!cleanedText.trim()) {
    throw new Error("Extracted PDF text was empty after cleaning");
  }

  const summaryResponse = await createOpenAIResponse({
    model: process.env.OPENAI_MODEL_SUMMARY || "gpt-4.1-mini",
    input: buildSummaryPrompt({
      courseName: pipelineItem.course_name,
      moduleName: pipelineItem.module_name,
      materialTitle: pipelineItem.material_title,
      cleanedText,
    }),
  });
  const summaryPayload = await parseJsonResponse(extractResponseText(summaryResponse) || "", {
    label: "Summary JSON",
    repair: repairJson,
  });
  const summaryMarkdown = summaryPayload.summary_markdown || "## Summary\nNo summary generated.";
  const summaryPreview = summaryPayload.preview || deriveSummaryPreview(summaryMarkdown);

  const lessonResponse = await createOpenAIResponse({
    model: process.env.OPENAI_MODEL_LESSON || "gpt-4.1",
    input: buildLessonPrompt({
      courseName: pipelineItem.course_name,
      moduleName: pipelineItem.module_name,
      materialTitle: pipelineItem.material_title,
      cleanedText,
    }),
  });
  const lessonPayload = await parseJsonResponse(extractResponseText(lessonResponse) || "", {
    label: "Material lesson JSON",
    repair: repairJson,
  });
  if (!Array.isArray(lessonPayload.slides) || !lessonPayload.slides.length) {
    throw new Error("Generated lesson payload did not contain slides");
  }

  const narrationScript = buildNarrationScript(lessonPayload);
  const audioManifest = {};
  const lessonWithAudio = {
    ...lessonPayload,
    slides: [],
  };

  for (const slide of lessonPayload.slides) {
    const audio = await generateLessonSlideAudio({
      lessonTitle: lessonPayload.title || pipelineItem.material_title,
      slideId: slide.id,
      text: slide.narration || "",
      backendUrl,
    });
    audioManifest[String(slide.id)] = audio.url;
    lessonWithAudio.slides.push({
      ...slide,
      audio_url: audio.url,
    });
  }

  const videoPayload = {
    type: "narrated_lesson_package",
    title: lessonWithAudio.title,
    subject: lessonWithAudio.subject,
    estimated_minutes: lessonWithAudio.estimated_minutes,
    slide_count: lessonWithAudio.slides.length,
    watchMode: "dashboard_inline_player",
  };

  updatePipelineItem(db, pipelineItem.id, {
    status: "ready",
    summaryPreview,
    summaryMarkdown,
    cleanedText,
    narrationScript,
    lessonJson: JSON.stringify(lessonWithAudio),
    audioManifestJson: JSON.stringify(audioManifest),
    videoPayloadJson: JSON.stringify(videoPayload),
    errorText: null,
    readyAt: new Date().toISOString(),
  });

  return {
    pipelineItemId: pipelineItem.id,
    status: "ready",
    summaryPreview,
    slideCount: lessonWithAudio.slides.length,
    audioSlides: Object.keys(audioManifest).length,
  };
}

function processQueuedMaterialJobs({
  db,
  resolveAccessTokenForUser,
  canvasRequest,
  downloadCanvasFile,
  createOpenAIResponse,
  extractResponseText,
  generateLessonSlideAudio,
  backendUrl,
  repairJson,
  limit = 2,
}) {
  const jobs = claimQueuedMaterialJobs(db, limit);
  const processed = [];

  return jobs.reduce(async (previousPromise, job) => {
    await previousPromise;
    try {
      const result = await processMaterialJob({
        db,
        job,
        resolveAccessTokenForUser,
        canvasRequest,
        downloadCanvasFile,
        createOpenAIResponse,
        extractResponseText,
        generateLessonSlideAudio,
        backendUrl,
        repairJson,
      });
      completeJob(db, job.id, result);
      processed.push({ id: job.id, status: "completed", result });
    } catch (error) {
      const event = getEventRecord(db, job.source_event_id);
      const materialEntityId = event?.entity_id || job.payload?.entityId || null;
      const item = materialEntityId
        ? getPipelineItemByEntity(db, job.user_id, job.course_id, materialEntityId)
        : null;
      if (item) {
        updatePipelineItem(db, item.id, {
          status: "failed",
          errorText: error.message,
        });
      }
      failJob(db, job.id, error);
      processed.push({ id: job.id, status: "failed", error: error.message });
    }
    return processed;
  }, Promise.resolve([]));
}

function listMaterialPipelineItems(db, userId, limit = 30) {
  return db
    .prepare(`
      SELECT *
      FROM material_pipeline_items
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(String(userId), Number(limit) || 30)
    .map((row) => ({
      id: row.id,
      courseId: row.course_id,
      courseName: row.course_name,
      moduleId: row.module_id,
      moduleName: row.module_name,
      materialEntityId: row.material_entity_id,
      materialTitle: row.material_title,
      status: row.status,
      summaryPreview: row.summary_preview || "",
      summaryMarkdown: row.summary_markdown || "",
      narrationScript: row.narration_script || "",
      lesson: parseJson(row.lesson_json, null),
      audioManifest: parseJson(row.audio_manifest_json, {}),
      videoPayload: parseJson(row.video_payload_json, null),
      error: row.error_text || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      readyAt: row.ready_at || null,
    }));
}

module.exports = {
  MATERIAL_JOB_TYPES,
  listMaterialPipelineItems,
  processQueuedMaterialJobs,
  registerMaterialItemsFromEvents,
};
