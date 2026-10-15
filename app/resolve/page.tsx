"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Product, ResolvedEntity } from "@/lib/types";

interface ResolveData {
  resolved: ResolvedEntity[];
  unresolved: Product[];
}

export default function ResolvePage() {
  const router = useRouter();
  const [data, setData] = useState<ResolveData | null>(null);
  const [reResolvingIndex, setReResolvingIndex] = useState<number | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Record<number, string>>({});
  const [loadingRecs, setLoadingRecs] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("cultivar:resolved");
    if (!raw) {
      router.push("/");
      return;
    }
    try {
      const parsed: ResolveData = JSON.parse(raw);
      setData(parsed);
    } catch {
      router.push("/");
    }
  }, [router]);

  const copyToClipboard = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTypeChange = (index: number, newType: string) => {
    setSelectedTypes((prev) => ({ ...prev, [index]: newType }));
  };

  const reResolveRow = async (index: number) => {
    if (!data) return;
    const target = data.resolved[index];
    const chosenType = selectedTypes[index] || "urn:entity:brand";

    setReResolvingIndex(index);
    setErrorMsg(null);

    // Build 1-row CSV
    const csvContent = `product_name,category,description\n"${target.product.name.replace(/"/g, '""')}","${target.product.category.replace(/"/g, '""')}","${target.product.description.replace(/"/g, '""')}"`;
    const blob = new Blob([csvContent], { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", blob, "single.csv");
    formData.append("type", chosenType);

    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error ? `${result.error}: ${JSON.stringify(result.detail || "")}` : `HTTP ${res.status}`);
      }

      if (result.resolved && result.resolved.length > 0) {
        const updatedResolved = [...data.resolved];
        updatedResolved[index] = result.resolved[0];
        const newData = { ...data, resolved: updatedResolved };
        setData(newData);
        sessionStorage.setItem("cultivar:resolved", JSON.stringify(newData));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Re-resolution failed: ${msg}`);
    } finally {
      setReResolvingIndex(null);
    }
  };

  const handleGenerateRecommendations = async () => {
    if (!data || data.resolved.length === 0) return;
    setLoadingRecs(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: data.resolved }),
      });

      const recResult = await res.json();
      if (!res.ok) {
        throw new Error(recResult.error ? `${recResult.error}: ${JSON.stringify(recResult.detail || "")}` : `HTTP ${res.status}`);
      }

      sessionStorage.setItem("cultivar:recommendations", JSON.stringify(recResult));
      router.push("/recommendations");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Recommendation failed: ${msg}`);
      setLoadingRecs(false);
    }
  };

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-sm">
        Loading catalog resolution...
      </div>
    );
  }

  const getConfidenceBadge = (confidence: number) => {
    if (confidence > 0.8) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {(confidence * 100).toFixed(0)}% High
        </span>
      );
    }
    if (confidence >= 0.5) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {(confidence * 100).toFixed(0)}% Med
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        {(confidence * 100).toFixed(0)}% Low
      </span>
    );
  };

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30">
        {/* Header */}
        <header className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between backdrop-blur bg-slate-950/60 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400 hover:bg-emerald-500/20 transition cursor-pointer"
              title="Return to upload"
            >
              CS
            </button>
            <div>
              <span className="font-semibold tracking-tight text-white">CropSignal</span>
              <span className="text-xs text-slate-500 ml-2 font-mono">/ Resolution Review</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            Stage 1 Verified
          </div>
        </header>

        {/* Content */}
        <main className="max-w-6xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
          {/* Title bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Catalog Resolution Review
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Each product from your catalog has been mapped to a verified entity in Qloo&apos;s cultural knowledge base.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
                {data.resolved.length} Resolved &bull; {data.unresolved?.length || 0} Unresolved
              </span>
            </div>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 font-mono text-xs overflow-x-auto">{errorMsg}</div>
            </div>
          )}

          {/* Resolved Entities Table */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/90 text-xs font-mono text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4 font-semibold">Product</th>
                    <th className="py-3.5 px-4 font-semibold">Resolved Entity</th>
                    <th className="py-3.5 px-4 font-semibold">Qloo ID</th>
                    <th className="py-3.5 px-4 font-semibold">Type</th>
                    <th className="py-3.5 px-4 font-semibold">Confidence</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {data.resolved.map((item, idx) => {
                    const isLowConfidence = item.confidence < 0.5;
                    const isReResolving = reResolvingIndex === idx;

                    return (
                      <tr
                        key={`${item.product.name}-${idx}`}
                        className={`transition hover:bg-slate-800/30 ${
                          isLowConfidence ? "bg-rose-950/10" : ""
                        }`}
                      >
                        {/* Product Column */}
                        <td className="py-4 px-4 font-medium text-slate-200">
                          <div>{item.product.name}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            {item.product.category}
                          </div>
                        </td>

                        {/* Resolved Entity Label */}
                        <td className="py-4 px-4 font-medium text-emerald-300">
                          {item.label}
                        </td>

                        {/* Qloo ID Column (Truncated + Tooltip on Hover) */}
                        <td className="py-4 px-4 font-mono text-xs text-slate-400">
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <span
                                onClick={() => copyToClipboard(item.qlooId)}
                                className="cursor-pointer hover:text-emerald-400 underline decoration-slate-700 underline-offset-4 transition"
                              >
                                {item.qlooId.slice(0, 24)}...
                              </span>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                side="top"
                                className="z-50 bg-slate-800 text-slate-100 border border-slate-700 px-3 py-1.5 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 select-all animate-in fade-in zoom-in-95"
                              >
                                <span>{item.qlooId}</span>
                                <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-1 rounded">
                                  {copiedId === item.qlooId ? "Copied!" : "Click to copy"}
                                </span>
                                <Tooltip.Arrow className="fill-slate-800" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        </td>

                        {/* Type Column */}
                        <td className="py-4 px-4 font-mono text-xs text-slate-400">
                          <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60">
                            {item.qlooType.replace("urn:entity:", "")}
                          </span>
                        </td>

                        {/* Confidence Column */}
                        <td className="py-4 px-4">
                          {getConfidenceBadge(item.confidence)}
                        </td>

                        {/* Action Column */}
                        <td className="py-4 px-4 text-right">
                          {isLowConfidence ? (
                            <div className="inline-flex items-center gap-2">
                              <select
                                value={selectedTypes[idx] || item.qlooType}
                                onChange={(e) => handleTypeChange(idx, e.target.value)}
                                disabled={isReResolving}
                                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
                              >
                                <option value="urn:entity:brand">brand</option>
                                <option value="urn:entity:product">product</option>
                                <option value="urn:entity:restaurant">restaurant</option>
                                <option value="urn:entity:place">place</option>
                              </select>
                              <button
                                onClick={() => reResolveRow(idx)}
                                disabled={isReResolving}
                                className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-medium rounded-lg transition disabled:opacity-50 cursor-pointer"
                              >
                                {isReResolving ? "Resolving..." : "Re-resolve"}
                              </button>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-500 font-mono">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Ready
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Unresolved Products Section (if any) */}
          {data.unresolved && data.unresolved.length > 0 && (
            <div className="bg-slate-900/50 border border-rose-900/30 rounded-2xl p-6">
              <h2 className="text-base font-semibold text-rose-400 flex items-center gap-2 mb-3">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Unresolved Products ({data.unresolved.length})
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                These products did not match any entity in Qloo by name or category.
              </p>
              <div className="space-y-2">
                {data.unresolved.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-300">
                    <div>
                      <span className="font-semibold text-white">{p.name}</span>
                      <span className="text-slate-500 ml-2">({p.category})</span>
                    </div>
                    <span className="text-rose-400 text-[11px]">No entity found</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Bar: Generate Recommendations */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800/80">
            <button
              onClick={() => router.push("/")}
              className="text-xs text-slate-400 hover:text-slate-200 transition font-mono flex items-center gap-1.5 cursor-pointer"
            >
              &larr; Upload a different catalog
            </button>

            <button
              onClick={handleGenerateRecommendations}
              disabled={loadingRecs || data.resolved.length === 0}
              className="w-full sm:w-auto px-8 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold text-sm transition shadow-xl shadow-emerald-500/15 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {loadingRecs ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-slate-950" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Querying Cultural Taste Graph...
                </>
              ) : (
                <>
                  Generate Recommendations
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600 font-mono">
          CropSignal &bull; Grounded in Qloo Live Graph &bull; No LLM Recommendations
        </footer>
      </div>
    </Tooltip.Provider>
  );
}
