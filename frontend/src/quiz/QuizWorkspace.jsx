import { useEffect, useMemo, useRef, useState } from "react";
import "../study-plan/study-plan.css";
import "./quiz.css";

function getRouteQuizId(routePath = "") {
  if (routePath === "/quiz/draft") return "draft";
  if (routePath.startsWith("/quiz/")) return decodeURIComponent(routePath.replace("/quiz/", ""));
  return null;
}

export default function QuizWorkspace({
  apiBase,
  apiFetchJson,
  user,
  courses,
  routePath,
  onNavigateList,
  onNavigateDraft,
  onNavigateSavedQuiz,
}) {
  const workspaceRef = useRef(null);
  const [courseId, setCourseId] = useState("");
  const [modules, setModules] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [quizTitle, setQuizTitle] = useState("");
  const [savedQuizzes, setSavedQuizzes] = useState([]);
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [openedQuiz, setOpenedQuiz] = useState(null);
  const [draftAnswers, setDraftAnswers] = useState({});
  const routeQuizId = useMemo(() => getRouteQuizId(routePath), [routePath]);
  const isDetailRoute = Boolean(routeQuizId);
  const isDraftRoute = routeQuizId === "draft";

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.id) === String(courseId)) || null,
    [courseId, courses]
  );

  useEffect(() => {
    async function loadSavedQuizzes() {
      if (!user?.id) return;
      try {
        const data = await apiFetchJson(`${apiBase}/quizzes?userId=${encodeURIComponent(user.id)}`, {
          headers: {},
        });
        setSavedQuizzes(Array.isArray(data) ? data : []);
      } catch {
        setSavedQuizzes([]);
      }
    }

    loadSavedQuizzes();
  }, [apiBase, apiFetchJson, user?.id]);

  useEffect(() => {
    async function loadModules() {
      if (!courseId) {
        setModules([]);
        return;
      }
      try {
        const data = await apiFetchJson(`${apiBase}/modules?courseId=${encodeURIComponent(courseId)}`, {
          headers: {},
        });
        setModules(Array.isArray(data) ? data : []);
      } catch {
        setModules([]);
      }
    }

    loadModules();
  }, [apiBase, apiFetchJson, courseId]);

  useEffect(() => {
    async function loadFiles() {
      if (!courseId || selectedModuleIds.length === 0) {
        setFiles([]);
        return;
      }

      try {
        const responses = await Promise.all(
          selectedModuleIds.map((moduleId) =>
            apiFetchJson(
              `${apiBase}/module-files?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(moduleId)}`,
              { headers: {} }
            ).catch(() => [])
          )
        );
        const flat = responses.flatMap((entry) => (Array.isArray(entry) ? entry : []));
        const unique = flat.filter(
          (file, index, list) => list.findIndex((candidate) => String(candidate.id) === String(file.id)) === index
        );
        setFiles(unique);
      } catch {
        setFiles([]);
      }
    }

    loadFiles();
  }, [apiBase, apiFetchJson, courseId, selectedModuleIds]);

  function handleCourseChange(nextCourseId) {
    setCourseId(nextCourseId);
    setSelectedModuleIds([]);
    setSelectedFileIds([]);
    setFiles([]);
    setQuizTitle("");
    setOpenedQuiz(null);
    setDraftAnswers({});
    setStatus("");
  }

  function toggleModule(moduleId) {
    const normalized = String(moduleId);
    setSelectedModuleIds((prev) =>
      prev.includes(normalized) ? prev.filter((id) => id !== normalized) : [...prev, normalized]
    );
  }

  function toggleFile(fileId) {
    const normalized = String(fileId);
    setSelectedFileIds((prev) =>
      prev.includes(normalized) ? prev.filter((id) => id !== normalized) : [...prev, normalized]
    );
  }

  async function refreshSavedQuizzes() {
    if (!user?.id) return;
    const data = await apiFetchJson(`${apiBase}/quizzes?userId=${encodeURIComponent(user.id)}`, { headers: {} });
    setSavedQuizzes(Array.isArray(data) ? data : []);
  }

  async function handleGenerateQuiz() {
    if (!user?.id || !selectedCourse) return;
    setGenerating(true);
    setStatus("");
    try {
      const data = await apiFetchJson(`${apiBase}/quizzes/generate`, {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          courseId: selectedCourse.id,
          courseName: selectedCourse.name,
          mode: "manual",
          title: quizTitle.trim() || `${selectedCourse.name} Custom Quiz`,
          selectedModuleIds,
          selectedFileIds,
        }),
      });
      const quiz = Array.isArray(data) ? data[0] : null;
      setOpenedQuiz(quiz);
      setDraftAnswers({});
      onNavigateDraft?.();
      requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      await refreshSavedQuizzes();
      setStatus("Quiz created.");
    } catch (err) {
      setStatus(err.message || "Failed to create quiz");
    } finally {
      setGenerating(false);
    }
  }

  function openQuiz(quiz) {
    setCourseId(String(quiz.courseId));
    setQuizTitle(quiz.title || "");
    setSelectedModuleIds(Array.isArray(quiz.selectedModuleIds) ? quiz.selectedModuleIds.map(String) : []);
    setSelectedFileIds(Array.isArray(quiz.selectedFileIds) ? quiz.selectedFileIds.map(String) : []);
    setOpenedQuiz(quiz);
    setDraftAnswers({});
    setStatus("");
    onNavigateSavedQuiz?.(quiz.id);
    requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function setAnswer(questionId, answerIndex) {
    setDraftAnswers((prev) => ({ ...prev, [questionId]: answerIndex }));
  }

  async function submitQuiz() {
    if (!openedQuiz || !user?.id) return;
    try {
      const updated = await apiFetchJson(`${apiBase}/quizzes/${openedQuiz.id}/submit`, {
        method: "PUT",
        body: JSON.stringify({
          userId: user.id,
          answers: Object.entries(draftAnswers).map(([questionId, answerIndex]) => ({
            questionId,
            answerIndex,
          })),
        }),
      });
      setOpenedQuiz(updated);
      await refreshSavedQuizzes();
      setStatus(`Quiz submitted. Score: ${updated.lastAttempt?.score ?? 0}%`);
    } catch (err) {
      setStatus(err.message || "Failed to submit quiz");
    }
  }

  async function handleUpdateQuiz() {
    if (!openedQuiz || !user?.id || !selectedCourse) return;
    setGenerating(true);
    setStatus("");
    try {
      const updated = await apiFetchJson(`${apiBase}/quizzes/${encodeURIComponent(openedQuiz.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          userId: user.id,
          courseId: selectedCourse.id,
          courseName: selectedCourse.name,
          title: quizTitle.trim() || openedQuiz.title,
          selectedModuleIds,
          selectedFileIds,
        }),
      });
      setOpenedQuiz(updated);
      setDraftAnswers({});
      setSavedQuizzes((prev) => prev.map((quiz) => (quiz.id === updated.id ? updated : quiz)));
      setStatus("Quiz updated.");
    } catch (err) {
      setStatus(err.message || "Failed to update quiz");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteQuiz(quizId) {
    if (!user?.id || !quizId) return;
    setStatus("");
    try {
      await apiFetchJson(`${apiBase}/quizzes/${encodeURIComponent(quizId)}?userId=${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      setSavedQuizzes((prev) => prev.filter((quiz) => quiz.id !== quizId));
      if (openedQuiz?.id === quizId) {
        setOpenedQuiz(null);
        setDraftAnswers({});
      }
      onNavigateList?.();
      setStatus("Quiz deleted.");
    } catch (err) {
      setStatus(err.message || "Failed to delete quiz");
    }
  }

  useEffect(() => {
    if (!routeQuizId || routeQuizId === "draft") return;
    const matchedQuiz = savedQuizzes.find((quiz) => quiz.id === routeQuizId);
    if (!matchedQuiz) return;
    setCourseId(String(matchedQuiz.courseId));
    setQuizTitle(matchedQuiz.title || "");
    setSelectedModuleIds(Array.isArray(matchedQuiz.selectedModuleIds) ? matchedQuiz.selectedModuleIds.map(String) : []);
    setSelectedFileIds(Array.isArray(matchedQuiz.selectedFileIds) ? matchedQuiz.selectedFileIds.map(String) : []);
    setOpenedQuiz(matchedQuiz);
    setDraftAnswers({});
  }, [routeQuizId, savedQuizzes]);

  return (
    <div className="feature-workspace" ref={workspaceRef}>
      {!isDetailRoute ? (
        <>
      <div className="feature-header">
        <span className="panel-badge feature-panel-badge">Manual builder</span>
        <h2>Create Quiz</h2>
        <p>Build richer quizzes from selected course materials, reopen them later, and manage each one from this workspace.</p>
      </div>

      <section className="feature-card feature-builder-card feature-builder-shell">
        <div className="feature-builder-head">
          <div>
            <h3>Quiz Setup</h3>
            <p className="feature-subcopy">Choose the course scope, optionally narrow it by modules and files, then generate or refresh the quiz.</p>
          </div>
          {openedQuiz ? (
            <button type="button" className="secondary-button" onClick={() => setOpenedQuiz(null)}>
              New Quiz
            </button>
          ) : null}
        </div>

        <div className="feature-form-grid">
          <label className="feature-field">
            <span>Course</span>
            <select value={courseId} onChange={(event) => handleCourseChange(event.target.value)}>
              <option value="">Select a course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
          </label>

          <label className="feature-field">
            <span>Quiz title</span>
            <input
              type="text"
              value={quizTitle}
              onChange={(event) => setQuizTitle(event.target.value)}
              placeholder="Module 5 review quiz"
            />
          </label>
        </div>

        <div className="feature-field">
          <span>Modules</span>
          <div className="feature-chip-list">
            {modules.map((module) => (
              <button
                key={module.id}
                type="button"
                className={`feature-chip ${selectedModuleIds.includes(String(module.id)) ? "active" : ""}`}
                onClick={() => toggleModule(module.id)}
              >
                {module.name}
              </button>
            ))}
          </div>
        </div>

        <div className="feature-field">
          <span>Files</span>
          <div className="feature-chip-list">
            {files.map((file) => (
              <button
                key={file.id}
                type="button"
                className={`feature-chip ${selectedFileIds.includes(String(file.id)) ? "active" : ""}`}
                onClick={() => toggleFile(file.id)}
              >
                {file.display_name}
              </button>
            ))}
            {selectedModuleIds.length > 0 && files.length === 0 ? <p className="feature-muted">No files found for those modules.</p> : null}
          </div>
        </div>

        <div className="feature-actions">
          <button type="button" className="primary-button" onClick={handleGenerateQuiz} disabled={generating || !courseId}>
            {generating ? "Generating..." : "Generate Quiz"}
          </button>
          <button type="button" className="secondary-button" onClick={handleUpdateQuiz} disabled={generating || !openedQuiz || !courseId}>
            Update Quiz
          </button>
          <button type="button" className="danger-button" onClick={() => handleDeleteQuiz(openedQuiz?.id)} disabled={!openedQuiz}>
            Delete Quiz
          </button>
        </div>

        {status ? <div className="feature-status">{status}</div> : null}
      </section>

      <section className="feature-card">
        <div className="feature-library-head">
          <div>
            <h3>Saved Quizzes</h3>
            <p className="feature-subcopy">Open a saved quiz into the main workspace, refresh it with new material, or delete it.</p>
          </div>
        </div>
        {savedQuizzes.length === 0 ? (
          <p className="feature-muted">No saved quizzes yet.</p>
        ) : (
          <div className="feature-library">
            {savedQuizzes.map((quiz) => {
              const isActive = openedQuiz?.id === quiz.id;
              return (
                <div key={quiz.id} className={`feature-library-card feature-library-card-rich ${isActive ? "active" : ""}`}>
                  <div className="feature-library-card-copy">
                    <div className="feature-library-badge-row">
                      <span className="feature-mini-badge">{quiz.taken ? "Completed" : "Ready to take"}</span>
                      <span className="feature-library-date">{quiz.taken ? `${quiz.lastAttempt?.score ?? 0}%` : `${quiz.questions?.length || 0} questions`}</span>
                    </div>
                    <strong>{quiz.title}</strong>
                    <p>{quiz.courseName}</p>
                  </div>
                  <div className="feature-inline-actions">
                    <button
                      type="button"
                      className="secondary-button feature-inline-button"
                      onClick={() => openQuiz(quiz)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="danger-button feature-inline-button"
                      onClick={() => handleDeleteQuiz(quiz.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
        </>
      ) : null}

      {isDetailRoute ? (
        <section className="feature-card feature-output-card feature-detail-shell">
          <div className="feature-detail-topbar">
            <button type="button" className="secondary-button" onClick={() => onNavigateList?.()}>
              Back To Quizzes
            </button>
            <div className="feature-inline-actions">
              <button type="button" className="secondary-button" onClick={handleUpdateQuiz} disabled={generating || !openedQuiz || !courseId}>
                Update Quiz
              </button>
              <button type="button" className="danger-button" onClick={() => handleDeleteQuiz(openedQuiz?.id)} disabled={!openedQuiz}>
                Delete Quiz
              </button>
            </div>
          </div>

          {openedQuiz ? (
            <>
              <div className="feature-output-hero">
                <div>
                  <span className="panel-badge feature-panel-badge">{isDraftRoute ? "New quiz" : openedQuiz?.taken ? "Quiz review" : "Quiz workspace"}</span>
                  <h3>{openedQuiz.title}</h3>
                  <p>{openedQuiz.description}</p>
                </div>
                <div className="feature-output-meta">
                  <span>{openedQuiz.courseName}</span>
                  <span>{openedQuiz.questions?.length || 0} questions</span>
                  <span>{openedQuiz.taken ? "Completed" : "In progress"}</span>
                </div>
              </div>

              <div className="feature-results">
                {(openedQuiz.questions || []).map((question, index) => {
                  const submittedAnswer = openedQuiz.lastAttempt?.answers?.find(
                    (answer) => String(answer.questionId) === String(question.id)
                  );
                  const selectedIndex = openedQuiz.taken ? submittedAnswer?.selectedIndex : draftAnswers[question.id];

                  return (
                    <div key={question.id} className="feature-result-item quiz-question">
                      <strong>{index + 1}. {question.prompt}</strong>
                      <div className="quiz-option-list">
                        {question.options.map((option, optionIndex) => {
                          const isCorrect = openedQuiz.taken && question.answerIndex === optionIndex;
                          const isWrong =
                            openedQuiz.taken &&
                            submittedAnswer?.selectedIndex === optionIndex &&
                            question.answerIndex !== optionIndex;

                          return (
                            <label
                              key={`${question.id}-${optionIndex}`}
                              className={`quiz-option ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`}
                            >
                              <input
                                type="radio"
                                name={`quiz-${question.id}`}
                                checked={selectedIndex === optionIndex}
                                onChange={() => setAnswer(question.id, optionIndex)}
                                disabled={openedQuiz.taken}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                      {openedQuiz.taken ? <p className="quiz-explanation">{question.explanation}</p> : null}
                    </div>
                  );
                })}

                <div className="feature-actions">
                  {!openedQuiz.taken ? (
                    <button type="button" className="primary-button" onClick={submitQuiz}>
                      Submit Quiz
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="feature-status">No quiz is open yet.</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
