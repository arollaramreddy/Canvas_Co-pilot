import aiAnimation from "../assets/lottie/ai.json";
import dataAnimation from "../assets/lottie/data.json";
import graphAnimation from "../assets/lottie/graph.json";
import introAnimation from "../assets/lottie/intro.json";
import summaryAnimation from "../assets/lottie/summary.json";

export const LOTTIE_ANIMATIONS = {
  ai: aiAnimation,
  data: dataAnimation,
  graph: graphAnimation,
  intro: introAnimation,
  summary: summaryAnimation,
};

export function getLottieAnimation(animationId) {
  return LOTTIE_ANIMATIONS[animationId] || LOTTIE_ANIMATIONS.intro;
}
