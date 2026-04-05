const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const GENERATED_ROOT = path.join(__dirname, "..", "generated");
const LESSON_AUDIO_DIR = path.join(GENERATED_ROOT, "lesson-audio");
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

function ensureLessonAudioDir() {
  fs.mkdirSync(LESSON_AUDIO_DIR, { recursive: true });
  return LESSON_AUDIO_DIR;
}

function getElevenLabsConfig() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set in backend/.env");
  }

  return { apiKey, voiceId, modelId };
}

function normalizeAudioText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAudioHash({ lessonTitle, slideId, text, voiceId, modelId }) {
  return crypto
    .createHash("sha1")
    .update(`${lessonTitle}::${slideId}::${voiceId}::${modelId}::${text}`)
    .digest("hex")
    .slice(0, 16);
}

async function generateLessonSlideAudio({
  lessonTitle = "lesson",
  slideId = "slide",
  text,
  backendUrl,
}) {
  const normalizedText = normalizeAudioText(text);
  if (!normalizedText) {
    throw new Error("Narration text is required");
  }

  const { apiKey, voiceId, modelId } = getElevenLabsConfig();
  ensureLessonAudioDir();

  const hash = buildAudioHash({
    lessonTitle,
    slideId,
    text: normalizedText,
    voiceId,
    modelId,
  });

  const fileName = `${hash}.mp3`;
  const filePath = path.join(LESSON_AUDIO_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: normalizedText,
        model_id: modelId,
        output_format: "mp3_44100_128",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs request failed (${response.status})${errorText ? `: ${errorText}` : ""}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
  }

  return {
    fileName,
    filePath,
    url: `${backendUrl}/generated/lesson-audio/${fileName}`,
  };
}

module.exports = {
  GENERATED_ROOT,
  ensureLessonAudioDir,
  generateLessonSlideAudio,
};
