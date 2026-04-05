function normalizeText(value) {
  return String(value || "").trim();
}

function getReplyPreferences(preferences = {}) {
  const reply = preferences.reply || {};
  return {
    length: reply.length || "short",
    tone: reply.tone || "supportive",
    interactivity: reply.interactivity || "balanced",
    emoji: Boolean(reply.emoji),
    includeNextSteps: reply.includeNextSteps !== false,
    includeCourseContext: reply.includeCourseContext !== false,
    signoffStyle: reply.signoffStyle || "simple",
  };
}

function getCourseFacts(runtimeState, courseId = null) {
  const assignments = runtimeState?.canvas?.normalizedWorkspace?.assignments || [];
  const selectedAssignments = courseId
    ? assignments.filter((assignment) => String(assignment.course_id) === String(courseId))
    : assignments;

  const gradedAssignments = selectedAssignments
    .filter((assignment) => assignment.score !== null && assignment.score !== undefined)
    .map((assignment) => ({
      id: assignment.id,
      name: assignment.name,
      course_id: assignment.course_id,
      course_name: assignment.course_name,
      score: assignment.score,
      points_possible: assignment.points_possible,
      percent:
        assignment.points_possible && Number(assignment.points_possible) > 0
          ? Math.round((Number(assignment.score) / Number(assignment.points_possible)) * 100)
          : null,
    }));

  return {
    gradedAssignments: gradedAssignments.slice(0, 12),
    upcomingAssignments: selectedAssignments
      .filter((assignment) => assignment.due_at && !assignment.is_completed)
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
      .slice(0, 8)
      .map((assignment) => ({
        id: assignment.id,
        name: assignment.name,
        course_id: assignment.course_id,
        course_name: assignment.course_name,
        due_at: assignment.due_at,
      })),
  };
}

function classifyMessageIntent(message, runtimeState) {
  const subject = normalizeText(message?.subject).toLowerCase();
  const body = normalizeText(message?.last_message).toLowerCase();
  const text = `${subject}\n${body}`;
  const courseNames = (runtimeState?.canvas?.normalizedWorkspace?.courses || [])
    .map((course) => String(course.name || "").toLowerCase())
    .filter(Boolean);

  const isCourseRelated =
    /(grade|score|assignment|homework|quiz|exam|module|discussion|course|canvas|deadline|points)/.test(
      text
    ) || courseNames.some((courseName) => text.includes(courseName));

  const needsReply = /(can you|could you|please|what|when|where|why|how|\?)/.test(text);
  const asksForGrade = /(grade|score|points|mark)/.test(text);
  const asksForAssignment = /(assignment|homework|quiz|exam|due)/.test(text);

  return {
    isCourseRelated,
    needsReply,
    asksForGrade,
    asksForAssignment,
  };
}

function buildReplyDraftPrompt({ message, runtimeState, preferences = {} }) {
  const replyPreferences = getReplyPreferences(preferences);
  const intent = classifyMessageIntent(message, runtimeState);
  const courseFacts = getCourseFacts(runtimeState);

  return `You are an autonomous Canvas copilot drafting a reply for a student inbox message.

Return ONLY valid JSON:
{
  "summary": "one sentence",
  "classification": {
    "isCourseRelated": true,
    "needsReply": true,
    "asksForGrade": false,
    "asksForAssignment": false
  },
  "draft": "ready-to-send reply text",
  "whyThisReply": ["short reason", "short reason"],
  "usedState": ["what state was used", "what state was used"]
}

Reply preferences:
${JSON.stringify(replyPreferences, null, 2)}

Message:
${JSON.stringify(
    {
      id: message?.id || null,
      subject: message?.subject || "",
      last_author_name: message?.last_author_name || "",
      last_message: message?.last_message || "",
      last_message_at: message?.last_message_at || null,
    },
    null,
    2
  )}

Intent signals:
${JSON.stringify(intent, null, 2)}

Relevant Canvas state:
${JSON.stringify(courseFacts, null, 2)}

Rules:
- Draft in first person as the student.
- If the message is course-related, use the Canvas state when helpful.
- If no exact fact is available, avoid inventing details.
- Match the reply preferences closely.
- Keep the message natural, human, and ready to send.`;
}

function buildAutonomousInboxFeed(runtimeState, preferences = {}) {
  const messages = runtimeState?.canvas?.inboxState?.messages || [];
  const replyPreferences = getReplyPreferences(preferences);

  return messages.slice(0, 8).map((message) => {
    const intent = classifyMessageIntent(message, runtimeState);
    return {
      id: message.id,
      type: "message",
      title: message.subject || "Message",
      subtitle: message.last_author_name || "Inbox",
      createdAt: message.last_message_at || runtimeState?.meta?.generatedAt || null,
      priority:
        intent.asksForGrade || intent.asksForAssignment
          ? "high"
          : intent.needsReply
            ? "normal"
            : "low",
      status: intent.needsReply ? "draft_ready" : "watching",
      actions: [
        "Review draft",
        "Edit reply",
        "Send",
      ],
      intent,
      replyPreferences,
    };
  });
}

module.exports = {
  buildAutonomousInboxFeed,
  buildReplyDraftPrompt,
  classifyMessageIntent,
  getCourseFacts,
  getReplyPreferences,
};
