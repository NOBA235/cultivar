"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Recommendation } from "@/lib/types";
import type { GenericSuggestion } from "@/app/api/generic/route";

export default function ComparePage() {
  const router = useRouter();

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [genericSuggestions, setGenericSuggestions] = useState<GenericSuggestion[]>([]);
  const [isLoadingGeneric, setIsLoadingGeneric] = useState(true);
  const [genericError, setGenericError] = useState<string | null>(null);

  // Expanded Qloo IDs per card index in the right column
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied ${label} to clipboard`);
    } catch {
      showToast(`Failed to copy`);
    }
  };

  // 1. Read sessionStorage on mount
  useEffect(() => {
    try {
      const recsJson = sessionStorage.getItem("cultivar:recommendations");
      const resolvedJson = sessionStorage.getItem("cultivar:resolved");

      if (!recsJson) {
        // Fallback for standalone demo / direct link if empty
        router.push("/");
        return;
      }

      const recs: Recommendation[] = JSON.parse(recsJson);
      setRecommendations(recs);

      let resolved: Array<{ product: { name: string; category: string } }> = [];
      if (resolvedJson) {
        resolved = JSON.parse(resolvedJson);
      }

      // 2. Fetch generic baseline from /api/generic
      const productsForGeneric = resolved.length > 0
        ? resolved.map((r) => ({ name: r.product.name, category: r.product.category }))
        : [
            { name: "Alder Street Yirgacheffe", category: "single-origin beans" },
            { name: "Foggy Ferry Cold Brew Concentrate", category: "cold brew" },
            { name: "Night Shift Espresso Blend", category: "espresso roast" },
            { name: "Hawthorne Oat Latte Can", category: "canned latte" },
            { name: "Tabor Hill Swiss Water Decaf", category: "decaf beans" },
          ];

      fetchGenericBaseline(productsForGeneric);
    } catch (err) {
      console.error("Failed to read sessionStorage in /compare:", err);
      router.push("/");
    }
  }, [router]);

  const fetchGenericBaseline = async (products: Array<{ name: string; category: string }>) => {
    setIsLoadingGeneric(true);
    setGenericError(null);
    try {
      const res = await fetch("/api/generic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.suggestions) && data.suggestions.length >= 3) {
        setGenericSuggestions(data.suggestions.slice(0, 3));
      } else {
        throw new Error("Invalid suggestions payload received");
      }
    } catch (err) {
      console.error("Error fetching /api/generic:", err);
      setGenericError(err instanceof Error ? err.message : "Failed to load generic baseline");
    } finally {
      setIsLoadingGeneric(false);
    }
  };

  const toggleExpand = (idx: number) => {
    setExpandedIds((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Live Summary metrics
  const { totalUniqueQlooEntities, uniqueDomainsCount, allUniqueUrns } = useMemo(() => {
    const urnSet = new Set<string>();
    const domainSet = new Set<string>();

    recommendations.slice(0, 3).forEach((rec) => {
      // Add recommendation entity ID
      if (rec.entityId) {
        urnSet.add(`urn:entity:brand:${rec.entityId}`);
      }

      // Add all supporting signal entity IDs
      (rec.supportingSignals || []).forEach((sig) => {
        const prefix = sig.entityType.startsWith("urn:entity:")
          ? sig.entityType
          : `urn:entity:${sig.entityType}`;
        urnSet.add(`${prefix}:${sig.entityId}`);

        const dom = sig.entityType.replace(/^urn:entity:/, "");
        domainSet.add(dom);
      });
    });

    return {
      totalUniqueQlooEntities: urnSet.size,
      uniqueDomainsCount: domainSet.size,
      allUniqueUrns: Array.from(urnSet),
    };
  }, [recommendations]);

  // Clean domain helper
  const cleanDomain = (raw: string) => {
    const stripped = raw.replace(/^urn:entity:/, "");
    if (stripped === "artist") return "musician";
    if (stripped === "brand") return "fashion_brand";
    return stripped;
  };

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30">
        {/* Navigation Bar */}
        <header className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between backdrop-blur bg-slate-950/60 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/recommendations")}
              className="text-xs text-slate-400 hover:text-emerald-400 transition font-mono flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700"
              title="Return to Recommendations"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Recommendations
            </button>
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight text-white">CropSignal</span>
              <span className="text-xs text-slate-500 font-mono">/ Model Grounding Comparison</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            Fair Baseline Evaluation
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-6xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
          {/* Page Heading */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Side-by-Side Model Grounding Comparison
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Both columns execute the exact same frontier model (<code className="text-emerald-400 font-mono">gemini-2.5-flash</code> at temperature 0.2).
              The left column relies on ungrounded standard consulting prompting; the right column is anchored directly to Qloo&apos;s live cross-domain taste graph.
            </p>
          </div>

          {/* Two Column Grid */}
          <div className="space-y-6">
            {/* Column Headers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column Header */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-500" />
                    <h2 className="text-sm sm:text-base font-semibold text-slate-200">
                      Generic LLM (gemini-2.5-flash, no cultural grounding)
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Standard food consulting prompt &bull; Zero cultural taste signals
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
                  Baseline
                </span>
              </div>

              {/* Right Column Header */}
              <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/50 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <h2 className="text-sm sm:text-base font-semibold text-emerald-300">
                      Cultivar (gemini-2.5-flash + Qloo taste graph)
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Culturally grounded &bull; Cross-domain live audience affinities
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-800/80 shrink-0">
                  Grounded
                </span>
              </div>
            </div>

            {/* Paired Rows 1..3 */}
            {[0, 1, 2].map((idx) => {
              const rankNum = idx + 1;
              const generic = genericSuggestions[idx];
              const rec = recommendations[idx];
              const isExpanded = Boolean(expandedIds[idx]);

              return (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 rounded-2xl bg-slate-900/30 border border-slate-800/90 relative"
                >
                  {/* Row Badge */}
                  <div className="absolute -top-3 left-6 z-10 px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[11px] font-mono font-semibold text-slate-300 shadow">
                    Recommendation #{rankNum}
                  </div>

                  {/* LEFT CELL: Generic LLM */}
                  <div className="flex flex-col justify-between rounded-xl bg-slate-900/80 border border-slate-800 p-5 space-y-4">
                    {isLoadingGeneric ? (
                      <div className="space-y-3 animate-pulse">
                        <div className="h-4 bg-slate-800 rounded w-1/3" />
                        <div className="h-6 bg-slate-800 rounded w-3/4" />
                        <div className="h-16 bg-slate-800 rounded w-full" />
                      </div>
                    ) : generic ? (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">
                              Category: {generic.category}
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800/80 text-slate-400">
                              No Qloo Seed
                            </span>
                          </div>
                          <h3 className="text-lg font-bold text-slate-200">
                            {generic.name}
                          </h3>
                          <p className="text-sm text-slate-400 leading-relaxed italic">
                            &quot;{generic.reasoning}&quot;
                          </p>
                        </div>

                        {/* Left Footer: Signal Depth */}
                        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                            <span>Signal depth: 0 cultural entities</span>
                          </div>
                          <span className="text-[11px] text-slate-600">0 urn:entity: IDs</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-rose-400 font-mono">
                        {genericError || "No generic suggestion available"}
                      </div>
                    )}
                  </div>

                  {/* RIGHT CELL: Cultivar */}
                  <div className="flex flex-col justify-between rounded-xl bg-slate-900/80 border border-emerald-900/30 p-5 space-y-4">
                    {rec ? (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-emerald-400/90 uppercase tracking-wider">
                              Category: {rec.category}
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
                              Confidence: {rec.confidence}%
                            </span>
                          </div>
                          <h3 className="text-lg font-bold text-white flex items-center justify-between">
                            <span>{rec.name}</span>
                          </h3>
                          <p className="text-sm text-slate-300 leading-relaxed">
                            {rec.explanation ||
                              `Based on verified audience affinity with ${rec.supportingSignals.map((s) => s.label).join(", ")}.`}
                          </p>
                        </div>

                        {/* Right Footer: Signal Depth + Expand Link */}
                        <div className="pt-3 border-t border-slate-800/80 space-y-3">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span>Signal depth: {rec.supportingSignals.length} cultural entities</span>
                            </div>

                            <button
                              onClick={() => toggleExpand(idx)}
                              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition cursor-pointer font-mono text-xs flex items-center gap-1"
                            >
                              {isExpanded ? "[Collapse Qloo entity IDs ▴]" : "[Expand Qloo entity IDs ▾]"}
                            </button>
                          </div>

                          {/* Expanded Qloo Entity IDs */}
                          {isExpanded && (
                            <div className="p-3 rounded-lg bg-slate-950 border border-emerald-900/50 space-y-2 animate-in fade-in duration-200">
                              <div className="text-[11px] font-mono uppercase text-slate-400 font-semibold flex justify-between">
                                <span>Grounding Qloo Entities</span>
                                <span className="text-emerald-400">
                                  {rec.supportingSignals.length + 1} entities
                                </span>
                              </div>

                              {/* Target Product Entity */}
                              <div className="text-[11px] font-mono p-1.5 rounded bg-slate-900 flex items-center justify-between gap-2">
                                <div className="truncate">
                                  <span className="text-emerald-400 font-medium">Target: </span>
                                  <span className="text-slate-300">urn:entity:brand:{rec.entityId}</span>
                                </div>
                                <button
                                  onClick={() =>
                                    copyToClipboard(`urn:entity:brand:${rec.entityId}`, "Target ID")
                                  }
                                  className="text-slate-500 hover:text-slate-300 text-[10px] shrink-0 px-1 py-0.5 rounded bg-slate-800"
                                >
                                  Copy
                                </button>
                              </div>

                              {/* Supporting Signals Entities */}
                              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                                {rec.supportingSignals.map((sig, sIdx) => {
                                  const prefix = sig.entityType.startsWith("urn:entity:")
                                    ? sig.entityType
                                    : `urn:entity:${sig.entityType}`;
                                  const fullUrn = `${prefix}:${sig.entityId}`;
                                  const cleanType = cleanDomain(sig.entityType);

                                  return (
                                    <div
                                      key={sIdx}
                                      className="text-[11px] font-mono p-1.5 rounded bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2"
                                    >
                                      <div className="truncate">
                                        <span className="text-slate-400">[{cleanType}] </span>
                                        <span className="text-slate-200 font-medium">
                                          {sig.label}:{" "}
                                        </span>
                                        <span className="text-slate-400 text-[10px]">{fullUrn}</span>
                                      </div>
                                      <button
                                        onClick={() => copyToClipboard(fullUrn, sig.label)}
                                        className="text-slate-500 hover:text-slate-300 text-[10px] shrink-0 px-1 py-0.5 rounded bg-slate-800"
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-slate-500 font-mono">
                        No Cultivar recommendation available
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Summary Bar */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-800 font-mono text-sm">
              {/* Left Summary */}
              <div className="flex items-center gap-2 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                <span>
                  Generic LLM: <strong className="text-slate-300">0</strong> Qloo entities used.
                </span>
              </div>

              {/* Right Summary */}
              <div className="flex items-center gap-2 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span>
                  Cultivar: <strong className="text-white font-bold">{totalUniqueQlooEntities}</strong> Qloo entities used across <strong className="text-white font-bold">{uniqueDomainsCount}</strong> domains.
                </span>
              </div>
            </div>

            {/* Note & Tooltip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400 font-mono">
              <div className="flex items-center gap-2">
                <span>
                  Both columns use <strong className="text-slate-200">gemini-2.5-flash</strong> at temperature <strong className="text-slate-200">0.2</strong>. The only difference is cultural grounding via Qloo.
                </span>

                {/* ⓘ Tooltip */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer shrink-0 text-[11px] font-bold"
                      aria-label="Evaluation methodology details"
                    >
                      ⓘ
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      align="center"
                      className="max-w-xs z-50 px-3 py-2 text-xs font-sans text-slate-200 bg-slate-900 border border-slate-700 rounded-lg shadow-xl animate-in fade-in zoom-in-95"
                    >
                      We ran the same model on both sides. The left is a fair baseline. We did not use a weaker model to make Qloo look better.
                      <Tooltip.Arrow className="fill-slate-900" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>

              {/* Right: Unique entity badge */}
              <div className="shrink-0 text-[11px] px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-emerald-400 font-mono">
                {allUniqueUrns.length} Verified Qloo URNs Active
              </div>
            </div>
          </div>
        </main>

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
          CropSignal &bull; Phase 8 Side-by-Side Evaluation &bull; Grounded in Qloo Taste Graph
        </footer>
      </div>
    </Tooltip.Provider>
  );
}
