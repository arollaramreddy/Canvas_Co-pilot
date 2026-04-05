const crypto = require("crypto");
const { registerMaterialItemsFromEvents } = require("./material-pipeline");
const GLOBAL_INBOX_SCOPE = "__global_inbox__";

function normalizeStateForSnapshot(state) {
  return {
    syncedAt: state.syncedAt,
    course: state.course,
    stats: state.stats,
    modules: (state.modules || []).map((module) => ({
      id: String(module.id),
      name: module.name,
      items: (module.items || []).map((item) => ({
        id: String(item.id),
        content_id: item.content_id ? String(item.content_id) : null,
        display_name: item.display_name,
        type: item.type,
        is_pdf: Boolean(item.is_pdf),
      })),
    })),
    assignments: (state.assignments || []).map((assignment) => ({
      id: assignment.id ? String(assignment.id) : null,
      name: assignment.name,
      due_at: assignment.due_at || null,
      points_possible: assignment.points_possible ?? null,
      score: assignment.score ?? null,
      grade: assignment.grade ?? null,
      missing: Boolean(assignment.missing),
      submitted_at: assignment.submitted_at || null,
      submission_status: assignment.submission_status || null,
    })),
    discussions: (state.discussions || []).map((discussion) => ({
      id: String(discussion.id),
      title: discussion.title,
      posted_at: discussion.posted_at || null,
      author_name: discussion.author_name || null,
      unread_count: discussion.unread_count ?? 0,
    })),
    announcements: (state.announcements || []).map((announcement) => ({
      id: String(announcement.id),
      title: announcement.title,
      posted_at: announcement.posted_at || null,
      author_name: announcement.author_name || null,
    })),
    messages: (state.messages || []).map((message) => ({
      id: String(message.id),
      subject: message.subject,
      last_message_at: message.last_message_at || null,
      message_count: message.message_count ?? 0,
      last_author_name: message.last_author_name || null,
      workflow_state: message.workflow_state || null,
    })),
  };
}

function indexBy(items, keyFn) {
  return new Map((items || []).map((item) => [keyFn(item), item]));
}

function normalizeInboxStateForSnapshot(state) {
  return {
    syncedAt: state.syncedAt,
    messages: (state.messages || []).map((message) => ({
      id: String(message.id),
      subject: message.subject,
      last_message_at: message.last_message_at || null,
      message_count: message.message_count ?? 0,
      last_author_name: message.last_author_name || null,
      workflow_state: message.workflow_state || null,
    })),
  };
}

function buildEvent({ eventType, courseId, entityType, entityId, title, detail, userId }) {
  return {
    id: null,
    userId: userId ? String(userId) : null,
    courseId: String(courseId),
    eventType,
    entityType,
    entityId: entityId ? String(entityId) : null,
    title,
    detail: detail || {},
  };
}

