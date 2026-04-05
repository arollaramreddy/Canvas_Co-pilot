import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API = "http://localhost:3001/api";

const DEFAULT_SETTINGS = {
  previewLength: 2000,   // chars shown in extracted text preview
  deadlineWindow: 7,     // days: show deadlines within N days in sidebar
  compactModules: false, // show modules in compact single-column list
};

const AGENT_TASKS = [
  {
    id: "plan",
    icon: "📅",
    label: "Build Study Plan",
    prompt: "Analyze all modules and assignments in this course. Read the key PDFs to understand the content. Create a comprehensive study plan with weekly goals, prioritized by upcoming due dates. Identify the most important topics to study first.",
  },
  {
    id: "notes",
    icon: "📝",
    label: "Exam Prep Notes",
    prompt: "Read through ALL the course materials — every module, every PDF you can find. Create comprehensive exam preparation notes covering all key concepts, definitions, formulas, and likely exam topics. Organize by module.",
  },
  {
    id: "quiz",
    icon: "❓",
    label: "Generate Quiz",
    prompt: "Read the course materials thoroughly. Generate a practice quiz with 12 questions and detailed answers. Cover the most important concepts from each module. Include a mix of conceptual and application questions.",
  },
  {
    id: "explain",
    icon: "🔍",
    label: "Key Concepts",
    prompt: "Explore all course modules and read the materials. Identify and explain the top 15 most important concepts, terms, and ideas from this course. For each one, give a clear definition and why it matters.",
  },
];

