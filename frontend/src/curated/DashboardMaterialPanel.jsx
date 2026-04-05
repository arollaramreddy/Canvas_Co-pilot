import { useEffect, useMemo, useRef, useState } from "react";
import AnimatedLessonPlayer from "../animated-lessons/AnimatedLessonPlayer";

function formatStatus(status) {
  const value = String(status || "new").toLowerCase();
  if (value === "processing") return "Processing";
  if (value === "ready") return "Ready";
  if (value === "failed") return "Failed";
  return "New";
}

function normalizeSlides(lesson) {
  return Array.isArray(lesson?.slides) ? lesson.slides : [];
}

function AnimatedVideoStatus({ job }) {
  if (!job) return null;
  const status = String(job.status || "queued").toLowerCase();

  const labels = {
    queued: "Queued for rendering…",
    rendering: "Rendering animated video…",
    encoding: "Encoding video…",
    ready: "Animated video is ready",
    failed: "Animated video generation failed",
  };

  return (
    <div className={`animated-video-status animated-video-status-${status}`}>
      <div className="animated-video-status-header">
        <span className={`status-pill status-pill-${status}`}>{status}</span>
        <strong>{labels[status] || "Processing…"}</strong>
      </div>
      {job.progressMessage ? <p>{job.progressMessage}</p> : null}
      {status === "failed" && job.error ? (
        <p className="animated-video-error">{job.error}</p>
      ) : null}
    </div>
  );
}