function diffStates(previousState, nextState, userId) {
  if (!previousState) {
    return [];
  }

  const events = [];
  const prevModules = indexBy(previousState.modules, (item) => String(item.id));
  const nextModules = indexBy(nextState.modules, (item) => String(item.id));

  for (const [moduleId, module] of nextModules.entries()) {
    if (!prevModules.has(moduleId)) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "new_module_posted",
          entityType: "module",
          entityId: moduleId,
          title: module.name,
          detail: { moduleName: module.name },
        })
      );
      continue;
    }

    const prevItems = indexBy(prevModules.get(moduleId).items, (item) => String(item.id));
    for (const item of module.items) {
      if (!prevItems.has(String(item.id))) {
        events.push(
          buildEvent({
            userId,
            courseId: nextState.course.id,
            eventType: "new_material_posted",
            entityType: item.type === "File" ? "file" : "module_item",
            entityId: item.content_id || item.id,
            title: item.display_name,
            detail: {
              moduleId,
              moduleName: module.name,
              itemType: item.type,
              isPdf: item.is_pdf,
              courseName: nextState.course.name,
            },
          })
        );
      }
    }
  }

  const prevAssignments = indexBy(previousState.assignments, (item) => String(item.id));
  for (const assignment of nextState.assignments || []) {
    const key = String(assignment.id);
    const previous = prevAssignments.get(key);
    if (!previous) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "assignment_posted",
          entityType: "assignment",
          entityId: key,
          title: assignment.name,
          detail: {
            dueAt: assignment.due_at,
            pointsPossible: assignment.points_possible,
          },
        })
      );
      continue;
    }

    const nextScore = assignment.score;
    const prevScore = previous.score;
    const scoreChanged =
      nextScore !== prevScore &&
      nextScore !== null &&
      nextScore !== undefined;

    if (scoreChanged) {
      const percent =
        assignment.points_possible && assignment.points_possible > 0
          ? Math.round((Number(nextScore) / Number(assignment.points_possible)) * 100)
          : null;
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "grade_released",
          entityType: "assignment",
          entityId: key,
          title: assignment.name,
          detail: {
            previousScore: prevScore,
            newScore: nextScore,
            percent,
            pointsPossible: assignment.points_possible,
            lowPerformance: percent !== null ? percent < 70 : false,
          },
        })
      );
    }

    if (!previous.missing && assignment.missing) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "assignment_marked_missing",
          entityType: "assignment",
          entityId: key,
          title: assignment.name,
          detail: {
            dueAt: assignment.due_at,
            pointsPossible: assignment.points_possible,
          },
        })
      );
    }
  }

  const prevDiscussions = indexBy(previousState.discussions, (item) => String(item.id));
  for (const discussion of nextState.discussions || []) {
    if (!prevDiscussions.has(String(discussion.id))) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "new_discussion_posted",
          entityType: "discussion",
          entityId: discussion.id,
          title: discussion.title,
          detail: {
            postedAt: discussion.posted_at,
            authorName: discussion.author_name,
            unreadCount: discussion.unread_count,
          },
        })
      );
    }
  }

  const prevAnnouncements = indexBy(previousState.announcements, (item) => String(item.id));
  for (const announcement of nextState.announcements || []) {
    if (!prevAnnouncements.has(String(announcement.id))) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "new_announcement_posted",
          entityType: "announcement",
          entityId: announcement.id,
          title: announcement.title,
          detail: {
            postedAt: announcement.posted_at,
            authorName: announcement.author_name,
          },
        })
      );
    }
  }

  const prevMessages = indexBy(previousState.messages, (item) => String(item.id));
  for (const message of nextState.messages || []) {
    const key = String(message.id);
    const previous = prevMessages.get(key);
    if (!previous) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "new_message_received",
          entityType: "message",
          entityId: key,
          title: message.subject,
          detail: {
            lastMessageAt: message.last_message_at,
            messageCount: message.message_count,
            authorName: message.last_author_name,
          },
        })
      );
      continue;
    }

    if ((message.message_count ?? 0) > (previous.message_count ?? 0)) {
      events.push(
        buildEvent({
          userId,
          courseId: nextState.course.id,
          eventType: "message_reply_received",
          entityType: "message",
          entityId: key,
          title: message.subject,
          detail: {
            lastMessageAt: message.last_message_at,
            previousCount: previous.message_count,
            newCount: message.message_count,
            authorName: message.last_author_name,
          },
        })
      );
    }
  }

  return events;
}

