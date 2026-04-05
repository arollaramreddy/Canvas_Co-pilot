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

const STUDY_FOCUS_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateInput, days) {
  const date = new Date(`${dateInput}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function createInitialStudyPlanForm(course) {
  const startDate = getTodayInputValue();
  return {
    startDate,
    endDate: addDays(startDate, 14),
    objective: course ? `Stay on track in ${course.name}` : "Stay on track",
    hoursPerWeek: 8,
    sessionMinutes: 60,
    focusDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    priorities: [],
    selectedModuleIds: [],
    includeAssignments: true,
    pace: "balanced",
  };
}

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

function getStudyPlansPath() {
  return "/study-plans";
}

function getQuizzesPath() {
  return "/quizzes";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("study-assistant-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Agent state
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentMode, setAgentMode] = useState("home");
  const [agentMessages, setAgentMessages] = useState([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentInput, setAgentInput] = useState("");
  const [syllabusState, setSyllabusState] = useState({
    courseId: null,
    loading: false,
    error: "",
    data: null,
  });
  const [studyPlanForm, setStudyPlanForm] = useState(() =>
    createInitialStudyPlanForm(null)
  );
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);
  const [studyPlanError, setStudyPlanError] = useState("");
  const [studyPlanResult, setStudyPlanResult] = useState(null);
  const [studyPlanSchedule, setStudyPlanSchedule] = useState([]);
  const [savedPlans, setSavedPlans] = useState([]);
  const [savedPlansLoading, setSavedPlansLoading] = useState(false);
  const [savedPlansError, setSavedPlansError] = useState("");
  const [studyPlanSaveStatus, setStudyPlanSaveStatus] = useState("");
  const [openedSavedPlan, setOpenedSavedPlan] = useState(null);
  const [savedQuizzes, setSavedQuizzes] = useState([]);
  const [savedQuizzesLoading, setSavedQuizzesLoading] = useState(false);
  const [savedQuizzesError, setSavedQuizzesError] = useState("");
  const [quizBuilderCourseId, setQuizBuilderCourseId] = useState("");
  const [quizBuilderModules, setQuizBuilderModules] = useState([]);
  const [quizBuilderFiles, setQuizBuilderFiles] = useState([]);
  const [quizBuilderSelectedModuleIds, setQuizBuilderSelectedModuleIds] = useState([]);
  const [quizBuilderSelectedFileIds, setQuizBuilderSelectedFileIds] = useState([]);
  const [quizBuilderTitle, setQuizBuilderTitle] = useState("");
  const [quizGenerating, setQuizGenerating] = useState(false);
  const [openedQuiz, setOpenedQuiz] = useState(null);
  const [quizDraftAnswers, setQuizDraftAnswers] = useState({});
  const [quizSubmitStatus, setQuizSubmitStatus] = useState("");
  const agentMessagesEndRef = useRef(null);

  // Lesson / video player state
  const [lessons, setLessons] = useState({});           // fileId -> lesson object
  const [generatingLesson, setGeneratingLesson] = useState({}); // fileId -> bool
  const [openLesson, setOpenLesson] = useState(null);   // lesson being played

  async function handleGenerateLesson(file) {
    const fileId = String(file.id);
    setGeneratingLesson((p) => ({ ...p, [fileId]: true }));
    try {
      // Get text from cache or extract first
      let text = "";
      if (extractedTexts[fileId]?.text) {
        text = extractedTexts[fileId].text;
      } else {
        const res = await fetch(`${API}/file-text?fileId=${fileId}&courseId=${selectedCourse.id}`);
        const data = await res.json();
        text = data.text || "";
        if (text) setExtractedTexts((p) => ({ ...p, [fileId]: { text, chars: text.length } }));
      }
      if (!text) throw new Error("No extractable text in this PDF");

      const res = await fetch(`${API}/generate-lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, title: file.display_name }),
      });
      const lesson = await res.json();
      if (lesson.error) throw new Error(lesson.error);
      setLessons((p) => ({ ...p, [fileId]: lesson }));
      setOpenLesson(lesson);
    } catch (err) {
      alert(`Video generation failed: ${err.message}`);
    } finally {
      setGeneratingLesson((p) => ({ ...p, [fileId]: false }));
    }
  }

  function updateSetting(key, value) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem("study-assistant-settings", JSON.stringify(next));
      return next;
    });
  }

  const routeCourseId = getCourseIdFromPath(pathname);

  useEffect(() => {
    function handlePopState() {
      setPathname(getCurrentPath());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((path) => {
    if (path === getCurrentPath()) return;
    window.history.pushState({}, "", path);
    setPathname(path);
  }, []);

  const resetCourseView = useCallback(() => {
    setSelectedCourse(null);
    setAssignments([]);
    setFiles([]);
    setModules([]);
    setSelectedModule(null);
    setModuleFiles([]);
    setSummaries({});
    setModuleSummary(null);
    setSummarizing({});
    setSummarizingModule(false);
    setExtractedTexts({});
    setSearchQuery("");
    setLoadingModules(false);
    setLoadingFiles(false);
    setAgentMode("home");
    setAgentMessages([]);
    setAgentInput("");
    setSyllabusState({ courseId: null, loading: false, error: "", data: null });
    setStudyPlanForm(createInitialStudyPlanForm(null));
    setStudyPlanLoading(false);
    setStudyPlanError("");
    setStudyPlanResult(null);
    setStudyPlanSchedule([]);
    setStudyPlanSaveStatus("");
    setOpenedSavedPlan(null);
  }, []);

  const ensureSyllabusLoaded = useCallback(async (courseId) => {
    if (!courseId) return null;
    if (
      syllabusState.courseId === courseId &&
      (syllabusState.data || syllabusState.loading || syllabusState.error)
    ) {
      return syllabusState.data;
    }

    setSyllabusState({
      courseId,
      loading: true,
      error: "",
      data: null,
    });

    try {
      const res = await fetch(`${API}/courses/${courseId}/syllabus`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load syllabus");
      }
      setSyllabusState({
        courseId,
        loading: false,
        error: "",
        data,
      });
      return data;
    } catch (err) {
      setSyllabusState({
        courseId,
        loading: false,
        error: err.message || "Failed to load syllabus",
        data: null,
      });
      return null;
    }
  }, [syllabusState.courseId, syllabusState.data, syllabusState.error, syllabusState.loading]);

  useEffect(() => {
    if (!selectedCourse) return;
    setStudyPlanForm(createInitialStudyPlanForm(selectedCourse));
    setStudyPlanLoading(false);
    setStudyPlanError("");
    setStudyPlanResult(null);
    setStudyPlanSchedule([]);
    setStudyPlanSaveStatus("");
    setSyllabusState({
      courseId: selectedCourse.id,
      loading: false,
      error: "",
      data: null,
    });
  }, [selectedCourse]);

  useEffect(() => {
    if (agentOpen && agentMode === "planner" && selectedCourse) {
      ensureSyllabusLoaded(selectedCourse.id);
    }
  }, [agentMode, agentOpen, ensureSyllabusLoaded, selectedCourse]);

  async function handleLogin() {
    setLoading(true);
    setError("");
    setUser(null);
    setCourses([]);
    resetCourseView();

    try {
      const res = await fetch(`${API}/test-login`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }
      setUser(data.user);
      await fetchSavedPlans(data.user.id);
      await fetchSavedQuizzes(data.user.id);
      const coursesRes = await fetch(`${API}/courses`);
      const coursesData = await coursesRes.json();
      if (Array.isArray(coursesData)) setCourses(coursesData);
    } catch {
      setError("Network error - is the backend running on port 3001?");
    } finally {
      setLoading(false);
    }
  }

  const fetchCourseData = useCallback(async (courseId) => {
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
      setModules(Array.isArray(data) ? data : []);
    } catch {
      setModules([]);
    }
  }, []);

  const fetchSavedPlans = useCallback(async (userId) => {
    if (!userId) return;
    setSavedPlansLoading(true);
    setSavedPlansError("");
    try {
      const res = await fetch(`${API}/study-plans?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load saved plans");
      }
      setSavedPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      setSavedPlans([]);
      setSavedPlansError(err.message || "Failed to load saved plans");
    } finally {
      setSavedPlansLoading(false);
    }
  }, []);

  const fetchSavedQuizzes = useCallback(async (userId) => {
    if (!userId) return;
    setSavedQuizzesLoading(true);
    setSavedQuizzesError("");
    try {
      const res = await fetch(`${API}/quizzes?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load quizzes");
      }
      setSavedQuizzes(Array.isArray(data) ? data : []);
    } catch (err) {
      setSavedQuizzes([]);
      setSavedQuizzesError(err.message || "Failed to load quizzes");
    } finally {
      setSavedQuizzesLoading(false);
    }
  }, []);

  const handleCourseSelect = useCallback(async (course, options = {}) => {
    if (!options.skipNavigation) navigate(getCoursePath(course.id));
    setSelectedCourse(course);
    setAssignments([]);
    setFiles([]);
    setModules([]);
    setSelectedModule(null);
    setModuleFiles([]);
    setSummaries({});
    setModuleSummary(null);
    setSummarizing({});
    setSummarizingModule(false);
    setExtractedTexts({});
    setSearchQuery("");
    setAgentMode("home");
    setAgentMessages([]);
    setAgentInput("");
    setLoading(true);
    setLoadingModules(true);
    await Promise.allSettled([fetchCourseData(course.id), fetchModules(course.id)]);
    setLoading(false);
    setLoadingModules(false);
  }, [fetchCourseData, fetchModules, navigate]);

  useEffect(() => {
    if (!courses.length || routeCourseId == null) return;
    const routeCourse = courses.find((c) => c.id === routeCourseId);
    if (!routeCourse) return;
    if (selectedCourse?.id !== routeCourse.id) {
      handleCourseSelect(routeCourse, { skipNavigation: true });
    }
  }, [courses, handleCourseSelect, routeCourseId, selectedCourse?.id]);

  // Auto-scroll agent messages
  useEffect(() => {
    if (agentMessagesEndRef.current) {
      agentMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [agentMessages]);

  function handleBackToCourses() {
    resetCourseView();
    navigate("/");
  }

  async function handleModuleSelect(module) {
    if (!selectedCourse) return;
    setSelectedModule(module);
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

    setAgentMode("chat");
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

  async function openStudyPlanner() {
    if (!selectedCourse) return;
    setAgentMode("planner");
    setStudyPlanError("");
    await ensureSyllabusLoaded(selectedCourse.id);
  }

  function updateStudyPlanField(field, value) {
    setStudyPlanForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "startDate" && next.endDate < value) {
        next.endDate = value;
      }
      if (field === "endDate" && value < next.startDate) {
        next.startDate = value;
      }
      return next;
    });
  }

  function toggleStudyPlanDay(day) {
    setStudyPlanForm((prev) => {
      const exists = prev.focusDays.includes(day);
      const focusDays = exists
        ? prev.focusDays.filter((item) => item !== day)
        : [...prev.focusDays, day];

      return {
        ...prev,
        focusDays: focusDays.length > 0 ? focusDays : [day],
      };
    });
  }

  function toggleStudyPlanPriority(priority) {
    setStudyPlanForm((prev) => {
      const exists = prev.priorities.includes(priority);
      return {
        ...prev,
        priorities: exists
          ? prev.priorities.filter((item) => item !== priority)
          : [...prev.priorities, priority],
      };
    });
  }

  function toggleStudyPlanModule(moduleId) {
    const moduleKey = String(moduleId);
    setStudyPlanForm((prev) => {
      const exists = prev.selectedModuleIds.includes(moduleKey);
      return {
        ...prev,
        selectedModuleIds: exists
          ? prev.selectedModuleIds.filter((item) => item !== moduleKey)
          : [...prev.selectedModuleIds, moduleKey],
      };
    });
  }

  function selectAllStudyPlanModules() {
    setStudyPlanForm((prev) => ({
      ...prev,
      selectedModuleIds: [],
    }));
  }

  async function handleBuildStudyPlan() {
    if (!selectedCourse || studyPlanLoading) return;

    setStudyPlanLoading(true);
    setStudyPlanError("");
    try {
      await ensureSyllabusLoaded(selectedCourse.id);
      const res = await fetch(`${API}/study-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: selectedCourse.id,
          preferences: studyPlanForm,
          userId: user?.id ? String(user.id) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to build study plan");
      }
      setStudyPlanResult(data);
      setStudyPlanSchedule(createEditableSchedule(data.plan));
      setStudyPlanSaveStatus("");
      if (user?.id) {
        await fetchSavedQuizzes(user.id);
      }
    } catch (err) {
      setStudyPlanError(err.message || "Failed to build study plan");
      setStudyPlanResult(null);
      setStudyPlanSchedule([]);
    } finally {
      setStudyPlanLoading(false);
    }
  }

  function buildCalendarSessions(week, weekIndex) {
    const focusDays =
      studyPlanForm.focusDays.length > 0 ? studyPlanForm.focusDays : ["Mon", "Tue", "Wed"];
    const palette = ["rose", "peach", "gold", "lavender"];

    return focusDays.map((day, index) => {
      const groupedTasks = (week?.tasks || []).filter(
        (_, taskIndex) => taskIndex % Math.max(focusDays.length, 1) === index
      );
      const hour = 8 + ((weekIndex + index) % 5) * 2;
      const durationHours = Math.max(1, Math.round(studyPlanForm.sessionMinutes / 60));
      return {
        day,
        timeLabel: `${String(hour).padStart(2, "0")}:00`,
        endLabel: `${String(Math.min(hour + durationHours, 22)).padStart(2, "0")}:00`,
        title: week?.focus || "Focused review",
        tasks: groupedTasks.length > 0 ? groupedTasks : ["Review the current material scope."],
        tone: palette[(weekIndex + index) % palette.length],
      };
    });
  }

  function createEditableSchedule(plan) {
    const weeklyPlan = Array.isArray(plan?.weeklyPlan) ? plan.weeklyPlan : [];
    return weeklyPlan.map((week, weekIndex) => ({
      ...week,
      sessions: buildCalendarSessions(week, weekIndex),
    }));
  }

  function buildModuleDeadline(checkpointIndex, totalCount, preferences) {
    const start = new Date(`${preferences?.startDate || getTodayInputValue()}T12:00:00`);
    const end = new Date(`${preferences?.endDate || preferences?.startDate || getTodayInputValue()}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return preferences?.endDate || preferences?.startDate || null;
    }
    const rangeMs = Math.max(0, end.getTime() - start.getTime());
    const stepMs = totalCount > 1 ? Math.floor(rangeMs / (totalCount - 1)) : rangeMs;
    return new Date(start.getTime() + stepMs * checkpointIndex).toISOString();
  }

  function normalizeSavedPlan(savedPlan) {
    const preferences = savedPlan.preferences || createInitialStudyPlanForm(null);
    const scopedModules = Array.isArray(savedPlan.scopedModules) ? savedPlan.scopedModules : [];
    const objectiveLabel = (preferences.objective || savedPlan.planName || "your goal")
      .replace(/^stay on track in\s+/i, "")
      .trim();
    const nextPlan = {
      ...(savedPlan.plan || {}),
    };

    if (typeof nextPlan.overview === "string" && nextPlan.overview) {
      const firstSentence = nextPlan.overview.split(/(?<=[.!?])\s+/)[0] || nextPlan.overview;
      nextPlan.overview = firstSentence.length > 180
        ? `${firstSentence.slice(0, 177).trim()}...`
        : firstSentence;
    }

    if (scopedModules.length > 0) {
      const moduleNames = scopedModules.map((module) => module.name).filter(Boolean);
      nextPlan.weeklyPlan = (Array.isArray(nextPlan.weeklyPlan) ? nextPlan.weeklyPlan : []).map((week, index) => ({
        ...week,
        focus: moduleNames[index]
          ? `${moduleNames[index]}: review the core ideas.`
          : `Study the selected material for ${objectiveLabel || savedPlan.courseName}.`,
        tasks: [
          moduleNames[index]
            ? `Review ${moduleNames[index]} and capture the key ideas.`
            : "Review the selected module scope and summarize the main points.",
          "Write 3 to 5 quick recall questions.",
          "Finish one focused practice block for this session.",
        ],
      }));

      nextPlan.milestones = scopedModules.map((module, index) => ({
        title: module.name,
        dueDate:
          savedPlan.plan?.milestones?.[index]?.dueDate ||
          buildModuleDeadline(index, scopedModules.length, preferences),
        reason:
          index === 0
            ? "Start this selected module first and complete its core topics by this checkpoint."
            : "Use this checkpoint to finish the selected module before moving on.",
      }));
    }

    const savedScheduleHasOldHomework = Array.isArray(savedPlan.schedule)
      && savedPlan.schedule.some((week) =>
        (week.sessions || []).some((session) =>
          (session.tasks || []).some((task) => /hw\s*\d+|make progress on/i.test(task || ""))
        )
      );

    return {
      ...savedPlan,
      plan: nextPlan,
      schedule:
        Array.isArray(savedPlan.schedule) && savedPlan.schedule.length > 0 && !savedScheduleHasOldHomework
          ? savedPlan.schedule
          : createEditableSchedule(nextPlan),
    };
  }

  async function handleSaveStudyPlan() {
    if (!user?.id || !selectedCourse || !studyPlanResult?.plan) return;

    setStudyPlanSaveStatus("Saving...");
    try {
      const res = await fetch(`${API}/study-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(user.id),
          planName: studyPlanForm.objective,
          goalName: studyPlanForm.objective,
          courseId: selectedCourse.id,
          courseName: selectedCourse.name,
          preferences: studyPlanForm,
          scopedModules: studyPlanResult.scopedModules || [],
          plan: studyPlanResult.plan,
          schedule: studyPlanSchedule,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to save study plan");
      }
      await fetchSavedPlans(user.id);
      setStudyPlanSaveStatus("Saved to Study Plans");
    } catch (err) {
      setStudyPlanSaveStatus(err.message || "Failed to save study plan");
    }
  }

  async function handleUpdateSavedPlan() {
    if (!user?.id || !openedSavedPlan?.id || !studyPlanResult?.plan) return;

    setStudyPlanSaveStatus("Updating...");
    try {
      const res = await fetch(`${API}/study-plans/${openedSavedPlan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(user.id),
          planName: studyPlanForm.objective || openedSavedPlan.planName,
          goalName: studyPlanForm.objective || openedSavedPlan.goalName || openedSavedPlan.planName,
          courseId: studyPlanResult.courseId,
          courseName: studyPlanResult.courseName,
          preferences: studyPlanForm,
          scopedModules: studyPlanResult.scopedModules || [],
          plan: studyPlanResult.plan,
          schedule: studyPlanSchedule,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to update study plan");
      }
      setOpenedSavedPlan(data);
      await fetchSavedPlans(user.id);
      setStudyPlanSaveStatus("Saved plan updated");
    } catch (err) {
      setStudyPlanSaveStatus(err.message || "Failed to update study plan");
    }
  }

  async function handleOpenSavedPlan(savedPlan) {
    const normalizedSavedPlan = normalizeSavedPlan(savedPlan);
    setOpenedSavedPlan(normalizedSavedPlan);
    setStudyPlanForm(normalizedSavedPlan.preferences || createInitialStudyPlanForm(null));
    setStudyPlanResult({
      courseId: normalizedSavedPlan.courseId,
      courseName: normalizedSavedPlan.courseName,
      preferences: normalizedSavedPlan.preferences,
      scopedModules: normalizedSavedPlan.scopedModules || [],
      plan: normalizedSavedPlan.plan,
    });
    setStudyPlanSchedule(normalizedSavedPlan.schedule || []);
    setStudyPlanSaveStatus(`Loaded "${normalizedSavedPlan.planName}"`);
  }

  async function handleOpenAiStudyPlanner(targetCourseId) {
    const resolvedCourseId =
      targetCourseId || selectedCourse?.id || openedSavedPlan?.courseId || null;

    if (!resolvedCourseId) {
      setSavedPlansError("Open a course first, then use Build New Study Plan.");
      return;
    }

    const course = courses.find((item) => String(item.id) === String(resolvedCourseId));
    if (!course) {
      setSavedPlansError("That course is not available in your current course list.");
      return;
    }

    await handleCourseSelect(course);
    setAgentOpen(true);
    setAgentMode("planner");
    setOpenedSavedPlan(null);
  }

  async function handleQuizBuilderCourseChange(courseId) {
    setQuizBuilderCourseId(courseId);
    setQuizBuilderSelectedModuleIds([]);
    setQuizBuilderSelectedFileIds([]);
    setQuizBuilderFiles([]);
    setOpenedQuiz(null);
    if (!courseId) {
      setQuizBuilderModules([]);
      return;
    }

    try {
      const res = await fetch(`${API}/modules?courseId=${courseId}`);
      const data = await res.json();
      setQuizBuilderModules(Array.isArray(data) ? data : []);
    } catch {
      setQuizBuilderModules([]);
    }
  }

  async function toggleQuizBuilderModule(moduleId) {
    const moduleKey = String(moduleId);
    let nextSelectedModuleIds = [];

    setQuizBuilderSelectedModuleIds((prev) => {
      const exists = prev.includes(moduleKey);
      nextSelectedModuleIds = exists
        ? prev.filter((item) => item !== moduleKey)
        : [...prev, moduleKey];
      return nextSelectedModuleIds;
    });

    setQuizBuilderSelectedFileIds([]);

    if (nextSelectedModuleIds.length === 0 || !quizBuilderCourseId) {
      setQuizBuilderFiles([]);
      return;
    }

    try {
      const fileGroups = await Promise.all(
        nextSelectedModuleIds.map(async (selectedModuleId) => {
          const res = await fetch(
            `${API}/module-files?courseId=${quizBuilderCourseId}&moduleId=${selectedModuleId}`
          );
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        })
      );
      const flattened = fileGroups.flat();
      const uniqueFiles = flattened.filter(
        (file, index, array) => array.findIndex((entry) => String(entry.id) === String(file.id)) === index
      );
      setQuizBuilderFiles(uniqueFiles);
    } catch {
      setQuizBuilderFiles([]);
    }
  }

  function toggleQuizBuilderFile(fileId) {
    const fileKey = String(fileId);
    setQuizBuilderSelectedFileIds((prev) =>
      prev.includes(fileKey)
        ? prev.filter((item) => item !== fileKey)
        : [...prev, fileKey]
    );
  }

  async function handleGenerateManualQuiz() {
    if (!user?.id || !quizBuilderCourseId) return;

    const course = courses.find((item) => String(item.id) === String(quizBuilderCourseId));
    if (!course) return;

    setQuizGenerating(true);
    setQuizSubmitStatus("");
    try {
      const res = await fetch(`${API}/quizzes/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(user.id),
          courseId: quizBuilderCourseId,
          courseName: course.name,
          mode: "manual",
          title: quizBuilderTitle.trim() || `${course.name} Custom Quiz`,
          selectedModuleIds: quizBuilderSelectedModuleIds,
          selectedFileIds: quizBuilderSelectedFileIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to generate quiz");
      }
      await fetchSavedQuizzes(user.id);
      const createdQuiz = Array.isArray(data) ? data[0] : null;
      setOpenedQuiz(createdQuiz);
      setQuizDraftAnswers({});
      setQuizSubmitStatus("Quiz created");
    } catch (err) {
      setQuizSubmitStatus(err.message || "Failed to generate quiz");
    } finally {
      setQuizGenerating(false);
    }
  }

  function handleOpenQuiz(quiz) {
    setOpenedQuiz(quiz);
    setQuizDraftAnswers({});
    setQuizSubmitStatus("");
  }

  function handleQuizAnswerChange(questionId, answerIndex) {
    setQuizDraftAnswers((prev) => ({
      ...prev,
      [questionId]: answerIndex,
    }));
  }

  async function handleSubmitQuiz() {
    if (!user?.id || !openedQuiz?.id) return;

    setQuizSubmitStatus("Submitting...");
    try {
      const answers = Object.entries(quizDraftAnswers).map(([questionId, answerIndex]) => ({
        questionId,
        answerIndex,
      }));
      const res = await fetch(`${API}/quizzes/${openedQuiz.id}/submit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(user.id),
          answers,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to submit quiz");
      }
      setOpenedQuiz(data);
      await fetchSavedQuizzes(user.id);
      setQuizSubmitStatus(`Quiz submitted. Score: ${data.lastAttempt?.score ?? 0}%`);
    } catch (err) {
      setQuizSubmitStatus(err.message || "Failed to submit quiz");
    }
  }

  function addScheduleTask(weekIndex, sessionIndex) {
    setStudyPlanSchedule((prev) =>
      prev.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          sessions: week.sessions.map((session, currentSessionIndex) => {
            if (currentSessionIndex !== sessionIndex) return session;
            return {
              ...session,
              tasks: [...session.tasks, ""],
            };
          }),
        };
      })
    );
  }

  function updateScheduleTask(weekIndex, sessionIndex, taskIndex, value) {
    setStudyPlanSchedule((prev) =>
      prev.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          sessions: week.sessions.map((session, currentSessionIndex) => {
            if (currentSessionIndex !== sessionIndex) return session;
            return {
              ...session,
              tasks: session.tasks.map((task, currentTaskIndex) =>
                currentTaskIndex === taskIndex ? value : task
              ),
            };
          }),
        };
      })
    );
  }

  function removeScheduleTask(weekIndex, sessionIndex, taskIndex) {
    setStudyPlanSchedule((prev) =>
      prev.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          sessions: week.sessions.map((session, currentSessionIndex) => {
            if (currentSessionIndex !== sessionIndex) return session;
            const nextTasks = session.tasks.filter((_, currentTaskIndex) => currentTaskIndex !== taskIndex);
            return {
              ...session,
              tasks: nextTasks.length > 0 ? nextTasks : [""],
            };
          }),
        };
      })
    );
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

  function renderStudyPlanPanel() {
    const plan = studyPlanResult?.plan || null;
    const editableWeeks = studyPlanSchedule.length > 0 ? studyPlanSchedule : [];
    const moduleScopeCount =
      studyPlanForm.selectedModuleIds.length > 0
        ? studyPlanForm.selectedModuleIds.length
        : modules.length;

    return (
      <div className="study-plan-panel">
        <div className="study-plan-intro">
          <p className="study-plan-eyebrow">Interactive study planner</p>
          <h3>Build a plan from your Canvas syllabus and modules</h3>
          <p>
            Choose your timeline, focus days, and module scope. The planner uses your
            course syllabus plus the current module list from Canvas.
          </p>
        </div>

        <div className="study-plan-section">
          <div className="study-plan-section-head">
            <div>
              <h4>Planner settings</h4>
              <p className="study-plan-caption">
                {moduleScopeCount} module{moduleScopeCount === 1 ? "" : "s"} in scope
              </p>
            </div>
          </div>

          <div className="study-plan-grid">
            <label className="study-plan-field">
              <span>Start date</span>
              <input
                type="date"
                value={studyPlanForm.startDate}
                onChange={(e) => updateStudyPlanField("startDate", e.target.value)}
              />
            </label>

            <label className="study-plan-field">
              <span>End date</span>
              <input
                type="date"
                value={studyPlanForm.endDate}
                onChange={(e) => updateStudyPlanField("endDate", e.target.value)}
              />
            </label>

            <label className="study-plan-field study-plan-field-full">
              <span>Goal</span>
              <input
                type="text"
                value={studyPlanForm.objective}
                onChange={(e) => updateStudyPlanField("objective", e.target.value)}
                placeholder="Midterm 2 prep, finals review, weekly catch-up..."
              />
            </label>

            <label className="study-plan-field">
              <span>Hours per week</span>
              <input
                type="number"
                min="1"
                max="40"
                value={studyPlanForm.hoursPerWeek}
                onChange={(e) => updateStudyPlanField("hoursPerWeek", Number(e.target.value))}
              />
            </label>

            <label className="study-plan-field">
              <span>Session length</span>
              <select
                value={studyPlanForm.sessionMinutes}
                onChange={(e) => updateStudyPlanField("sessionMinutes", Number(e.target.value))}
              >
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
                <option value={90}>90 minutes</option>
                <option value={120}>120 minutes</option>
              </select>
            </label>

            <label className="study-plan-field study-plan-field-full">
              <span>Pace</span>
              <div className="study-chip-row">
                {["light", "balanced", "intensive"].map((pace) => (
                  <button
                    key={pace}
                    type="button"
                    className={`study-chip ${studyPlanForm.pace === pace ? "active" : ""}`}
                    onClick={() => updateStudyPlanField("pace", pace)}
                  >
                    {pace}
                  </button>
                ))}
              </div>
            </label>

            <div className="study-plan-field study-plan-field-full">
              <span>Focus days</span>
              <div className="study-chip-row">
                {STUDY_FOCUS_DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={`study-chip ${studyPlanForm.focusDays.includes(day) ? "active" : ""}`}
                    onClick={() => toggleStudyPlanDay(day)}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            <div className="study-plan-field study-plan-field-full">
              <span>Priorities</span>
              <div className="study-chip-row">
                {["exams", "assignments", "retention", "practice", "reading"].map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    className={`study-chip ${studyPlanForm.priorities.includes(priority) ? "active" : ""}`}
                    onClick={() => toggleStudyPlanPriority(priority)}
                  >
                    {priority}
                  </button>
                ))}
              </div>
            </div>

            <div className="study-plan-field study-plan-field-full">
              <span>Module scope</span>
              <div className="study-scope-actions">
                <button
                  type="button"
                  className={`study-chip ${studyPlanForm.selectedModuleIds.length === 0 ? "active" : ""}`}
                  onClick={selectAllStudyPlanModules}
                >
                  All modules
                </button>
              </div>
              <div className="study-module-list">
                {modules.map((module) => {
                  const checked =
                    studyPlanForm.selectedModuleIds.length === 0 ||
                    studyPlanForm.selectedModuleIds.includes(String(module.id));
                  return (
                    <label key={module.id} className={`study-module-item ${checked ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStudyPlanModule(module.id)}
                      />
                      <span>{module.name}</span>
                    </label>
                  );
                })}
                {modules.length === 0 && (
                  <p className="study-plan-caption">Load a course with modules to narrow the plan scope.</p>
                )}
              </div>
            </div>

            <label className="study-plan-toggle">
              <input
                type="checkbox"
                checked={studyPlanForm.includeAssignments}
                onChange={(e) => updateStudyPlanField("includeAssignments", e.target.checked)}
              />
              <span>Use assignment deadlines when building the plan</span>
            </label>
          </div>

          <div className="study-plan-actions">
            <button
              className="action-btn"
              type="button"
              onClick={() => {
                setStudyPlanForm(createInitialStudyPlanForm(selectedCourse));
                setStudyPlanError("");
              }}
              disabled={studyPlanLoading}
            >
              Reset
            </button>
            <button
              className="action-btn primary"
              type="button"
              onClick={handleBuildStudyPlan}
              disabled={studyPlanLoading}
            >
              {studyPlanLoading ? <><span className="spinner-sm" /> Building...</> : "Build Study Plan"}
            </button>
          </div>
        </div>

        {studyPlanError && <div className="agent-msg agent-msg-error"><strong>Error:</strong> {studyPlanError}</div>}

        {plan && (
          <div className="study-plan-results">
            <div className="study-plan-hero">
              <div className="study-plan-hero-copy">
                <h4>{studyPlanResult.courseName}</h4>
                <p>{studyPlanForm.objective}</p>
                {studyPlanSaveStatus && <p className="study-plan-save-status">{studyPlanSaveStatus}</p>}
              </div>
              <div className="study-plan-hero-stats">
                <div className="study-stat-card">
                  <span>Window</span>
                  <strong>{studyPlanForm.startDate} to {studyPlanForm.endDate}</strong>
                </div>
                <div className="study-stat-card">
                  <span>Study cadence</span>
                  <strong>{studyPlanForm.hoursPerWeek} hrs/week</strong>
                </div>
                <div className="study-stat-card">
                  <span>Focused modules</span>
                  <strong>{moduleScopeCount}</strong>
                </div>
                <button
                  type="button"
                  className="action-btn primary study-save-btn"
                  onClick={handleSaveStudyPlan}
                >
                  Save Plan
                </button>
              </div>
            </div>

            {editableWeeks.length > 0 && (
              <div className="study-plan-result-card study-plan-calendar-shell">
                <div className="study-plan-calendar-header">
                  <div>
                    <h4>Calendar schedule</h4>
                    <p className="study-plan-caption">
                      A visual week-by-week layout built from your selected days and session length.
                    </p>
                  </div>
                  <div className="study-mini-legend">
                    <span className="study-legend-chip rose">Deep Work</span>
                    <span className="study-legend-chip peach">Module Review</span>
                    <span className="study-legend-chip gold">Revision</span>
                    <span className="study-legend-chip lavender">Practice</span>
                  </div>
                </div>
                <div className="study-week-list">
                  {editableWeeks.map((week, index) => (
                    <div key={`${week.day}-${index}`} className="study-week-card study-week-calendar-card">
                      <div className="study-week-head study-week-title-row">
                        <div>
                          <strong>{week.day}</strong>
                          <span>{week.focus}</span>
                        </div>
                        <span className="study-week-badge">
                          {studyPlanForm.sessionMinutes} min blocks
                        </span>
                      </div>
                      <div className="study-calendar-grid">
                        {(week.sessions || []).map((session, sessionIndex) => (
                          <div
                            key={`${session.day}-${sessionIndex}`}
                            className={`study-calendar-block ${session.tone}`}
                          >
                            <div className="study-calendar-meta">
                              <span>{session.day}</span>
                              <span>{session.timeLabel} - {session.endLabel}</span>
                            </div>
                            <strong>{session.title}</strong>
                            <div className="study-day-task-list">
                              {session.tasks.map((task, taskIndex) => (
                                <div key={`${session.day}-${taskIndex}`} className="study-day-task-item">
                                  <input
                                    type="text"
                                    value={task}
                                    onChange={(e) =>
                                      updateScheduleTask(index, sessionIndex, taskIndex, e.target.value)
                                    }
                                    placeholder="Add a task for this session"
                                  />
                                  <button
                                    type="button"
                                    className="study-task-remove"
                                    onClick={() => removeScheduleTask(index, sessionIndex, taskIndex)}
                                    aria-label="Remove task"
                                  >
                                    x
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="study-task-add"
                              onClick={() => addScheduleTask(index, sessionIndex)}
                            >
                              + Add task
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {plan.milestones?.length > 0 && (
              <div className="study-plan-result-card">
                <h4>Milestones</h4>
                <div className="study-milestone-list">
                  {plan.milestones.map((milestone, index) => (
                    <div key={`${milestone.title}-${index}`} className="study-milestone-item">
                      <div>
                        <strong>{milestone.title}</strong>
                        <p>{milestone.reason}</p>
                        <p className="study-milestone-deadline">
                          Deadline: {formatDate(milestone.dueDate)}
                        </p>
                      </div>
                      <span>{formatShortDate(milestone.dueDate) || "TBD"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    );
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
  const showStudyPlansView = pathname === getStudyPlansPath();
  const showQuizzesView = pathname === getQuizzesPath();

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
            {selectedCourse && (
              <div className="agent-view-switch">
                <button
                  className={`agent-view-btn ${agentMode !== "planner" ? "active" : ""}`}
                  onClick={() => setAgentMode(agentMessages.length > 0 ? "chat" : "home")}
                  disabled={agentRunning}
                >
                  Copilot
                </button>
                <button
                  className={`agent-view-btn ${agentMode === "planner" ? "active" : ""}`}
                  onClick={openStudyPlanner}
                  disabled={agentRunning}
                >
                  Study Plan
                </button>
              </div>
            )}
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
          ) : agentMode === "planner" ? (
            renderStudyPlanPanel()
          ) : agentMessages.length === 0 ? (
            <div className="agent-empty">
              <p className="agent-empty-label">What would you like to know about <strong>{selectedCourse.name}</strong>?</p>
              <div className="agent-task-grid">
                {AGENT_TASKS.map((task) => (
                  <button
                    key={task.id}
                    className="agent-task-btn"
                    onClick={() => {
                      if (task.id === "plan") {
                        openStudyPlanner();
                      } else {
                        runAgent(task.prompt);
                      }
                    }}
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
          className={`sidebar-nav-item ${!showCourseDetail && !showStudyPlansView && !showQuizzesView ? "active" : ""}`}
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

        <button
          className={`sidebar-nav-item ${showStudyPlansView ? "active" : ""}`}
          onClick={() => navigate(getStudyPlansPath())}
          title="Study Plans"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 2v4" />
            <path d="M16 2v4" />
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M3 10h18" />
          </svg>
          {sidebarOpen && <span>Study Plans</span>}
        </button>

        <button
          className={`sidebar-nav-item ${showQuizzesView ? "active" : ""}`}
          onClick={() => navigate(getQuizzesPath())}
          title="Quizzes"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          {sidebarOpen && <span>Quizzes</span>}
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
            ) : showStudyPlansView ? (
              <span className="topbar-title">Study Plans</span>
            ) : showQuizzesView ? (
              <span className="topbar-title">Quizzes</span>
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

        {user && !showCourseDetail && !showStudyPlansView && !showQuizzesView && (
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

        {user && showStudyPlansView && (
          <section>
            <div className="section-head">
              <div>
                <p className="section-kicker">Saved plans</p>
                <h2>Study Plans</h2>
              </div>
              <div className="study-plans-head-actions">
                <span className="count-pill">{savedPlans.length}</span>
                <button
                  type="button"
                  className="action-btn primary"
                  onClick={() => handleOpenAiStudyPlanner(openedSavedPlan?.courseId)}
                >
                  Build New Study Plan
                </button>
              </div>
            </div>

            {savedPlansLoading && <p className="muted loading-msg">Loading saved study plans...</p>}
            {savedPlansError && <div className="status error topbar-error">{savedPlansError}</div>}

            {!savedPlansLoading && savedPlans.length === 0 && (
              <section className="card">
                <p className="muted">No saved study plans yet. Build one in the AI Agent and save it with your goal name.</p>
              </section>
            )}

            {savedPlans.length > 0 && (
              <div className="course-grid study-plan-grid-list">
                {savedPlans.map((savedPlan) => (
                  <div key={savedPlan.id} className="course-card study-plan-saved-card">
                    <div className="course-card-banner study-plan-saved-banner">
                      <span className="course-card-initials">PL</span>
                    </div>
                    <div className="course-card-body">
                      <div className="course-card-code">{savedPlan.courseName}</div>
                      <div className="course-card-name">{savedPlan.planName}</div>
                      <p className="muted study-plan-saved-meta">
                        {savedPlan.scopedModules?.length || 0} scoped modules
                      </p>
                    </div>
                    <div className="course-card-footer">
                      <button
                        type="button"
                        className="action-btn primary"
                        onClick={() => handleOpenSavedPlan(savedPlan)}
                      >
                        Open Plan
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {openedSavedPlan && studyPlanResult?.plan && (
              <section className="card study-plan-library-detail">
                <div className="card-header-row">
                  <div>
                    <p className="section-kicker">Saved plan</p>
                    <h2>{openedSavedPlan.planName}</h2>
                  </div>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setOpenedSavedPlan(null)}
                  >
                    Close
                  </button>
                </div>
                <div className="study-plan-results">
                  <div className="study-plan-hero">
                    <div className="study-plan-hero-copy">
                      <h4>{studyPlanResult.courseName}</h4>
                      <p>{studyPlanForm.objective || openedSavedPlan.planName}</p>
                      {studyPlanSaveStatus && <p className="study-plan-save-status">{studyPlanSaveStatus}</p>}
                    </div>
                    <div className="study-plan-hero-stats">
                      <div className="study-stat-card">
                        <span>Window</span>
                        <strong>{studyPlanForm.startDate} to {studyPlanForm.endDate}</strong>
                      </div>
                      <div className="study-stat-card">
                        <span>Study cadence</span>
                        <strong>{studyPlanForm.hoursPerWeek} hrs/week</strong>
                      </div>
                <div className="study-stat-card">
                  <span>Focused modules</span>
                  <strong>{studyPlanResult.scopedModules?.length || 0}</strong>
                </div>
                <button
                  type="button"
                  className="action-btn primary study-save-btn"
                  onClick={handleUpdateSavedPlan}
                >
                  Update Plan
                </button>
              </div>
            </div>

                  {studyPlanSchedule.length > 0 && (
                    <div className="study-plan-result-card study-plan-calendar-shell">
                      <div className="study-plan-calendar-header">
                        <div>
                          <h4>Calendar schedule</h4>
                          <p className="study-plan-caption">
                            Your saved editable study blocks.
                          </p>
                        </div>
                      </div>
                      <div className="study-week-list">
                        {studyPlanSchedule.map((week, index) => (
                          <div key={`${week.day}-${index}`} className="study-week-card study-week-calendar-card">
                            <div className="study-week-head study-week-title-row">
                              <div>
                                <strong>{week.day}</strong>
                                <span>{week.focus}</span>
                              </div>
                              <span className="study-week-badge">
                                {studyPlanForm.sessionMinutes} min blocks
                              </span>
                            </div>
                            <div className="study-calendar-grid">
                              {(week.sessions || []).map((session, sessionIndex) => (
                                <div
                                  key={`${session.day}-${sessionIndex}`}
                                  className={`study-calendar-block ${session.tone}`}
                                >
                                  <div className="study-calendar-meta">
                                    <span>{session.day}</span>
                                    <span>{session.timeLabel} - {session.endLabel}</span>
                                  </div>
                                  <strong>{session.title}</strong>
                                  <div className="study-day-task-list">
                                    {session.tasks.map((task, taskIndex) => (
                                      <div key={`${session.day}-${taskIndex}`} className="study-day-task-item">
                                        <input
                                          type="text"
                                          value={task}
                                          onChange={(e) =>
                                            updateScheduleTask(index, sessionIndex, taskIndex, e.target.value)
                                          }
                                          placeholder="Add a task for this session"
                                        />
                                        <button
                                          type="button"
                                          className="study-task-remove"
                                          onClick={() => removeScheduleTask(index, sessionIndex, taskIndex)}
                                          aria-label="Remove task"
                                        >
                                          x
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    className="study-task-add"
                                    onClick={() => addScheduleTask(index, sessionIndex)}
                                  >
                                    + Add task
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {studyPlanResult.plan.milestones?.length > 0 && (
                    <div className="study-plan-result-card">
                      <h4>Milestones</h4>
                      <div className="study-milestone-list">
                        {studyPlanResult.plan.milestones.map((milestone, index) => (
                          <div key={`${milestone.title}-${index}`} className="study-milestone-item">
                            <div>
                              <strong>{milestone.title}</strong>
                              <p>{milestone.reason}</p>
                              <p className="study-milestone-deadline">
                                Deadline: {formatDate(milestone.dueDate)}
                              </p>
                            </div>
                            <span>{formatShortDate(milestone.dueDate) || "TBD"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </section>
        )}

        {user && showQuizzesView && (
          <section>
            <div className="section-head">
              <div>
                <p className="section-kicker">Quiz center</p>
                <h2>Quizzes</h2>
              </div>
              <span className="count-pill">{savedQuizzes.length}</span>
            </div>

            <section className="card">
              <div className="card-header-row">
                <div>
                  <h2>Create Quiz</h2>
                  <p className="muted">Build a quiz for any course, module, or file scope.</p>
                </div>
              </div>

              <div className="study-plan-grid">
                <label className="study-plan-field study-plan-field-full">
                  <span>Course</span>
                  <select
                    value={quizBuilderCourseId}
                    onChange={(e) => handleQuizBuilderCourseChange(e.target.value)}
                  >
                    <option value="">Select a course</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>{course.name}</option>
                    ))}
                  </select>
                </label>

                <label className="study-plan-field study-plan-field-full">
                  <span>Quiz title</span>
                  <input
                    type="text"
                    value={quizBuilderTitle}
                    onChange={(e) => setQuizBuilderTitle(e.target.value)}
                    placeholder="Midterm review quiz, Module 5 practice quiz..."
                  />
                </label>

                <div className="study-plan-field study-plan-field-full">
                  <span>Modules</span>
                  <div className="study-module-list">
                    {quizBuilderModules.map((module) => (
                      <label
                        key={module.id}
                        className={`study-module-item ${quizBuilderSelectedModuleIds.includes(String(module.id)) ? "active" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={quizBuilderSelectedModuleIds.includes(String(module.id))}
                          onChange={() => toggleQuizBuilderModule(module.id)}
                        />
                        <span>{module.name}</span>
                      </label>
                    ))}
                    {quizBuilderCourseId && quizBuilderModules.length === 0 && (
                      <p className="study-plan-caption">No modules loaded for this course yet.</p>
                    )}
                  </div>
                </div>

                <div className="study-plan-field study-plan-field-full">
                  <span>Files</span>
                  <div className="study-module-list">
                    {quizBuilderFiles.map((file) => (
                      <label
                        key={file.id}
                        className={`study-module-item ${quizBuilderSelectedFileIds.includes(String(file.id)) ? "active" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={quizBuilderSelectedFileIds.includes(String(file.id))}
                          onChange={() => toggleQuizBuilderFile(file.id)}
                        />
                        <span>{file.display_name}</span>
                      </label>
                    ))}
                    {quizBuilderFiles.length === 0 && (
                      <p className="study-plan-caption">Select one or more modules to narrow quiz files, or leave files empty to use module scope.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="study-plan-actions">
                <button
                  type="button"
                  className="action-btn primary"
                  onClick={handleGenerateManualQuiz}
                  disabled={quizGenerating || !quizBuilderCourseId}
                >
                  {quizGenerating ? <><span className="spinner-sm" /> Generating...</> : "Generate Quiz"}
                </button>
              </div>
            </section>

            {savedQuizzesLoading && <p className="muted loading-msg">Loading quizzes...</p>}
            {savedQuizzesError && <div className="status error topbar-error">{savedQuizzesError}</div>}
            {quizSubmitStatus && <div className="status success topbar-error">{quizSubmitStatus}</div>}

            {savedQuizzes.length > 0 && (
              <div className="course-grid study-plan-grid-list">
                {savedQuizzes.map((quiz) => (
                  <div key={quiz.id} className="course-card study-plan-saved-card">
                    <div className="course-card-banner study-plan-saved-banner">
                      <span className="course-card-initials">QZ</span>
                    </div>
                    <div className="course-card-body">
                      <div className="course-card-code">{quiz.courseName}</div>
                      <div className="course-card-name">{quiz.title}</div>
                      <p className="muted study-plan-saved-meta">
                        {quiz.taken ? `Completed - ${quiz.lastAttempt?.score ?? 0}%` : "Not taken yet"}
                      </p>
                    </div>
                    <div className="course-card-footer">
                      <button
                        type="button"
                        className="action-btn primary"
                        onClick={() => handleOpenQuiz(quiz)}
                      >
                        {quiz.taken ? "Review Quiz" : "Take Quiz"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {openedQuiz && (
              <section className="card study-plan-library-detail">
                <div className="card-header-row">
                  <div>
                    <p className="section-kicker">Saved quiz</p>
                    <h2>{openedQuiz.title}</h2>
                  </div>
                  <button type="button" className="action-btn" onClick={() => setOpenedQuiz(null)}>
                    Close
                  </button>
                </div>

                <div className="quiz-question-list">
                  {(openedQuiz.questions || []).map((question, index) => {
                    const submittedAnswer = openedQuiz.lastAttempt?.answers?.find(
                      (answer) => String(answer.questionId) === String(question.id)
                    );
                    const selectedIndex = openedQuiz.taken
                      ? submittedAnswer?.selectedIndex
                      : quizDraftAnswers[question.id];
                    return (
                      <div key={question.id} className="quiz-question-card">
                        <strong>{index + 1}. {question.prompt}</strong>
                        <div className="quiz-option-list">
                          {question.options.map((option, optionIndex) => {
                            const isChecked = selectedIndex === optionIndex;
                            const isCorrect = openedQuiz.taken && question.answerIndex === optionIndex;
                            const isWrongSelection =
                              openedQuiz.taken &&
                              submittedAnswer?.selectedIndex === optionIndex &&
                              question.answerIndex !== optionIndex;
                            return (
                              <label
                                key={`${question.id}-${optionIndex}`}
                                className={`quiz-option ${isCorrect ? "correct" : ""} ${isWrongSelection ? "wrong" : ""}`}
                              >
                                <input
                                  type="radio"
                                  name={`question-${question.id}`}
                                  checked={Boolean(isChecked)}
                                  onChange={() => handleQuizAnswerChange(question.id, optionIndex)}
                                  disabled={openedQuiz.taken}
                                />
                                <span>{option}</span>
                              </label>
                            );
                          })}
                        </div>
                        {openedQuiz.taken && (
                          <p className="study-plan-caption">
                            {question.explanation}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {!openedQuiz.taken && (
                  <div className="study-plan-actions">
                    <button type="button" className="action-btn primary" onClick={handleSubmitQuiz}>
                      Submit Quiz
                    </button>
                  </div>
                )}
              </section>
            )}
          </section>
        )}

        {/* Course Detail */}
        {showCourseDetail && !showStudyPlansView && !showQuizzesView && (
          <>
            {loading && <p className="muted loading-msg">Loading course data...</p>}

            {/* Modules */}
            <section className="card">
              <div className="section-head">
                <div>
                  <p className="section-kicker">Course content</p>
                  <h2>Modules</h2>
                </div>
                {modules.length > 0 && <span className="count-pill">{modules.length}</span>}
              </div>

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
