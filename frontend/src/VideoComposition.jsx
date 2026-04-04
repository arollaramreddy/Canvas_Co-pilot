import React from "react";
import { Composition } from "remotion";
import { StudyVideoComposition } from "./components/StudyVideo";

export const RemotionRoot = ({ videoData = {}, audioUrl = "" }) => {
  const durationInFrames = videoData.totalDurationFrames || 300;
  const fps = videoData.fps || 30;

  return (
    <Composition
      id="StudyVideo"
      component={StudyVideoComposition}
      durationInFrames={durationInFrames}
      fps={fps}
      width={960}
      height={540}
      defaultProps={{ scenes: videoData.scenes || [], audioUrl }}
    />
  );
};
