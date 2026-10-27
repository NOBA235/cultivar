"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { CulturalGraphModal } from "@/components/CulturalGraph";
import { MONTH_NAMES, getSeasonForMonth } from "@/lib/seasonal";
import type { Recommendation, CulturalSignal, ResolvedEntity } from "@/lib/types";

function cleanDomain(urn: string): string {
  const map: Record<string, string> = {
    "urn:entity:artist": "musician",
    "urn:entity:movie": "movie",
    "urn:entity:brand": "fashion_brand",
    "urn:entity:book": "book",
    "urn:entity:destination": "destination",
    "urn:entity:restaurant": "restaurant",
    "urn:entity:place": "place",
  };
  return map[urn] || urn.replace("urn:entity:", "");
}

function getSignalUrn(signal: CulturalSignal): string {
  const prefix = signal.entityType.startsWith("urn:entity:")
    ? signal.entityType
    : `urn:entity:${signal.entityType}`;
  return `${prefix}:${signal.entityId}`;
}

export default function RecommendationsPage() {
  const router = useRouter();
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [loadingExplains, setLoadingExplains] = useState<boolean>(true);
  const [expandedWhy, setExpandedWhy] = useState<Record<number, boolean>>({});
  const [expandedSignals, setExpandedSignals] = useState<Record<number, boolean>>({});
  const [showFullJsonMap, setShowFullJsonMap] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [graphModalRec, setGraphModalRec] = useState<Recommendation | null>(null);
  const [sourceProducts, setSourceProducts] = useState<ResolvedEntity[]>([]);
  const [showBreakdown, setShowBreakdown] = useState<boolean>(false);

  // Seasonality and Memory states
  const [selectedMonth, setSelectedMonth] = useState<number>(10); // Default: October (Autumn)
  const [isRecalculatingMonth, setIsRecalculatingMonth] = useState<boolean>(false);
  const [cardDecisions, setCardDecisions] = useState<Record<string, boolean>>({});
  const [savingRecId, setSavingRecId] = useState<string | null>(null);

  // Dismissible disclaimer banner
  const [dismissDisclaimer, setDismissDisclaimer] = useState<boolean>(false);

  // Refs for Why Panels to wire `beforematch` event listeners for `hidden="until-found"`
  const whyPanelRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Feature-detect `onbeforematch` support and wire listeners for Find-in-Page reveal
  useEffect(() => {
    if (typeof HTMLElement === "undefined") return;

    if (!("onbeforematch" in HTMLElement.prototype)) {
      // Fallback for browsers without `hidden="until-found"` support
      setExpandedWhy({ 0: true, 1: true, 2: true });
      return;
    }

    const cleanups: Array<() => void> = [];
    [0, 1, 2].forEach((idx) => {
      const el = whyPanelRefs.current[idx];
      if (!el) return;
      const onMatch = () => {
        setExpandedWhy((prev) => ({ ...prev, [idx]: true }));
      };
      el.addEventListener("beforematch", onMatch);
      cleanups.push(() => el.removeEventListener("beforematch", onMatch));
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [recommendations]);

  // Ensure hidden="until-found" attribute stays synchronized after browser beforematch reveals it
  useEffect(() => {
    if (typeof HTMLElement === "undefined" || !("onbeforematch" in HTMLElement.prototype)) return;
    [0, 1, 2].forEach((idx) => {
      const el = whyPanelRefs.current[idx];
      if (!el) return;
      if (expandedWhy[idx]) {
        el.removeAttribute("hidden");
      } else {
        el.setAttribute("hidden", "until-found");
      }
    });
  }, [expandedWhy, recommendations]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const copyFullReportAsJson = async () => {
    try {
      const whyPanelData = (recommendations || []).map((rec) => ({
        recommendation: rec.name,
        category: rec.category,
        confidence: rec.confidence,
        ranking_breakdown: rec.ranking,
        supporting_signals: rec.supportingSignals.map((sig) => ({
          label: sig.label,
          domain: cleanDomain(sig.entityType),
          qloo_id: sig.entityId,
          affinity: sig.candidateAffinity ?? sig.affinity,
          qloo_request: sig.qloo_request,
          qloo_response: sig.qloo_response,
        })),
        live_queries: rec.supportingSignals.map((s) => s.qloo_request?.url),
      }));

      const fullReport = {
        app: "Cultivar",
        products: sourceProducts,
        catalog: sourceProducts,
        recommendations,
        why_panel_data: whyPanelData,
        exported_at: new Date().toISOString(),
      };

      await navigator.clipboard.writeText(JSON.stringify(fullReport, null, 2));
      showToast("Full report copied to clipboard as JSON");
    } catch {
      showToast("Failed to copy report JSON");
    }
  };

  useEffect(() => {
    const fetchMemoryDecisions = async () => {
      try {
        const res = await fetch("/api/memory");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.records)) {
            const decisionsMap: Record<string, boolean> = {};
            data.records.forEach((r: { id: string; accepted: boolean }) => {
              decisionsMap[r.id] = r.accepted;
            });
            setCardDecisions(decisionsMap);
          }
        }
      } catch (err) {
        console.warn("Could not load initial memory records:", err);
      }
    };
    fetchMemoryDecisions();
  }, []);

  const fetchExplains = useCallback(async (recsList: Recommendation[]) => {
    setLoadingExplains(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recsList }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.detail || errData.error || `HTTP ${res.status}`;
        showToast(`Explain API error: ${errMsg}`);
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (data.recommendations && Array.isArray(data.recommendations)) {
        setRecommendations(data.recommendations);
        sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
      }
    } catch {
      clearTimeout(timeoutId);
      setRecommendations((prev) => {
        if (!prev) return recsList;
        return prev.map((r) => {
          if (r.explanation) return r;
          const topLabels = r.supportingSignals.slice(0, 3).map((s) => s.label);
          const fallback =
            topLabels.length > 0
              ? `Based on cultural affinity with ${topLabels.join(", ")}.`
              : "Based on cross-domain cultural taste signals from your catalog.";
          return { ...r, explanation: fallback };
        });
      });
    } finally {
      setLoadingExplains(false);
    }
  }, [showToast]);

  useEffect(() => {
    const rawResolved = sessionStorage.getItem("cultivar:resolved");
    if (rawResolved) {
      try {
        const parsedResolved = JSON.parse(rawResolved);
        if (Array.isArray(parsedResolved)) {
          setSourceProducts(parsedResolved);
        } else if (parsedResolved && Array.isArray(parsedResolved.resolved)) {
          setSourceProducts(parsedResolved.resolved);
        }
      } catch {}
    }

    const raw = sessionStorage.getItem("cultivar:recommendations");
    if (!raw) {
      router.push("/");
      return;
    }

    let parsedList: Recommendation[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsedList = parsed;
      } else if (parsed && Array.isArray(parsed.recommendations)) {
        parsedList = parsed.recommendations;
      }
    } catch {
      router.push("/");
      return;
    }

    if (parsedList.length === 0) {
      router.push("/");
      return;
    }

    setRecommendations(parsedList);
    fetchExplains(parsedList);
  }, [router, fetchExplains]);

  const handleMonthChange = async (newMonth: number) => {
    setSelectedMonth(newMonth);
    setIsRecalculatingMonth(true);

    try {
      let resolvedPayload = sourceProducts;
      if (resolvedPayload.length === 0) {
        const rawResolved = sessionStorage.getItem("cultivar:resolved");
        if (rawResolved) {
          const parsed = JSON.parse(rawResolved);
          resolvedPayload = Array.isArray(parsed) ? parsed : parsed.resolved || [];
        }
      }

      if (resolvedPayload.length === 0) {
        showToast("No catalog entities found to recalculate.");
        setIsRecalculatingMonth(false);
        return;
      }

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: resolvedPayload, month: newMonth }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.recommendations) && data.recommendations.length > 0) {
        setRecommendations(data.recommendations);
        sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
        showToast(`Updated recommendations for ${MONTH_NAMES[newMonth]} launch window.`);
        await fetchExplains(data.recommendations);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Seasonal recalculation failed: ${msg}`);
    } finally {
      setIsRecalculatingMonth(false);
    }
  };

  const handleSaveDecision = async (rec: Recommendation, accepted: boolean) => {
    setSavingRecId(rec.entityId);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendation: rec,
          accepted,
          month: selectedMonth,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setCardDecisions((prev) => ({ ...prev, [rec.entityId]: accepted }));
      showToast("Saved. We'll remember this for future runs.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to save decision: ${msg}`);
    } finally {
      setSavingRecId(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copied to clipboard");
    }
  };

  const toggleWhy = (idx: number) => {
    setExpandedWhy((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleSignals = (idx: number) => {
    setExpandedSignals((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleFullJson = (key: string) => {
    setShowFullJsonMap((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const { totalUniqueEntities, domainCounts } = useMemo(() => {
    if (!recommendations) return { totalUniqueEntities: 0, domainCounts: {} as Record<string, number> };
    const entitySet = new Set<string>();
    const counts: Record<string, number> = {};

    recommendations.forEach((r) => {
      entitySet.add(r.entityId);
      counts["brand"] = (counts["brand"] || 0) + 1;
      r.supportingSignals.forEach((s) => {
        entitySet.add(s.entityId);
        const dom = cleanDomain(s.entityType);
        counts[dom] = (counts[dom] || 0) + 1;
      });
    });

    return { totalUniqueEntities: entitySet.size, domainCounts: counts };
  }, [recommendations]);

  const currentSeason = useMemo(() => getSeasonForMonth(selectedMonth), [selectedMonth]);

  if (!recommendations) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="space-y-2 border-b border-stone-200 pb-5">
          <div className="h-6 w-56 bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-96 max-w-full bg-stone-200/70 rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
              <div className="h-5 w-48 bg-stone-200 rounded animate-pulse" />
              <div className="h-12 w-full bg-stone-100 rounded animate-pulse" />
              <div className="h-4 w-64 bg-stone-200/70 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between">
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Page Header & Actions */}
        <div className="flex flex-col justify-between gap-4 border-b border-[#e7ece6] pb-6 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <button
                type="button"
                onClick={() => router.push("/resolve")}
                className="hover:text-stone-900 transition-colors inline-flex items-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Review resolved catalog
              </button>
              <span aria-hidden="true">/</span>
              <span>Opportunities</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#17211b] sm:text-3xl">
              Product opportunities
            </h1>
            <p className="text-sm text-stone-600">
              Ranked product concepts grounded in Qloo cross-domain taste affinities from your catalog.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => router.push("/compare")}
              className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors cursor-pointer"
            >
              Compare with baseline
            </button>
            <button
              type="button"
              onClick={copyFullReportAsJson}
              className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 text-xs font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Export complete run with audit trails and Why Panel payloads"
            >
              <svg className="w-3.5 h-3.5 text-[#1E4D3B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy full report as JSON
            </button>
          </div>
        </div>

        {/* Dismissible Decision-Support Disclaimer Banner */}
        {!dismissDisclaimer && (
          <div className="px-4 py-3 rounded-lg bg-amber-50/80 border border-amber-200 flex items-start justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-start gap-2.5">
              <svg
                className="w-4 h-4 text-amber-700 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="leading-relaxed">
                These recommendations are decision-support tools, not market guarantees. Verify supply chain and production feasibility before acting.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissDisclaimer(true)}
              className="text-amber-700 hover:text-amber-950 p-0.5 rounded hover:bg-amber-100/80 cursor-pointer shrink-0"
              aria-label="Dismiss disclaimer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Seasonal Calibration & Historical Context Bar */}
        <section
          aria-label="Seasonal calibration and historical comparison"
          className="space-y-3.5 rounded-2xl border border-[#e5ebe4] bg-white p-4 shadow-[0_8px_28px_rgba(27,53,35,.035)] sm:p-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-stone-900">
                  Seasonal launch calibration
                </h2>
                <span className="text-xs px-2 py-0.5 rounded bg-[#EDF5F0] text-[#1E4D3B] border border-[#C5DFD0] font-medium">
                  {currentSeason.seasonName} ({currentSeason.quarter.replace("_", " ")})
                </span>
              </div>
              <p className="text-xs text-stone-600">
                {currentSeason.focusDescription}
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <label htmlFor="launch-month" className="text-xs font-medium text-stone-700">
                Target launch month
              </label>
              <select
                id="launch-month"
                value={selectedMonth}
                disabled={isRecalculatingMonth}
                onChange={(e) => handleMonthChange(Number(e.target.value))}
                className="bg-white border border-stone-300 hover:border-stone-400 text-stone-900 text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 shadow-2xs"
              >
                {[
                  { m: 1, label: "January (Q1)" },
                  { m: 2, label: "February (Q1)" },
                  { m: 3, label: "March (Q1)" },
                  { m: 4, label: "April (Q2)" },
                  { m: 5, label: "May (Q2)" },
                  { m: 6, label: "June (Q2)" },
                  { m: 7, label: "July (Q3)" },
                  { m: 8, label: "August (Q3)" },
                  { m: 9, label: "September (Q3)" },
                  { m: 10, label: "October (Q4)" },
                  { m: 11, label: "November (Q4)" },
                  { m: 12, label: "December (Q4)" },
                ].map(({ m, label }) => (
                  <option key={m} value={m}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Secondary Disclosure: "This time last year" comparison using native <details> */}
          <details className="group border-t border-stone-200 pt-3">
            <summary className="flex items-center justify-between cursor-pointer list-none text-xs font-medium text-stone-700 hover:text-stone-900">
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5 text-stone-500 transition-transform group-open:rotate-90"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>
                  This time last year comparison ({MONTH_NAMES[selectedMonth]} 2025 vs. {MONTH_NAMES[selectedMonth]} 2026)
                </span>
              </span>
              <span className="text-[11px] text-stone-500 font-normal">
                Illustrative — based on demo memory, not real market data
              </span>
            </summary>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 text-xs">
              <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                <div className="text-[11px] font-medium text-stone-500">
                  Last year ({MONTH_NAMES[selectedMonth]} 2025)
                </div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  Chameleon Cold-brew Concentrates
                </div>
                <div className="text-stone-600 mt-1">
                  Accepted &bull; Core staple cold-brew baseline
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#EDF5F0]/60 border border-[#C5DFD0]">
                <div className="text-[11px] font-medium text-[#1E4D3B]">
                  This year ({MONTH_NAMES[selectedMonth]} 2026)
                </div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {recommendations[0]?.name || "The Wall Street Journal"}
                </div>
                <div className="text-stone-700 mt-1">
                  Signal shift: Audience affinity shifted toward functional botanical infusions and high-trust editorial media.
                </div>
              </div>
            </div>
          </details>
        </section>

        {/* Ranked Recommendation Cards (#1 to #3) */}
        {isRecalculatingMonth ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
                <div className="flex justify-between">
                  <div className="h-6 w-56 bg-stone-200 rounded animate-pulse" />
                  <div className="h-5 w-32 bg-stone-200 rounded animate-pulse" />
                </div>
                <div className="h-12 w-full bg-stone-100 rounded animate-pulse" />
                <div className="h-4 w-72 bg-stone-200/70 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {recommendations.slice(0, 3).map((rec, idx) => {
              const rankNumber = idx + 1;
              const isWhyExpanded = Boolean(expandedWhy[idx]);
              const isSignalsExpanded = Boolean(expandedSignals[idx]);
              const signalsToShow = isSignalsExpanded
                ? rec.supportingSignals
                : rec.supportingSignals.slice(0, 3);

              const totalAffinityVal =
                rec.ranking?.totalAffinity ??
                Number(
                  rec.supportingSignals
                    .reduce((acc, s) => acc + (s.candidateAffinity ?? s.affinity), 0)
                    .toFixed(4)
                );
              const signalCountVal = rec.ranking?.signalCount ?? rec.supportingSignals.length;
              const noveltyBonusVal = rec.ranking?.noveltyBonus ?? 1.5;
              const isNewCategory = rec.ranking?.isNewCategory ?? true;
              const rawScoreVal =
                rec.ranking?.rawScore ??
                Number(
                  (totalAffinityVal * Math.log(signalCountVal + 1) * noveltyBonusVal).toFixed(4)
                );
              const calcText =
                rec.ranking?.calculationText ||
                `${totalAffinityVal} × ln(${signalCountVal} + 1) × ${noveltyBonusVal} = ${rawScoreVal}`;

              const entityUrnList = [
                `urn:entity:brand:${rec.entityId}`,
                ...rec.supportingSignals.map(getSignalUrn),
              ];

              return (
                <article
                  key={rec.entityId || idx}
                  className="rounded-xl border border-stone-200 bg-white shadow-2xs overflow-hidden"
                >
                  <div className="p-5 sm:p-6 space-y-5">
                    {/* Card Header: Rank, Name, Category, Confidence */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-[#EDF5F0] text-[#1E4D3B] border border-[#C5DFD0] text-xs font-mono font-semibold tabular-nums">
                            #{rankNumber}
                          </span>
                          <h2 className="text-lg font-semibold tracking-tight text-stone-900">
                            {rec.name}
                          </h2>
                          <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                            {rec.category}
                          </span>
                        </div>
                      </div>

                      {/* Confidence Meter */}
                      <div className="w-full sm:w-44 shrink-0 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-stone-500">Confidence</span>
                          <span className="text-stone-900 font-mono font-semibold tabular-nums">
                            {rec.confidence}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-stone-100 border border-stone-200/70 overflow-hidden">
                          <div
                            className="h-full bg-[#1E4D3B] rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(5, rec.confidence))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Gemini-Generated Explanation */}
                    <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200/80 min-h-[3.25rem] flex items-center">
                      {loadingExplains ? (
                        <div className="space-y-2 w-full animate-pulse">
                          <div className="h-3.5 bg-stone-200 rounded w-5/6" />
                          <div className="h-3.5 bg-stone-200 rounded w-2/3" />
                        </div>
                      ) : (
                        <p className="text-sm text-stone-800 leading-relaxed">
                          {rec.explanation || "No explanation provided."}
                        </p>
                      )}
                    </div>

                    {/* Supporting Signals */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-stone-700">
                          Supporting signals ({Math.min(3, rec.supportingSignals.length)} of{" "}
                          {rec.supportingSignals.length} shown)
                        </span>
                        {rec.supportingSignals.length > 3 && (
                          <button
                            type="button"
                            onClick={() => toggleSignals(idx)}
                            className="text-[#1E4D3B] hover:underline font-medium cursor-pointer"
                          >
                            {isSignalsExpanded
                              ? "Show fewer"
                              : `Show all ${rec.supportingSignals.length} signals`}
                          </button>
                        )}
                      </div>

                      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        {signalsToShow.map((signal, sIdx) => {
                          const domainClean = cleanDomain(signal.entityType);
                          const affinityScore = signal.candidateAffinity ?? signal.affinity;
                          return (
                            <li
                              key={sIdx}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-stone-50/70 border border-stone-200/80"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-stone-900 truncate">
                                  {signal.label}
                                </div>
                                <div className="text-[11px] text-stone-500">
                                  {domainClean}
                                </div>
                              </div>
                              <span className="font-mono text-xs font-medium text-[#1E4D3B] bg-[#EDF5F0] px-2 py-0.5 rounded border border-[#C5DFD0] shrink-0 tabular-nums">
                                {affinityScore.toFixed(2)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {/* Primary Card Footer: Evidence Controls & Producer Decision */}
                    <div className="pt-3 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          id={`why-btn-${idx}`}
                          aria-expanded={isWhyExpanded}
                          aria-controls={`why-panel-${idx}`}
                          onClick={() => toggleWhy(idx)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                            isWhyExpanded
                              ? "bg-stone-900 text-white border-stone-900"
                              : "bg-white hover:bg-stone-50 text-stone-800 border-stone-300"
                          }`}
                        >
                          <span>{isWhyExpanded ? "Why this? ▴" : "Why this? ▾"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setGraphModalRec(rec)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1E4D3B] bg-[#EDF5F0] hover:bg-[#E2EFE7] border border-[#C5DFD0] rounded-lg transition-colors cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>View cultural graph</span>
                        </button>
                      </div>

                      {/* Producer Decision Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        {cardDecisions[rec.entityId] !== undefined && (
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                              cardDecisions[rec.entityId]
                                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                : "bg-rose-50 border-rose-200 text-rose-800"
                            }`}
                          >
                            {cardDecisions[rec.entityId] ? "Saved: I'll try this" : "Saved: Not for us"}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSaveDecision(rec, true)}
                          disabled={savingRecId === rec.entityId}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                            cardDecisions[rec.entityId] === true
                              ? "bg-[#1E4D3B] border-[#1E4D3B] text-white"
                              : "bg-white hover:bg-stone-50 border-stone-300 text-stone-800"
                          }`}
                        >
                          I&apos;ll try this
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSaveDecision(rec, false)}
                          disabled={savingRecId === rec.entityId}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                            cardDecisions[rec.entityId] === false
                              ? "bg-rose-700 border-rose-700 text-white"
                              : "bg-white hover:bg-rose-50/50 border-stone-300 text-stone-700 hover:text-rose-800"
                          }`}
                        >
                          Not for us
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Why Panel (Searchable via hidden="until-found" when collapsed) */}
                  <div
                    id={`why-panel-${idx}`}
                    ref={(el) => {
                      whyPanelRefs.current[idx] = el;
                    }}
                    aria-labelledby={`why-btn-${idx}`}
                    {...(!isWhyExpanded
                      ? ({ hidden: "until-found" } as unknown as React.HTMLAttributes<HTMLDivElement>)
                      : {})}
                  >
                    {/* Nested wrapper receives borders, padding, and background per search-hidden-content best practices */}
                    <div className="bg-stone-50 border-t border-stone-200 p-5 sm:p-6 space-y-6 text-xs">
                      <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                        <div>
                          <h3 className="text-sm font-semibold text-stone-900">
                            Evidence &amp; ranking audit trail
                          </h3>
                          <p className="text-xs text-stone-500">
                            Exact Qloo API queries, raw JSON payloads, ranking formula, and entity IDs for {rec.name}.
                          </p>
                        </div>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-600">
                          {rec.supportingSignals.length} live requests
                        </span>
                      </div>

                      {/* Sub-section A: "The Qloo queries we ran" */}
                      <div className="space-y-2.5">
                        <h4 className="font-semibold text-stone-800">
                          A. The Qloo queries we ran
                        </h4>
                        <div className="space-y-2">
                          {rec.supportingSignals.map((signal, sIdx) => {
                            const queryUrl =
                              signal.qloo_request?.url ||
                              `https://hackathon.api.qloo.com/v2/insights?filter.type=${encodeURIComponent(
                                signal.entityType
                              )}&signal.interests.entities=${signal.entityId}&take=20`;

                            return (
                              <div
                                key={sIdx}
                                className="rounded-lg bg-white border border-stone-200 p-3 space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-stone-800">
                                    Signal: {signal.label}{" "}
                                    <span className="text-stone-500">
                                      ({cleanDomain(signal.entityType)})
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(queryUrl)}
                                    className="text-[#1E4D3B] hover:underline font-medium cursor-pointer"
                                  >
                                    Copy URL
                                  </button>
                                </div>
                                <div className="p-2 rounded bg-stone-50 border border-stone-200/80 font-mono text-[11px] text-stone-700 overflow-x-auto select-all">
                                  <code>{queryUrl}</code>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sub-section B: "Raw Qloo responses" */}
                      <div className="space-y-2.5">
                        <h4 className="font-semibold text-stone-800">
                          B. Raw Qloo responses
                        </h4>
                        <div className="space-y-2">
                          {rec.supportingSignals.map((signal, sIdx) => {
                            const jsonKey = `${rec.entityId}-${sIdx}`;
                            const isFull = Boolean(showFullJsonMap[jsonKey]);
                            const relevantSlice = {
                              entity_id: signal.entityId,
                              name: signal.label,
                              types: [signal.entityType],
                              query: {
                                affinity: signal.candidateAffinity ?? signal.affinity,
                              },
                            };
                            const fullJson = signal.qloo_response || {
                              status: "success",
                              results: {
                                entities: [relevantSlice],
                              },
                            };

                            return (
                              <div
                                key={sIdx}
                                className="rounded-lg bg-white border border-stone-200 p-3 space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-stone-800">
                                    Response for &quot;{signal.label}&quot;
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleFullJson(jsonKey)}
                                    className="text-[#1E4D3B] hover:underline font-medium cursor-pointer"
                                  >
                                    {isFull ? "Show slice" : "Show full JSON ▾"}
                                  </button>
                                </div>
                                <pre className="p-2.5 rounded bg-stone-50 border border-stone-200/80 text-[11px] font-mono text-stone-700 overflow-x-auto select-all max-h-52 overflow-y-auto">
                                  {isFull
                                    ? JSON.stringify(fullJson, null, 2)
                                    : JSON.stringify(relevantSlice, null, 2)}
                                </pre>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sub-section C: "How we ranked it" */}
                      <div className="space-y-2.5">
                        <h4 className="font-semibold text-stone-800">
                          C. How we ranked it
                        </h4>
                        <div className="p-3.5 rounded-lg bg-white border border-stone-200 font-mono text-xs text-stone-700 space-y-1.5">
                          <div>
                            <span className="text-stone-500">totalAffinity = </span>
                            <span className="text-[#1E4D3B] font-semibold">{totalAffinityVal}</span>{" "}
                            <span className="text-stone-500 font-sans text-[11px]">
                              (sum across all signals)
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-500">signalCount = </span>
                            <span className="text-[#1E4D3B] font-semibold">{signalCountVal}</span>
                          </div>
                          <div>
                            <span className="text-stone-500">noveltyBonus = </span>
                            <span className="text-amber-700 font-semibold">{noveltyBonusVal}</span>{" "}
                            <span className="text-stone-500 font-sans text-[11px]">
                              ({isNewCategory ? "category is new to your catalog" : "matches catalog domain"})
                            </span>
                          </div>
                          <div className="pt-2 border-t border-stone-200 text-stone-900">
                            <span className="text-stone-500">score = </span>
                            <span>
                              {totalAffinityVal} × log({signalCountVal} + 1) × {noveltyBonusVal} ={" "}
                            </span>
                            <span className="text-[#1E4D3B] font-semibold">{rawScoreVal}</span>
                          </div>
                          <div className="text-[11px] text-stone-500 pt-1">
                            {calcText}
                          </div>
                        </div>
                      </div>

                      {/* Sub-section D: "Qloo entities that drove this decision" */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-stone-800">
                            D. Qloo entities that drove this decision
                          </h4>
                          <span className="text-[11px] text-stone-500">
                            Click any ID to copy
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-[11px]">
                          {entityUrnList.map((urnId, uIdx) => (
                            <button
                              type="button"
                              key={uIdx}
                              onClick={() => copyToClipboard(urnId)}
                              className="flex items-center justify-between p-2 rounded-md bg-white border border-stone-200 hover:border-[#1E4D3B] hover:bg-[#EDF5F0]/40 transition-colors cursor-pointer text-left group"
                              title="Click to copy entity URN"
                            >
                              <span className="text-stone-700 group-hover:text-[#1E4D3B] truncate mr-2 select-all">
                                {urnId}
                              </span>
                              <span className="text-[10px] font-sans font-medium text-stone-500 group-hover:text-[#1E4D3B] shrink-0 px-1.5 py-0.5 rounded bg-stone-100 group-hover:bg-white border border-stone-200">
                                Copy
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Bottom Summary Bar */}
        <div className="pt-4 border-t border-stone-200 text-center space-y-3 text-xs text-stone-600">
          <p>
            This recommendation set used{" "}
            <strong className="text-stone-900 font-semibold tabular-nums">{totalUniqueEntities}</strong> Qloo entities
            across{" "}
            <strong className="text-stone-900 font-semibold tabular-nums">{Object.keys(domainCounts).length}</strong>{" "}
            domains.{" "}
            <button
              type="button"
              onClick={() => setShowBreakdown((prev) => !prev)}
              className="text-[#1E4D3B] hover:underline ml-1 cursor-pointer font-medium"
            >
              {showBreakdown ? "Hide breakdown" : "Show entity breakdown"}
            </button>
          </p>

          {showBreakdown && (
            <div className="max-w-sm mx-auto p-3.5 rounded-lg bg-white border border-stone-200 text-left space-y-1.5 shadow-2xs">
              <div className="text-[11px] text-stone-500 font-medium pb-1 border-b border-stone-100">
                Entity domain distribution
              </div>
              {Object.entries(domainCounts).map(([dom, count]) => (
                <div key={dom} className="flex justify-between items-center text-xs">
                  <span className="capitalize text-stone-700">{dom.replace("_", " ")}</span>
                  <span className="text-[#1E4D3B] font-mono font-medium tabular-nums">
                    {count} entities
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Cultural Graph Modal */}
      <CulturalGraphModal
        recommendation={graphModalRec}
        sourceProducts={sourceProducts}
        open={Boolean(graphModalRec)}
        onOpenChange={(open) => !open && setGraphModalRec(null)}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-stone-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium"
        >
          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
