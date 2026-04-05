function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .trim();
}

function normalizeCompact(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function deriveMessageCourseContext(message, runtimeState) {
  const courses = runtimeState?.canvas?.normalizedWorkspace?.courses || [];
  const assignments = runtimeState?.canvas?.normalizedWorkspace?.assignments || [];
  const normalizedMessage = normalizeName(
    `${message?.subject || ""}\n${message?.last_message || ""}`
  );
  const directCourseId = message?.course_id ? String(message.course_id) : "";
  if (directCourseId) {
    const directCourse = courses.find((course) => String(course.id) === directCourseId);
    if (directCourse) {
      return directCourse;
    }
  }

  const contextHints = [
    normalizeName(message?.context_name || ""),
    normalizeName(message?.context_code || ""),
  ].filter(Boolean);

  if (contextHints.length) {
    const contextMatches = courses.filter((course) => {
      const name = normalizeName(course.name || "");
      const code = normalizeName(course.code || "");
      return contextHints.some((hint) => hint === name || hint === code || (name && hint.includes(name)) || (code && hint.includes(code)));
    });

    if (contextMatches.length === 1) {
      return contextMatches[0];
    }
  }

  const explicitCourseMatches = courses.filter((course) => {
    const name = normalizeName(course.name || "");
    const code = normalizeName(course.code || "");
    return (name && normalizedMessage.includes(name)) || (code && normalizedMessage.includes(code));
  });

  if (explicitCourseMatches.length === 1) {
    return explicitCourseMatches[0];
  }

  const assignmentMatches = assignments.filter((assignment) => {
    const assignmentName = normalizeName(assignment.name || "");
    return assignmentName && normalizedMessage.includes(assignmentName);
  });

  const assignmentCourseIds = Array.from(
    new Set(assignmentMatches.map((assignment) => String(assignment.course_id || "")))
  ).filter(Boolean);

  if (assignmentCourseIds.length === 1) {
    return courses.find((course) => String(course.id) === assignmentCourseIds[0]) || null;
  }

  return null;
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

function findMatchedAssignmentReference(message, runtimeState) {
  const matchedCourse = deriveMessageCourseContext(message, runtimeState);
  const courseFacts = getCourseFacts(runtimeState, matchedCourse?.id || null);
  const sourceText = `${message?.subject || ""}\n${message?.last_message || ""}`;
  const normalizedText = normalizeCompact(sourceText);
  const expandedText = normalizeName(sourceText);

  const gradedAssignments = courseFacts.gradedAssignments || [];
  if (!gradedAssignments.length) {
    return null;
  }

  const exactNameMatch = gradedAssignments.find((assignment) => {
    const compactName = normalizeCompact(assignment.name);
    return compactName && normalizedText.includes(compactName);
  });
  if (exactNameMatch) {
    return exactNameMatch;
  }

  const numberedReference =
    expandedText.match(/\b(?:homework|assignment|quiz|exam)\s*(\d+)\b/) ||
    expandedText.match(/\b(?:hw)\s*(\d+)\b/);

  if (numberedReference?.[1]) {
    const wantedNumber = numberedReference[1];
    const numberedMatches = gradedAssignments.filter((assignment) => {
      const compactName = normalizeCompact(assignment.name);
      const expandedName = normalizeName(assignment.name);
      return (
        compactName.includes(wantedNumber) &&
        /(homework|assignment|quiz|exam|hw)/.test(expandedName)
      );
    });

    if (numberedMatches.length === 1) {
      return numberedMatches[0];
    }
  }

  return null;
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

function assessReplyContext(message, runtimeState, extraContext = "") {
  const intent = classifyMessageIntent(message, runtimeState);
  if (!intent.needsReply) {
    return {
      requiresClarification: false,
      clarificationQuestion: "",
      missingContext: [],
    };
  }

  if (normalizeText(extraContext)) {
    return {
      requiresClarification: false,
      clarificationQuestion: "",
      missingContext: [],
    };
  }

  const courses = runtimeState?.canvas?.normalizedWorkspace?.courses || [];
  const matchedCourse = deriveMessageCourseContext(message, runtimeState);
  const courseFacts = getCourseFacts(runtimeState, matchedCourse?.id || null);
  const matchedAssignment = findMatchedAssignmentReference(message, runtimeState);
  const missingContext = [];
  let clarificationQuestion = "";

  if (intent.isCourseRelated && !matchedCourse && courses.length > 1) {
    missingContext.push("course");
    clarificationQuestion = "Which course is this message about?";
  }

  if (intent.asksForGrade && !courseFacts.gradedAssignments.length) {
    missingContext.push("grade_detail");
    clarificationQuestion = clarificationQuestion || "What graded item or score are you asking about?";
  }

  if (intent.asksForGrade && courseFacts.gradedAssignments.length > 1 && !matchedAssignment) {
    missingContext.push("grade_detail");
    clarificationQuestion =
      clarificationQuestion || "Which graded item should I mention?";
  }

  if (intent.asksForAssignment && !courseFacts.upcomingAssignments.length && !matchedAssignment) {
    missingContext.push("assignment_detail");
    clarificationQuestion = clarificationQuestion || "Which assignment, quiz, or due date should I mention?";
  }

  const messageBody = normalizeText(message?.last_message || "");
  if (!clarificationQuestion && messageBody.split(/\s+/).filter(Boolean).length < 4) {
    missingContext.push("message_detail");
    clarificationQuestion = "What should I mention in the reply?";
  }

  return {
    requiresClarification: Boolean(clarificationQuestion),
    clarificationQuestion,
    missingContext,
  };
}

function buildReplyDraftPrompt({ message, runtimeState, preferences = {}, extraContext = "" }) {
  const replyPreferences = getReplyPreferences(preferences);
  const intent = classifyMessageIntent(message, runtimeState);
  const matchedCourse = deriveMessageCourseContext(message, runtimeState);
  const courseFacts = getCourseFacts(runtimeState, matchedCourse?.id || null);
  const contextAssessment = assessReplyContext(message, runtimeState, extraContext);
  const matchedAssignment = findMatchedAssignmentReference(message, runtimeState);

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
  "requiresClarification": false,
  "clarificationQuestion": "",
  "missingContext": ["course | grade_detail | assignment_detail | message_detail"],
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
      counterpart_name: message?.counterpart_name || "",
      context_code: message?.context_code || "",
      context_name: message?.context_name || "",
      course_id: message?.course_id || null,
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

Matched assignment reference:
${JSON.stringify(
    matchedAssignment
      ? {
          id: matchedAssignment.id,
          name: matchedAssignment.name,
          score: matchedAssignment.score,
          points_possible: matchedAssignment.points_possible,
          percent: matchedAssignment.percent,
        }
      : null,
    null,
    2
  )}

Matched course context:
${JSON.stringify(
    matchedCourse
      ? {
          id: matchedCourse.id,
          name: matchedCourse.name,
          code: matchedCourse.code || "",
        }
      : null,
    null,
    2
  )}

Student-provided extra context:
${normalizeText(extraContext) || "none"}

Context assessment:
${JSON.stringify(contextAssessment, null, 2)}

Rules:
- Draft in first person as the student.
- If you use a greeting, address the other participant, not the student account holder.
- Never greet the student using their own name.
- If the message is course-related, use the Canvas state when helpful.
- If a course can be inferred from the message, use only that course context.
- If a specific graded item can be matched from the message, answer directly instead of asking a clarification question.
- If no exact fact is available, avoid inventing details.
- If the context assessment says clarification is needed, return requiresClarification: true, ask one short question, leave the draft empty, and list the missing context.
- Match the reply preferences closely.
- Keep the message natural, human, and ready to send.`;
}

function buildAutonomousInboxFeed(runtimeState, preferences = {}) {
  const messages = runtimeState?.canvas?.inboxState?.messages || [];
  const replyPreferences = getReplyPreferences(preferences);

  return messages.slice(0, 8).map((message) => {
    const intent = classifyMessageIntent(message, runtimeState);
    const matchedCourse = deriveMessageCourseContext(message, runtimeState);
    return {
      id: message.id,
      type: "message",
      title: message.subject || "Message",
      subtitle: matchedCourse?.name || message.last_author_name || "Inbox",
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
      matchedCourse,
      replyPreferences,
    };
  });
}

module.exports = {
  buildAutonomousInboxFeed,
  assessReplyContext,
  buildReplyDraftPrompt,
  classifyMessageIntent,
  deriveMessageCourseContext,
  findMatchedAssignmentReference,
  getCourseFacts,
  getReplyPreferences,
};
