import React from "react";
import { Composition, registerRoot } from "remotion";
import { AnimatedLessonComposition } from "./AnimatedLessonComposition";

const fallbackLesson = {
  title: "Animated lesson",
  subject: "Explainer",
  totalFrames: 240,
  fps: 30,
  scenes: [
    {
      id: "1",
      animationId: "intro",
      heading: "Animated explainer",
      subheading: "Fallback preview scene",
      captionGroups: ["This composition is ready to receive generated lesson scenes."],
      highlightWords: ["composition", "lesson"],
      durationInFrames: 240,
      audioUrl: null,
    },
  ],
};

const VIDEO_WIDTH = 960;
const VIDEO_HEIGHT = 540;

function RemotionRoot() {
  return (
    <Composition
      id="AnimatedLessonVideo"
      component={AnimatedLessonComposition}
      durationInFrames={fallbackLesson.totalFrames}
      fps={fallbackLesson.fps}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={{ lesson: fallbackLesson }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props?.lesson?.totalFrames || fallbackLesson.totalFrames,
        fps: props?.lesson?.fps || fallbackLesson.fps,
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
      })}
    />
  );
}

registerRoot(RemotionRoot);
