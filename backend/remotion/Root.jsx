import React from "react";
import { Composition } from "remotion";
import { LessonVideo } from "./LessonVideo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="LessonVideo"
      component={LessonVideo}
      durationInFrames={300}
      fps={30}
      width={1280}
      height={720}
      defaultProps={{
        title: "Lesson Video",
        subtitle: "Canvas PDF lesson",
        mode: "quick",
        fps: 30,
        totalFrames: 300,
        sourceName: "Canvas PDF",
        scenes: [],
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(150, props.totalFrames || 300),
        fps: props.fps || 30,
        width: 1280,
        height: 720,
      })}
    />
  );
};

export default RemotionRoot;
