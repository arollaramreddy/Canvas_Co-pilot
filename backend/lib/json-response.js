function stripCodeFences(text) {
  const value = String(text || "").trim();
  if (!value.startsWith("```")) return value;
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeJsonText(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();
}

function extractBalancedJson(text) {
  const source = normalizeJsonText(stripCodeFences(text));
  const start = source.indexOf("{");
  if (start < 0) {
    throw new Error("Could not find a JSON object in model response");
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("Could not find a complete JSON object in model response");
}

function applyJsonHeuristics(text) {
  return String(text || "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u0000-\u0019]/g, " ");
}

function tryParseJson(text) {
  const candidate = extractBalancedJson(text);
  return JSON.parse(candidate);
}

async function parseJsonResponse(text, options = {}) {
  const { label = "JSON response", repair } = options;

  try {
    return tryParseJson(text);
  } catch (firstError) {
    try {
      return JSON.parse(applyJsonHeuristics(extractBalancedJson(text)));
    } catch (secondError) {
      if (typeof repair === "function") {
        const repaired = await repair({
          originalText: String(text || ""),
          extractedJson: (() => {
            try {
              return extractBalancedJson(text);
            } catch {
              return String(text || "");
            }
          })(),
          errorMessage: secondError.message || firstError.message,
          label,
        });
        return JSON.parse(applyJsonHeuristics(extractBalancedJson(repaired)));
      }
      throw new Error(`${label} could not be parsed: ${secondError.message || firstError.message}`);
    }
  }
}

module.exports = {
  extractBalancedJson,
  parseJsonResponse,
};
