import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Lottie } from "@remotion/lottie";
import { getLottieAnimation } from "../lottieRegistry";

function CaptionBlock({ text, index, highlights = [] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    fps,
    frame: frame - index * 6,
    config: {
      damping: 200,
      stiffness: 160,
    },
  });

  const opacity = interpolate(entrance, [0, 1], [0, 1]);
  const translateY = interpolate(entrance, [0, 1], [24, 0]);
  const unique = Array.from(new Set(highlights || []));
  const pattern = unique.length
    ? new RegExp(`\\b(${unique.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
    : null;
  const parts = pattern ? text.split(pattern) : [text];

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        padding: "18px 20px",
        lineHeight: 1.5,
        fontSize: 28,
      }}
    >
      {parts.map((part, partIndex) =>
        unique.some((word) => word.toLowerCase() === part.toLowerCase()) ? (
          <span key={`${part}-${partIndex}`} style={{ color: "#ffd36a", fontWeight: 800 }}>
            {part}
          </span>
        ) : (
          <span key={`${part}-${partIndex}`}>{part}</span>
        )
      )}
    </div>
  );
}

function SceneFrame({ scene, title, subject }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, fps * 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at top left, rgba(82,118,255,0.24), transparent 34%), radial-gradient(circle at bottom right, rgba(11,187,146,0.2), transparent 34%), linear-gradient(160deg, #09111f, #101d34 58%, #10284d)",
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <AbsoluteFill style={{ padding: 64, opacity: fadeIn }}>
        <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.2fr", gap: 40, height: "100%" }}>
          <div style={{ display: "grid", alignContent: "center", justifyItems: "center", gap: 18 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                padding: "10px 18px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
              }}
            >
              Animated explainer
            </div>
            <div style={{ width: 360, height: 360 }}>
              <Lottie animationData={getLottieAnimation(scene.animationId)} loop />
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.72)",
              }}
            >
              {scene.animationId}
            </div>
          </div>

          <div style={{ display: "grid", alignContent: "center", gap: 20 }}>
            <div style={{ fontSize: 22, color: "rgba(255,255,255,0.7)" }}>{subject || title}</div>
            <div style={{ fontSize: 78, lineHeight: 0.93, fontWeight: 900, letterSpacing: "-0.06em" }}>
              {scene.heading}
            </div>
            {scene.subheading ? (
              <div style={{ fontSize: 28, lineHeight: 1.4, color: "rgba(255,255,255,0.8)" }}>
                {scene.subheading}
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 12 }}>
              {(scene.captionGroups || []).map((caption, index) => (
                <CaptionBlock
                  key={`${scene.id}-${index}`}
                  text={caption}
                  index={index}
                  highlights={scene.highlightWords}
                />
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>
      {scene.audioUrl ? <Audio src={scene.audioUrl} /> : null}
    </AbsoluteFill>
  );
}

export function AnimatedLessonComposition({ lesson }) {
  let frameCursor = 0;

  return (
    <AbsoluteFill>
      {(lesson?.scenes || []).map((scene) => {
        const from = frameCursor;
        frameCursor += scene.durationInFrames;

        return (
          <Sequence key={scene.id} from={from} durationInFrames={scene.durationInFrames}>
            <SceneFrame scene={scene} title={lesson?.title} subject={lesson?.subject} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
