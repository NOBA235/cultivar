"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { CulturalGraphModal } from "@/components/CulturalGraph";
import { MONTH_NAMES, SEASONAL_DATA_DISCLAIMER, getSeasonForMonth } from "@/lib/seasonal";
import { readLocalMemory, saveLocalDecision, slimRecommendation } from "@/lib/localMemory";
import type { Recommendation, CulturalSignal, ResolvedEntity, ToolTrace } from "@/lib/types";

function cleanDomain(urn: string): string {
  const map: Record<string, string> = {
    "urn:entity:artist": "musician",
    "urn:entity:movie": "movie",
    "urn:entity:brand": "brand",
    "urn:entity:book": "book",
    "urn:entity:destination": "destination",
    "urn:entity:restaurant": "restaurant",
    "urn:entity:place": "place",
  };
  return map[urn] || urn.replace("urn:entity:", "");
}

function fmtAffinity(n: number | undefined): string {
  return typeof n === "number" ? n.toFixed(2) : "n/a";
}

function formatEntityUrn(type: string, id: string): string {
  if (id.startsWith("urn:entity:")) return id;
  const cleanType = type.startsWith("urn:entity:") ? type : `urn:entity:${type}`;
  return `${cleanType}:${id}`;
}

/** The stage-3 Qloo call (signal → brands) that returned this recommendation for a given signal. */
function findStage3Trace(rec: Recommendation, signal: CulturalSignal): ToolTrace | undefined {
  return rec.toolTraces?.find((t) => {
    const input = t.input as { entityId?: unknown } | null;
    return t.tool === "find_adjacent_products" && input?.entityId === signal.entityId;
  });
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

  // Seasonality and Memory states. 0 = no seasonal weighting (the initial run).
  const [selectedMonth, setSelectedMonth] = useState<number>(0);
  const [isRecalculatingMonth, setIsRecalculatingMonth] = useState<boolean>(false);
  const [cardDecisions, setCardDecisions] = useState<Record<string, boolean>>({});
  const [savingRecId, setSavingRecId] = useState<string | null>(null);
  const [explainFallbackReason, setExplainFallbackReason] = useState<string | null>(null);

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
        brand_inspiration: rec.name,
        qloo_category_tag: rec.category,
        relative_rank_score: rec.confidence,
        relative_rank_score_note: "Raw score indexed to the #1 result (=100). Not a probability.",
        ranking_breakdown: rec.ranking,
        explanation_is_template_fallback: Boolean(rec.explanationFallback),
        supporting_signals: rec.supportingSignals.map((sig) => ({
          label: sig.label,
          domain: cleanDomain(sig.entityType),
          qloo_id: sig.entityId,
          source_catalog_product: sig.sourceProduct ?? null,
          catalog_to_signal_affinity: sig.affinity,
          signal_to_candidate_affinity: sig.candidateAffinity ?? null,
          stage2_qloo_request: sig.qloo_request ?? null,
          stage3_qloo_request: findStage3Trace(rec, sig)?.qloo_request ?? null,
        })),
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
    // Decisions saved in this browser (localStorage) plus the local demo file.
    const decisionsMap: Record<string, boolean> = {};
    const fetchMemoryDecisions = async () => {
      try {
        const res = await fetch("/api/memory");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.records)) {
            data.records.forEach((r: { accepted: boolean; recommendation?: { entityId?: string } }) => {
              if (r.recommendation?.entityId) decisionsMap[r.recommendation.entityId] = r.accepted;
            });
          }
        }
      } catch (err) {
        console.warn("Could not load local demo memory file:", err);
      }
      // Browser-local records win because they are this browser's latest decisions.
      readLocalMemory().forEach((r) => {
        decisionsMap[r.recommendation.entityId] = r.accepted;
      });
      setCardDecisions({ ...decisionsMap });
    };
    fetchMemoryDecisions();
  }, []);

  const fetchExplains = useCallback(async (recsList: Recommendation[]) => {
    setLoadingExplains(true);
    setExplainFallbackReason(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

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
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (data.recommendations && Array.isArray(data.recommendations)) {
        setRecommendations(data.recommendations);
        sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
      }
      if (data.isFallback) {
        const reason = String(data.fallbackReason || "Gemini unavailable");
        setExplainFallbackReason(reason);
        showToast(
          /429|rate|quota/i.test(reason)
            ? `Gemini rate-limited: showing template explanations. ${reason}`
            : `Gemini error: showing template explanations. ${reason}`,
        );
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      setExplainFallbackReason(msg);
      showToast(`Explain API error: ${msg}`);
      // No invented text: cards without an explanation show the Qloo evidence only.
      setRecommendations((prev) => prev ?? recsList);
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
        body: JSON.stringify(
          newMonth > 0 ? { resolved: resolvedPayload, month: newMonth } : { resolved: resolvedPayload },
        ),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.recommendations) && data.recommendations.length > 0) {
        setRecommendations(data.recommendations);
        sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
        showToast(
          newMonth > 0
            ? `Re-ran with illustrative ${MONTH_NAMES[newMonth]} keyword weighting.`
            : "Re-ran without seasonal weighting.",
        );
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
    const month = selectedMonth > 0 ? selectedMonth : undefined;
    try {
      // 1) Browser-local memory (what the History page reads first).
      saveLocalDecision(rec, accepted, month);
      setCardDecisions((prev) => ({ ...prev, [rec.entityId]: accepted }));

      // 2) Local demo file on the server, used as context for Gemini explanations.
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendation: slimRecommendation(rec),
          accepted,
          month,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `HTTP ${res.status}`);
      }

      showToast("Saved in this browser (local demo memory).");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Saved in this browser only; demo file write failed: ${msg}`);
    } finally {
      setSavingRecId(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Clipboard unavailable: copy failed");
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
      counts["brand inspiration"] = (counts["brand inspiration"] || 0) + 1;
      r.supportingSignals.forEach((s) => {
        entitySet.add(s.entityId);
        const dom = cleanDomain(s.entityType);
        counts[dom] = (counts[dom] || 0) + 1;
      });
    });

    return { totalUniqueEntities: entitySet.size, domainCounts: counts };
  }, [recommendations]);

  const currentSeason = useMemo(
    () => (selectedMonth > 0 ? getSeasonForMonth(selectedMonth) : null),
    [selectedMonth],
  );

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
              <span>Inspirations</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#17211b] sm:text-3xl">
              Cultural &amp; brand inspirations
            </h1>
            <p className="max-w-3xl text-sm text-stone-600">
              Existing brands in Qloo&apos;s taste graph whose audiences overlap with cultural signals linked to your
              catalog. Use them as positioning, partnership, or concept inspiration, not as proof of demand.
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
                These are decision-support leads, not market guarantees. Qloo affinity shows audience taste overlap; it
                does not predict sales or purchase demand. Verify supply chain and production feasibility before acting.
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

        {/* Optional illustrative seasonal weighting */}
        <section
          aria-label="Illustrative seasonal weighting"
          className="space-y-3 rounded-2xl border border-[#e5ebe4] bg-white p-4 shadow-[0_8px_28px_rgba(27,53,35,.035)] sm:p-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-stone-900">
                  Seasonal weighting (illustrative)
                </h2>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-medium">
                  Keyword assumptions, not trend data
                </span>
                {currentSeason && (
                  <span className="text-xs px-2 py-0.5 rounded bg-[#EDF5F0] text-[#1E4D3B] border border-[#C5DFD0] font-medium">
                    {currentSeason.seasonName}
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-600">
                {currentSeason
                  ? `${currentSeason.focusDescription} The weight only changes which signals are queried next; displayed Qloo affinities are unchanged.`
                  : "Off. Results use raw Qloo affinities only. Pick a month to re-run with hand-written seasonal keyword weights."}
              </p>
              <p className="text-[11px] text-stone-500">{SEASONAL_DATA_DISCLAIMER}</p>
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
                <option value={0}>No seasonal weighting</option>
                {Object.entries(MONTH_NAMES).map(([m, label]) => (
                  <option key={m} value={Number(m)}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {explainFallbackReason && !loadingExplains && (
          <div
            role="status"
            className="px-4 py-3 rounded-lg bg-stone-100 border border-stone-300 text-xs text-stone-800"
          >
            <strong className="font-semibold">Gemini explanations unavailable.</strong>{" "}
            Cards marked &ldquo;Template&rdquo; show fixed text built from Qloo signal labels. The rankings and Qloo
            scores are unaffected. <span className="font-mono text-stone-600 break-all">{explainFallbackReason}</span>
          </div>
        )}

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

              const entityUrnList = [
                formatEntityUrn("brand", rec.entityId),
                ...rec.supportingSignals.map((s) => formatEntityUrn(s.entityType, s.entityId)),
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

                      {/* Relative Rank Score Meter */}
                      <div className="w-full sm:w-48 shrink-0 space-y-1">
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-stone-500 font-medium" title="Indexed to the top-scoring result (=100). Not a probability.">
                            Relative rank score
                          </span>
                          <span className="text-stone-900 font-mono font-semibold tabular-nums">
                            {rec.confidence} / 100
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-stone-100 border border-stone-200/70 overflow-hidden">
                          <div
                            className="h-full bg-[#1E4D3B] rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(5, rec.confidence))}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-stone-500 text-right">
                          #1 top match = 100 &bull; not a probability
                        </div>
                      </div>
                    </div>

                    {/* Gemini-Generated Explanation or Template Fallback */}
                    <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200/80 min-h-[3.25rem] flex items-center">
                      {loadingExplains ? (
                        <div className="space-y-2 w-full animate-pulse">
                          <div className="h-3.5 bg-stone-200 rounded w-5/6" />
                          <div className="h-3.5 bg-stone-200 rounded w-2/3" />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {rec.explanationFallback && (
                              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                                Template (Gemini unavailable)
                              </span>
                            )}
                            <span className="text-[11px] text-stone-500 font-medium">
                              {rec.explanationFallback ? "Synthesized from Qloo signals" : "Gemini 2.5 Flash cultural narrative"}
                            </span>
                          </div>
                          <p className="text-sm text-stone-800 leading-relaxed">
                            {rec.explanation || "No explanation provided."}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Supporting Signals with 2-Hop Qloo Affinities */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-stone-700">
                          Supporting cultural signals ({Math.min(3, rec.supportingSignals.length)} of{" "}
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

                      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        {signalsToShow.map((signal, sIdx) => {
                          const domainClean = cleanDomain(signal.entityType);
                          return (
                            <li
                              key={sIdx}
                              className="flex flex-col justify-between p-2.5 rounded-lg bg-stone-50/70 border border-stone-200/80 space-y-2"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-stone-900 truncate" title={signal.label}>
                                  {signal.label}
                                </div>
                                <div className="text-[11px] text-stone-500 flex items-center justify-between">
                                  <span>{domainClean}</span>
                                  {signal.sourceProduct && (
                                    <span className="truncate max-w-[120px] text-stone-600" title={`Surfaced via catalog item "${signal.sourceProduct}"`}>
                                      via {signal.sourceProduct}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="pt-1.5 border-t border-stone-200/60 grid grid-cols-2 gap-1 text-[11px]">
                                <div title="Stage 2: Qloo audience affinity between catalog item and this signal">
                                  <span className="text-stone-500 block text-[10px]">Catalog affinity</span>
                                  <span className="font-mono font-medium text-stone-800 tabular-nums">
                                    {fmtAffinity(signal.affinity)}
                                  </span>
                                </div>
                                <div title="Stage 3: Qloo audience affinity between this signal and the candidate brand">
                                  <span className="text-stone-500 block text-[10px]">Candidate affinity</span>
                                  <span className="font-mono font-medium text-[#1E4D3B] tabular-nums">
                                    {fmtAffinity(signal.candidateAffinity)}
                                  </span>
                                </div>
                              </div>
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
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-stone-800">
                            A. The Qloo queries we ran (2-hop graph audit)
                          </h4>
                          <span className="text-[11px] text-stone-500">
                            Stage 2 (Catalog → Signal) &amp; Stage 3 (Signal → Brand)
                          </span>
                        </div>
                        <div className="space-y-2">
                          {rec.supportingSignals.map((signal, sIdx) => {
                            const stage2Url =
                              signal.qloo_request?.url ||
                              (signal.sourceEntityId
                                ? `https://hackathon.api.qloo.com/v2/insights?filter.type=${encodeURIComponent(
                                    signal.entityType
                                  )}&signal.interests.entities=${signal.sourceEntityId}&take=20`
                                : null);
                            const stage3Trace = findStage3Trace(rec, signal);
                            const stage3Url =
                              stage3Trace?.qloo_request?.url ||
                              `https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Abrand&signal.interests.entities=${signal.entityId}&take=15`;

                            return (
                              <div
                                key={sIdx}
                                className="rounded-lg bg-white border border-stone-200 p-3 space-y-2"
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-semibold text-stone-900">
                                    Signal #{sIdx + 1}: {signal.label}{" "}
                                    <span className="text-stone-500 font-normal">
                                      ({cleanDomain(signal.entityType)})
                                    </span>
                                    {signal.sourceProduct && (
                                      <span className="text-stone-500 font-normal">
                                        {" "}via &ldquo;{signal.sourceProduct}&rdquo;
                                      </span>
                                    )}
                                  </span>
                                </div>

                                {/* Hop 1 */}
                                {stage2Url && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between items-center text-[10px] text-stone-500">
                                      <span>Hop 1: Catalog item &rarr; Cultural signal</span>
                                      <button
                                        type="button"
                                        onClick={() => copyToClipboard(stage2Url)}
                                        className="text-[#1E4D3B] hover:underline font-medium cursor-pointer"
                                      >
                                        Copy URL
                                      </button>
                                    </div>
                                    <div className="p-1.5 rounded bg-stone-50 border border-stone-200/80 font-mono text-[10px] text-stone-700 overflow-x-auto select-all">
                                      <code>{stage2Url}</code>
                                    </div>
                                  </div>
                                )}

                                {/* Hop 2 */}
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-[10px] text-stone-500">
                                    <span>Hop 2: Cultural signal &rarr; Candidate brand ({rec.name})</span>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(stage3Url)}
                                      className="text-[#1E4D3B] hover:underline font-medium cursor-pointer"
                                    >
                                      Copy URL
                                    </button>
                                  </div>
                                  <div className="p-1.5 rounded bg-stone-50 border border-stone-200/80 font-mono text-[10px] text-stone-700 overflow-x-auto select-all">
                                    <code>{stage3Url}</code>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sub-section B: "Raw Qloo responses" */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-stone-800">
                            B. Raw Qloo responses
                          </h4>
                          <span className="text-[11px] text-stone-500">
                            Real JSON returned by Qloo
                          </span>
                        </div>
                        <div className="space-y-2">
                          {rec.supportingSignals.map((signal, sIdx) => {
                            const jsonKey = `${rec.entityId}-${sIdx}`;
                            const isFull = Boolean(showFullJsonMap[jsonKey]);
                            const stage3Trace = findStage3Trace(rec, signal);
                            const fullJson =
                              stage3Trace?.qloo_response ||
                              signal.qloo_response ||
                              rec.qloo_response;

                            const relevantSlice = {
                              signal: {
                                entity_id: signal.entityId,
                                name: signal.label,
                                type: signal.entityType,
                                catalog_affinity: signal.affinity,
                                ...(signal.sourceProduct ? { source_catalog_product: signal.sourceProduct } : {}),
                              },
                              candidate_surfaced: {
                                entity_id: rec.entityId,
                                name: rec.name,
                                type: "urn:entity:brand",
                                candidate_affinity: signal.candidateAffinity ?? null,
                              },
                            };

                            return (
                              <div
                                key={sIdx}
                                className="rounded-lg bg-white border border-stone-200 p-3 space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-stone-800">
                                    Qloo affinity pair for &quot;{signal.label}&quot; &rarr; &quot;{rec.name}&quot;
                                  </span>
                                  {Boolean(fullJson) && (
                                    <button
                                      type="button"
                                      onClick={() => toggleFullJson(jsonKey)}
                                      className="text-[#1E4D3B] hover:underline font-medium cursor-pointer"
                                    >
                                      {isFull ? "Show slice" : "Show full Qloo payload ▾"}
                                    </button>
                                  )}
                                </div>
                                <pre className="p-2.5 rounded bg-stone-50 border border-stone-200/80 text-[11px] font-mono text-stone-700 overflow-x-auto select-all max-h-52 overflow-y-auto">
                                  {isFull && fullJson
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
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-stone-800">
                            C. How we ranked it (Deterministic Formula)
                          </h4>
                          <span className="text-[11px] text-stone-500">
                            No LLM scoring
                          </span>
                        </div>
                        <div className="p-3.5 rounded-lg bg-white border border-stone-200 font-mono text-xs text-stone-700 space-y-2">
                          <div className="space-y-1">
                            <div>
                              <span className="text-stone-500">totalAffinity = </span>
                              <span className="text-[#1E4D3B] font-semibold">{totalAffinityVal}</span>{" "}
                              <span className="text-stone-500 font-sans text-[11px]">
                                (sum of signal-to-candidate affinities across supporting signals)
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
                                ({isNewCategory ? "category is new to catalog: 1.5×" : "matches catalog category: 1.0×"})
                              </span>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-stone-200 text-stone-900 space-y-1">
                            <div>
                              <span className="text-stone-500">rawScore = </span>
                              <span>
                                {totalAffinityVal} × ln({signalCountVal} + 1) × {noveltyBonusVal} ={" "}
                              </span>
                              <span className="text-[#1E4D3B] font-semibold">{rawScoreVal}</span>
                            </div>
                            <div className="text-[11px] text-stone-600 font-sans">
                              <strong>Relative rank score:</strong> {rec.confidence} / 100 (indexed to top raw score in this run).
                            </div>
                            <div className="text-[10px] text-stone-500 font-sans italic">
                              Note: Relative rank score is an ordinal ranking tool relative to the top candidate. It is not a statistical probability of market success, sales volume, or consumer purchase intent.
                            </div>
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
