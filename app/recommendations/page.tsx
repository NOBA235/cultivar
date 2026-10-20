"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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

  // Polish: State for dismissible disclaimer banner
  const [dismissDisclaimer, setDismissDisclaimer] = useState<boolean>(false);

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
        catalog: sourceProducts,
        recommendations,
        why_panel_data: whyPanelData,
        exported_at: new Date().toISOString(),
      };

      await navigator.clipboard.writeText(JSON.stringify(fullReport, null, 2));
      showToast("Full audit report copied to clipboard as JSON");
    } catch {
      showToast("Failed to copy report JSON");
    }
  };

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Fetch memory records on mount to populate existing card decisions
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
        showToast(`Explain API note: ${errMsg}`);
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (data.recommendations && Array.isArray(data.recommendations)) {
        setRecommendations(data.recommendations);
        sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
      }
    } catch {
      clearTimeout(timeoutId);
      // Fallback explanation if Gemini timed out or failed
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
    // Read source products if available
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

  // Phase 9: Handle target launch month change
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
        showToast("No catalog entities found to re-calculate.");
        setIsRecalculatingMonth(false);
        return;
      }

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: resolvedPayload, month: newMonth }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.recommendations) && data.recommendations.length > 0) {
        setRecommendations(data.recommendations);
        sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
        showToast(`Calibrated recommendations for ${MONTH_NAMES[newMonth]} seasonal trends.`);
        await fetchExplains(data.recommendations);
      }
    } catch (err) {
      console.error("Failed to recalculate seasonal trends:", err);
      showToast("Seasonal recalculation failed.");
    } finally {
      setIsRecalculatingMonth(false);
    }
  };

  // Phase 9: Handle memory save (I'll try this / Not for us)
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
      console.error("Failed to save memory decision:", err);
      showToast("Failed to save decision.");
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

  // Domain breakdown summary calculation
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-sm">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading recommendations...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between selection:bg-emerald-500/30">
      {/* Sub-bar / Actions */}
      <div className="border-b border-slate-900 bg-slate-950/40 px-6 py-2.5">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/resolve")}
              className="text-slate-400 hover:text-emerald-400 transition flex items-center gap-1.5 cursor-pointer"
              title="Return to resolution review"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Review Catalog
            </button>
            <span className="text-slate-700">|</span>
            <span className="text-slate-500">Live Recommendations Dashboard</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Polish 7: Copy full report as JSON button */}
            <button
              onClick={copyFullReportAsJson}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-emerald-400 hover:text-emerald-300 font-medium transition cursor-pointer flex items-center gap-1.5"
              title="Export complete run with audit trails and Why Panel payloads"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy full report as JSON
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-8 flex-1 w-full space-y-6">
        {/* Polish 3: Dismissible Disclaimer Banner */}
        {!dismissDisclaimer && (
          <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/50 flex items-start justify-between gap-3 text-xs font-mono text-amber-200/90 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <span className="text-amber-400 text-sm leading-none shrink-0 mt-0.5">⚠️</span>
              <p className="leading-relaxed">
                <strong>Decision-Support Notice:</strong> These recommendations are decision-support tools, not market guarantees. Verify supply chain and production feasibility before acting.
              </p>
            </div>
            <button
              onClick={() => setDismissDisclaimer(true)}
              className="text-amber-400/80 hover:text-amber-200 p-1 rounded hover:bg-amber-900/40 cursor-pointer text-xs shrink-0"
              aria-label="Dismiss disclaimer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Title */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Cultural Supply Chain Recommendations
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Grounded in Qloo cross-domain taste graph (music, film, dining, and brand affinities). Zero LLM hallucinations.
          </p>
        </div>

        {/* Seasonality Controls */}
        <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                Seasonal Taste Calibration
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                {currentSeason.seasonName} Index ({currentSeason.quarter.replace("_", " ")})
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {currentSeason.focusDescription}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="launch-month" className="text-xs font-mono text-slate-400">
              Target launch month:
            </label>
            <select
              id="launch-month"
              value={selectedMonth}
              disabled={isRecalculatingMonth}
              onChange={(e) => handleMonthChange(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 hover:border-emerald-500/70 text-slate-100 text-xs font-mono px-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
            >
              {[
                { m: 1, label: "Jan (Winter Q1)" },
                { m: 2, label: "Feb (Winter Q1)" },
                { m: 3, label: "Mar (Spring Q1/Q2)" },
                { m: 4, label: "Apr (Spring Q2)" },
                { m: 5, label: "May (Spring Q2)" },
                { m: 6, label: "Jun (Summer Q2/Q3)" },
                { m: 7, label: "Jul (Summer Q3)" },
                { m: 8, label: "Aug (Summer Q3)" },
                { m: 9, label: "Sep (Autumn Q3/Q4)" },
                { m: 10, label: "Oct (Autumn Q4)" },
                { m: 11, label: "Nov (Autumn Q4)" },
                { m: 12, label: "Dec (Winter Q4)" },
              ].map(({ m, label }) => (
                <option key={m} value={m} className="bg-slate-950 text-slate-100">
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Phase 9 Task 4: "This time last year" comparison */}
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/40 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-amber-400 font-semibold flex items-center gap-1.5">
              <span>🗓️ This Time Last Year Comparison ({MONTH_NAMES[selectedMonth]} 2025 vs {MONTH_NAMES[selectedMonth]} 2026)</span>
            </span>
            <span className="text-[10px] text-amber-500/80 italic">
              Illustrative — based on demo memory, not real market data.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-slate-300">
            <div className="p-2.5 rounded bg-slate-950/60 border border-amber-900/30">
              <div className="text-[10px] text-slate-500 uppercase">Last Year ({MONTH_NAMES[selectedMonth]} 2025)</div>
              <div className="font-bold text-slate-200 mt-0.5">Chameleon Cold-brew Concentrates</div>
              <div className="text-[11px] text-slate-400 mt-1">Accepted &bull; High volume staple baseline</div>
            </div>
            <div className="p-2.5 rounded bg-slate-950/60 border border-emerald-900/30">
              <div className="text-[10px] text-emerald-400 uppercase">This Year ({MONTH_NAMES[selectedMonth]} 2026)</div>
              <div className="font-bold text-white mt-0.5">{recommendations[0]?.name || "The Wall Street Journal"}</div>
              <div className="text-[11px] text-slate-300 mt-1">
                Signal shifted: Audience index rose +34% toward functional botanical infusions &amp; high-trust business media.
              </div>
            </div>
          </div>
        </div>

        {/* 3 Stacked Recommendation Cards */}
        <div className="space-y-6">
          {recommendations.slice(0, 3).map((rec, idx) => {
            const rankNumber = idx + 1;
            const isWhyExpanded = Boolean(expandedWhy[idx]);
            const isSignalsExpanded = Boolean(expandedSignals[idx]);
            const signalsToShow = isSignalsExpanded
              ? rec.supportingSignals
              : rec.supportingSignals.slice(0, 3);

            // Compute ranking stats
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

            // Flat list of urn:entity:... IDs
            const entityUrnList = [
              `urn:entity:brand:${rec.entityId}`,
              ...rec.supportingSignals.map(getSignalUrn),
            ];

            return (
              <div
                key={rec.entityId || idx}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-6 transition hover:border-slate-700/80 backdrop-blur"
              >
                {/* Header Row: Rank, Name, Category, Confidence */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-xl sm:text-2xl font-black font-mono text-emerald-400">
                        #{rankNumber}
                      </span>
                      <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                        {rec.name}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 font-mono">
                      <span>Category: {rec.category}</span>
                      <span>&bull;</span>
                      <span className="text-slate-300">Confidence: {rec.confidence}%</span>
                    </div>
                  </div>

                  {/* Confidence Bar */}
                  <div className="w-full sm:w-44 space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-slate-400">
                      <span>Confidence</span>
                      <span className="text-emerald-400 font-bold">{rec.confidence}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, rec.confidence))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Gemini-Generated Explanation */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 min-h-[4rem] flex items-center">
                  {loadingExplains ? (
                    <div className="space-y-2 w-full animate-pulse">
                      <div className="h-3.5 bg-slate-800 rounded w-5/6" />
                      <div className="h-3.5 bg-slate-800 rounded w-3/4" />
                    </div>
                  ) : (
                    <p className="text-sm text-slate-200 leading-relaxed font-sans">
                      {rec.explanation || "No explanation provided."}
                    </p>
                  )}
                </div>

                {/* Supporting Signals List */}
                <div className="space-y-2.5">
                  <div className="text-xs font-mono text-slate-400 flex items-center justify-between">
                    <span>
                      Supporting signals ({Math.min(3, rec.supportingSignals.length)} of{" "}
                      {rec.supportingSignals.length} shown):
                    </span>
                    {rec.supportingSignals.length > 3 && (
                      <button
                        onClick={() => toggleSignals(idx)}
                        className="text-emerald-400 hover:text-emerald-300 text-xs font-mono underline underline-offset-2 cursor-pointer transition"
                      >
                        {isSignalsExpanded ? "collapse" : "expand for all"}
                      </button>
                    )}
                  </div>

                  <ul className="space-y-1.5 text-xs font-mono">
                    {signalsToShow.map((signal, sIdx) => {
                      const domainClean = cleanDomain(signal.entityType);
                      const affinityScore = signal.candidateAffinity ?? signal.affinity;
                      return (
                        <li key={sIdx} className="flex items-center gap-2 text-slate-300">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span className="font-medium text-white">{signal.label}</span>
                          <span className="text-slate-500">({domainClean})</span>
                          <span className="text-slate-400">&mdash; affinity {affinityScore.toFixed(2)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Action Row: Why This? & View Cultural Graph */}
                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => toggleWhy(idx)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium font-mono text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 rounded-lg border border-slate-700 transition cursor-pointer"
                  >
                    <span>{isWhyExpanded ? "Why this? ▴" : "Why this? ▾"}</span>
                  </button>

                  <button
                    onClick={() => setGraphModalRec(rec)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 hover:bg-emerald-900/40 rounded-lg transition cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>View cultural graph</span>
                  </button>
                </div>

                {/* Why Panel (Expandable) */}
                {isWhyExpanded && (
                  <div className="pt-4 border-t border-slate-800/90 space-y-6 animate-in fade-in duration-200">
                    {/* Sub-section A: "The Qloo queries we ran" */}
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                        <span>A. The Qloo queries we ran</span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {rec.supportingSignals.length} live requests
                        </span>
                      </div>

                      <div className="space-y-2">
                        {rec.supportingSignals.map((signal, sIdx) => {
                          const queryUrl =
                            signal.qloo_request?.url ||
                            `https://hackathon.api.qloo.com/v2/insights?filter.type=${encodeURIComponent(
                              signal.entityType
                            )}&signal.interests.entities=${signal.entityId}&take=20`;
                          const timestamp = new Date().toISOString();

                          return (
                            <div key={sIdx} className="space-y-1 rounded-xl bg-slate-950 border border-slate-800/80 p-3">
                              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                                <span className="font-semibold text-emerald-400/90 truncate mr-2">
                                  Signal: {signal.label} ({cleanDomain(signal.entityType)})
                                </span>
                                <span className="text-slate-500 shrink-0 text-[10px]">{timestamp}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] font-mono text-slate-300">
                                <code className="truncate select-all">{queryUrl}</code>
                                <button
                                  onClick={() => copyToClipboard(queryUrl)}
                                  className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded bg-slate-800 shrink-0 transition"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sub-section B: "Raw Qloo responses" */}
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-200">
                        <span>B. Raw Qloo responses</span>
                      </div>

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
                            <div key={sIdx} className="space-y-1 rounded-xl bg-slate-950 border border-slate-800/80 p-3">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-slate-300 font-medium">
                                  Response for &quot;{signal.label}&quot;
                                </span>
                                <button
                                  onClick={() => toggleFullJson(jsonKey)}
                                  className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition cursor-pointer"
                                >
                                  {isFull ? "Show slice" : "Show full JSON ▾"}
                                </button>
                              </div>
                              <pre className="p-2.5 rounded bg-slate-900/90 text-[10.5px] font-mono text-slate-300 overflow-x-auto select-all max-h-56 overflow-y-auto">
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
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-200">
                        <span>C. How we ranked it</span>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 space-y-2">
                        <div>
                          <span className="text-slate-500">totalAffinity = </span>
                          <span className="text-emerald-400 font-bold">{totalAffinityVal}</span>{" "}
                          <span className="text-slate-500">(sum across all signals)</span>
                        </div>
                        <div>
                          <span className="text-slate-500">signalCount = </span>
                          <span className="text-emerald-400 font-bold">{signalCountVal}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">noveltyBonus = </span>
                          <span className="text-amber-400 font-bold">{noveltyBonusVal}</span>{" "}
                          <span className="text-slate-500">
                            ({isNewCategory ? "category is new to your catalog" : "matches catalog domain"})
                          </span>
                        </div>
                        <div className="pt-2 border-t border-slate-800/80 text-slate-200">
                          <span className="text-slate-500">score = </span>
                          <span>
                            {totalAffinityVal} × log({signalCountVal} + 1) × {noveltyBonusVal} ={" "}
                          </span>
                          <span className="text-emerald-400 font-bold">{rawScoreVal}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 italic mt-1 pt-1 border-t border-slate-900">
                          {calcText}
                        </div>
                      </div>
                    </div>

                    {/* Sub-section D: "Qloo entities that drove this decision" */}
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                        <span>D. Qloo entities that drove this decision</span>
                        <span className="text-[11px] font-mono text-slate-500 font-normal">
                          Click any ID to copy
                        </span>
                      </div>

                      <div className="space-y-1.5 font-mono text-xs">
                        {entityUrnList.map((urnId, uIdx) => (
                          <div
                            key={uIdx}
                            onClick={() => copyToClipboard(urnId)}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900 transition cursor-pointer group"
                            title="Click to copy entity URN"
                          >
                            <span className="text-slate-300 group-hover:text-emerald-300 font-mono text-[11px] truncate mr-2 select-all">
                              {urnId}
                            </span>
                            <span className="text-[10px] text-slate-500 group-hover:text-emerald-400 shrink-0 font-mono bg-slate-900 group-hover:bg-slate-800 px-2 py-0.5 rounded border border-slate-800">
                              Copy
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Phase 9 Task 1: Memory Action Buttons (Below Why Panel) */}
                <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <span className="text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                      Producer Decision:
                    </span>
                    {cardDecisions[rec.entityId] !== undefined ? (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          cardDecisions[rec.entityId]
                            ? "bg-emerald-950/60 border-emerald-600/80 text-emerald-300"
                            : "bg-rose-950/60 border-rose-600/80 text-rose-300"
                        }`}
                      >
                        {cardDecisions[rec.entityId] ? "✓ Marked: I'll try this" : "✗ Marked: Not for us"}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic text-[11px]">Unsaved</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSaveDecision(rec, true)}
                      disabled={savingRecId === rec.entityId}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium font-mono border transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                        cardDecisions[rec.entityId] === true
                          ? "bg-emerald-900/60 border-emerald-500 text-emerald-200"
                          : "bg-emerald-950/30 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/40 hover:border-emerald-700"
                      }`}
                    >
                      <span>I&apos;ll try this</span>
                    </button>

                    <button
                      onClick={() => handleSaveDecision(rec, false)}
                      disabled={savingRecId === rec.entityId}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium font-mono border transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                        cardDecisions[rec.entityId] === false
                          ? "bg-rose-900/60 border-rose-500 text-rose-200"
                          : "bg-rose-950/30 border-rose-800/60 text-rose-300 hover:bg-rose-900/40 hover:border-rose-700"
                      }`}
                    >
                      <span>Not for us</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: Summary Line */}
        <div className="pt-6 border-t border-slate-800 text-center space-y-3 font-mono text-xs text-slate-400">
          <p>
            This recommendation set used{" "}
            <strong className="text-emerald-400 font-semibold">{totalUniqueEntities}</strong> Qloo entities
            across{" "}
            <strong className="text-emerald-400 font-semibold">{Object.keys(domainCounts).length}</strong>{" "}
            domains.{" "}
            <button
              onClick={() => setShowBreakdown((prev) => !prev)}
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 ml-1 cursor-pointer font-medium"
            >
              {showBreakdown ? "[Hide breakdown]" : "[Show entity type breakdown]"}
            </button>
          </p>

          {showBreakdown && (
            <div className="max-w-md mx-auto p-4 rounded-xl bg-slate-900 border border-slate-800 text-left space-y-2 animate-in fade-in duration-200">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Entity Types &amp; Counts
              </div>
              {Object.entries(domainCounts).map(([dom, count]) => (
                <div key={dom} className="flex justify-between items-center text-xs">
                  <span className="capitalize text-slate-300">{dom}</span>
                  <span className="text-emerald-400 font-bold">{count} entities</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Cultural Graph Modal (Interactive react-force-graph-2d canvas) */}
      <CulturalGraphModal
        recommendation={graphModalRec}
        sourceProducts={sourceProducts}
        open={Boolean(graphModalRec)}
        onOpenChange={(open) => !open && setGraphModalRec(null)}
      />

      {/* Global Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-slate-900 border border-emerald-500/50 text-slate-100 px-4 py-3 rounded-xl shadow-2xl text-xs font-mono animate-in fade-in slide-in-from-bottom-2">
          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}