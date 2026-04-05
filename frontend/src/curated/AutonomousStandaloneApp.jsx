import React from "react";
import AutonomousAgentsWorkingView from "./AutonomousAgentsWorkingView";
import InboxDebugPanel from "./InboxDebugPanel";
import useAutonomousInboxFeed from "./useAutonomousInboxFeed";
import { loadMessages, messageMatchesUser } from "./autonomousInboxApi";
import "../autonomous-page.css";

const API = "http://localhost:3001/api";

function RawInboxCards({ snapshot, onDraftReply, onSendReply, currentUserName }) {
  const messages = (snapshot?.messages || []).filter((message) =>
    messageMatchesUser(message, currentUserName)
  );

  if (!messages.length) {
    return (
      <section className="draft-panel">
        <h3>Raw inbox cards</h3>
        <p>No raw inbox messages are available yet.</p>
      </section>
    );
  }

  return (
    <section className="draft-panel">
      <h3>Raw inbox cards</h3>
      <p>This list renders directly from the backend messages payload.</p>

      <div className="raw-card-grid">
        {messages.slice(0, 8).map((message) => (
          <article key={message.id} className="draft-card">
            <span className="draft-label">Message</span>
            <h4 className="raw-card-title">{message.subject || "Message"}</h4>
            <p className="raw-card-meta">
              {message.workflow_state || "unknown"} • {message.last_message_at || "No time"}
            </p>
            <div className="draft-body">{message.last_message || "[No message]"}</div>
            <div className="autonomous-page-actions raw-card-actions">
              <button
                type="button"
                className="page-button-secondary"
                onClick={() => onDraftReply?.(message)}
              >
                Draft
              </button>
              <button
                type="button"
                className="page-button"
                onClick={() => onSendReply?.(message)}
              >
                Send
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function UnreadInboxCards({ snapshot, onDraftReply, onSendReply, currentUserName }) {
  const unreadMessages = (snapshot?.messages || []).filter(
    (message) =>
      String(message.workflow_state || "").toLowerCase() === "unread" &&
      messageMatchesUser(message, currentUserName)
  );

  if (!unreadMessages.length) {
    return (
      <section className="draft-panel">
        <h3>Unread messages</h3>
        <p>No unread inbox messages were found in the raw payload.</p>
      </section>
    );
  }

  return (
    <section className="draft-panel unread-panel">
      <h3>Unread messages</h3>
      <p>This section is rendered directly from the unread raw inbox payload.</p>

      <div className="raw-card-grid">
        {unreadMessages.slice(0, 6).map((message) => (
          <article key={message.id} className="draft-card unread-card">
            <span className="draft-label">Unread</span>
            <h4 className="raw-card-title">{message.subject || "Message"}</h4>
            <p className="raw-card-meta">
              {message.last_message_at || "No time"}
            </p>
            <div className="draft-body">{message.last_message || "[No message]"}</div>
            <div className="autonomous-page-actions raw-card-actions">
              <button
                type="button"
                className="page-button-secondary"
                onClick={() => onDraftReply?.(message)}
              >
                Draft
              </button>
              <button
                type="button"
                className="page-button"
                onClick={() => onSendReply?.(message)}
              >
                Send
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function AutonomousStandaloneApp() {
  const [authLoading, setAuthLoading] = React.useState(true);
  const [user, setUser] = React.useState(null);
  const [authError, setAuthError] = React.useState("");
  const [debugSnapshot, setDebugSnapshot] = React.useState(null);
  const [debugLoading, setDebugLoading] = React.useState(false);
  const [debugError, setDebugError] = React.useState("");
  const {
    drafts,
    error,
    feed,
    loading,
    onDraftReply,
    onPreferenceChange,
    onSendReply,
    preferences,
    refresh,
    syncNow,
    syncing,
  } = useAutonomousInboxFeed(undefined, user?.name || "");

  React.useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      setAuthLoading(true);
      setAuthError("");
      try {
        const response = await fetch(`${API}/auth/me`, {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!mounted) return;

        if (!response.ok || !data.authenticated) {
          setUser(null);
          setAuthError("Login in the main app first with your Canvas personal access token.");
          return;
        }

        setUser(data.user || null);
      } catch (err) {
        if (mounted) {
          setAuthError(err.message || "Failed to check session");
        }
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshDebug = React.useCallback(async () => {
    setDebugLoading(true);
    setDebugError("");
    try {
      const messages = await loadMessages(20);
      setDebugSnapshot({
        fetchedAt: new Date().toISOString(),
        totalMessages: messages.length,
        messages,
      });
    } catch (err) {
      setDebugError(err.message || "Failed to load raw inbox payload");
    } finally {
      setDebugLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!user) return;
    refresh();
    refreshDebug();
  }, [user, refresh, refreshDebug]);

  return (
    <div className="autonomous-page">
      <div className="autonomous-page-inner">
        <header className="autonomous-page-header">
          <div>
            <span className="autonomous-page-tag">Standalone inbox view</span>
            <h1>Autonomous agents working</h1>
            <p>
              {user ? `Signed in as ${user.name}.` : "Use this page to verify inbox-driven agent behavior."}
            </p>
          </div>

          <div className="autonomous-page-actions">
            <button
              type="button"
              className="page-button-secondary"
              onClick={() => window.location.assign("/")}
            >
              Main app
            </button>
            <button
              type="button"
              className="page-button"
              onClick={() => syncNow()}
              disabled={syncing || authLoading || !user}
            >
              {syncing ? "Syncing..." : "Sync inbox now"}
            </button>
          </div>
        </header>

        {authLoading ? (
          <section className="autonomous-status-card">
            <h1>Loading session</h1>
            <p>Checking whether your Canvas login is active.</p>
          </section>
        ) : null}

        {!authLoading && authError ? (
          <section className="autonomous-status-card">
            <h1>Login required</h1>
            <p>{authError}</p>
          </section>
        ) : null}

        {!authLoading && user ? (
          <>
            {error ? <div className="autonomous-error">{error}</div> : null}

            {loading ? (
              <section className="autonomous-status-card">
                <h1>Loading autonomous inbox</h1>
                <p>Pulling LangGraph runtime state and inbox changes.</p>
              </section>
            ) : (
              <AutonomousAgentsWorkingView
                feed={feed}
                preferences={preferences}
                onDraftReply={onDraftReply}
                onSendReply={onSendReply}
                onPreferenceChange={onPreferenceChange}
              />
            )}

            <UnreadInboxCards
              snapshot={debugSnapshot}
              currentUserName={user?.name || ""}
              onDraftReply={onDraftReply}
              onSendReply={onSendReply}
            />

            <section className="draft-panel">
              <h3>Draft preview</h3>
              <p>When you click Draft on a message, the generated reply will appear here.</p>

              <div className="draft-stack">
                {Object.keys(drafts).length ? (
                  Object.entries(drafts).map(([messageId, draft]) => (
                    <article key={messageId} className="draft-card">
                      <span className="draft-label">Message {messageId}</span>
                      <div className="draft-body">{draft}</div>
                    </article>
                  ))
                ) : (
                  <article className="draft-card">
                    <span className="draft-label">No draft yet</span>
                    <div className="draft-body">Click Draft on any inbox item to generate a reply preview.</div>
                  </article>
                )}
              </div>
            </section>

            <RawInboxCards
              snapshot={debugSnapshot}
              currentUserName={user?.name || ""}
              onDraftReply={onDraftReply}
              onSendReply={onSendReply}
            />

            <InboxDebugPanel
              snapshot={debugSnapshot}
              loading={debugLoading}
              error={debugError}
              onRefresh={refreshDebug}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