function LessonSlideView({ lesson, slide }) {
  const typeBadge = { concept: "Concept", definition: "Definition", example: "Example", summary: "Summary" };
  const badgeCls = { concept: "", definition: "def", example: "ex", summary: "sum" };

  if (slide.type === "title") return (
    <div className="lp-slide lp-title-slide">
      <div className="lp-subject-tag">{lesson.subject}</div>
      <h1 className="lp-big-heading">{slide.heading}</h1>
      {slide.subheading && <p className="lp-subheading">{slide.subheading}</p>}
      <div className="lp-title-meta">{lesson.slides.length} slides · ~{lesson.estimated_minutes} min</div>
    </div>
  );

  if (slide.type === "summary") return (
    <div className="lp-slide lp-summary-slide">
      <h2 className="lp-slide-heading">{slide.heading || "Key Takeaways"}</h2>
      <ul className="lp-bullet-list lp-checks">
        {(slide.bullets || []).map((bullet, index) => (
          <li key={index}><span className="lp-check-icon">✓</span>{bullet}</li>
        ))}
      </ul>
    </div>
  );

  if (slide.type === "definition") return (
    <div className="lp-slide lp-definition-slide">
      <div className={`lp-type-badge lp-badge-${badgeCls[slide.type] || ""}`}>{typeBadge[slide.type]}</div>
      <h2 className="lp-term">{slide.term}</h2>
      <div className="lp-term-divider" />
      <p className="lp-def-text">{slide.definition}</p>
      {slide.example && <p className="lp-example-text"><em>Example: </em>{slide.example}</p>}
    </div>
  );

  return (
    <div className="lp-slide lp-concept-slide">
      {typeBadge[slide.type] && (
        <div className={`lp-type-badge lp-badge-${badgeCls[slide.type] || ""}`}>{typeBadge[slide.type]}</div>
      )}
      <h2 className="lp-slide-heading">{slide.heading}</h2>
      {slide.bullets && (
        <ul className="lp-bullet-list">
          {slide.bullets.map((bullet, index) => (
            <li key={index}>
              <span className="lp-dot">{slide.type === "example" ? index + 1 : "●"}</span>{bullet}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Lesson Player (text-to-video) ─────────────────────────
function LessonPlayer({ lesson, onClose }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const utteranceRef = useRef(null);

  const slide = lesson.slides[slideIndex];
  const isLast = slideIndex === lesson.slides.length - 1;
  const isFirst = slideIndex === 0;
  const progress = ((slideIndex + 1) / lesson.slides.length) * 100;

  function speakSlide(text, onDone) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.pitch = 1.0;
    u.onend = onDone || null;
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  }

  useEffect(() => {
    if (!playing) { window.speechSynthesis?.cancel(); return; }
    if (!voiceOn) return;
    speakSlide(slide.narration, () => {
      if (!isLast) setTimeout(() => setSlideIndex((i) => i + 1), 700);
      else setPlaying(false);
    });
    return () => window.speechSynthesis?.cancel();
  }, [isLast, playing, slide.narration, voiceOn]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function goNext() { if (!isLast) { setSlideIndex((i) => i + 1); } }
  function goPrev() { if (!isFirst) { setSlideIndex((i) => i - 1); } }
  function togglePlay() {
    if (playing) { window.speechSynthesis?.cancel(); setPlaying(false); }
    else { setPlaying(true); }
  }
  function handleClose() { window.speechSynthesis?.cancel(); onClose(); }

  return (
    <div className="lp-overlay" onClick={handleClose}>
      <div className="lp-player" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lp-header">
          <div className="lp-header-left">
            <span className="lp-header-badge">▶ Video Lesson</span>
            <span className="lp-header-title">{lesson.title}</span>
          </div>
          <div className="lp-header-right">
            <span className="lp-slide-num">{slideIndex + 1} / {lesson.slides.length}</span>
            <button className="lp-close-btn" onClick={handleClose}>✕</button>
          </div>
        </div>

        {/* Slide Stage */}
        <div className="lp-stage">
          <LessonSlideView lesson={lesson} slide={slide} key={slideIndex} />
        </div>

        {/* Narration strip */}
        <div className={`lp-narration ${playing ? "visible" : ""}`}>
          <span className="lp-nar-dot" />
          <span className="lp-nar-text">{slide.narration}</span>
        </div>

        {/* Controls */}
        <div className="lp-controls">
          <div className="lp-progress-bar">
            <div className="lp-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="lp-control-row">
            <div className="lp-ctrl-group">
              <button className="lp-ctrl-btn" onClick={goPrev} disabled={isFirst}>⏮</button>
              <button className="lp-ctrl-btn lp-play-btn" onClick={togglePlay}>
                {playing ? "⏸" : "▶"}
              </button>
              <button className="lp-ctrl-btn" onClick={goNext} disabled={isLast}>⏭</button>
            </div>
            <span className="lp-time-label">~{lesson.estimated_minutes} min</span>
            <button
              className={`lp-ctrl-btn lp-voice-btn ${voiceOn ? "on" : "off"}`}
              onClick={() => { if (voiceOn) window.speechSynthesis?.cancel(); setVoiceOn((v) => !v); }}
              title={voiceOn ? "Mute" : "Unmute"}
            >
              {voiceOn ? "🔊" : "🔇"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getCurrentPath() {
  return window.location.pathname || "/";
}

function getCoursePath(courseId) {
  return `/course/${courseId}`;
}

function getCourseIdFromPath(pathname) {
  const match = pathname.match(/^\/course\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

// Returns deadline urgency info, or null if > 7 days away
function deadlineStatus(dateStr) {
  if (!dateStr) return null;
  const now = Date.now();
  const due = new Date(dateStr).getTime();
  const diff = due - now;
  const hours = diff / (1000 * 60 * 60);
  if (diff < 0) return { label: "Overdue", cls: "overdue" };
  if (hours < 24) return { label: "Due today", cls: "urgent" };
  if (hours < 72) return { label: `${Math.ceil(hours / 24)}d left`, cls: "soon" };
  if (hours < 168) return { label: `${Math.ceil(hours / 24)}d left`, cls: "week" };
  return null;
}

// Tool icons for the agent panel
function ToolIcon({ tool }) {
  if (tool === "list_modules") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (tool === "get_module_files") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    );
  }
  if (tool === "extract_pdf") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    );
  }
  if (tool === "list_assignments") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }
  return null;
}
const DEFAULT_PLAN_PREFERENCES = {
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  hoursPerWeek: 8,
  sessionMinutes: 60,
  focusDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  priorities: [],
  selectedModuleIds: [],
  includeAssignments: true,
  objective: "General study plan",
  pace: "balanced",
};
const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRIORITY_OPTIONS = ["assignments", "exams", "reading", "projects", "revision"];

function App() {
  const [pathname, setPathname] = useState(getCurrentPath);
  const [user, setUser] = useState(null);
  const [courses, setCourses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [modules, setModules] = useState([]);
  const [selectedModule, setSelectedModule] = useState(null);
  const [moduleFiles, setModuleFiles] = useState([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [summaries, setSummaries] = useState({});
  const [moduleSummary, setModuleSummary] = useState(null);
  const [summarizing, setSummarizing] = useState({});
  const [summarizingModule, setSummarizingModule] = useState(false);
  const [extractedTexts, setExtractedTexts] = useState({});
  const [searchQuery, setSearchQuery] = useState("");

  // ── Existing handlers ──────────────────────────────

  async function handleLogin() {
    setLoading(true);
    setError("");
    setUser(null);
    setCourses([]);
    setAssignments([]);
    setFiles([]);
    setModules([]);
    setSelectedModule(null);
    setModuleFiles([]);
    setSummaries({});
    setModuleSummary(null);

    try {
      const res = await fetch(`${API}/test-login`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }
      setUser(data.user);
      const coursesRes = await fetch(`${API}/courses`);
      const coursesData = await coursesRes.json();
      if (Array.isArray(coursesData)) setCourses(coursesData);
    } catch {
      setError("Network error - is the backend running on port 3001?");
    } finally {
      setLoading(false);
    }
  }

  async function handleCourseSelect(course) {
    setSelectedCourse(course);
    setAssignments([]);
    setFiles([]);
    setModules([]);
    setSelectedModule(null);
    setModuleFiles([]);
    setSummaries({});
    setModuleSummary(null);
    setSearchQuery("");

    // Fetch assignments/files and modules in parallel
    setLoading(true);
    setLoadingModules(true);

    const [, modulesResult] = await Promise.allSettled([
      fetchCourseData(course.id),
      fetchModules(course.id),
    ]);

    setLoading(false);
    setLoadingModules(false);
  }

  async function fetchCourseData(courseId) {
    try {
      const [assignRes, filesRes] = await Promise.allSettled([
        fetch(`${API}/courses/${courseId}/assignments`),
        fetch(`${API}/courses/${courseId}/files`),
      ]);
      if (assignRes.status === "fulfilled") {
        const data = await assignRes.value.json();
        setAssignments(Array.isArray(data) ? data : []);
      }
      if (filesRes.status === "fulfilled") {
        const data = await filesRes.value.json();
        setFiles(Array.isArray(data) ? data : []);
      }
    } catch {
      setAssignments([]);
      setFiles([]);
    }
  }, []);

  const fetchModules = useCallback(async (courseId) => {
    try {
      const res = await fetch(`${API}/modules?courseId=${courseId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setModules(data);
      } else {
        setModules([]);
      }
    } catch {
      setModules([]);
    }
  }

  async function handleModuleSelect(mod) {
    setSelectedModule(mod);
    setModuleFiles([]);
    setSummaries({});
    setModuleSummary(null);
    setLoadingFiles(true);
    try {
      const res = await fetch(
        `${API}/module-files?courseId=${selectedCourse.id}&moduleId=${module.id}`
      );
      const data = await res.json();
      setModuleFiles(Array.isArray(data) ? data : []);
    } catch {
      setModuleFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }

  async function handleExtractText(file) {
    if (!selectedCourse) return;
    setExtractedTexts((prev) => ({ ...prev, [file.id]: { loading: true } }));
    try {
      const res = await fetch(
        `${API}/file-text?fileId=${file.id}&courseId=${selectedCourse.id}`
      );
      const data = await res.json();
      setExtractedTexts((prev) => ({
        ...prev,
        [file.id]: {
          text: data.text || "",
          warning: data.warning || null,
          pages: data.pages,
          chars: data.chars,
          loading: false,
        },
      }));
    } catch {
      setExtractedTexts((prev) => ({
        ...prev,
        [file.id]: { error: "Failed to extract text", loading: false },
      }));
    }
  }

  async function handleSummarizeFile(file) {
    if (!selectedCourse) return;
    setSummarizing((prev) => ({ ...prev, [file.id]: true }));
    try {
      const res = await fetch(`${API}/summarize-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          courseId: selectedCourse.id,
          fileName: file.display_name,
        }),
      });
      const data = await res.json();
      setSummaries((prev) => ({
        ...prev,
        [file.id]: data.error ? `Error: ${data.error}` : data.summary,
      }));
    } catch {
      setSummaries((prev) => ({ ...prev, [file.id]: "Failed to generate summary." }));
    } finally {
      setSummarizing((prev) => ({ ...prev, [file.id]: false }));
    }
  }

  async function handleSummarizeModule() {
    if (!selectedCourse || !selectedModule) return;
    setSummarizingModule(true);
    setModuleSummary(null);
    try {
      const res = await fetch(`${API}/summarize-module`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: selectedCourse.id,
          moduleId: selectedModule.id,
          moduleName: selectedModule.name,
        }),
      });
      const data = await res.json();
      setModuleSummary(data.error ? `Error: ${data.error}` : data.summary);
    } catch {
      setModuleSummary("Failed to generate module summary.");
    } finally {
      setSummarizingModule(false);
    }
  }

  async function handleSummarizeAllPDFs() {
    const pdfs = moduleFiles.filter((f) => f.is_pdf && f.type === "File");
    for (const file of pdfs) {
      if (!summaries[file.id]) await handleSummarizeFile(file);
    }
  }

  // ── Agent functions ──────────────────────────────────────

  async function runAgent(task) {
    if (!selectedCourse || agentRunning) return;

    setAgentMessages((prev) => [...prev, { type: "user", text: task }]);
    setAgentRunning(true);

    try {
      const response = await fetch(`${API}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, courseId: selectedCourse.id }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        setAgentMessages((prev) => [
          ...prev,
          { type: "error", message: err.error || "Agent request failed" },
        ]);
        setAgentRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep last incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === "done") {
              // stream complete
            } else {
              setAgentMessages((prev) => [...prev, event]);
            }
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      setAgentMessages((prev) => [
        ...prev,
        { type: "error", message: err.message || "Network error" },
      ]);
    } finally {
      setAgentRunning(false);
    }
  }

  function handleAgentInputKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const task = agentInput.trim();
      if (task && !agentRunning) {
        setAgentInput("");
        runAgent(task);
      }
    }
  }

  function handleAgentSend() {
    const task = agentInput.trim();
    if (task && !agentRunning) {
      setAgentInput("");
      runAgent(task);
    }
  }

  function renderAgentMessage(msg, idx) {
    if (msg.type === "user") {
      return (
        <div key={idx} className="agent-msg agent-msg-user">
          <div className="agent-msg-bubble">{msg.text}</div>
        </div>
      );
    }

    if (msg.type === "thinking") {
      return (
        <div key={idx} className="agent-msg agent-msg-thinking">
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-label">Thinking... (step {msg.step + 1})</span>
        </div>
      );
    }

    if (msg.type === "tool_call") {
      return (
        <div key={idx} className="agent-msg agent-msg-tool">
          <div className="agent-tool-header">
            <span className="agent-tool-icon"><ToolIcon tool={msg.tool} /></span>
            <span className="agent-tool-name">{msg.tool.replace(/_/g, " ")}</span>
          </div>
          {msg.input && Object.keys(msg.input).length > 0 && (
            <div className="agent-tool-input">
              {Object.entries(msg.input).map(([k, v]) => (
                <span key={k} className="agent-tool-param">
                  <span className="agent-tool-param-key">{k}:</span>{" "}
                  <span className="agent-tool-param-val">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (msg.type === "tool_result") {
      return (
        <div key={idx} className={`agent-msg agent-msg-result ${msg.success ? "success" : "fail"}`}>
          <span className="agent-result-icon">{msg.success ? "✓" : "✗"}</span>
          <span className="agent-result-preview">{msg.preview}</span>
        </div>
      );
    }

    if (msg.type === "answer") {
      return (
        <div key={idx} className="agent-msg agent-msg-answer">
          <div className="agent-answer-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Agent Response
          </div>
          <div className="summary-content agent-answer-content">
            {renderMarkdown(msg.text)}
          </div>
        </div>
      );
    }

    if (msg.type === "error") {
      return (
        <div key={idx} className="agent-msg agent-msg-error">
          <strong>Error:</strong> {msg.message}
        </div>
      );
    }

    return null;
  }

  // ── Formatting helpers ───────────────────────────────────

  function formatDate(dateStr) {
    if (!dateStr) return "No due date";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    const kb = bytes / 1024;
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
  }

  function renderInline(text) {
    return text.split(/\*\*(.*?)\*\*/g).map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
    );
  }

  function renderMarkdown(text) {
    if (!text) return null;
    return text.split("\n").map((line, i) => {
      if (line.startsWith("### "))
        return <h4 key={i} className="md-h4">{renderInline(line.slice(4))}</h4>;
      if (line.startsWith("## "))
        return <h3 key={i} className="md-h3">{renderInline(line.slice(3))}</h3>;
      if (line.startsWith("- ") || line.startsWith("* "))
        return <li key={i} className="md-li">{renderInline(line.slice(2))}</li>;
      if (/^\d+\.\s/.test(line))
        return <li key={i} className="md-li md-ol">{renderInline(line.replace(/^\d+\.\s/, ""))}</li>;
      if (!line.trim()) return <br key={i} />;
      return <p key={i} className="md-p">{renderInline(line)}</p>;
    });
  }

  const filteredFiles = searchQuery
    ? moduleFiles.filter((f) => {
        const q = searchQuery.toLowerCase();
        return (
          (f.display_name || "").toLowerCase().includes(q) ||
          (extractedTexts[f.id]?.text || "").toLowerCase().includes(q)
        );
      })
    : moduleFiles;

  const pdfCount = moduleFiles.filter((f) => f.is_pdf && f.type === "File").length;
  const showCourseDetail = routeCourseId != null && selectedCourse;

  // Assignments within the user's configured deadline window, sorted soonest first
  const alertAssignments = assignments
    .filter((a) => {
      if (!a.due_at) return false;
      const diff = new Date(a.due_at).getTime() - Date.now();
      const hours = diff / (1000 * 60 * 60);
      return diff < 0 || hours <= settings.deadlineWindow * 24;
    })
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

  // ── Agent Panel ──────────────────────────────────────────
  const agentPanel = agentOpen && (
    <>
      <div className="agent-overlay" onClick={() => setAgentOpen(false)} />
      <div className="agent-panel">
        {/* Header */}
        <div className="agent-header">
          <div className="agent-header-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFC627" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span>AI Agent</span>
          </div>
          <div className="agent-header-actions">
            {agentMessages.length > 0 && (
              <button
                className="agent-clear-btn"
                onClick={() => setAgentMessages([])}
                disabled={agentRunning}
                title="Clear conversation"
              >
                Clear
              </button>
            )}
            <button
              className="agent-close-btn"
              onClick={() => setAgentOpen(false)}
              title="Close agent panel"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="agent-messages">
          {!selectedCourse ? (
            <div className="agent-no-course">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              <p>Open a course first to use the AI Agent</p>
            </div>
          ) : agentMessages.length === 0 ? (
            <div className="agent-empty">
              <p className="agent-empty-label">What would you like to know about <strong>{selectedCourse.name}</strong>?</p>
              <div className="agent-task-grid">
                {AGENT_TASKS.map((task) => (
                  <button
                    key={task.id}
                    className="agent-task-btn"
                    onClick={() => runAgent(task.prompt)}
                    disabled={agentRunning}
                  >
                    <span className="agent-task-icon">{task.icon}</span>
                    <span className="agent-task-label">{task.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="agent-message-list">
              {agentMessages.map((msg, idx) => renderAgentMessage(msg, idx))}
              {agentRunning && (
                <div className="agent-msg agent-msg-thinking">
                  <span className="agent-thinking-dot" />
                  <span className="agent-thinking-dot" />
                  <span className="agent-thinking-dot" />
                  <span className="agent-thinking-label">Agent working...</span>
                </div>
              )}
              <div ref={agentMessagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {selectedCourse && (
          <div className="agent-input-row">
            <textarea
              className="agent-input"
              placeholder={agentRunning ? "Agent is working..." : "Ask anything about this course..."}
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
              onKeyDown={handleAgentInputKeyDown}
              disabled={agentRunning}
              rows={2}
            />
            <button
              className="agent-send-btn"
              onClick={handleAgentSend}
              disabled={agentRunning || !agentInput.trim()}
            >
              {agentRunning ? (
                <span className="spinner" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );

  // ── Sidebar ──────────────────────────────────────────────
  const sidebar = (
    <aside className={`sidebar ${sidebarOpen ? "open" : "collapsed"}`}>
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </div>
        {sidebarOpen && <span className="sidebar-brand-text">Study Assistant</span>}
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item ${!showCourseDetail ? "active" : ""}`}
          onClick={handleBackToCourses}
          title="Dashboard"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          {sidebarOpen && <span>Dashboard</span>}
        </button>

        {/* AI Agent nav item */}
        <button
          className={`sidebar-nav-item ${agentOpen ? "active" : ""}`}
          onClick={() => setAgentOpen(true)}
          title="AI Agent"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          {sidebarOpen && <span>AI Agent</span>}
        </button>

        <button
          className="sidebar-nav-item"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {sidebarOpen && <span>Settings</span>}
        </button>

        {user && (
          <button
            className="sidebar-nav-item"
            onClick={handleLogin}
            disabled={loading}
            title="Refresh Courses"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {sidebarOpen && <span>{loading ? "Loading..." : "Refresh"}</span>}
          </button>
        )}

        {showCourseDetail && (
          <div className="sidebar-course-active">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {sidebarOpen && (
              <span className="sidebar-course-name">{selectedCourse.name}</span>
            )}
          </div>
        )}
      </nav>

      {/* Deadline Tracker */}
      {sidebarOpen && (
        <div className="sidebar-deadlines">
          <div className="sidebar-section-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Deadlines
          </div>

          {!selectedCourse && (
            <p className="sidebar-empty">Open a course to see deadlines</p>
          )}

          {selectedCourse && loading && (
            <p className="sidebar-empty">Loading...</p>
          )}

          {selectedCourse && !loading && alertAssignments.length === 0 && assignments.length > 0 && (
            <p className="sidebar-empty">No deadlines within 7 days</p>
          )}

          {selectedCourse && !loading && assignments.length === 0 && (
            <p className="sidebar-empty">No assignments found</p>
          )}

          {alertAssignments.map((a) => {
            const status = deadlineStatus(a.due_at);
            return (
              <div key={a.id} className={`deadline-item ${status.cls}`}>
                <div className="deadline-name">
                  {a.html_url ? (
                    <a href={a.html_url} target="_blank" rel="noreferrer">{a.name}</a>
                  ) : a.name}
                </div>
                <div className="deadline-meta">
                  <span className={`deadline-badge ${status.cls}`}>{status.label}</span>
                  <span className="deadline-date">{formatShortDate(a.due_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toggle button */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((v) => !v)}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: sidebarOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s" }}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* User profile at bottom */}
      {user && (
        <div className="sidebar-user">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="avatar" className="sidebar-avatar" />
          ) : (
            <div className="sidebar-avatar-placeholder">
              {user.name?.[0]?.toUpperCase()}
            </div>
          )}
          {sidebarOpen && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.name}</div>
              <div className="sidebar-user-sub">ASU Canvas</div>
            </div>
          )}
        </div>
      )}
    </aside>
  );

  // ── Main Content ─────────────────────────────────────────
  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
      {sidebar}

      <main className="main-content">
        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-left">
            {showCourseDetail ? (
              <>
                <button className="back-link" onClick={handleBackToCourses}>
                  ← Courses
                </button>
                <span className="topbar-sep">/</span>
                <span className="topbar-course">{selectedCourse.name}</span>
              </>
            ) : (
              <span className="topbar-title">Dashboard</span>
            )}
          </div>
          {error && <div className="status error topbar-error">{error}</div>}
        </div>

        {/* Login / Connect */}
        {!user && (
          <section className="connect-card">
            <div className="connect-card-inner">
              <div className="connect-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FFC627" strokeWidth="1.5">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
              <h2>Connect to Canvas</h2>
              <p className="muted">Load your courses, modules, and study materials</p>
              <button onClick={handleLogin} disabled={loading} className="login-btn">
                {loading && <span className="spinner" />}
                {loading ? "Connecting..." : "Login with Canvas"}
              </button>
            </div>
          </section>
        )}

        {user && !showCourseDetail && (
          <>
            {/* User greeting */}
            <div className="user-greeting">
              <div className="user-greeting-left">
                {user.avatar_url && (
                  <img src={user.avatar_url} alt="avatar" className="greeting-avatar" />
                )}
                <div>
                  <h2>Welcome back, {user.name.split(" ")[0]}</h2>
                  <p className="muted">{courses.length} courses loaded</p>
                </div>
              </div>
              <button onClick={handleLogin} disabled={loading} className="action-btn">
                {loading && <span className="spinner-sm" />}
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {/* Course Grid */}
            {courses.length > 0 && (
              <section>
                <div className="section-head">
                  <h2>My Courses</h2>
                  <span className="count-pill">{courses.length}</span>
                </div>
                <div className="course-grid">
                  {courses.map((course, idx) => {
                    const colors = [
                      "#8C1D40", "#1a5276", "#1e6b45", "#6c3483",
                      "#b7950b", "#784212", "#1a5276", "#922b21",
                    ];
                    const color = colors[idx % colors.length];
                    const initials = course.name
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase();
                    return (
                      <button
                        key={course.id}
                        type="button"
                        className="course-card"
                        onClick={() => handleCourseSelect(course)}
                      >
                        <div className="course-card-banner" style={{ background: color }}>
                          <span className="course-card-initials">{initials}</span>
                        </div>
                        <div className="course-card-body">
                          <div className="course-card-code">{course.code}</div>
                          <div className="course-card-name">{course.name}</div>
                        </div>
                        <div className="course-card-footer">
                          <span className="course-card-cta" style={{ color }}>Open Course →</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}

      {/* ── Modules Section ───────────────────────── */}
      {selectedCourse && (
        <section className="card">
          <h2>
            Modules - {selectedCourse.name}
            {modules.length > 0 && ` (${modules.length})`}
          </h2>

              {loadingModules && <p className="muted">Loading modules...</p>}
              {!loadingModules && modules.length === 0 && (
                <p className="muted">No modules found for this course.</p>
              )}

              {modules.length > 0 && (
                <div className={`module-list ${settings.compactModules ? "compact" : ""}`}>
                  {modules.map((module) => (
                    <button
                      key={module.id}
                      type="button"
                      className={`module-item ${selectedModule?.id === module.id ? "active" : ""}`}
                      onClick={() => handleModuleSelect(module)}
                    >
                      <div className="module-item-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M4 10h16M4 14h8" />
                        </svg>
                      </div>
                      <div>
                        <strong>{module.name}</strong>
                        <p className="muted">
                          {module.items_count != null ? `${module.items_count} items` : "Module"}
                        </p>
                      </div>
                      <span className="module-open">View →</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Module Files */}
            {selectedModule && (
              <section className="card">
                <div className="card-header-row">
                  <div>
                    <p className="section-kicker">Selected module</p>
                    <h2>{selectedModule.name}</h2>
                  </div>
                  <div className="card-actions">
                    {pdfCount > 0 && (
                      <>
                        <button
                          className="action-btn primary"
                          onClick={handleSummarizeModule}
                          disabled={summarizingModule}
                        >
                          {summarizingModule ? (
                            <><span className="spinner-sm" /> Summarizing...</>
                          ) : "Summarize Module"}
                        </button>
                        <button className="action-btn" onClick={handleSummarizeAllPDFs}>
                          Summarize All PDFs
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {loadingFiles && <p className="muted">Loading files...</p>}
                {!loadingFiles && moduleFiles.length === 0 && (
                  <p className="muted">No professor-uploaded files in this module.</p>
                )}

                {moduleFiles.length > 0 && (
                  <div className="search-bar">
                    <input
                      type="text"
                      placeholder="Search files or extracted text..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="search-input"
                    />
                    {searchQuery && (
                      <button className="search-clear" onClick={() => setSearchQuery("")}>
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {filteredFiles.map((file) => (
                  <div key={file.id} className="file-card">
                    <div className="file-header">
                      <div className="file-info">
                        <span className={`file-badge ${file.is_pdf ? "pdf" : "other"}`}>
                          {file.is_pdf ? "PDF" : file.type === "ExternalUrl" ? "Link" : "File"}
                        </span>
                        <strong className="file-name">{file.display_name}</strong>
                        {file.size && <span className="file-size">{formatSize(file.size)}</span>}
                      </div>
                      {file.is_pdf && file.type === "File" && (
                        <div className="file-actions">
                          <button
                            className="action-btn sm"
                            onClick={() => handleExtractText(file)}
                            disabled={extractedTexts[file.id]?.loading}
                          >
                            {extractedTexts[file.id]?.loading ? "Extracting..."
                              : extractedTexts[file.id]?.text ? "Re-extract" : "Extract Text"}
                          </button>
                          <button
                            className="action-btn sm primary"
                            onClick={() => handleSummarizeFile(file)}
                            disabled={summarizing[file.id]}
                          >
                            {summarizing[file.id]
                              ? <><span className="spinner-sm" /> Summarizing...</>
                              : summaries[file.id] ? "Re-summarize" : "Summarize"}
                          </button>
                          <button
                            className="action-btn sm video-btn"
                            onClick={() => {
                              if (lessons[String(file.id)]) { setOpenLesson(lessons[String(file.id)]); }
                              else { handleGenerateLesson(file); }
                            }}
                            disabled={generatingLesson[String(file.id)]}
                            title="Generate video lesson from this PDF"
                          >
                            {generatingLesson[String(file.id)]
                              ? <><span className="spinner-sm" /> Building...</>
                              : lessons[String(file.id)] ? "▶ Play Lesson" : "▶ Video Lesson"}
                          </button>
                        </div>
                      )}
                      {file.type === "ExternalUrl" && file.external_url && (
                        <a href={file.external_url} target="_blank" rel="noreferrer" className="action-btn sm">
                          Open Link
                        </a>
                      )}
                    </div>

                    {extractedTexts[file.id] && !extractedTexts[file.id].loading && (
                      <div className="extract-panel">
                        {extractedTexts[file.id].warning && (
                          <p className="warning">{extractedTexts[file.id].warning}</p>
                        )}
                        {extractedTexts[file.id].error && (
                          <p className="warning">{extractedTexts[file.id].error}</p>
                        )}
                        {extractedTexts[file.id].text && (
                          <>
                            <p className="extract-meta">
                              {extractedTexts[file.id].chars?.toLocaleString()} chars
                              {extractedTexts[file.id].pages && `, ~${extractedTexts[file.id].pages} pages`}
                            </p>
                            <pre className="extract-text">
                              {extractedTexts[file.id].text.slice(0, settings.previewLength)}
                              {extractedTexts[file.id].text.length > settings.previewLength && "\n\n... (truncated in preview)"}
                            </pre>
                          </>
                        )}
                      </div>
                    )}

                    {summaries[file.id] && (
                      <div className="summary-panel">
                        <h4>AI Summary</h4>
                        <div className="summary-content">{renderMarkdown(summaries[file.id])}</div>
                      </div>
                    )}
                    {file.error && <p className="muted">{file.error}</p>}
                  </div>
                ))}
              </section>
            )}

            {moduleSummary && (
              <section className="card summary-card">
                <h2>Module Summary — {selectedModule?.name}</h2>
                <div className="summary-content">{renderMarkdown(moduleSummary)}</div>
              </section>
            )}

            {/* Assignments table */}
            {assignments.length > 0 && (
              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">Assignments</p>
                    <h2>Upcoming work</h2>
                  </div>
                  <span className="count-pill">{assignments.length}</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Assignment</th>
                      <th>Due Date</th>
                      <th>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => {
                      const status = deadlineStatus(a.due_at);
                      return (
                        <tr key={a.id} className={status ? `row-${status.cls}` : ""}>
                          <td>
                            {a.html_url ? (
                              <a href={a.html_url} target="_blank" rel="noreferrer">{a.name}</a>
                            ) : a.name}
                          </td>
                          <td>
                            {formatDate(a.due_at)}
                            {status && (
                              <span className={`deadline-badge ${status.cls}`} style={{ marginLeft: "0.5rem" }}>
                                {status.label}
                              </span>
                            )}
                          </td>
                          <td>{a.points_possible ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}

            {/* All files */}
            {files.length > 0 && (
              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">Course files</p>
                    <h2>All uploaded materials</h2>
                  </div>
                  <span className="count-pill">{files.length}</span>
                </div>
                {files.map((file) => {
                  const isPdf = (file.display_name || "").toLowerCase().endsWith(".pdf");
                  return (
                    <div key={file.id} className="file-card">
                      <div className="file-header">
                        <div className="file-info">
                          <span className={`file-badge ${isPdf ? "pdf" : "other"}`}>
                            {isPdf ? "PDF" : "File"}
                          </span>
                          <strong className="file-name">{file.display_name}</strong>
                          {file.size && <span className="file-size">{formatSize(file.size)}</span>}
                          <span className="file-date">{formatDate(file.created_at)}</span>
                        </div>
                        {isPdf && (
                          <div className="file-actions">
                            <button
                              className="action-btn sm"
                              onClick={() => handleExtractText({ id: file.id, display_name: file.display_name })}
                              disabled={extractedTexts[file.id]?.loading}
                            >
                              {extractedTexts[file.id]?.loading ? "Extracting..."
                                : extractedTexts[file.id]?.text ? "Re-extract" : "Extract Text"}
                            </button>
                            <button
                              className="action-btn sm primary"
                              onClick={() => handleSummarizeFile({ id: file.id, display_name: file.display_name })}
                              disabled={summarizing[file.id]}
                            >
                              {summarizing[file.id]
                                ? <><span className="spinner-sm" /> Summarizing...</>
                                : summaries[file.id] ? "Re-summarize" : "Summarize"}
                            </button>
                            <button
                              className="action-btn sm video-btn"
                              onClick={() => {
                                const fid = String(file.id);
                                if (lessons[fid]) { setOpenLesson(lessons[fid]); }
                                else { handleGenerateLesson({ id: file.id, display_name: file.display_name }); }
                              }}
                              disabled={generatingLesson[String(file.id)]}
                              title="Generate video lesson from this PDF"
                            >
                              {generatingLesson[String(file.id)]
                                ? <><span className="spinner-sm" /> Building...</>
                                : lessons[String(file.id)] ? "▶ Play Lesson" : "▶ Video Lesson"}
                            </button>
                          </div>
                        )}
                      </div>
                      {extractedTexts[file.id] && !extractedTexts[file.id].loading && (
                        <div className="extract-panel">
                          {extractedTexts[file.id].warning && (
                            <p className="warning">{extractedTexts[file.id].warning}</p>
                          )}
                          {extractedTexts[file.id].error && (
                            <p className="warning">{extractedTexts[file.id].error}</p>
                          )}
                          {extractedTexts[file.id].text && (
                            <>
                              <p className="extract-meta">
                                {extractedTexts[file.id].chars?.toLocaleString()} chars
                                {extractedTexts[file.id].pages && `, ~${extractedTexts[file.id].pages} pages`}
                              </p>
                              <pre className="extract-text">
                                {extractedTexts[file.id].text.slice(0, 2000)}
                                {extractedTexts[file.id].text.length > 2000 && "\n\n... (truncated in preview)"}
                              </pre>
                            </>
                          )}
                        </div>
                      )}
                      {summaries[file.id] && (
                        <div className="summary-panel">
                          <h4>AI Summary</h4>
                          <div className="summary-content">{renderMarkdown(summaries[file.id])}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}

        <footer>
          <p>Canvas Study Assistant · AI summaries powered by Claude · Arizona State University</p>
        </footer>
      </main>

      {/* ── Video Lesson Player ────────────────────────────── */}
      {openLesson && <LessonPlayer lesson={openLesson} onClose={() => setOpenLesson(null)} />}

      {/* ── Agent Panel ────────────────────────────────────── */}
      {agentPanel}

      {/* ── Settings Modal ─────────────────────────────────── */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Preferences</h2>
              <button className="modal-close" onClick={() => setShowSettings(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="modal-body">
              {/* Preview Length */}
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name">Text Preview Length</span>
                  <span className="setting-desc">Characters shown in extracted PDF preview</span>
                </div>
                <select
                  className="setting-select"
                  value={settings.previewLength}
                  onChange={(e) => updateSetting("previewLength", Number(e.target.value))}
                >
                  <option value={500}>500 chars (short)</option>
                  <option value={2000}>2,000 chars (default)</option>
                  <option value={5000}>5,000 chars (long)</option>
                  <option value={10000}>10,000 chars (full)</option>
                </select>
              </div>

              {/* Deadline Window */}
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name">Deadline Alert Window</span>
                  <span className="setting-desc">Show upcoming deadlines in sidebar within</span>
                </div>
                <select
                  className="setting-select"
                  value={settings.deadlineWindow}
                  onChange={(e) => updateSetting("deadlineWindow", Number(e.target.value))}
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days (default)</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>

              {/* Compact modules */}
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name">Compact Module List</span>
                  <span className="setting-desc">Show modules with less spacing</span>
                </div>
                <button
                  className={`setting-toggle ${settings.compactModules ? "on" : "off"}`}
                  onClick={() => updateSetting("compactModules", !settings.compactModules)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="action-btn"
                onClick={() => {
                  setSettings(DEFAULT_SETTINGS);
                  localStorage.setItem("study-assistant-settings", JSON.stringify(DEFAULT_SETTINGS));
                }}
              >
                Reset to defaults
              </button>
              <button className="action-btn primary" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
