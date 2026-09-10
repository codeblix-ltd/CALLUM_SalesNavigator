export function firstNameFrom(value: unknown) {
  const name = nullableString(value)?.trim();
  return name ? name.split(/\s+/)[0] : null;
}

export function profileText(value: unknown, maximumLength: number) {
  const text = nullableString(value)
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
  return text || null;
}

export function composeConnectionNote(firstNameValue: unknown, draftValue: unknown) {
  const firstName =
    profileText(firstNameValue, 40)?.replace(/[^\p{L}\p{M}'’-]/gu, "") ||
    "there";
  const prefix = `Hi ${firstName}, `;
  const closing = "I would be glad to connect.";
  const detailLimit = 300 - prefix.length - closing.length - 2;
  let detail = String(draftValue ?? "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:comment|message|draft)\s*:\s*/i, "")
    .replace(/^(["'])\s*/, "")
    .replace(/\s*(["'])$/, "")
    .replace(/^hi\s+[^,]+,?\s*/i, "")
    .replace(/\b(?:thanks|thank you) for connecting\.?/gi, "")
    .replace(/\b(?:I would|I'd) be (?:glad|happy) to connect\.?/gi, "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  detail = detail.replace(
    /^(Your|The|A|An|Leading|Building|Working|With|Bringing|Managing|Driving|Focusing|Helping|Combining|Developing|Growing|Overseeing)\b/,
    (opening) => opening.toLowerCase(),
  );
  if (detail.length > detailLimit) {
    const completeSentence = detail
      .slice(0, detailLimit + 1)
      .match(/^(.{20,}?[.!?])(?:\s|$)/)?.[1];
    detail = completeSentence || detail.slice(0, detailLimit);
    if (!completeSentence) {
      detail = detail.replace(/\s+\S*$/, "").replace(/[,;:]+$/, "");
    }
    detail = detail.replace(/[.!?]+$/, "").trim();
  }
  if (!detail) {
    throw new Error("The AI did not return a usable personal profile detail.");
  }
  return `${prefix}${detail}. ${closing}`;
}

export function normalizeLanguageResults(
  value: Array<{
    id: string;
    status: string;
    languageCode: string;
    confidence: number;
  }>,
  samples: Array<{ id: string; text: string }>,
) {
  if (!Array.isArray(value) || value.length !== samples.length) {
    throw new Error("The language service returned an incomplete result.");
  }
  const expectedIds = new Set(samples.map((sample) => sample.id));
  const seen = new Set<string>();
  const normalized = value.map((result) => {
    const id = String(result?.id || "").trim();
    if (!expectedIds.has(id) || seen.has(id)) {
      throw new Error("The language service returned an invalid sample id.");
    }
    seen.add(id);
    const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
    const languageCode = /^[a-z]{2}$/i.test(String(result.languageCode || ""))
      ? String(result.languageCode).toLowerCase()
      : "und";
    const rawStatus = String(result.status || "uncertain");
    let status: "english" | "non_english" | "uncertain" =
      ["english", "non_english"].includes(rawStatus) && confidence >= 0.8
        ? rawStatus as "english" | "non_english"
        : "uncertain";
    if (
      (status === "english" && languageCode !== "en") ||
      (status === "non_english" && languageCode === "en")
    ) {
      status = "uncertain";
    }
    return { id, status, languageCode, confidence };
  });
  return samples.map((sample) => {
    const result = normalized.find((item) => item.id === sample.id);
    if (!result) throw new Error("The language service omitted a sample.");
    return result;
  });
}


function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }
