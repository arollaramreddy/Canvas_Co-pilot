import { useState } from "react";
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

function ChangeCard({ item, onClarificationChange, onDraft, onSend }) {
  const draftLabel = item.isDrafting ? "Drafting..." : "Draft";
  const sendLabel = item.isSending ? "Sending..." : "Send";
  const [localClarification, setLocalClarification] = useState(item.clarificationInput || "");

  function handleClarificationChange(value) {
    setLocalClarification(value);
    onClarificationChange?.(item.id, value);
  }

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

        {item.draftState?.requiresClarification ? (
          <div className="agent-clarification-box">
            <strong>{item.draftState.clarificationQuestion || "The agent needs more context."}</strong>
            <textarea
              className="agent-clarification-input"
              value={localClarification}
              onChange={(event) => handleClarificationChange(event.target.value)}
              placeholder="Add the missing context here..."
            />
            <button
              type="button"
              className="agent-secondary"
              onClick={() => onDraft?.(item)}
              disabled={item.isDrafting || !localClarification.trim()}
            >
              Redraft with my answer
            </button>
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
            disabled={item.isDrafting || item.isSending || item.draftState?.requiresClarification}
          >
            {sendLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

function MaterialCard({ item, onOpen, isActive }) {
  return (
    <article className={`agent-card material-card ${isActive ? "material-card-active" : ""}`}>
      <div className="agent-card-top">
        <div>
          <span className="agent-pill agent-pill-normal">material</span>
          <h3>{item.fileName}</h3>
          <p>{item.courseName}</p>
        </div>
        <span className="agent-time">{formatTime(item.createdAt)}</span>
      </div>

      <div className="agent-card-body">
        <div className="agent-meta-row">
          <span>Module</span>
          <strong>{item.moduleName}</strong>
        </div>
        <p>{item.subtitle}</p>
        <div className="agent-actions">
          <button type="button" className="agent-primary" onClick={() => onOpen?.(item)}>
            Open
          </button>
        </div>
      </div>
    </article>
  );
}

function MaterialWorkflowPanel({ selectedMaterial, materialWorkflow, materialLoading }) {
  return (
    <aside className="settings-panel">
      <div className="settings-header">
        <span className="settings-tag">Material copilot</span>
        <h3>{selectedMaterial ? selectedMaterial.fileName : "Select material"}</h3>
      </div>

      {!selectedMaterial ? (
        <div className="empty-card">
          <h3>No material selected</h3>
          <p>Open a file to view outputs.</p>
        </div>
      ) : materialLoading ? (
        <div className="empty-card">
          <h3>Agents are working</h3>
          <p>Preparing learning support.</p>
        </div>
      ) : materialWorkflow ? (
        <div className="material-workflow-stack">
          <div className="workflow-section">
            <span className="section-tag">Course</span>
            <h4>{selectedMaterial.courseName}</h4>
            <p>{selectedMaterial.moduleName}</p>
          </div>

          <div className="workflow-section">
            <span className="section-tag">Curated summary</span>
            <div className="workflow-text">
              {materialWorkflow.workflow?.assets?.summary || materialWorkflow.workflow?.overview || "No summary generated yet."}
            </div>
          </div>

          <div className="workflow-section">
            <span className="section-tag">Agent flow</span>
            <div className="workflow-list">
              <div className="workflow-line">
                <strong>Agent 1</strong>
                <span>Parse material.</span>
              </div>
              <div className="workflow-line">
                <strong>Agent 2</strong>
                <span>Summarize.</span>
              </div>
              <div className="workflow-line">
                <strong>Agent 3</strong>
                <span>Make flashcards.</span>
              </div>
              <div className="workflow-line">
                <strong>Agent 4</strong>
                <span>Make quizzes.</span>
              </div>
              <div className="workflow-line">
                <strong>Agent 5</strong>
                <span>Prepare video plan.</span>
              </div>
              <div className="workflow-line">
                <strong>Agent 6</strong>
                <span>Refresh study plan.</span>
              </div>
            </div>
          </div>

          <div className="workflow-section">
            <span className="section-tag">Learning assets</span>
            <div className="workflow-list">
              {(materialWorkflow.workflow?.assets?.curated_resources || []).slice(0, 4).map((resource, index) => (
                <div key={`${resource.title}-${index}`} className="workflow-line">
                  <strong>{resource.title}</strong>
                  <span>{resource.reason}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="workflow-section">
            <span className="section-tag">Video handoff</span>
            <div className="workflow-text">
              {materialWorkflow.workflow?.assets?.video_plan?.reason || "Video plan will appear here."}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-card">
          <h3>Ready to generate</h3>
          <p>Open a file to start.</p>
        </div>
      )}
    </aside>
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
  materialCards = [],
  materialLoading = false,
  materialWorkflow = null,
  onOpenMaterial,
  onDraftReply,
  onSendReply,
  onPreferenceChange,
  selectedMaterial = null,
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
          <h2>Live updates</h2>
          <p>Messages, materials, and scores in one place.</p>
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
            <span className="section-tag">New material</span>
            <h3>New materials</h3>
          </div>

          <div className="card-stack">
            {materialCards.length ? (
              materialCards.map((item) => (
                <MaterialCard
                  key={`${item.eventId}-${item.entityId || item.fileName}`}
                  item={item}
                  isActive={String(selectedMaterial?.eventId) === String(item.eventId)}
                  onOpen={onOpenMaterial}
                />
              ))
            ) : (
              <div className="empty-card">
                <h3>No new materials yet</h3>
                <p>New files appear here.</p>
              </div>
            )}
          </div>

          <div className="section-header">
            <span className="section-tag">Inbox</span>
            <h3>Messages</h3>
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
                <h3>No inbox changes</h3>
                <p>New messages appear here.</p>
              </div>
            )}
          </div>
        </div>

        <div className="side-stack">
          <MaterialWorkflowPanel
            selectedMaterial={selectedMaterial}
            materialWorkflow={materialWorkflow}
            materialLoading={materialLoading}
          />
          <SettingsPanel
            preferences={preferences}
            onPreferenceChange={onPreferenceChange}
          />
        </div>
      </div>
    </section>
  );
}

export {
  ChangeCard,
  DEFAULT_PREFERENCES,
  MaterialCard,
  MaterialWorkflowPanel,
  SettingsPanel,
};
