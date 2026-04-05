import { useCallback, useEffect, useState } from "react";
import "./App.css";
import AutonomousAgentsWorkingView from "./curated/AutonomousAgentsWorkingView";
import useAutonomousInboxFeed from "./curated/useAutonomousInboxFeed";
import StudyPlanWorkspace from "./study-plan/StudyPlanWorkspace";
import studyPlanConfig from "./study-plan/study-plan.config.json";
import QuizWorkspace from "./quiz/QuizWorkspace";
import quizConfig from "./quiz/quiz.config.json";
import ManualStudentInteractionView from "./manual/ManualStudentInteractionView";

const API = "http://localhost:3001/api";
const TAB_PATHS = {
  autonomous: "/",
  [studyPlanConfig.id]: "/study-plan",
  [quizConfig.id]: "/quiz",
  manual: "/manual",
};

const TABS = [
  { id: "autonomous", label: "Autonomous agents working" },
  { id: studyPlanConfig.id, label: studyPlanConfig.label },
  { id: quizConfig.id, label: quizConfig.label },
  { id: "manual", label: "Manual student interaction" },
];

function getRouteState(path) {
  if (path === "/" || !path) {
    return { tabId: "autonomous", detailId: null, isDraft: false };
  }
  if (path === "/manual") {
    return { tabId: "manual", detailId: null, isDraft: false };
  }
  if (path === "/study-plan") {
    return { tabId: studyPlanConfig.id, detailId: null, isDraft: false };
  }
  if (path === "/study-plan/draft") {
    return { tabId: studyPlanConfig.id, detailId: "draft", isDraft: true };
  }
  if (path.startsWith("/study-plan/")) {
    return {
      tabId: studyPlanConfig.id,
      detailId: decodeURIComponent(path.replace("/study-plan/", "")),
      isDraft: false,
    };
  }
  if (path === "/quiz") {
    return { tabId: quizConfig.id, detailId: null, isDraft: false };
  }
  if (path === "/quiz/draft") {
    return { tabId: quizConfig.id, detailId: "draft", isDraft: true };
  }
  if (path.startsWith("/quiz/")) {
    return {
      tabId: quizConfig.id,
      detailId: decodeURIComponent(path.replace("/quiz/", "")),
      isDraft: false,
    };
  }
  return { tabId: "autonomous", detailId: null, isDraft: false };
}

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [activeTab, setActiveTab] = useState("autonomous");
  const [pathname, setPathname] = useState(() => window.location.pathname || "/");
  const [courses, setCourses] = useState([]);
  const {
    drafts,
    error: autonomousError,
    feed,
    loading: autonomousLoading,
    materialCards,
    materialLoading,
    materialWorkflow,
    draftingMessageId,
    onOpenMaterial,
    onDraftReply,
    onPreferenceChange,
    onSendReply,
    preferences,
    sendingMessageId,
    selectedMaterial,
    syncNow,
    syncing,
  } = useAutonomousInboxFeed(undefined, user?.name || "");

  const apiFetchJson = useCallback(async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }, []);

  const getTabFromPath = useCallback((path) => getRouteState(path).tabId, []);

  const navigateToPath = useCallback((nextPath) => {
    if ((window.location.pathname || "/") !== nextPath) {
      window.history.pushState({}, "", nextPath);
      setPathname(nextPath);
    }
    setActiveTab(getRouteState(nextPath).tabId);
  }, []);

  const navigateToTab = useCallback((tabId) => {
    navigateToPath(TAB_PATHS[tabId] || "/");
  }, []);

  const bootstrapSession = useCallback(async () => {
    setAuthLoading(true);
    setError("");
    try {
      const auth = await apiFetchJson(`${API}/auth/me`, { headers: {} }).catch(() => ({ authenticated: false }));
      if (auth.authenticated && auth.user) {
        setUser(auth.user);
        const loadedCourses = await apiFetchJson(`${API}/courses`, { headers: {} }).catch(() => []);
        setCourses(Array.isArray(loadedCourses) ? loadedCourses : []);
        setActiveTab(getRouteState(window.location.pathname || "/").tabId);
      } else {
        setUser(null);
        setCourses([]);
      }
    } catch (err) {
      setError(err.message || "Failed to load session");
    } finally {
      setAuthLoading(false);
    }
  }, [apiFetchJson, getTabFromPath]);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    function handlePopState() {
      const nextPath = window.location.pathname || "/";
      setPathname(nextPath);
      setActiveTab(getTabFromPath(nextPath));
    }

    window.addEventListener("popstate", handlePopState);
    handlePopState();
    return () => window.removeEventListener("popstate", handlePopState);
  }, [getTabFromPath]);

  async function handleLogin() {
    if (!tokenInput.trim() || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      const auth = await apiFetchJson(`${API}/auth/token-login`, {
        method: "POST",
        body: JSON.stringify({ accessToken: tokenInput.trim() }),
      });
      setUser(auth.user || null);
      const loadedCourses = await apiFetchJson(`${API}/courses`, { headers: {} }).catch(() => []);
      setCourses(Array.isArray(loadedCourses) ? loadedCourses : []);
      setTokenInput("");
      navigateToPath(window.location.pathname || "/");
    } catch (err) {
      setError(err.message || "Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setError("");
    try {
      await apiFetchJson(`${API}/auth/logout`, {
        method: "POST",
        headers: {},
      });
      setUser(null);
      setCourses([]);
      setTokenInput("");
      navigateToTab("autonomous");
    } catch (err) {
      setError(err.message || "Failed to log out");
    } finally {
      setLoggingOut(false);
    }
  }

  if (authLoading) {
    return (
      <div className="app-shell app-shell-loading">
        <div className="status-card">
          <div className="status-dot" />
          <h1>Loading workspace</h1>
          <p>Checking your Canvas session.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell app-shell-login">
        <div className="login-layout">
          <div className="brand-block">
            <span className="brand-tag">Canvas Copilot</span>
            <h1>Login with your Canvas personal access token</h1>
            <p>
              Paste your token to enter the workspace. The token field is hidden as you type.
            </p>
          </div>

          <div className="login-card">
            <label className="field-label" htmlFor="canvas-token">
              Canvas Personal Access Token
            </label>
            <input
              id="canvas-token"
              className="token-input"
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Enter your Canvas token"
              autoComplete="off"
              spellCheck="false"
            />

            {error && <div className="error-banner">{error}</div>}

            <button className="primary-button" onClick={handleLogin} disabled={submitting || !tokenInput.trim()}>
              {submitting ? "Signing in..." : "Login"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-workspace">
      <div className="workspace-frame">
        <header className="workspace-header">
          <div>
            <span className="brand-tag">Canvas Copilot</span>
            <h1>Welcome, {user.name}</h1>
          </div>
          <button className="secondary-button" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </header>

        <section className="workspace-card">
          <div className="tab-row" role="tablist" aria-label="Workspace tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => navigateToTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="tab-panel" role="tabpanel">
            {activeTab === "autonomous" ? (
              <div className="panel-copy">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
                  <div>
                    <span className="panel-badge">Default view</span>
                    <h2>Autonomous agents working</h2>
                    <p>Inbox changes and agent-ready actions appear here.</p>
                  </div>
                  <button className="secondary-button" onClick={() => syncNow()} disabled={syncing}>
                    {syncing ? "Syncing..." : "Sync inbox"}
                  </button>
                </div>

                {autonomousError ? <div className="error-banner">{autonomousError}</div> : null}

                {autonomousLoading ? (
                  <p>Loading autonomous inbox...</p>
                ) : (
                  <AutonomousAgentsWorkingView
                    feed={feed}
                    preferences={preferences}
                    draftingMessageId={draftingMessageId}
                    materialCards={materialCards}
                    materialLoading={materialLoading}
                    materialWorkflow={materialWorkflow}
                    onOpenMaterial={onOpenMaterial}
                    onDraftReply={onDraftReply}
                    onSendReply={onSendReply}
                    onPreferenceChange={onPreferenceChange}
                    selectedMaterial={selectedMaterial}
                    sendingMessageId={sendingMessageId}
                  />
                )}

                <div style={{ marginTop: 20 }}>
                  <span className="panel-badge">Draft preview</span>
                  <div className="login-card" style={{ marginTop: 12 }}>
                    {Object.keys(drafts).length ? (
                      Object.entries(drafts).map(([messageId, draft]) => (
                        <div key={messageId} style={{ marginBottom: 16 }}>
                          <strong>Message {messageId}</strong>
                          <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{draft}</p>
                        </div>
                      ))
                    ) : (
                      <p>No draft yet. Click `Draft` on any inbox item.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel-copy">
                {activeTab === studyPlanConfig.id ? (
                  <StudyPlanWorkspace
                    apiBase={API}
                    apiFetchJson={apiFetchJson}
                    user={user}
                    courses={courses}
                    routePath={pathname}
                    onNavigateList={() => navigateToPath("/study-plan")}
                    onNavigateDraft={() => navigateToPath("/study-plan/draft")}
                    onNavigateSavedPlan={(planId) => navigateToPath(`/study-plan/${encodeURIComponent(planId)}`)}
                  />
                ) : activeTab === quizConfig.id ? (
                  <QuizWorkspace
                    apiBase={API}
                    apiFetchJson={apiFetchJson}
                    user={user}
                    courses={courses}
                    routePath={pathname}
                    onNavigateList={() => navigateToPath("/quiz")}
                    onNavigateDraft={() => navigateToPath("/quiz/draft")}
                    onNavigateSavedQuiz={(quizId) => navigateToPath(`/quiz/${encodeURIComponent(quizId)}`)}
                  />
                ) : (
                  <ManualStudentInteractionView apiBase={API} active={activeTab === "manual"} />
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {error && <div className="error-floating">{error}</div>}
    </div>
  );
}

export default App;
