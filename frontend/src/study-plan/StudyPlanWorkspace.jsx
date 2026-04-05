import { useEffect, useMemo, useRef, useState } from "react";
import "./study-plan.css";
import config from "./study-plan.config.json";

const DAY_NAMES = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
  { short: "Sun", full: "Sunday" },
];

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateInput, days) {
  const date = new Date(`${dateInput}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function createInitialForm(courseName = "") {
  const startDate = getToday();
  return {
    startDate,
    endDate: addDays(startDate, 14),
    objective: courseName ? `Stay on track in ${courseName}` : "Stay on track",
    hoursPerWeek: config.defaults.hoursPerWeek,
    sessionMinutes: config.defaults.sessionMinutes,
    pace: config.defaults.pace,
    includeAssignments: config.defaults.includeAssignments,
    focusDays: [...config.defaults.focusDays],
    priorities: [],
    selectedModuleIds: [],
  };
}

function formatDate(dateValue) {
  if (!dateValue) return "No date";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function createFormFromSavedPlan(savedPlan) {
  return {
    startDate: savedPlan.preferences?.startDate || getToday(),
    endDate: savedPlan.preferences?.endDate || addDays(getToday(), 14),
    objective: savedPlan.goalName || savedPlan.planName || "Stay on track",
    hoursPerWeek: Number(savedPlan.preferences?.hoursPerWeek || config.defaults.hoursPerWeek),
    sessionMinutes: Number(savedPlan.preferences?.sessionMinutes || config.defaults.sessionMinutes),
    pace: savedPlan.preferences?.pace || config.defaults.pace,
    includeAssignments:
      typeof savedPlan.preferences?.includeAssignments === "boolean"
        ? savedPlan.preferences.includeAssignments
        : config.defaults.includeAssignments,
    focusDays: Array.isArray(savedPlan.preferences?.focusDays)
      ? savedPlan.preferences.focusDays
      : [...config.defaults.focusDays],
    priorities: Array.isArray(savedPlan.preferences?.priorities) ? savedPlan.preferences.priorities : [],
    selectedModuleIds: Array.isArray(savedPlan.preferences?.selectedModuleIds)
      ? savedPlan.preferences.selectedModuleIds.map(String)
      : Array.isArray(savedPlan.scopedModules)
        ? savedPlan.scopedModules.map((module) => String(module.id))
        : [],
  };
}

function formatShortDate(dateValue) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatSessionLabel(minutes) {
  const total = Number(minutes) || 60;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours > 0 && remainder > 0) return `${hours}h ${remainder}m`;
  if (hours > 0) return `${hours}h`;
  return `${remainder}m`;
}

function buildDailySchedule(weeklyPlan = [], preferences = {}) {
  const startDate = preferences.startDate || getToday();
  const focusDays = Array.isArray(preferences.focusDays) && preferences.focusDays.length > 0
    ? preferences.focusDays
    : [...config.defaults.focusDays];
  const sessionLabel = formatSessionLabel(preferences.sessionMinutes);

  return (weeklyPlan || []).map((week, weekIndex) => {
    const weekStart = addDays(startDate, weekIndex * 7);
    const days = DAY_NAMES.map((day, dayIndex) => {
      const date = addDays(weekStart, dayIndex);
      const active = focusDays.includes(day.short);
      const taskPool = Array.isArray(week.tasks) ? week.tasks : [];
      const derivedTasks = active
        ? taskPool.length > 0
          ? [taskPool[dayIndex % taskPool.length]]
          : [`Review the key ideas for ${week.focus || `Week ${weekIndex + 1}`}.`]
        : [];

      return {
        dayKey: day.short,
        label: day.full,
        date,
        schedule: active ? `${sessionLabel} study block` : "Open slot",
        tasks: derivedTasks,
      };
    });

    return {
      weekLabel: week.day || `Week ${weekIndex + 1}`,
      focus: week.focus || "",
      days,
    };
  });
}

function ensurePlanShape(plan, preferences) {
  const normalizedPlan = plan ? { ...plan } : {};
  const weeklyPlan = Array.isArray(normalizedPlan.weeklyPlan) ? normalizedPlan.weeklyPlan : [];
  return {
    ...normalizedPlan,
    weeklyPlan,
    dailySchedule:
      Array.isArray(normalizedPlan.dailySchedule) && normalizedPlan.dailySchedule.length > 0
        ? normalizedPlan.dailySchedule
        : buildDailySchedule(weeklyPlan, preferences),
  };
}

function getRoutePlanId(routePath = "") {
  if (routePath === "/study-plan/draft") return "draft";
  if (routePath.startsWith("/study-plan/")) return decodeURIComponent(routePath.replace("/study-plan/", ""));
  return null;
}

export default function StudyPlanWorkspace({
  apiBase,
  apiFetchJson,
  user,
  courses,
  routePath,
  onNavigateList,
  onNavigateDraft,
  onNavigateSavedPlan,
}) {
  const workspaceRef = useRef(null);
  const [courseId, setCourseId] = useState("");
  const [modules, setModules] = useState([]);
  const [form, setForm] = useState(createInitialForm());
  const [building, setBuilding] = useState(false);
  const [planResult, setPlanResult] = useState(null);
  const [status, setStatus] = useState("");
  const [savedPlans, setSavedPlans] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [activeSavedPlanId, setActiveSavedPlanId] = useState(null);
  const routePlanId = useMemo(() => getRoutePlanId(routePath), [routePath]);
  const isDetailRoute = Boolean(routePlanId);
  const isDraftRoute = routePlanId === "draft";

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.id) === String(courseId)) || null,
    [courseId, courses]
  );

  useEffect(() => {
    async function loadSavedPlans() {
      if (!user?.id) return;
      setSavedLoading(true);
      try {
        const data = await apiFetchJson(`${apiBase}/study-plans?userId=${encodeURIComponent(user.id)}`, {
          headers: {},
        });
        setSavedPlans(Array.isArray(data) ? data : []);
      } catch {
        setSavedPlans([]);
      } finally {
        setSavedLoading(false);
      }
    }

    loadSavedPlans();
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

  function handleCourseChange(nextCourseId) {
    setCourseId(nextCourseId);
    const course = courses.find((item) => String(item.id) === String(nextCourseId));
    setForm(createInitialForm(course?.name || ""));
    setPlanResult(null);
    setActiveSavedPlanId(null);
    setStatus("");
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleFocusDay(dayKey) {
    setForm((prev) => ({
      ...prev,
      focusDays: prev.focusDays.includes(dayKey)
        ? prev.focusDays.filter((day) => day !== dayKey)
        : [...prev.focusDays, dayKey],
    }));
  }

  function toggleModule(moduleId) {
    const normalized = String(moduleId);
    setForm((prev) => ({
      ...prev,
      selectedModuleIds: prev.selectedModuleIds.includes(normalized)
        ? prev.selectedModuleIds.filter((id) => id !== normalized)
        : [...prev.selectedModuleIds, normalized],
    }));
  }

  async function handleBuildPlan() {
    if (!courseId) return;
    setBuilding(true);
    setStatus("");
    try {
      const data = await apiFetchJson(`${apiBase}/study-plan`, {
        method: "POST",
        body: JSON.stringify({
          courseId,
          userId: user?.id || null,
          preferences: form,
        }),
      });
      setPlanResult({
        ...data,
        plan: ensurePlanShape(data.plan, data.preferences || form),
      });
      onNavigateDraft?.();
      requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      setStatus(data.autoQuizCount ? `Study plan built. ${data.autoQuizCount} module quiz(es) were also created.` : "Study plan built.");
    } catch (err) {
      setStatus(err.message || "Failed to build study plan");
    } finally {
      setBuilding(false);
    }
  }

  async function handleSavePlan() {
    if (!user?.id || !planResult) return;
    setStatus("");
    try {
      const savedPlan = await apiFetchJson(`${apiBase}/study-plans`, {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          planName: form.objective,
          goalName: form.objective,
          courseId: planResult.courseId,
          courseName: planResult.courseName,
          preferences: {
            ...planResult.preferences,
            ...form,
            selectedModuleIds: form.selectedModuleIds,
          },
          scopedModules: planResult.scopedModules || [],
          plan: planResult.plan,
          schedule: planResult.plan?.weeklyPlan || [],
        }),
      });
      setSavedPlans((prev) => [savedPlan, ...prev.filter((plan) => plan.id !== savedPlan.id)]);
      setActiveSavedPlanId(savedPlan.id);
      setPlanResult({
        courseId: savedPlan.courseId,
        courseName: savedPlan.courseName,
        preferences: savedPlan.preferences,
        scopedModules: savedPlan.scopedModules,
        plan: ensurePlanShape(savedPlan.plan, savedPlan.preferences),
        autoQuizCount: 0,
      });
      onNavigateSavedPlan?.(savedPlan.id);
      setStatus("Study plan saved.");
    } catch (err) {
      setStatus(err.message || "Failed to save study plan");
    }
  }

  async function handleUpdatePlan() {
    if (!user?.id || !activeSavedPlanId || !planResult) return;
    setStatus("");
    try {
      const updatedPlan = await apiFetchJson(`${apiBase}/study-plans/${encodeURIComponent(activeSavedPlanId)}`, {
        method: "PUT",
        body: JSON.stringify({
          userId: user.id,
          planName: form.objective,
          goalName: form.objective,
          courseId: planResult.courseId,
          courseName: planResult.courseName,
          preferences: {
            ...planResult.preferences,
            ...form,
            selectedModuleIds: form.selectedModuleIds,
          },
          scopedModules: planResult.scopedModules || [],
          plan: planResult.plan,
          schedule: planResult.plan?.weeklyPlan || [],
        }),
      });
      setSavedPlans((prev) => prev.map((plan) => (plan.id === updatedPlan.id ? updatedPlan : plan)));
      setPlanResult({
        courseId: updatedPlan.courseId,
        courseName: updatedPlan.courseName,
        preferences: updatedPlan.preferences,
        scopedModules: updatedPlan.scopedModules,
        plan: ensurePlanShape(updatedPlan.plan, updatedPlan.preferences),
        autoQuizCount: 0,
      });
      setStatus("Saved plan updated.");
    } catch (err) {
      setStatus(err.message || "Failed to update plan");
    }
  }

  async function handleDeletePlan(planId) {
    if (!user?.id || !planId) return;
    setStatus("");
    try {
      await apiFetchJson(`${apiBase}/study-plans/${encodeURIComponent(planId)}?userId=${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      setSavedPlans((prev) => prev.filter((plan) => plan.id !== planId));
      if (activeSavedPlanId === planId) {
        setActiveSavedPlanId(null);
        setPlanResult(null);
      }
      onNavigateList?.();
      setStatus("Study plan deleted.");
    } catch (err) {
      setStatus(err.message || "Failed to delete plan");
    }
  }

  function openSavedPlan(savedPlan) {
    setCourseId(String(savedPlan.courseId));
    setForm(createFormFromSavedPlan(savedPlan));
    setPlanResult({
      courseId: savedPlan.courseId,
      courseName: savedPlan.courseName,
      preferences: savedPlan.preferences,
      scopedModules: savedPlan.scopedModules || [],
      plan: ensurePlanShape(savedPlan.plan, savedPlan.preferences),
      autoQuizCount: 0,
    });
    setActiveSavedPlanId(savedPlan.id);
    setStatus(`Opened saved plan "${savedPlan.planName}".`);
    onNavigateSavedPlan?.(savedPlan.id);
    requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function updateDayTask(weekIndex, dayIndex, taskIndex, value) {
    setPlanResult((prev) => {
      if (!prev?.plan?.dailySchedule) return prev;
      const dailySchedule = prev.plan.dailySchedule.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          days: week.days.map((day, currentDayIndex) => {
            if (currentDayIndex !== dayIndex) return day;
            return {
              ...day,
              tasks: day.tasks.map((task, currentTaskIndex) => (currentTaskIndex === taskIndex ? value : task)),
            };
          }),
        };
      });
      return { ...prev, plan: { ...prev.plan, dailySchedule } };
    });
  }

  function addDayTask(weekIndex, dayIndex) {
    setPlanResult((prev) => {
      if (!prev?.plan?.dailySchedule) return prev;
      const dailySchedule = prev.plan.dailySchedule.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          days: week.days.map((day, currentDayIndex) => {
            if (currentDayIndex !== dayIndex) return day;
            return {
              ...day,
              tasks: [...(day.tasks || []), ""],
            };
          }),
        };
      });
      return { ...prev, plan: { ...prev.plan, dailySchedule } };
    });
  }

  function removeDayTask(weekIndex, dayIndex, taskIndex) {
    setPlanResult((prev) => {
      if (!prev?.plan?.dailySchedule) return prev;
      const dailySchedule = prev.plan.dailySchedule.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          days: week.days.map((day, currentDayIndex) => {
            if (currentDayIndex !== dayIndex) return day;
            return {
              ...day,
              tasks: day.tasks.filter((_, currentTaskIndex) => currentTaskIndex !== taskIndex),
            };
          }),
        };
      });
      return { ...prev, plan: { ...prev.plan, dailySchedule } };
    });
  }

  useEffect(() => {
    if (!routePlanId || routePlanId === "draft") return;
    const savedPlan = savedPlans.find((plan) => plan.id === routePlanId);
    if (!savedPlan) return;
    setCourseId(String(savedPlan.courseId));
    setForm(createFormFromSavedPlan(savedPlan));
    setPlanResult({
      courseId: savedPlan.courseId,
      courseName: savedPlan.courseName,
      preferences: savedPlan.preferences,
      scopedModules: savedPlan.scopedModules || [],
      plan: ensurePlanShape(savedPlan.plan, savedPlan.preferences),
      autoQuizCount: 0,
    });
    setActiveSavedPlanId(savedPlan.id);
  }, [routePlanId, savedPlans]);

  useEffect(() => {
    if (planResult?.plan) {
      setPlanResult((prev) => {
        if (!prev?.plan) return prev;
        const nextPlan = ensurePlanShape(prev.plan, form);
        if (nextPlan.dailySchedule === prev.plan.dailySchedule) return prev;
        return { ...prev, plan: nextPlan };
      });
    }
  }, [form.focusDays, form.sessionMinutes]);

  const activeSavedPlan = useMemo(
    () => savedPlans.find((plan) => plan.id === activeSavedPlanId) || null,
    [savedPlans, activeSavedPlanId]
  );

  const detailTitle = activeSavedPlan?.planName || form.objective || planResult?.courseName;

  return (
    <div className="feature-workspace" ref={workspaceRef}>
      {!isDetailRoute ? (
        <>
      <div className="feature-header">
        <span className="panel-badge feature-panel-badge">Manual builder</span>
        <h2>Build Study Plan</h2>
        <p>Design a polished study roadmap, reopen it later, and keep refining it without losing your place.</p>
      </div>

      <section className="feature-card feature-builder-card feature-builder-shell">
        <div className="feature-builder-head">
          <div>
            <h3>Plan Setup</h3>
            <p className="feature-subcopy">Pick the course, narrow the module scope, then generate or refresh the plan.</p>
          </div>
          {planResult ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPlanResult(null);
                setActiveSavedPlanId(null);
                setStatus("");
              }}
            >
              Build Another
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
            <span>Goal name</span>
            <input
              type="text"
              value={form.objective}
              onChange={(event) => updateField("objective", event.target.value)}
              placeholder="Midterm 2 prep"
            />
          </label>

          <div className="feature-row">
            <label className="feature-field">
              <span>Start date</span>
              <input type="date" value={form.startDate} onChange={(event) => updateField("startDate", event.target.value)} />
            </label>
            <label className="feature-field">
              <span>End date</span>
              <input type="date" value={form.endDate} onChange={(event) => updateField("endDate", event.target.value)} />
            </label>
          </div>

          <div className="feature-row">
            <label className="feature-field">
              <span>Hours per week</span>
              <input
                type="number"
                min="1"
                value={form.hoursPerWeek}
                onChange={(event) => updateField("hoursPerWeek", Number(event.target.value) || 1)}
              />
            </label>
            <label className="feature-field">
              <span>Session minutes</span>
              <input
                type="number"
                min="15"
                step="15"
                value={form.sessionMinutes}
                onChange={(event) => updateField("sessionMinutes", Number(event.target.value) || 60)}
              />
            </label>
          </div>

          <label className="feature-field">
            <span>Pace</span>
            <select value={form.pace} onChange={(event) => updateField("pace", event.target.value)}>
              <option value="light">Light</option>
              <option value="balanced">Balanced</option>
              <option value="intensive">Intensive</option>
            </select>
          </label>
        </div>

        <div className="feature-field">
          <span>Study days</span>
          <div className="feature-chip-list">
            {DAY_NAMES.map((day) => (
              <button
                key={day.short}
                type="button"
                className={`feature-chip ${form.focusDays.includes(day.short) ? "active" : ""}`}
                onClick={() => toggleFocusDay(day.short)}
              >
                {day.full}
              </button>
            ))}
          </div>
        </div>

        <div className="feature-field">
          <span>Modules</span>
          <div className="feature-chip-list">
            {modules.map((module) => (
              <button
                key={module.id}
                type="button"
                className={`feature-chip ${form.selectedModuleIds.includes(String(module.id)) ? "active" : ""}`}
                onClick={() => toggleModule(module.id)}
              >
                {module.name}
              </button>
            ))}
            {selectedCourse && modules.length === 0 ? <p className="feature-muted">No modules found yet.</p> : null}
          </div>
        </div>

        <div className="feature-actions">
          <button type="button" className="primary-button" onClick={handleBuildPlan} disabled={building || !courseId}>
            {building ? "Building..." : "Build Study Plan"}
          </button>
          <button type="button" className="secondary-button" onClick={handleSavePlan} disabled={!planResult || Boolean(activeSavedPlanId)}>
            Save Plan
          </button>
          <button type="button" className="secondary-button" onClick={handleUpdatePlan} disabled={!planResult || !activeSavedPlanId}>
            Update Plan
          </button>
          <button type="button" className="danger-button" onClick={() => handleDeletePlan(activeSavedPlanId)} disabled={!activeSavedPlanId}>
            Delete Plan
          </button>
        </div>

        {status ? <div className="feature-status">{status}</div> : null}
      </section>

      <section className="feature-card">
        <div className="feature-library-head">
          <div>
            <h3>Saved Plans</h3>
            <p className="feature-subcopy">Open any saved roadmap in this tab, then update or delete it from the main workspace.</p>
          </div>
        </div>
        {savedLoading ? (
          <p className="feature-muted">Loading saved plans...</p>
        ) : savedPlans.length === 0 ? (
          <p className="feature-muted">No saved study plans yet.</p>
        ) : (
          <div className="feature-library">
            {savedPlans.map((plan) => {
              const isActive = plan.id === activeSavedPlanId;
              return (
                <div key={plan.id} className={`feature-library-card feature-library-card-rich ${isActive ? "active" : ""}`}>
                  <div className="feature-library-card-copy">
                    <div className="feature-library-badge-row">
                      <span className="feature-mini-badge">{isActive ? "Open now" : "Saved plan"}</span>
                      <span className="feature-library-date">{formatDate(plan.updatedAt || plan.createdAt)}</span>
                    </div>
                    <strong>{plan.planName}</strong>
                    <p>{plan.courseName}</p>
                  </div>
                  <div className="feature-inline-actions">
                    <button
                      type="button"
                      className="secondary-button feature-inline-button"
                      onClick={() => openSavedPlan(plan)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="danger-button feature-inline-button"
                      onClick={() => handleDeletePlan(plan.id)}
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
              Back To Study Plans
            </button>
            <div className="feature-inline-actions">
              <button type="button" className="secondary-button" onClick={handleUpdatePlan} disabled={!planResult || !activeSavedPlanId}>
                Update Plan
              </button>
              <button type="button" className="danger-button" onClick={() => handleDeletePlan(activeSavedPlanId)} disabled={!activeSavedPlanId}>
                Delete Plan
              </button>
            </div>
          </div>

          {planResult ? (
            <>
              <div className="feature-output-hero">
                <div>
                  <span className="panel-badge feature-panel-badge">{isDraftRoute ? "New plan" : "Saved plan"}</span>
                  <h3>{detailTitle}</h3>
                  <p>{planResult.plan?.overview}</p>
                </div>
                <div className="feature-output-meta">
                  <span>{form.startDate} to {form.endDate}</span>
                  <span>{form.hoursPerWeek} hrs/week</span>
                  <span>{planResult.scopedModules?.length || 0} modules</span>
                </div>
              </div>

              <div className="feature-output-grid">
                <div className="feature-result-block">
                  <h4>Weekly Focus</h4>
                  {(planResult.plan?.weeklyPlan || []).map((week, index) => (
                    <div key={`${week.day}-${index}`} className="feature-result-item">
                      <strong>{week.day}</strong>
                      <p>{week.focus}</p>
                    </div>
                  ))}
                </div>

                <div className="feature-result-block">
                  <h4>Milestones</h4>
                  {(planResult.plan?.milestones || []).map((milestone, index) => (
                    <div key={`${milestone.title}-${index}`} className="feature-result-item">
                      <strong>{milestone.title}</strong>
                      <p>{milestone.reason}</p>
                      <span>{formatDate(milestone.dueDate)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="feature-card feature-day-planner">
                <div className="feature-library-head">
                  <div>
                    <h3>Daily Study Schedule</h3>
                    <p className="feature-subcopy">Customize each week from Monday through Sunday. Add tasks, remove tasks, and keep the plan flexible.</p>
                  </div>
                  {!activeSavedPlanId ? (
                    <button type="button" className="secondary-button" onClick={handleSavePlan}>
                      Save Plan
                    </button>
                  ) : null}
                </div>

                <div className="feature-week-stack">
                  {(planResult.plan?.dailySchedule || []).map((week, weekIndex) => (
                    <section key={`${week.weekLabel}-${weekIndex}`} className="feature-week-card">
                      <div className="feature-week-header">
                        <div>
                          <h4>{week.weekLabel}</h4>
                          <p>{week.focus}</p>
                        </div>
                      </div>
                      <div className="feature-day-grid">
                        {(week.days || []).map((day, dayIndex) => (
                          <div key={`${day.dayKey}-${dayIndex}`} className={`feature-day-card ${form.focusDays.includes(day.dayKey) ? "active" : ""}`}>
                            <div className="feature-day-header">
                              <div>
                                <strong>{day.label}</strong>
                                <span>{formatShortDate(day.date)}</span>
                              </div>
                              <small>{day.schedule}</small>
                            </div>
                            <div className="feature-task-list">
                              {(day.tasks || []).map((task, taskIndex) => (
                                <div key={`${day.dayKey}-task-${taskIndex}`} className="feature-task-row">
                                  <input
                                    type="text"
                                    value={task}
                                    onChange={(event) => updateDayTask(weekIndex, dayIndex, taskIndex, event.target.value)}
                                    placeholder={`Add a task for ${day.label}`}
                                  />
                                  <button
                                    type="button"
                                    className="danger-button feature-task-delete"
                                    onClick={() => removeDayTask(weekIndex, dayIndex, taskIndex)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                              {(!day.tasks || day.tasks.length === 0) ? (
                                <p className="feature-muted">No tasks yet for this day.</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="secondary-button feature-day-add"
                              onClick={() => addDayTask(weekIndex, dayIndex)}
                            >
                              Add Task
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="feature-status">No study plan is open yet.</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
