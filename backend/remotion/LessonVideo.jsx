import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const palette = [
  ["#08111f", "#0f2743", "#1b4f72"],
  ["#1b1128", "#36204f", "#7c3aed"],
  ["#0c1d17", "#134e4a", "#14b8a6"],
  ["#2a1208", "#78350f", "#f59e0b"],
  ["#1e132f", "#4338ca", "#60a5fa"],
  ["#1b1b0d", "#3f6212", "#bef264"],
];

const styleVariants = {
  kinetic: { accent: "#fbbf24", align: "flex-start" },
  spotlight: { accent: "#f472b6", align: "center" },
  diagram: { accent: "#38bdf8", align: "flex-start" },
  timeline: { accent: "#22c55e", align: "center" },
  contrast: { accent: "#fb7185", align: "flex-end" },
  callout: { accent: "#c084fc", align: "flex-start" },
};

const containerStyle = {
  fontFamily: "Avenir Next, Helvetica Neue, sans-serif",
  color: "white",
  overflow: "hidden",
};

const chipStyle = {
  padding: "12px 22px",
  borderRadius: 999,
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  background: "rgba(8, 15, 30, 0.68)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.25)",
};

function FloatingShapes({ index }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <>
      {[0, 1, 2].map((shape) => {
        const size = 180 + shape * 70;
        const drift = interpolate(frame, [0, 180], [0, 70 + shape * 12], {
          extrapolateRight: "extend",
        });
        const x = (width * (0.12 + shape * 0.28) + drift + index * 24) % width;
        const y = (height * (0.16 + shape * 0.22) + drift * 0.6 + index * 18) % height;
        return (
          <div
            key={shape}
            style={{
              position: "absolute",
              width: size,
              height: size,
              left: x - size / 2,
              top: y - size / 2,
              borderRadius: shape === 1 ? 38 : "50%",
              background:
                shape === 2
                  ? "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02))"
                  : "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0.03))",
              filter: "blur(1px)",
              opacity: 0.55,
              transform: `rotate(${frame * (shape + 1) * 0.18}deg)`,
            }}
          />
        );
      })}
    </>
  );
}

function BackgroundLayer({ scene, index }) {
  const frame = useCurrentFrame();
  const colors = palette[index % palette.length];
  const zoom = interpolate(frame, [0, 120], [1.04, 1.12], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill>
      {scene.backgroundVideoUrl ? (
        <OffthreadVideo
          src={scene.backgroundVideoUrl}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom})`,
          }}
        />
      ) : scene.backgroundImage ? (
        <Img
          src={scene.backgroundImage}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom})`,
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at top left, ${colors[2]}, transparent 42%), linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
          }}
        >
          <FloatingShapes index={index} />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(4,8,15,0.18), rgba(4,8,15,0.52) 40%, rgba(4,8,15,0.92))",
        }}
      />
    </AbsoluteFill>
  );
}

function TextOverlay({ scene, index, mode, sourceName }) {
  const frame = useCurrentFrame();
  const variant = styleVariants[scene.visualStyle] || styleVariants.kinetic;
  const headingEntrance = spring({
    frame,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
  });
  const bulletEntrance = spring({
    frame: frame - 10,
    fps: 30,
    config: { damping: 18, stiffness: 130 },
  });
  const captionEntrance = interpolate(frame, [0, 18], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "space-between",
        padding: "54px 70px 42px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ ...chipStyle, color: variant.accent }}>
          {mode === "detailed" ? "Detailed Lesson" : "Quick 2-Minute Lesson"}
        </div>
        <div
          style={{
            ...chipStyle,
            fontSize: 18,
            textTransform: "none",
            letterSpacing: "0.02em",
            color: "rgba(255,255,255,0.84)",
          }}
        >
          {sourceName}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: variant.align,
          gap: 26,
          maxWidth: 930,
          transform: `translateY(${interpolate(headingEntrance, [0, 1], [42, 0])}px)`,
          opacity: headingEntrance,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            padding: "14px 20px",
            borderRadius: 24,
            background: "rgba(10, 15, 28, 0.72)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: variant.accent,
              boxShadow: `0 0 24px ${variant.accent}`,
            }}
          />
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.84)",
            }}
          >
            Scene {index + 1}
          </span>
        </div>

        <h1
          style={{
            fontSize: 72,
            lineHeight: 1.02,
            letterSpacing: "-0.03em",
            fontWeight: 800,
            textShadow: "0 18px 50px rgba(0,0,0,0.35)",
            maxWidth: 960,
          }}
        >
          {scene.title}
        </h1>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: scene.onScreenText.length > 2 ? "1fr 1fr" : "1fr",
            gap: 18,
            width: "100%",
            maxWidth: 860,
            opacity: bulletEntrance,
            transform: `translateY(${interpolate(bulletEntrance, [0, 1], [36, 0])}px)`,
          }}
        >
          {scene.onScreenText.map((line, lineIndex) => (
            <div
              key={lineIndex}
              style={{
                padding: "20px 24px",
                borderRadius: 26,
                background: "rgba(8, 12, 22, 0.66)",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  lineHeight: 1.25,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.94)",
                }}
              >
                {line}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
          opacity: captionEntrance,
        }}
      >
        <div
          style={{
            flex: 1,
            maxWidth: 900,
            padding: "18px 24px",
            borderRadius: 24,
            background: "rgba(7, 10, 18, 0.75)",
            border: "1px solid rgba(255,255,255,0.14)",
            backdropFilter: "blur(14px)",
          }}
        >
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.3,
              fontWeight: 500,
              color: "rgba(255,255,255,0.94)",
            }}
          >
            {scene.captions || scene.narration}
          </div>
        </div>

        <div
          style={{
            minWidth: 180,
            padding: "16px 20px",
            borderRadius: 22,
            background: "rgba(7, 10, 18, 0.72)",
            border: "1px solid rgba(255,255,255,0.14)",
            textAlign: "right",
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: "rgba(255,255,255,0.58)",
              marginBottom: 8,
            }}
          >
            Search cue
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: variant.accent,
            }}
          >
            {scene.keyword}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

export const LessonVideo = ({ title, subtitle, mode, scenes, sourceName }) => {
  return (
    <AbsoluteFill style={containerStyle}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, rgba(6,11,20,1), rgba(10,18,33,1))",
        }}
      />

      {scenes.map((scene, index) => (
        <Sequence
          key={scene.id || index}
          from={scene.startFrame}
          durationInFrames={scene.durationFrames}
        >
          <AbsoluteFill>
            <BackgroundLayer scene={scene} index={index} />
            <TextOverlay
              scene={scene}
              index={index}
              mode={mode}
              sourceName={index === 0 ? title : sourceName || subtitle}
            />
            {scene.audioUrl ? <Audio src={scene.audioUrl} /> : null}
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export default LessonVideo;
