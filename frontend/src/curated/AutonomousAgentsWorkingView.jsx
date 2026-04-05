import "./autonomous-agents-working.css";

const DEFAULT_PREFERENCES = {
  reply: {
    length: "short",
    tone: "supportive",
    interactivity: "balanced",
    emoji: false,
    includeNextSteps: true,
    includeCourseContext: true,
    signoffStyle: "simple",
  },
};

function formatTime(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ChangeCard({ item, onDraft, onSend }) {
  const draftLabel = item.isDrafting ? "Drafting..." : "Draft";
  const sendLabel = item.isSending ? "Sending..." : "Send";

  return (
    <article className="agent-card">
      <div className="agent-card-top">
        <div>
          <span className={`agent-pill agent-pill-${item.priority || "normal"}`}>
            {item.type || "update"}
          </span>
          <h3>{item.title}</h3>
          <p>{item.subtitle}</p>
        </div>
        <span className="agent-time">{formatTime(item.createdAt)}</span>
      </div>

      <div className="agent-card-body">
        <div className="agent-meta-row">
          <span>Status</span>
          <strong>{item.status || "watching"}</strong>
        </div>

        {item.intent ? (
          <div className="agent-intent-grid">
            <span>{item.intent.isCourseRelated ? "Course-aware" : "General message"}</span>
            <span>{item.intent.asksForGrade ? "Grade question" : "No grade pull"}</span>
            <span>{item.intent.asksForAssignment ? "Assignment question" : "No assignment pull"}</span>
          </div>
        ) : null}

        <div className="agent-actions">
          <button
            type="button"
            className="agent-secondary"
            onClick={() => onDraft?.(item)}
            disabled={item.isDrafting || item.isSending}
          >
            {draftLabel}
          </button>
          <button
            type="button"
            className="agent-primary"
            onClick={() => onSend?.(item)}
            disabled={item.isDrafting || item.isSending}
          >
            {sendLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

function SettingsPanel({ preferences = DEFAULT_PREFERENCES, onPreferenceChange }) {
  const reply = preferences.reply || DEFAULT_PREFERENCES.reply;

  return (
    <aside className="settings-panel">
      <div className="settings-header">
        <span className="settings-tag">Settings</span>
        <h3>Reply preferences</h3>
      </div>

      <div className="settings-stack">
        <label className="settings-field">
          <span>Length</span>
          <select
            value={reply.length}
            onChange={(event) => onPreferenceChange?.("reply.length", event.target.value)}
          >
            <option value="short">Short</option>
            <option value="medium">Medium</option>
            <option value="long">Long</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Tone</span>
          <select
            value={reply.tone}
            onChange={(event) => onPreferenceChange?.("reply.tone", event.target.value)}
          >
            <option value="supportive">Supportive</option>
            <option value="professional">Professional</option>
            <option value="casual">Casual</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Interactivity</span>
          <select
            value={reply.interactivity}
            onChange={(event) => onPreferenceChange?.("reply.interactivity", event.target.value)}
          >
            <option value="low">Low</option>
            <option value="balanced">Balanced</option>
            <option value="high">High</option>
          </select>
        </label>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={Boolean(reply.includeCourseContext)}
            onChange={(event) =>
              onPreferenceChange?.("reply.includeCourseContext", event.target.checked)
            }
          />
          <span>Use course context in replies</span>
        </label>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={Boolean(reply.includeNextSteps)}
            onChange={(event) =>
              onPreferenceChange?.("reply.includeNextSteps", event.target.checked)
            }
          />
          <span>Include next steps</span>
        </label>
      </div>
    </aside>
  );
}

export default function AutonomousAgentsWorkingView({
  feed = [],
  preferences = DEFAULT_PREFERENCES,
  draftingMessageId = null,
  onDraftReply,
  onSendReply,
  onPreferenceChange,
  sendingMessageId = null,
}) {
  const messageCards = feed
    .filter((item) => item.type === "message")
    .map((item) => ({
      ...item,
      isDrafting: String(draftingMessageId) === String(item.id),
      isSending: String(sendingMessageId) === String(item.id),
    }));

  return (
    <section className="autonomous-workbench">
      <div className="autonomous-hero">
        <div>
          <span className="hero-chip">Autonomous agents</span>
          <h2>State changes arrive here</h2>
          <p>Messages, grades, assignments, discussions, and new material should surface without manual searching.</p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <strong>{feed.length}</strong>
            <span>Live changes</span>
          </div>
          <div className="hero-stat">
            <strong>{messageCards.length}</strong>
            <span>Inbox actions</span>
          </div>
        </div>
      </div>

      <div className="autonomous-grid">
        <div className="autonomous-column">
          <div className="section-header">
            <span className="section-tag">Inbox</span>
            <h3>Reply-ready messages</h3>
          </div>

          <div className="card-stack">
            {messageCards.length ? (
              messageCards.map((item) => (
                <ChangeCard
                  key={item.id}
                  item={item}
                  onDraft={onDraftReply}
                  onSend={onSendReply}
                />
              ))
            ) : (
              <div className="empty-card">
                <h3>No inbox changes yet</h3>
                <p>The agent feed will place new course-aware messages here.</p>
              </div>
            )}
          </div>
        </div>

        <SettingsPanel
          preferences={preferences}
          onPreferenceChange={onPreferenceChange}
        />
      </div>
    </section>
  );
}

export { DEFAULT_PREFERENCES };
