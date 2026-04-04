import { Player } from "@remotion/player";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Sequence,
  spring,
  useVideoConfig,
  Audio,
} from "remotion";

// ── Scene Components ─────────────────────────────────────

function TitleScene({ heading, subtitle }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleScale = spring({ frame, fps, config: { damping: 15 } });
  const subtitleOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #8c1d40 0%, #4a0e22 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 60,
      }}
    >
      <div
        style={{
          transform: `scale(${titleScale})`,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            color: "#fff",
            fontSize: 52,
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          {heading}
        </h1>
      </div>
      {subtitle && (
        <p
          style={{
            color: "rgba(255,255,255,0.8)",
            fontSize: 26,
            marginTop: 24,
            textAlign: "center",
            opacity: subtitleOpacity,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {subtitle}
        </p>
      )}
    </AbsoluteFill>
  );
}

function ContentScene({ heading, bullets }) {
  const frame = useCurrentFrame();
  const headingOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "#fff",
        padding: "50px 60px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          borderLeft: "4px solid #8c1d40",
          paddingLeft: 20,
          marginBottom: 30,
          opacity: headingOpacity,
        }}
      >
        <h2
          style={{
            color: "#8c1d40",
            fontSize: 38,
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            margin: 0,
          }}
        >
          {heading}
        </h2>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(bullets || []).map((bullet, i) => {
          const delay = 12 + i * 10;
          const bulletOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          });
          const bulletX = interpolate(frame, [delay, delay + 10], [-30, 0], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          });
          return (
            <li
              key={i}
              style={{
                fontSize: 28,
                marginBottom: 18,
                color: "#333",
                opacity: bulletOpacity,
                transform: `translateX(${bulletX}px)`,
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                fontFamily: "system-ui, sans-serif",
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#8c1d40",
                  flexShrink: 0,
                  marginTop: 10,
                }}
              />
              {bullet}
            </li>
          );
        })}
      </ul>
    </AbsoluteFill>
  );
}

function DefinitionScene({ term, definition }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const termScale = spring({ frame, fps, config: { damping: 12 } });
  const defOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #fdf2f5 0%, #fff 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 60,
      }}
    >
      <div
        style={{
          transform: `scale(${termScale})`,
          background: "#8c1d40",
          color: "#fff",
          padding: "14px 36px",
          borderRadius: 12,
          fontSize: 36,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
          marginBottom: 30,
        }}
      >
        {term}
      </div>
      <p
        style={{
          fontSize: 28,
          color: "#444",
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.5,
          opacity: defOpacity,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {definition}
      </p>
    </AbsoluteFill>
  );
}

function SummaryScene({ heading, bullets }) {
  const frame = useCurrentFrame();
  const headingOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        padding: "50px 60px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <h2
        style={{
          color: "#ffd700",
          fontSize: 38,
          fontFamily: "system-ui, sans-serif",
          fontWeight: 700,
          marginBottom: 30,
          opacity: headingOpacity,
        }}
      >
        {heading || "Key Takeaways"}
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(bullets || []).map((bullet, i) => {
          const delay = 12 + i * 10;
          const bulletOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          });
          return (
            <li
              key={i}
              style={{
                fontSize: 28,
                marginBottom: 18,
                color: "#e0e0e0",
                opacity: bulletOpacity,
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                fontFamily: "system-ui, sans-serif",
                lineHeight: 1.4,
              }}
            >
              <span style={{ color: "#ffd700", fontSize: 24, flexShrink: 0 }}>
                ★
              </span>
              {bullet}
            </li>
          );
        })}
      </ul>
    </AbsoluteFill>
  );
}

// ── Main Composition ─────────────────────────────────────

function StudyVideoComposition({ scenes, audioUrl }) {
  return (
    <>
      {audioUrl && <Audio src={audioUrl} />}
      <AbsoluteFill>
        {(scenes || []).map((scene) => (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.durationFrames}
          >
            <div style={{ width: '100%', height: '100%' }}>
              {scene.type === "title" && (
                <TitleScene heading={scene.heading} subtitle={scene.subtitle} />
              )}
              {scene.type === "content" && (
                <ContentScene heading={scene.heading} bullets={scene.bullets} />
              )}
              {scene.type === "definition" && (
                <DefinitionScene term={scene.term} definition={scene.definition} />
              )}
              {scene.type === "summary" && (
                <SummaryScene heading={scene.heading} bullets={scene.bullets} />
              )}
            </div>
          </Sequence>
        ))}
      </AbsoluteFill>
    </>
  );
}

// ── Exported Player Wrapper ──────────────────────────────

export default function StudyVideoPlayer({ videoData }) {
  if (!videoData || !videoData.scenes || videoData.scenes.length === 0) {
    return <p className="muted">No video data available.</p>;
  }

  return (
    <div className="video-player-wrap">
      <Player
        component={StudyVideoComposition}
        inputProps={{ scenes: videoData.scenes }}
        durationInFrames={videoData.totalDurationFrames || 300}
        fps={videoData.fps || 30}
        compositionWidth={960}
        compositionHeight={540}
        style={{ width: "100%", borderRadius: 10, overflow: "hidden" }}
        controls
        autoPlay={false}
      />
      <div className="video-meta">
        <span>{videoData.scenes.length} scenes</span>
        <span>{Math.round(videoData.totalDurationSeconds || 0)}s</span>
      </div>
    </div>
  );
}
