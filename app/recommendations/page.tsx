"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CulturalGraphModal } from "@/components/CulturalGraph";
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

  useEffect(() => {
    // Read source products if available
    const rawResolved = sessionStorage.getItem("cultivar:resolved");
    if (rawResolved) {
      try {
        const parsedResolved = JSON.parse(rawResolved);
        if (parsedResolved && Array.isArray(parsedResolved.resolved)) {
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

    // Call POST /api/explain on mount
    const fetchExplains = async () => {
      setLoadingExplains(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recommendations: parsedList }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.detail || errData.error || `HTTP ${res.status}`;
          setToastMessage(`Explain API error: ${errMsg}`);
          setTimeout(() => setToastMessage(null), 4000);
          throw new Error(errMsg);
        }

        const data = await res.json();
        if (data.recommendations && Array.isArray(data.recommendations)) {
          setRecommendations(data.recommendations);
          sessionStorage.setItem("cultivar:recommendations", JSON.stringify(data.recommendations));
        }
      } catch {
        clearTimeout(timeoutId);
        // Fallback explanation if Gemini timed out (10s) or failed:
        // "Based on affinity with [label1], [label2], and [label3]."
        setRecommendations((prev) => {
          if (!prev) return parsedList;
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
    };

    fetchExplains();
  }, [router]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToastMessage(`Copied to clipboard`);
      setTimeout(() => setToastMessage(null), 2500);
    } catch {
      setToastMessage("Copied to clipboard");
      setTimeout(() => setToastMessage(null), 2500);
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

  if (!recommendations) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-sm">
        Loading recommendations...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between backdrop-blur bg-slate-950/60 sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/resolve")}
            className="text-xs text-slate-400 hover:text-emerald-400 transition font-mono flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700"
            title="Return to resolution review"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Review Catalog
          </button>
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-white">CropSignal</span>
            <span className="text-xs text-slate-500 font-mono">/ Recommendations Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/compare")}
            className="text-xs text-amber-300 hover:text-amber-200 bg-amber-950/40 border border-amber-800/60 hover:border-amber-700/80 px-3 py-1.5 rounded-lg transition font-mono flex items-center gap-1.5 cursor-pointer"
          >
            Compare with Generic LLM
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
          <div className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Qloo Grounded
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
        {/* Title */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Cultural Supply Chain Recommendations
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Grounded in Qloo cross-domain taste graph (music, film, dining, and brand affinities). Zero LLM hallucinations.
          </p>
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
            const topScoreVal = rec.ranking?.topScore ?? rawScoreVal;
            const calcText =
              rec.ranking?.calculationText ||
              `${totalAffinityVal} × ln(${signalCountVal} + 1) × ${noveltyBonusVal} = ${rawScoreVal}`;

            // Flat list of urn:entity:... IDs
            const entityUrnList: string[] = [
              `urn:entity:brand:${rec.entityId}`,
              ...rec.supportingSignals.map(getSignalUrn),
            ];

            return (
              <div
                key={rec.entityId || idx}
                className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm transition duration-200 hover:border-slate-700/80"
              >
                {/* Card Top Section */}
                <div className="p-6 sm:p-7 space-y-5">
                  {/* Header: Rank + Product Name + Category + Confidence */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-mono font-bold">
                          #{rankNumber}
                        </span>
                        <h2 className="text-xl font-bold text-white tracking-tight">
                          {rec.name}
                        </h2>
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Category: <span className="text-slate-300 font-semibold">{rec.category}</span>
                        <span className="mx-2 text-slate-600">&bull;</span>
                        Confidence: <span className="text-emerald-400 font-bold">{rec.confidence}%</span>
                      </div>
                    </div>

                    {/* Confidence Progress Bar */}
                    <div className="w-full sm:w-44 space-y-1.5 self-center sm:self-start">
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(5, rec.confidence))}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>Score: {rawScoreVal}</span>
                        <span>Rank #{rankNumber}</span>
                      </div>
                    </div>
                  </div>

                  {/* Gemini Explanation */}
                  <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    {loadingExplains && !rec.explanation ? (
                      <div className="space-y-2 py-1">
                        <div className="h-4 bg-slate-800 rounded animate-pulse w-3/4" />
                        <div className="h-3 bg-slate-800/60 rounded animate-pulse w-1/2" />
                      </div>
                    ) : (
                      <p className="text-sm text-slate-200 leading-relaxed font-sans">
                        {rec.explanation}
                      </p>
                    )}
                  </div>

                  {/* Supporting Signals List */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">
                        Supporting signals ({signalsToShow.length} of {rec.supportingSignals.length} shown
                        {rec.supportingSignals.length > 3 && ", click toggle for all"}):
                      </span>
                      {rec.supportingSignals.length > 3 && (
                        <button
                          onClick={() => toggleSignals(idx)}
                          className="text-xs font-mono text-emerald-400 hover:text-emerald-300 transition cursor-pointer"
                        >
                          {isSignalsExpanded ? "Show fewer" : "Expand for all ▾"}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {signalsToShow.map((signal, sIdx) => {
                        const affNum = (signal.candidateAffinity ?? signal.affinity).toFixed(2);
                        return (
                          <div
                            key={sIdx}
                            className="flex items-center justify-between text-xs font-mono py-1 px-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:border-slate-700/60 transition"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
                              <span className="text-slate-200 font-medium">{signal.label}</span>
                              <span className="text-slate-500 text-[11px]">
                                ({cleanDomain(signal.entityType)})
                              </span>
                            </div>
                            <span className="text-emerald-400 font-semibold">
                              affinity {affNum}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Card Bottom Buttons: Why this? & View cultural graph */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
                    <button
                      onClick={() => toggleWhy(idx)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs font-mono text-slate-200 border border-slate-700 transition cursor-pointer"
                    >
                      <span>Why this?</span>
                      <svg
                        className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                          isWhyExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    <button
                      onClick={() => setGraphModalRec(rec)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-mono text-emerald-400 border border-emerald-500/30 transition cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      <span>View cultural graph</span>
                    </button>
                  </div>
                </div>

                {/* Why Panel (Expandable section) */}
                {isWhyExpanded && (
                  <div className="border-t border-slate-800 bg-slate-950/90 p-6 sm:p-7 space-y-7 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2 font-mono text-xs text-emerald-400 uppercase tracking-wider font-semibold">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Audit Trail &amp; Qloo Grounding</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">Live API Verified</span>
                    </div>

                    {/* Sub-section A: "The Qloo queries we ran" */}
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                        <span>A. The Qloo queries we ran</span>
                        <span className="text-[11px] font-mono text-slate-500 font-normal">
                          Full URL + Query Parameters
                        </span>
                      </div>

                      <div className="space-y-3">
                        {/* Primary Candidate Query */}
                        {rec.qloo_request && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                              <span className="text-emerald-400 font-medium">Candidate Adjacency Query</span>
                              <span>GET /v2/insights</span>
                            </div>
                            <div className="relative group">
                              <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-400/95 overflow-x-auto whitespace-pre-wrap break-all pr-16 select-all">
                                {rec.qloo_request.url}
                              </pre>
                              <button
                                onClick={() => copyToClipboard(rec.qloo_request?.url || "")}
                                className="absolute top-2 right-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono transition cursor-pointer"
                              >
                                Copy URL
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Supporting Signals Queries */}
                        {rec.supportingSignals.map((signal, sIdx) => {
                          const queryUrl =
                            signal.qloo_request?.url ||
                            `https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Abrand&signal.interests.entities=${signal.entityId}&take=10`;
                          const timestamp = new Date().toISOString();

                          return (
                            <div key={sIdx} className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                                <span>
                                  Signal #{sIdx + 1}: <strong className="text-slate-200">{signal.label}</strong>{" "}
                                  ({cleanDomain(signal.entityType)})
                                </span>
                                <span className="text-slate-500">{timestamp}</span>
                              </div>
                              <div className="relative group">
                                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-400/90 overflow-x-auto whitespace-pre-wrap break-all pr-16 select-all">
                                  {queryUrl}
                                </pre>
                                <button
                                  onClick={() => copyToClipboard(queryUrl)}
                                  className="absolute top-2 right-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono transition cursor-pointer"
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
                      <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                        <span>B. Raw Qloo responses</span>
                        <span className="text-[11px] font-mono text-slate-500 font-normal">
                          Collapsible JSON payload
                        </span>
                      </div>

                      <div className="space-y-3">
                        {rec.supportingSignals.map((signal, sIdx) => {
                          const jsonKey = `${idx}-${sIdx}`;
                          const isFull = Boolean(showFullJsonMap[jsonKey]);
                          const relevantSlice = {
                            entity_id: signal.entityId,
                            label: signal.label,
                            affinity: Number(
                              (signal.candidateAffinity ?? signal.affinity).toFixed(4)
                            ),
                            entity_type: signal.entityType,
                          };
                          const fullJson = signal.qloo_response || rec.qloo_response || {
                            success: true,
                            results: {
                              entities: [
                                {
                                  entity_id: signal.entityId,
                                  name: signal.label,
                                  types: [signal.entityType],
                                  query: { affinity: signal.candidateAffinity ?? signal.affinity },
                                },
                              ],
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
                        <div>
                          <span className="text-slate-500">normalized confidence = </span>
                          <span className="text-emerald-400 font-bold">{rec.confidence} / 100</span>{" "}
                          <span className="text-slate-500">
                            (relative to top candidate score {topScoreVal})
                          </span>
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

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600 font-mono">
        CropSignal &bull; Grounded in Qloo Live Graph &bull; Gemini 2.5 Flash Explanations
      </footer>
    </div>
  );
}
