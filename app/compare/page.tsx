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
      showToast("Failed to copy");
    }
  };

  useEffect(() => {
    try {
      const recsJson = sessionStorage.getItem("cultivar:recommendations");
      const resolvedJson = sessionStorage.getItem("cultivar:resolved");

      if (!recsJson) {
        router.push("/");
        return;
      }

      const parsedRecs = JSON.parse(recsJson);
      const recs: Recommendation[] = Array.isArray(parsedRecs)
        ? parsedRecs
        : parsedRecs.recommendations || [];
      setRecommendations(recs);

      let resolved: Array<{ product: { name: string; category: string } }> = [];
      if (resolvedJson) {
        const parsedRes = JSON.parse(resolvedJson);
        resolved = Array.isArray(parsedRes) ? parsedRes : parsedRes.resolved || [];
      }

      const productsForGeneric =
        resolved.length > 0
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

  const { totalUniqueQlooEntities, uniqueDomainsCount, allUniqueUrns } = useMemo(() => {
    const urnSet = new Set<string>();
    const domainSet = new Set<string>();

    recommendations.slice(0, 3).forEach((rec) => {
      if (rec.entityId) {
        urnSet.add(`urn:entity:brand:${rec.entityId}`);
      }

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

  const cleanDomain = (raw: string) => {
    const stripped = raw.replace(/^urn:entity:/, "");
    if (stripped === "artist") return "musician";
    if (stripped === "brand") return "fashion_brand";
    return stripped;
  };

  return (
    <Tooltip.Provider delayDuration={150}>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Compact Page Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-[#e7ece6] pb-6 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <button
                type="button"
                onClick={() => router.push("/recommendations")}
                className="hover:text-stone-900 transition-colors inline-flex items-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Recommendations
              </button>
              <span aria-hidden="true">/</span>
              <span>Baseline comparison</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#17211b] sm:text-3xl">
              Baseline comparison
            </h1>
            <p className="text-sm text-stone-600">
              Comparing ungrounded LLM suggestions with Qloo-grounded recommendations using the same model (<code className="font-mono text-xs text-stone-800">gemini-2.5-flash</code>).
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-medium tabular-nums">
              {allUniqueUrns.length} active Qloo entities
            </span>
          </div>
        </div>

        {/* Column Headers (Desktop Sticky / Aligned) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#e5ebe4] bg-white p-4 shadow-[0_5px_20px_rgba(27,53,35,.025)]">
            <div>
              <h2 className="text-sm font-semibold text-stone-800">
                Generic LLM (gemini-2.5-flash, no cultural grounding)
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Catalog names &amp; categories only
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-white text-stone-600 border border-stone-200 shrink-0 font-medium">
              Baseline
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#cfe2d4] bg-[#f2f8f2] p-4 shadow-[0_5px_20px_rgba(27,53,35,.025)]">
            <div>
              <h2 className="text-sm font-semibold text-[#1E4D3B]">
                Cultivar (gemini-2.5-flash + Qloo taste graph)
              </h2>
              <p className="text-xs text-stone-600 mt-0.5">
                Cross-domain audience affinities
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-white text-[#1E4D3B] border border-[#C5DFD0] shrink-0 font-medium">
              Grounded
            </span>
          </div>
        </div>

        {/* Paired Comparison Rows (#1 to #3) */}
        <div className="space-y-4">
          {[0, 1, 2].map((idx) => {
            const rankNum = idx + 1;
            const generic = genericSuggestions[idx];
            const rec = recommendations[idx];
            const isExpanded = Boolean(expandedIds[idx]);

            return (
              <div
                key={idx}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch"
              >
                {/* Left Cell: Generic LLM */}
                <div className="flex flex-col justify-between space-y-4 rounded-2xl border border-[#e5ebe4] bg-white p-5 shadow-[0_8px_24px_rgba(27,53,35,.035)]">
                  {isLoadingGeneric ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-4 bg-stone-200 rounded w-1/3" />
                      <div className="h-5 bg-stone-200 rounded w-2/3" />
                      <div className="h-12 bg-stone-100 rounded w-full" />
                    </div>
                  ) : generic ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-stone-500">
                              #{rankNum}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                              {generic.category}
                            </span>
                          </div>
                          <span className="text-stone-400">Ungrounded</span>
                        </div>
                        <h3 className="text-base font-semibold text-stone-900">
                          {generic.name}
                        </h3>
                        <p className="text-sm text-stone-600 leading-relaxed">
                          {generic.reasoning}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
                        <span>Signal depth: 0 cultural entities</span>
                        <span className="font-mono text-[11px] text-stone-400">
                          0 urn:entity: IDs
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-rose-700 font-mono">
                      {genericError || "No generic suggestion available"}
                    </div>
                  )}
                </div>

                {/* Right Cell: Cultivar */}
                <div className="flex flex-col justify-between space-y-4 rounded-2xl border border-[#cfe2d4] bg-white p-5 shadow-[0_8px_24px_rgba(27,53,35,.045)]">
                  {rec ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-[#1E4D3B]">
                              #{rankNum}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#EDF5F0] text-[#1E4D3B] border border-[#C5DFD0]">
                              {rec.category}
                            </span>
                          </div>
                          <span className="font-mono font-medium text-stone-700 tabular-nums">
                            Confidence: {rec.confidence}%
                          </span>
                        </div>
                        <h3 className="text-base font-semibold text-stone-900">
                          {rec.name}
                        </h3>
                        <p className="text-sm text-stone-700 leading-relaxed">
                          {rec.explanation ||
                            `Based on verified audience affinity with ${rec.supportingSignals
                              .map((s) => s.label)
                              .join(", ")}.`}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-stone-100 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-[#1E4D3B]">
                            Signal depth: {rec.supportingSignals.length} cultural entities
                          </span>

                          <button
                            type="button"
                            onClick={() => toggleExpand(idx)}
                            className="text-[#1E4D3B] hover:underline font-medium cursor-pointer text-xs"
                          >
                            {isExpanded ? "Hide entity IDs ▴" : "Expand entity IDs ▾"}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-2 text-xs">
                            <div className="text-[11px] text-stone-500 font-medium flex justify-between">
                              <span>Grounding Qloo entities</span>
                              <span className="text-[#1E4D3B] font-mono">
                                {rec.supportingSignals.length + 1} IDs
                              </span>
                            </div>

                            {/* Target Entity */}
                            <div className="text-[11px] font-mono p-1.5 rounded bg-white border border-stone-200 flex items-center justify-between gap-2">
                              <div className="truncate">
                                <span className="text-[#1E4D3B] font-medium">Target: </span>
                                <span className="text-stone-700">
                                  urn:entity:brand:{rec.entityId}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  copyToClipboard(
                                    `urn:entity:brand:${rec.entityId}`,
                                    "Target ID"
                                  )
                                }
                                className="text-stone-600 hover:text-stone-900 font-sans text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 cursor-pointer"
                              >
                                Copy
                              </button>
                            </div>

                            {/* Supporting Signal Entities */}
                            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                              {rec.supportingSignals.map((sig, sIdx) => {
                                const prefix = sig.entityType.startsWith("urn:entity:")
                                  ? sig.entityType
                                  : `urn:entity:${sig.entityType}`;
                                const fullUrn = `${prefix}:${sig.entityId}`;
                                const cleanType = cleanDomain(sig.entityType);

                                return (
                                  <div
                                    key={sIdx}
                                    className="text-[11px] font-mono p-1.5 rounded bg-white border border-stone-200 flex items-center justify-between gap-2"
                                  >
                                    <div className="truncate">
                                      <span className="text-stone-500">[{cleanType}] </span>
                                      <span className="text-stone-900 font-sans font-medium">
                                        {sig.label}:{" "}
                                      </span>
                                      <span className="text-stone-600 text-[10px]">
                                        {fullUrn}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(fullUrn, sig.label)}
                                      className="text-stone-600 hover:text-stone-900 font-sans text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 cursor-pointer"
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
                    <div className="text-xs text-stone-500">
                      No Cultivar recommendation available
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Bar */}
        <section
          aria-label="Comparison summary"
          className="p-5 rounded-xl bg-white border border-stone-200 shadow-2xs space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-3 border-b border-stone-200 text-sm">
            <div className="flex items-center gap-2 text-stone-600">
              <span className="w-2 h-2 rounded-full bg-stone-400" />
              <span>
                Generic LLM: <strong className="text-stone-900 font-semibold tabular-nums">0</strong> Qloo entities used.
              </span>
            </div>

            <div className="flex items-center gap-2 text-[#1E4D3B]">
              <span className="w-2 h-2 rounded-full bg-[#1E4D3B]" />
              <span>
                Cultivar:{" "}
                <strong className="font-semibold tabular-nums">
                  {totalUniqueQlooEntities}
                </strong>{" "}
                Qloo entities used across{" "}
                <strong className="font-semibold tabular-nums">
                  {uniqueDomainsCount}
                </strong>{" "}
                domains.
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-stone-600">
            <div className="flex items-center gap-2">
              <span>
                Both columns use <strong className="text-stone-900">gemini-2.5-flash</strong> at temperature{" "}
                <strong className="text-stone-900">0.2</strong>. The only difference is cultural grounding via Qloo.
              </span>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-stone-100 border border-stone-300 text-stone-700 hover:bg-stone-200 transition-colors cursor-pointer shrink-0 text-[11px] font-semibold"
                    aria-label="Evaluation methodology details"
                  >
                    ⓘ
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="top"
                    align="center"
                    className="max-w-xs z-50 px-3 py-2 text-xs text-stone-100 bg-stone-900 rounded-lg shadow-lg"
                  >
                    We ran the same model on both sides. The left is a fair baseline. We did not use a weaker model to make Qloo look better.
                    <Tooltip.Arrow className="fill-stone-900" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </div>
          </div>
        </section>

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
      </main>
    </Tooltip.Provider>
  );
}
