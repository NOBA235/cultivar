import type { CulturalSignal } from "./types";

/**
 * ==============================================================================
 * ILLUSTRATIVE KEYWORD WEIGHTING — NOT TREND DATA
 * The quarters, keywords, and multipliers below are hand-written assumptions
 * for the demo. They are not derived from Qloo time-series data, sales data, or
 * any market research. They only change which Qloo signals are prioritised for
 * candidate lookup; they never change the Qloo affinity values that are shown.
 * ==============================================================================
 */

export const SEASONAL_DATA_DISCLAIMER =
  "Illustrative keyword weighting written for this demo. Not live market trends and not Qloo time-series data.";

export type Season = "Q1_Winter" | "Q2_Spring" | "Q3_Summer" | "Q4_Autumn";

export interface SeasonInfo {
  quarter: Season;
  seasonName: "Winter" | "Spring" | "Summer" | "Autumn";
  focusTitle: string;
  focusDescription: string;
  boostedKeywords: string[];
}

export const MONTH_NAMES: Record<number, string> = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
};

export const QUARTER_DEFINITIONS: Record<Season, SeasonInfo> = {
  Q1_Winter: {
    quarter: "Q1_Winter",
    seasonName: "Winter",
    focusTitle: "Winter: warming, indoor themes",
    focusDescription:
      "Assumption: signals mentioning warming or indoor themes (books, dark roasts, chocolate) are prioritised.",
    boostedKeywords: ["book", "espresso", "dark", "chocolate", "winter", "acoustic"],
  },
  Q2_Spring: {
    quarter: "Q2_Spring",
    seasonName: "Spring",
    focusTitle: "Spring: floral and botanical themes",
    focusDescription:
      "Assumption: signals mentioning floral, botanical, or tea themes are prioritised.",
    boostedKeywords: ["bloom", "botanical", "tea", "chamomile", "mint", "garden", "spring"],
  },
  Q3_Summer: {
    quarter: "Q3_Summer",
    seasonName: "Summer",
    focusTitle: "Summer: cold and outdoor themes",
    focusDescription:
      "Assumption: signals mentioning cold drinks, cans, or outdoor activity are prioritised.",
    boostedKeywords: ["cold brew", "iced", "can", "beach", "summer", "active", "festival"],
  },
  Q4_Autumn: {
    quarter: "Q4_Autumn",
    seasonName: "Autumn",
    focusTitle: "Autumn: harvest and spice themes",
    focusDescription:
      "Assumption: signals mentioning harvest, spice, or cascara themes are prioritised.",
    boostedKeywords: ["harvest", "cascara", "spice", "pumpkin", "autumn", "fall"],
  },
};

export function getSeasonForMonth(month: number): SeasonInfo {
  const m = Math.min(Math.max(1, Math.round(month)), 12);
  if (m >= 1 && m <= 3) return QUARTER_DEFINITIONS.Q1_Winter;
  if (m >= 4 && m <= 6) return QUARTER_DEFINITIONS.Q2_Spring;
  if (m >= 7 && m <= 9) return QUARTER_DEFINITIONS.Q3_Summer;
  return QUARTER_DEFINITIONS.Q4_Autumn;
}

/**
 * Illustrative keyword weight between 1.0 and 1.25 for a cultural signal
 * based on the target launch month.
 */
export function getSeasonalMultiplier(signal: CulturalSignal, month: number): number {
  const season = getSeasonForMonth(month);
  const text = `${signal.label} ${signal.entityType}`.toLowerCase();

  for (const keyword of season.boostedKeywords) {
    if (text.includes(keyword)) {
      return 1.25;
    }
  }

  // Domain-level illustrative weights
  const dom = signal.entityType.toLowerCase();
  if (season.quarter === "Q3_Summer" && (dom.includes("destination") || dom.includes("artist"))) {
    return 1.15;
  }
  if (season.quarter === "Q1_Winter" && dom.includes("book")) {
    return 1.2;
  }
  if (season.quarter === "Q4_Autumn" && dom.includes("movie")) {
    return 1.15;
  }

  return 1.0;
}

/**
 * Attaches the illustrative seasonal weight to each signal. The Qloo affinity
 * is left untouched so every displayed score is still the value Qloo returned.
 */
export function applySeasonalMultipliers(
  signals: CulturalSignal[],
  month: number,
): CulturalSignal[] {
  return signals.map((sig) => ({
    ...sig,
    seasonalMultiplier: getSeasonalMultiplier(sig, month),
  }));
}
