function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function getLatestSnapshot(db, userId, courseId) {
  const row = db
    .prepare(`
      SELECT snapshot_json, created_at
      FROM canvas_snapshots
      WHERE user_id = ? AND course_id = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(String(userId), String(courseId));

  if (!row) return null;
  return {
    createdAt: row.created_at,
    snapshot: parseJson(row.snapshot_json, {}),
  };
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

  return row
    ? {
        ...row,
        detail: parseJson(row.detail_json, {}),
      }
    : null;
}

function claimQueuedJobs(db, limit = 5) {
  const jobs = db
    .prepare(`
      SELECT id, user_id, course_id, source_event_id, job_type, priority, status, payload_json, created_at, updated_at
      FROM workflow_jobs
      WHERE status = 'queued'
        AND job_type NOT IN ('material_ingestion', 'video_generation_candidate')
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

  const claimed = [];
  for (const job of jobs) {
    const result = claim.run(new Date().toISOString(), job.id);
    if (result.changes) {
      claimed.push(job);
    }
  }
  return claimed;
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

function buildStudySessions(snapshot, intervention) {
  const assignments = (snapshot.assignments || [])
    .filter((assignment) => assignment.due_at)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 4);

  return assignments.map((assignment, index) => ({
    title: `Focus: ${assignment.name}`,
    duration_minutes: intervention.level === "critical" ? 50 : 35,
    order: index + 1,
    goal: `Prepare for ${assignment.name} before ${assignment.due_at}`,
  }));
}

function buildCuratedResources(intervention, event) {
  const resources = [];
  const primaryGap = intervention?.performance?.lowScores?.[0]?.name || intervention?.autonomousSupportNetwork?.proactiveGoals?.[0];
  if (primaryGap) {
    resources.push({
      title: `Rebuild ${primaryGap}`,
      reason: "This is where the student is currently losing performance.",
      format: "video",
    });
    resources.push({
      title: `Practice set for ${primaryGap}`,
      reason: "Targeted retrieval practice after the explanation.",
      format: "quiz",
    });
  }

  if (event?.event_type === "new_material_posted" || event?.event_type === "new_module_posted") {
    resources.push({
      title: event.title || "New material digest",
      reason: "Fresh professor-posted content should be summarized and converted into learning assets.",
      format: "summary",
    });
  }

  if (event?.event_type === "new_discussion_posted") {
    resources.push({
      title: event.title || "Discussion digest",
      reason: "The thread may contain hints, clarifications, or course logistics.",
      format: "discussion",
    });
  }

  return resources.slice(0, 4);
}

function createAgentResult({ job, snapshot, event, intervention, plan }) {
  const team = [];
  const handoffs = [];

  const handoff = (from, to, reason) => {
    handoffs.push({ from, to, reason });
  };

  if (job.job_type === "grade_recovery" || job.job_type === "performance_review") {
    team.push({
      agent: "Performance Watcher",
      output: "Scored the student performance and detected weak assessments.",
    });
    team.push({
      agent: "Recovery Planner",
      output: "Created a rebound sequence for the weakest graded work.",
    });
    team.push({
      agent: "Concept Rebuilder",
      output: "Prepared concept repair targets based on gaps and low marks.",
    });
    team.push({
      agent: "Resource Curator",
      output: "Prepared targeted support resources and next-study outputs.",
    });
    handoff("Performance Watcher", "Recovery Planner", "Low-score signal detected");
    handoff("Recovery Planner", "Concept Rebuilder", "Student needs concept repair");
    handoff("Concept Rebuilder", "Resource Curator", "Student needs better learning material");
  } else if (job.job_type === "material_ingestion" || job.job_type === "video_generation_candidate") {
    team.push({
      agent: "State Watcher",
      output: "Detected new course material from Canvas.",
    });
    team.push({
      agent: "Material Ingestion Agent",
      output: "Prepared the material for study outputs.",
    });
    team.push({
      agent: "Study Plan Agent",
      output: "Created short study blocks around the new material.",
    });
    team.push({
      agent: "Video Tutor",
      output: "Flagged a visual lesson candidate for the new material.",
    });
    handoff("State Watcher", "Material Ingestion Agent", "New module or file posted");
    handoff("Material Ingestion Agent", "Study Plan Agent", "Material ready for adaptation");
    handoff("Study Plan Agent", "Video Tutor", "Student may benefit from guided visual learning");
  } else if (job.job_type === "discussion_digest") {
    team.push({
      agent: "State Watcher",
      output: "Detected a new discussion thread.",
    });
    team.push({
      agent: "Discussion Analyst",
      output: "Prepared a digest of why the discussion matters.",
    });
    handoff("State Watcher", "Discussion Analyst", "New discussion posted");
  } else if (job.job_type === "announcement_digest") {
    team.push({
      agent: "State Watcher",
      output: "Detected a new announcement from the course stream.",
    });
    team.push({
      agent: "Announcement Analyst",
      output: "Prepared a short digest and classified whether it changes study priorities.",
    });
    team.push({
      agent: "Study Plan Agent",
      output: "Adjusted the study plan if the announcement changed expectations or schedule.",
    });
    handoff("State Watcher", "Announcement Analyst", "New announcement posted");
    handoff("Announcement Analyst", "Study Plan Agent", "Announcement may affect what the student should do next");
  } else if (job.job_type === "assignment_planning") {
    team.push({
      agent: "State Watcher",
      output: "Detected a newly posted assignment.",
    });
    team.push({
      agent: "Assignment Planner",
      output: "Prepared a first-pass plan and deadlines for the new assignment.",
    });
    team.push({
      agent: "Study Plan Agent",
      output: "Inserted the new assignment into the student study rhythm.",
    });
    handoff("State Watcher", "Assignment Planner", "New assignment posted");
    handoff("Assignment Planner", "Study Plan Agent", "Assignment should shape the next study sessions");
  } else if (job.job_type === "message_digest") {
    team.push({
      agent: "Inbox Watcher",
      output: "Detected a new inbox message or thread reply.",
    });
    team.push({
      agent: "Message Analyst",
      output: "Prepared a digest of the message and whether it needs action.",
    });
    handoff("Inbox Watcher", "Message Analyst", "New message or reply received");
  } else if (job.job_type === "assignment_rescue") {
    team.push({
      agent: "Deadline Guardian",
      output: "Flagged missing work.",
    });
    team.push({
      agent: "Recovery Planner",
      output: "Prepared a rescue checklist and priority path.",
    });
    handoff("Deadline Guardian", "Recovery Planner", "Missing submission detected");
  } else {
    team.push({
      agent: "Study Plan Agent",
      output: "Prepared an updated study rhythm from the latest course state.",
    });
  }

  return {
    jobType: job.job_type,
    priority: job.priority,
    course: snapshot?.course || null,
    trigger: event
      ? {
          type: event.event_type,
          title: event.title,
          entityType: event.entity_type,
          entityId: event.entity_id,
        }
      : job.payload || null,
    activeAgents: team,
    handoffs,
    intervention,
    supportNetwork: intervention?.autonomousSupportNetwork || null,
    outputs: {
      study_plan: {
        horizon: job.job_type === "grade_recovery" ? "7 days" : "3 days",
        sessions: buildStudySessions(snapshot || {}, intervention || { level: "stable" }),
      },
      curated_flashcards: (intervention?.performance?.lowScores || [])
        .slice(0, 4)
        .map((item) => ({
          front: `What went wrong in ${item.name}?`,
          back: `Review the concepts behind this ${item.percent}% score and rebuild the weak steps.`,
        })),
      adaptive_quiz: buildCuratedResources(intervention, event).map((resource, index) => ({
        question: `Checkpoint ${index + 1}: explain the key idea behind ${resource.title}`,
        answer: resource.reason,
        difficulty: index === 0 ? "easy" : "medium",
      })),
      curated_resources: buildCuratedResources(intervention, event),
      video_recommendation: {
        should_generate: Boolean(
          job.job_type === "grade_recovery" ||
            job.job_type === "video_generation_candidate" ||
            event?.event_type === "new_material_posted"
        ),
        reason:
          job.job_type === "grade_recovery"
            ? "Weak performance detected, so a visual explanation should help rebuild the concept."
            : "New material was detected and can be turned into a guided lesson.",
      },
    },
    timestamps: {
      processedAt: new Date().toISOString(),
      sourceSnapshotAt: snapshot?.syncedAt || null,
    },
  };
}

function runAgentJob({ db, job, computeInterventionScore, generateAutonomousReviewPlan, persistAutonomousReviewPlan }) {
  const snapshotRecord = getLatestSnapshot(db, job.user_id, job.course_id);
  const snapshot = snapshotRecord?.snapshot || {};
  const event = getEventRecord(db, job.source_event_id);
  const intervention = computeInterventionScore({
    db,
    userId: job.user_id,
    courseId: job.course_id,
    canvasState: snapshot,
  });
  const plan = generateAutonomousReviewPlan({
    db,
    userId: job.user_id,
    courseId: job.course_id,
    canvasState: snapshot,
    intervention,
  });

  if (["grade_recovery", "assignment_rescue", "performance_review", "support_handoff"].includes(job.job_type)) {
    persistAutonomousReviewPlan({
      db,
      userId: job.user_id,
      courseId: job.course_id,
      reviewSessions: plan.reviewSessions,
      autonomousActions: plan.autonomousActions,
    });
  }

  return createAgentResult({
    job,
    snapshot,
    event,
    intervention,
    plan,
  });
}

function processQueuedAgentJobs({ db, computeInterventionScore, generateAutonomousReviewPlan, persistAutonomousReviewPlan, limit = 5 }) {
  const jobs = claimQueuedJobs(db, limit);
  const processed = [];

  for (const job of jobs) {
    try {
      const result = runAgentJob({
        db,
        job,
        computeInterventionScore,
        generateAutonomousReviewPlan,
        persistAutonomousReviewPlan,
      });
      completeJob(db, job.id, result);
      processed.push({ id: job.id, status: "completed", result });
    } catch (error) {
      failJob(db, job.id, error);
      processed.push({ id: job.id, status: "failed", error: error.message });
    }
  }

  return processed;
}

module.exports = {
  processQueuedAgentJobs,
};