function LessonStage({ lesson, autoPlay }) {
  const slides = useMemo(() => normalizeSlides(lesson), [lesson]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const audioRef = useRef(null);

  const activeSlide = slides[activeIndex] || null;

  useEffect(() => {
    setActiveIndex(0);
    setAudioBlocked(false);
  }, [lesson]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeSlide?.audio_url) return undefined;

    audio.pause();
    audio.currentTime = 0;
    audio.load();

    if (autoPlay) {
      audio
        .play()
        .then(() => setAudioBlocked(false))
        .catch(() => setAudioBlocked(true));
    }

    return () => {
      audio.pause();
    };
  }, [activeSlide?.audio_url, autoPlay]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handleEnded = () => {
      setActiveIndex((current) => {
        if (current >= slides.length - 1) return current;
        return current + 1;
      });
    };

    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [slides.length]);

  if (!slides.length) {
    return (
      <div className="material-video-shell">
        <div className="material-video-stage material-video-empty">
          <strong>Video package not ready</strong>
          <span>The narrated lesson is still being prepared in the background.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="material-video-shell">
      <div className="material-video-stage">
        <div className="material-video-topbar">
          <span className="material-video-badge">Narrated lesson</span>
          <span className="material-video-counter">
            Slide {activeIndex + 1} of {slides.length}
          </span>
        </div>

        <div className="material-video-body">
          <div className="material-video-slide">
            <h4>{activeSlide?.heading || lesson?.title || "Lesson"}</h4>
            {activeSlide?.subheading ? <p>{activeSlide.subheading}</p> : null}
            {Array.isArray(activeSlide?.bullets) && activeSlide.bullets.length ? (
              <ul className="material-video-bullets">
                {activeSlide.bullets.map((bullet, index) => (
                  <li key={`${bullet}-${index}`}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            {!activeSlide?.bullets?.length && activeSlide?.narration ? (
              <p>{activeSlide.narration}</p>
            ) : null}
          </div>
        </div>

        <div className="material-video-controls">
          <button
            type="button"
            className="agent-secondary"
            onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}
            disabled={activeIndex === 0}
          >
            Previous
          </button>
          <audio ref={audioRef} controls preload="auto" src={activeSlide?.audio_url || ""} />
          <button
            type="button"
            className="agent-secondary"
            onClick={() => setActiveIndex((current) => Math.min(slides.length - 1, current + 1))}
            disabled={activeIndex >= slides.length - 1}
          >
            Next
          </button>
        </div>

        {audioBlocked ? (
          <p className="material-audio-note">
            Audio is ready. Press play in the lesson controls if the browser blocked autoplay.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function DashboardMaterialPanel({
  item,
  view = "summary",
  onRetry,
  animatedVideoJob,
  onStartAnimatedVideo,
}) {
  if (!item) {
    return (
      <aside className="settings-panel">
        <div className="settings-header">
          <span className="settings-tag">New material</span>
          <h3>Select a dashboard item</h3>
        </div>
        <div className="empty-card">
          <h3>No material selected</h3>
          <p>New professor-posted PDFs will appear here with summary, video, and live processing status.</p>
        </div>
      </aside>
    );
  }

  const summary = item.summaryMarkdown || item.summaryPreview || "Summary is not ready yet.";
  const isReady = String(item.status) === "ready";
  const hasSlides = Boolean(item.lesson?.slides?.length);

  const animatedStatus = animatedVideoJob?.status || null;
  const animatedReady = animatedStatus === "ready";
  const animatedBusy = animatedStatus === "queued" || animatedStatus === "rendering" || animatedStatus === "encoding";

  return (
    <aside className="settings-panel">
      <div className="settings-header">
        <span className={`status-pill status-pill-${String(item.status || "new").toLowerCase()}`}>
          {formatStatus(item.status)}
        </span>
        <h3>{item.materialTitle}</h3>
        <p>{item.courseName} · {item.moduleName}</p>
      </div>

      <div className="material-detail-tabs">
        <span className={`material-detail-tab ${view === "summary" ? "active" : ""}`}>Summary</span>
        <span className={`material-detail-tab ${view === "video" ? "active" : ""}`}>Video</span>
      </div>

      {String(item.status) === "failed" ? (
        <div className="empty-card material-failed-card">
          <h3>Pipeline failed</h3>
          <p>{item.error || "The background pipeline could not finish this material."}</p>
          <button type="button" className="agent-primary" onClick={() => onRetry?.(item)}>
            Retry processing
          </button>
        </div>
      ) : null}

      {String(item.status) === "new" || String(item.status) === "processing" ? (
        <div className="empty-card material-processing-card">
          <h3>{String(item.status) === "new" ? "Queued for processing" : "Generating summary and video"}</h3>
          <p>
            The background agent is cleaning the PDF, writing the summary, creating the narration,
            generating ElevenLabs audio, and packaging the lesson for the dashboard.
          </p>
        </div>
      ) : null}

      {view === "video" ? (
        <>
          {/* ── Normal video lesson ─────────────────── */}
          <LessonStage lesson={item.lesson} autoPlay={isReady} />

          {/* ── Animated video controls ─────────────── */}
          {isReady && hasSlides ? (
            <div className="animated-video-section">
              <div className="section-header-inline">
                <span className="section-tag">Animated Video Lesson</span>
              </div>

              {animatedReady && animatedVideoJob?.lessonPackage ? (
                <AnimatedLessonPlayer
                  lesson={animatedVideoJob.lessonPackage}
                  autoPlayToken={1}
                />
              ) : animatedBusy ? (
                <AnimatedVideoStatus job={animatedVideoJob} />
              ) : animatedStatus === "failed" ? (
                <>
                  <AnimatedVideoStatus job={animatedVideoJob} />
                  <button
                    type="button"
                    className="agent-primary"
                    style={{ marginTop: 8 }}
                    onClick={() => onStartAnimatedVideo?.(item)}
                  >
                    Retry Animated Video
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="agent-primary animated-video-btn"
                  onClick={() => onStartAnimatedVideo?.(item)}
                >
                  Generate Animated Video Lesson
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <div className="workflow-section material-summary-panel">
          <span className="section-tag">Generated summary</span>
          <div className="workflow-text">{summary}</div>
        </div>
      )}

      {isReady && item.videoPayload ? (
        <div className="workflow-section">
          <span className="section-tag">Output package</span>
          <div className="workflow-list">
            <div className="workflow-line">
              <strong>{item.videoPayload.title || item.materialTitle}</strong>
              <span>
                {item.videoPayload.slide_count || normalizeSlides(item.lesson).length} slides ·{" "}
                {item.videoPayload.estimated_minutes || item.lesson?.estimated_minutes || 0} min
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
