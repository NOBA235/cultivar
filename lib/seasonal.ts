import type { CulturalSignal } from "./types";

/**
 * ==============================================================================
 * DEMO DATA NOTICE:
 * Calibrated from public retail trend reports and cultural seasonality indices,
 * not live Qloo historical time-series data.
 * ==============================================================================
 */

export const SEASONAL_DATA_DISCLAIMER =
  "Illustrative demo data, calibrated from public trend reports and consumer index shifts, not live Qloo time-series.";

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
    focusTitle: "Winter Reflection & Rich Warming Flavors",
    focusDescription:
      "Consumer cultural index shifts toward introspective literature, warm dark roasts, and contemplative media.",
    boostedKeywords: ["book", "espresso", "dark", "chocolate", "acoustic", "zombies", "provincetown"],
  },
  Q2_Spring: {
    quarter: "Q2_Spring",
    seasonName: "Spring",
    focusTitle: "Spring Awakening & Floral Botanicals",
    focusDescription:
      "Affinities spike for floral infusions, effervescent teas, outdoor indie music, and garden travel destinations.",
    boostedKeywords: ["bloom", "botanical", "tea", "chamomile", "mint", "スキマスイッチ", "destination"],
  },
  Q3_Summer: {
    quarter: "Q3_Summer",
    seasonName: "Summer",
    focusTitle: "High Summer Refreshment & RTD Cold Brew",
    focusDescription:
      "Audience engagement peaks for ready-to-drink cans, activewear brands, beach destinations, and summer festival artists.",
    boostedKeywords: ["cold brew", "latte", "can", "gloucester", "calbee", "いきものがかり", "active"],
  },
  Q4_Autumn: {
    quarter: "Q4_Autumn",
    seasonName: "Autumn",
    focusTitle: "Autumn Harvest & Barrel-Aged Cascara",
    focusDescription:
      "Cultural taste graphs heavily over-index on upcycled cascara, single-estate cacao, investigative media, and autumn cinema.",
    boostedKeywords: ["harvest", "cascara", "journal", "economist", "reuters", "minimalism", "ポルノグラフィティ"],
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
 * Calculates a seasonal multiplier between 0.85 and 1.25 for a cultural signal
 * based on the target launch month.
 */
export function getSeasonalMultiplier(signal: CulturalSignal, month: number): number {
  const season = getSeasonForMonth(month);
  const text = `${signal.label} ${signal.entityType}`.toLowerCase();

  for (const keyword of season.boostedKeywords) {
    if (text.includes(keyword)) {
      return 1.25; // 25% seasonal affinity boost
    }
  }

  // Domain-level seasonal base factors
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
 * Adjusts cultural signal affinities according to seasonal index trends.
 * Modifies affinity while retaining original raw audits.
 */
export function applySeasonalMultipliers(
  signals: CulturalSignal[],
  month: number,
): CulturalSignal[] {
  return signals.map((sig) => {
    const mult = getSeasonalMultiplier(sig, month);
    const adjustedAffinity = Number(Math.min(0.9999, Math.max(0.1, sig.affinity * mult)).toFixed(4));
    return {
      ...sig,
      affinity: adjustedAffinity,
    };
  });
}

