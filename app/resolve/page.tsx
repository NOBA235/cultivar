"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Select from "@radix-ui/react-select";
import type { Product, ResolvedEntity } from "@/lib/types";

interface ResolveData {
  resolved: ResolvedEntity[];
  unresolved: Product[];
}

export default function ResolvePage() {
  const router = useRouter();
  const [data, setData] = useState<ResolveData | null>(null);
  const [reResolvingIndex, setReResolvingIndex] = useState<number | null>(null);
  const [loadingRecs, setLoadingRecs] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [skippedUnresolved, setSkippedUnresolved] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const raw = sessionStorage.getItem("cultivar:resolved");
    if (!raw) {
      router.push("/");
      return;
    }
    try {
      const parsed: ResolveData = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.resolved)) {
        router.push("/");
        return;
      }
      setData(parsed);
    } catch {
      router.push("/");
    }
  }, [router]);

  const copyToClipboard = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setToastMessage(`Copied "${id}" to clipboard`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch {
      setToastMessage("Copied to clipboard");
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  const handleTypeChangeAndResolve = async (index: number, chosenType: string) => {
    if (!data) return;
    const target = data.resolved[index];

    setReResolvingIndex(index);
    setErrorMsg(null);

    // Build single-row CSV to re-resolve with selected type
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
        throw new Error(
          result.error
            ? `${result.error}: ${JSON.stringify(result.detail || "")}`
            : `HTTP ${res.status}`
        );
      }

      if (result.resolved && result.resolved.length > 0) {
        const updatedResolved = [...data.resolved];
        updatedResolved[index] = result.resolved[0];
        const newData = { ...data, resolved: updatedResolved };
        setData(newData);
        sessionStorage.setItem("cultivar:resolved", JSON.stringify(newData));
        setToastMessage(`Re-resolved "${target.product.name}" as ${chosenType.replace("urn:entity:", "")}`);
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Re-resolution failed: ${msg}`);
    } finally {
      setReResolvingIndex(null);
    }
  };

  const handleGenerateRecommendations = async () => {
    if (!data) return;
    const validResolved = data.resolved.filter(
      (r) => r.qlooId && r.qlooId.trim().length > 0
    );

    if (validResolved.length < 2) return;

    setLoadingRecs(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: validResolved }),
      });

      const recResult = await res.json();
      if (!res.ok) {
        throw new Error(
          recResult.error
            ? `${recResult.error}: ${JSON.stringify(recResult.detail || "")}`
            : `HTTP ${res.status}`
        );
      }

      sessionStorage.setItem(
        "cultivar:recommendations",
        JSON.stringify(recResult.recommendations || recResult)
      );
      router.push("/recommendations");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Recommendation pipeline failed: ${msg}`);
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

  // Filter resolved items with valid Qloo IDs
  const validResolvedCount = data.resolved.filter(
    (r) => r.qlooId && r.qlooId.trim().length > 0
  ).length;

  // Separate any resolved items that have empty qlooId plus unresolved list
  const emptyQlooIdItems = data.resolved
    .map((r, idx) => ({ ...r, originalIndex: idx }))
    .filter((r) => !r.qlooId || r.qlooId.trim().length === 0);

  const unresolvedList: Array<{ product: Product; source: "unresolved" | "empty_id" }> = [
    ...(data.unresolved || []).map((p) => ({ product: p, source: "unresolved" as const })),
    ...emptyQlooIdItems.map((e) => ({ product: e.product, source: "empty_id" as const })),
  ];

  const getConfidenceBadge = (confidence: number) => {
    const formatted = confidence.toFixed(2);
    if (confidence > 0.8) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
          title={`Confidence: ${formatted} (> 0.8)`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {formatted}
        </span>
      );
    }
    if (confidence >= 0.5) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30"
          title={`Confidence: ${formatted} (0.5 – 0.8)`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {formatted}
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30"
        title={`Confidence: ${formatted} (< 0.5)`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        {formatted}
      </span>
    );
  };

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30">
        {/* Header */}
        <header className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between backdrop-blur bg-slate-950/60 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="text-xs text-slate-400 hover:text-emerald-400 transition font-mono flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700"
              title="Return to catalog upload"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back
            </button>
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight text-white">CropSignal</span>
              <span className="text-xs text-slate-500 font-mono">/ Resolution Review</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            Verified Qloo IDs
          </div>
        </header>

        {/* Content */}
        <main className="max-w-6xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
          {/* Title Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Catalog Resolution Review
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Verify and correct Qloo entity resolutions before generating cultural supply chain recommendations.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
                {validResolvedCount} Resolved &bull; {unresolvedList.length} Unresolved
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

          {/* Resolution Review Table */}
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
                    const truncatedId = item.qlooId
                      ? `${item.qlooId.slice(0, 24)}…`
                      : "—";

                    return (
                      <tr
                        key={`${item.product.name}-${idx}`}
                        className={`transition hover:bg-slate-800/30 ${
                          isLowConfidence ? "bg-rose-950/15" : ""
                        }`}
                      >
                        {/* 1. Product Column */}
                        <td className="py-4 px-4 font-medium text-slate-200">
                          <div>{item.product.name}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            {item.product.category}
                          </div>
                        </td>

                        {/* 2. Resolved Entity Column */}
                        <td className="py-4 px-4 font-medium text-emerald-300">
                          {item.label}
                        </td>

                        {/* 3. Qloo ID Column: truncated (first 24 chars + …), hover tooltip, click to copy */}
                        <td className="py-4 px-4 font-mono text-xs text-slate-300">
                          {item.qlooId ? (
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(item.qlooId)}
                                  className="text-left font-mono cursor-pointer hover:text-emerald-400 hover:underline decoration-emerald-500/50 underline-offset-4 transition inline-flex items-center gap-1.5 group"
                                  title="Click to copy full Qloo ID"
                                >
                                  <span>{truncatedId}</span>
                                  <svg
                                    className="w-3 h-3 text-slate-500 group-hover:text-emerald-400 shrink-0 transition"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                </button>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content
                                  side="top"
                                  className="z-50 bg-slate-900 text-slate-100 border border-slate-700 px-3 py-2 rounded-lg shadow-2xl text-xs font-mono flex items-center gap-3 select-all animate-in fade-in zoom-in-95"
                                >
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                                      Full Qloo Entity ID
                                    </div>
                                    <div className="font-semibold text-emerald-400">{item.qlooId}</div>
                                  </div>
                                  <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                                    Click to copy
                                  </span>
                                  <Tooltip.Arrow className="fill-slate-900" />
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* 4. Type Column */}
                        <td className="py-4 px-4 font-mono text-xs text-slate-400">
                          <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60">
                            {item.qlooType.replace("urn:entity:", "")}
                          </span>
                        </td>

                        {/* 5. Confidence Column: exact number + color pill */}
                        <td className="py-4 px-4">
                          {getConfidenceBadge(item.confidence)}
                        </td>

                        {/* 6. Action Column: Radix Select dropdown for red rows (< 0.5) */}
                        <td className="py-4 px-4 text-right">
                          {isLowConfidence ? (
                            <div className="inline-flex items-center gap-2">
                              {isReResolving ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-mono">
                                  <svg className="animate-spin h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                  </svg>
                                  Resolving...
                                </span>
                              ) : (
                                <Select.Root
                                  value={item.qlooType}
                                  onValueChange={(val: string) => handleTypeChangeAndResolve(idx, val)}
                                  disabled={isReResolving}
                                >
                                  <Select.Trigger
                                    className="inline-flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono text-slate-200 hover:bg-slate-700/80 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                                    aria-label="Override Qloo entity type"
                                  >
                                    <Select.Value placeholder="Select type" />
                                    <Select.Icon className="text-slate-400">
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </Select.Icon>
                                  </Select.Trigger>
                                  <Select.Portal>
                                    <Select.Content className="z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1 text-xs font-mono text-slate-200 animate-in fade-in zoom-in-95">
                                      <Select.Viewport className="p-1 space-y-0.5">
                                        <Select.Item
                                          value="urn:entity:brand"
                                          className="px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 hover:text-emerald-300 cursor-pointer outline-none flex items-center justify-between gap-3 data-[highlighted]:bg-emerald-500/20 data-[highlighted]:text-emerald-300"
                                        >
                                          <Select.ItemText>urn:entity:brand</Select.ItemText>
                                          <Select.ItemIndicator className="text-emerald-400">
                                            ✓
                                          </Select.ItemIndicator>
                                        </Select.Item>
                                        <Select.Item
                                          value="urn:entity:product"
                                          className="px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 hover:text-emerald-300 cursor-pointer outline-none flex items-center justify-between gap-3 data-[highlighted]:bg-emerald-500/20 data-[highlighted]:text-emerald-300"
                                        >
                                          <Select.ItemText>urn:entity:product</Select.ItemText>
                                          <Select.ItemIndicator className="text-emerald-400">
                                            ✓
                                          </Select.ItemIndicator>
                                        </Select.Item>
                                        <Select.Item
                                          value="urn:entity:restaurant"
                                          className="px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 hover:text-emerald-300 cursor-pointer outline-none flex items-center justify-between gap-3 data-[highlighted]:bg-emerald-500/20 data-[highlighted]:text-emerald-300"
                                        >
                                          <Select.ItemText>urn:entity:restaurant</Select.ItemText>
                                          <Select.ItemIndicator className="text-emerald-400">
                                            ✓
                                          </Select.ItemIndicator>
                                        </Select.Item>
                                      </Select.Viewport>
                                    </Select.Content>
                                  </Select.Portal>
                                </Select.Root>
                              )}
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

          {/* 6. Unresolved Products Section (Separate "Could not resolve" section) */}
          {unresolvedList.length > 0 && (
            <div className="bg-slate-900/60 border border-amber-900/40 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-amber-400 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Could not resolve ({unresolvedList.length})
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    These items could not be resolved to a known entity in Qloo. You can skip them to proceed with the remaining catalog.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {unresolvedList.map((item, i) => {
                  const isSkipped = skippedUnresolved[i] ?? true;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono text-slate-300"
                    >
                      <div>
                        <div className="font-semibold text-white">{item.product.name}</div>
                        <div className="text-slate-500 text-[11px] mt-0.5">
                          Category: {item.product.category}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none text-slate-400 hover:text-slate-200">
                        <input
                          type="checkbox"
                          checked={isSkipped}
                          onChange={(e) =>
                            setSkippedUnresolved((prev) => ({
                              ...prev,
                              [i]: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span className="text-xs">Skip this product</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 7. Bottom Bar: Generate Recommendations Button & Back Link */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800/80">
            <button
              onClick={() => router.push("/")}
              className="text-xs text-slate-400 hover:text-slate-200 transition font-mono flex items-center gap-1.5 cursor-pointer"
            >
              &larr; Upload a different catalog
            </button>

            <div className="flex items-center gap-4 w-full sm:w-auto">
              {validResolvedCount < 2 && (
                <span className="text-xs font-mono text-amber-400">
                  Requires at least 2 resolved products
                </span>
              )}
              <button
                onClick={handleGenerateRecommendations}
                disabled={loadingRecs || validResolvedCount < 2}
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
                    Generate recommendations
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </main>

        {/* Global Toast Notification */}
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
          CropSignal &bull; Grounded in Qloo Live Graph &bull; No LLM Recommendations
        </footer>
      </div>
    </Tooltip.Provider>
  );
}
