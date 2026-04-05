import { useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";
import { getLottieAnimation } from "./lottieRegistry";
import "./animatedLesson.css";

function highlightCaption(text, highlights = []) {
  if (!text) return text;
  const unique = Array.from(new Set((highlights || []).filter(Boolean)));
  if (!unique.length) return text;

  const pattern = new RegExp(`\\b(${unique.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
  return text.split(pattern).map((part, index) =>
    unique.some((word) => word.toLowerCase() === part.toLowerCase()) ? (
      <mark key={`${part}-${index}`} className="animated-lesson-highlight">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

export default function AnimatedLessonPlayer({ lesson, autoPlayToken = 0 }) {
  const scenes = useMemo(() => lesson?.scenes || [], [lesson]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState("");
  const audioRef = useRef(null);

  const scene = scenes[sceneIndex] || null;
  const progress = scenes.length ? ((sceneIndex + 1) / scenes.length) * 100 : 0;

  useEffect(() => {
    setSceneIndex(0);
    setPlaying(false);
    setAudioError("");
  }, [lesson?.title]);

  useEffect(() => {
    if (!autoPlayToken || !scenes.length) return;
    setSceneIndex(0);
    setPlaying(true);
  }, [autoPlayToken, scenes.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !scene?.audioUrl) return undefined;

    audio.pause();
    audio.src = scene.audioUrl;
    audio.currentTime = 0;

    if (playing) {
      audio.play().catch(() => {
        setAudioError("Animated narration is ready. Press play if the browser blocked autoplay.");
        setPlaying(false);
      });
    }

    function handleEnded() {
      setSceneIndex((current) => {
        if (current >= scenes.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }

    audio.onended = handleEnded;

    return () => {
      audio.pause();
      audio.onended = null;
    };
  }, [playing, scene?.audioUrl, scenes.length]);

  if (!scene) return null;

  return (
    <div className="animated-lesson-shell">
      {lesson.videoUrl ? (
        <div className="animated-lesson-video">
          <video controls src={lesson.videoUrl} preload="metadata" />
        </div>
      ) : null}

      <div className="animated-lesson-stage">
        <audio ref={audioRef} preload="auto" />
        <div className="animated-lesson-grid">
          <div className="animated-lesson-visual">
            <span className="animated-lesson-badge">Animated video lesson</span>
            <div className="animated-lesson-lottie">
              <Lottie animationData={getLottieAnimation(scene.animationId)} loop autoplay={playing} />
            </div>
            <span className="animated-lesson-meta">
              Scene {sceneIndex + 1} / {scenes.length} · {scene.animationId}
            </span>
          </div>

          <div className="animated-lesson-copy">
            <div>
              <p>{lesson.subject}</p>
              <h3>{scene.heading}</h3>
              {scene.subheading ? <p>{scene.subheading}</p> : null}
            </div>

            <div className="animated-lesson-captions">
              {(scene.captionGroups || []).map((group, index) => (
                <div
                  key={`${scene.id}-${index}`}
                  className="animated-lesson-caption"
                  style={{ animationDelay: `${index * 180}ms` }}
                >
                  {highlightCaption(group, scene.highlightWords)}
                </div>
              ))}
            </div>

            <div className="animated-lesson-controls">
              <div className="animated-lesson-control-group">
                <button
                  type="button"
                  className="animated-lesson-control"
                  onClick={() => setSceneIndex((current) => Math.max(0, current - 1))}
                  disabled={sceneIndex === 0}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="animated-lesson-control primary"
                  onClick={() => setPlaying((current) => !current)}
                >
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  className="animated-lesson-control"
                  onClick={() => setSceneIndex((current) => Math.min(scenes.length - 1, current + 1))}
                  disabled={sceneIndex >= scenes.length - 1}
                >
                  Next
                </button>
              </div>

              <div className="animated-lesson-meta">{Math.round(scene.durationSeconds)} sec scene</div>
            </div>

            <div className="animated-lesson-progress">
              <div className="animated-lesson-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            {audioError ? <div className="animated-lesson-error">{audioError}</div> : null}
            {lesson.renderError ? (
              <div className="animated-lesson-error">
                Remotion export is not ready yet on this machine: {lesson.renderError}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