function getLatestSnapshot(db, userId, courseId) {
  const row = db
    .prepare(`
      SELECT id, snapshot_json, created_at
      FROM canvas_snapshots
      WHERE user_id = ? AND course_id = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(String(userId), String(courseId));

  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    snapshot: JSON.parse(row.snapshot_json),
  };
}

function saveSnapshot(db, userId, courseId, snapshotType, snapshot) {
  const result = db
    .prepare(`
      INSERT INTO canvas_snapshots (user_id, course_id, snapshot_type, snapshot_json)
      VALUES (?, ?, ?, ?)
    `)
    .run(String(userId), String(courseId), snapshotType, JSON.stringify(snapshot));
  return result.lastInsertRowid;
}

function diffInboxStates(previousState, nextState, userId) {
  if (!previousState) {
    return [];
  }

  const events = [];
  const prevMessages = indexBy(previousState.messages, (item) => String(item.id));
  for (const message of nextState.messages || []) {
    const key = String(message.id);
    const previous = prevMessages.get(key);
    if (!previous) {
      events.push(
        buildEvent({
          userId,
          courseId: GLOBAL_INBOX_SCOPE,
          eventType: "new_message_received",
          entityType: "message",
          entityId: key,
          title: message.subject,
          detail: {
            lastMessageAt: message.last_message_at,
            messageCount: message.message_count,
            authorName: message.last_author_name,
          },
        })
      );
      continue;
    }

    if ((message.message_count ?? 0) > (previous.message_count ?? 0)) {
      events.push(
        buildEvent({
          userId,
          courseId: GLOBAL_INBOX_SCOPE,
          eventType: "message_reply_received",
          entityType: "message",
          entityId: key,
          title: message.subject,
          detail: {
            lastMessageAt: message.last_message_at,
            previousCount: previous.message_count,
            newCount: message.message_count,
            authorName: message.last_author_name,
          },
        })
      );
    }
  }

  return events;
}

function saveEvents(db, events) {
  const insertEvent = db.prepare(`
    INSERT INTO canvas_events (user_id, course_id, event_type, entity_type, entity_id, title, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  return events.map((event) => {
    const result = insertEvent.run(
      event.userId,
      event.courseId,
      event.eventType,
      event.entityType,
      event.entityId,
      event.title || "",
      JSON.stringify(event.detail || {})
    );
    return {
      ...event,
      id: Number(result.lastInsertRowid),
    };
  });
}

function enqueueWorkflowJobs(db, events) {
  const insertJob = db.prepare(`
    INSERT INTO workflow_jobs
    (id, user_id, course_id, source_event_id, job_type, priority, status, payload_json, result_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const jobs = [];
  for (const event of events) {
    const mappings = [];
    if (event.eventType === "new_module_posted" || event.eventType === "new_material_posted") {
      mappings.push({ jobType: "material_ingestion", priority: "high" });
      mappings.push({ jobType: "study_plan_refresh", priority: "normal" });
      mappings.push({ jobType: "video_generation_candidate", priority: "normal" });
    }
    if (event.eventType === "new_discussion_posted") {
      mappings.push({ jobType: "discussion_digest", priority: "normal" });
    }
    if (event.eventType === "new_announcement_posted") {
      mappings.push({ jobType: "announcement_digest", priority: "high" });
      mappings.push({ jobType: "study_plan_refresh", priority: "normal" });
    }
    if (event.eventType === "assignment_posted") {
      mappings.push({ jobType: "assignment_planning", priority: "high" });
      mappings.push({ jobType: "study_plan_refresh", priority: "normal" });
    }
    if (event.eventType === "grade_released") {
      mappings.push({ jobType: "performance_review", priority: "high" });
      if (event.detail?.lowPerformance) {
        mappings.push({ jobType: "grade_recovery", priority: "urgent" });
        mappings.push({ jobType: "support_handoff", priority: "high" });
      }
    }
    if (event.eventType === "assignment_marked_missing") {
      mappings.push({ jobType: "assignment_rescue", priority: "urgent" });
    }
    if (event.eventType === "new_message_received" || event.eventType === "message_reply_received") {
      mappings.push({ jobType: "message_digest", priority: "normal" });
    }

    for (const mapping of mappings) {
      const job = {
        id: crypto.randomBytes(12).toString("hex"),
        userId: event.userId,
        courseId: event.courseId,
        sourceEventId: event.id,
        jobType: mapping.jobType,
        priority: mapping.priority,
        status: "queued",
        payload: {
          eventType: event.eventType,
          entityType: event.entityType,
          entityId: event.entityId,
          title: event.title,
          detail: event.detail,
        },
      };

      insertJob.run(
        job.id,
        job.userId,
        job.courseId,
        job.sourceEventId,
        job.jobType,
        job.priority,
        job.status,
        JSON.stringify(job.payload),
        null,
        new Date().toISOString()
      );
      jobs.push(job);
    }
  }

  return jobs;
}

function syncCanvasStateToEvents({ db, userId, courseId, state }) {
  const normalized = normalizeStateForSnapshot(state);
  const previous = getLatestSnapshot(db, userId, courseId);
  const detectedEvents = diffStates(previous?.snapshot || null, normalized, userId);
  const snapshotId = saveSnapshot(db, userId, courseId, "workspace_state", normalized);
  const savedEvents = saveEvents(db, detectedEvents);
  registerMaterialItemsFromEvents(db, savedEvents);
  const jobs = enqueueWorkflowJobs(db, savedEvents);

  return {
    snapshotId,
    previousSnapshotId: previous?.id || null,
    detectedEvents: savedEvents,
    queuedJobs: jobs,
  };
}

function syncInboxStateToEvents({ db, userId, state }) {
  const normalized = normalizeInboxStateForSnapshot(state);
  const previous = getLatestSnapshot(db, userId, GLOBAL_INBOX_SCOPE);
  const detectedEvents = diffInboxStates(previous?.snapshot || null, normalized, userId);
  const snapshotId = saveSnapshot(db, userId, GLOBAL_INBOX_SCOPE, "inbox_state", normalized);
  const savedEvents = saveEvents(db, detectedEvents);
  registerMaterialItemsFromEvents(db, savedEvents);
  const jobs = enqueueWorkflowJobs(db, savedEvents);

  return {
    snapshotId,
    previousSnapshotId: previous?.id || null,
    detectedEvents: savedEvents,
    queuedJobs: jobs,
  };
}

function listRecentEvents(db, userId, courseId = null, limit = 30) {
  if (courseId) {
    return db
      .prepare(`
        SELECT id, course_id, event_type, entity_type, entity_id, title, detail_json, status, created_at
        FROM canvas_events
        WHERE user_id = ? AND course_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(String(userId), String(courseId), limit)
      .map((row) => ({ ...row, detail: JSON.parse(row.detail_json || "{}") }));
  }

  return db
    .prepare(`
      SELECT id, course_id, event_type, entity_type, entity_id, title, detail_json, status, created_at
      FROM canvas_events
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(String(userId), limit)
    .map((row) => ({ ...row, detail: JSON.parse(row.detail_json || "{}") }));
}

function listWorkflowJobs(db, userId, courseId = null, limit = 30) {
  if (courseId) {
    return db
      .prepare(`
        SELECT id, source_event_id, job_type, priority, status, payload_json, result_json, created_at, updated_at
        FROM workflow_jobs
        WHERE user_id = ? AND course_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(String(userId), String(courseId), limit)
      .map((row) => ({
        ...row,
        payload: JSON.parse(row.payload_json || "{}"),
        result: row.result_json ? JSON.parse(row.result_json) : null,
      }));
  }

  return db
    .prepare(`
      SELECT id, source_event_id, job_type, priority, status, payload_json, result_json, created_at, updated_at
      FROM workflow_jobs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(String(userId), limit)
    .map((row) => ({
      ...row,
      payload: JSON.parse(row.payload_json || "{}"),
      result: row.result_json ? JSON.parse(row.result_json) : null,
    }));
}

module.exports = {
  GLOBAL_INBOX_SCOPE,
  listRecentEvents,
  listWorkflowJobs,
  syncCanvasStateToEvents,
  syncInboxStateToEvents,
};
