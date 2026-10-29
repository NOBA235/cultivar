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
        setToastMessage(
          `Re-resolved "${target.product.name}" as ${chosenType.replace("urn:entity:", "")}`
        );
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
      <div className="flex-1 flex items-center justify-center p-8 text-stone-500 text-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-4 h-4 border-2 border-[#1E4D3B] border-t-transparent rounded-full animate-spin" />
          <span>Loading catalog resolution...</span>
        </div>
      </div>
    );
  }

  const validResolvedCount = data.resolved.filter(
    (r) => r.qlooId && r.qlooId.trim().length > 0
  ).length;

  const lowConfidenceCount = data.resolved.filter(
    (r) => r.confidence < 0.5
  ).length;

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
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono tabular-nums bg-emerald-50 text-emerald-800 border border-emerald-200"
          title={`Name match: ${formatted} (> 0.8, local string similarity)`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
          {formatted}
        </span>
      );
    }
    if (confidence >= 0.5) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono tabular-nums bg-amber-50 text-amber-800 border border-amber-200"
          title={`Name match: ${formatted} (0.5 – 0.8, local string similarity)`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          {formatted}
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono tabular-nums bg-rose-50 text-rose-800 border border-rose-200"
        title={`Name match: ${formatted} (< 0.5, local string similarity)`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
        {formatted}
      </span>
    );
  };

  return (
    <Tooltip.Provider delayDuration={150}>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Page Header & Summary Bar */}
        <div className="flex flex-col justify-between gap-4 border-b border-[#e7ece6] pb-6 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="hover:text-stone-900 transition-colors inline-flex items-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to upload
              </button>
              <span aria-hidden="true">/</span>
              <span>Entity resolution</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#17211b] sm:text-3xl">
              Catalog resolution review
            </h1>
            <p className="text-sm text-stone-600">
              Verify how your products map to Qloo entities before generating recommendations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs px-2.5 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-medium tabular-nums">
              {validResolvedCount} resolved
            </span>
            {lowConfidenceCount > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-800 font-medium tabular-nums">
                {lowConfidenceCount} low confidence
              </span>
            )}
            {unresolvedList.length > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-medium tabular-nums">
                {unresolvedList.length} unresolved
              </span>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5"
          >
            <svg className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 font-mono break-all">{errorMsg}</div>
          </div>
        )}

        {/* Resolution Data Table */}
        <div className="overflow-hidden rounded-2xl border border-[#e5ebe4] bg-white shadow-[0_8px_28px_rgba(27,53,35,.035)]">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="resolve-table-caption"
            className="table-wrapper"
          >
            <table className="responsive-data-table text-left">
              <caption id="resolve-table-caption" className="sr-only">
                Product entity resolution table with Qloo IDs, confidence scores, and type override controls
              </caption>
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-xs font-medium text-stone-600">
                  <th scope="col" className="py-3 px-4 border-b border-stone-200">
                    Product
                  </th>
                  <th scope="col" className="py-3 px-4 border-b border-stone-200">
                    Resolved Entity
                  </th>
                  <th scope="col" className="py-3 px-4 border-b border-stone-200">
                    Qloo ID
                  </th>
                  <th scope="col" className="py-3 px-4 border-b border-stone-200">
                    Type
                  </th>
                  <th scope="col" className="py-3 px-4 border-b border-stone-200">
                    <span title="Local string-similarity heuristic (0–1.0) between catalog product and matched Qloo entity name. Not a Qloo API score.">
                      Name Match (Local)
                    </span>
                  </th>
                  <th scope="col" className="py-3 px-4 border-b border-stone-200 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {data.resolved.map((item, idx) => {
                  const isLowConfidence = item.confidence < 0.5;
                  const isReResolving = reResolvingIndex === idx;
                  const isLastRow = idx === data.resolved.length - 1;
                  const cellBorder = isLastRow ? "" : "border-b border-stone-200";
                  const truncatedId = item.qlooId
                    ? `${item.qlooId.slice(0, 24)}…`
                    : "—";

                  return (
                    <tr
                      key={`${item.product.name}-${idx}`}
                      className={`transition-colors hover:bg-stone-50/70 ${
                        isLowConfidence ? "bg-rose-50/35" : ""
                      }`}
                    >
                      {/* 1. Product Row Header */}
                      <th
                        scope="row"
                        className={`py-3.5 px-4 font-medium text-stone-900 text-left ${cellBorder} ${
                          isLowConfidence ? "bg-rose-50/35" : "bg-white"
                        }`}
                      >
                        <div>{item.product.name}</div>
                        <div className="text-xs font-normal text-stone-500 mt-0.5">
                          {item.product.category}
                        </div>
                      </th>

                      {/* 2. Resolved Entity */}
                      <td className={`py-3.5 px-4 font-medium text-stone-800 ${cellBorder}`}>
                        {item.label}
                      </td>

                      {/* 3. Qloo ID */}
                      <td className={`py-3.5 px-4 font-mono text-xs text-stone-600 ${cellBorder}`}>
                        {item.qlooId ? (
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(item.qlooId)}
                                className="text-left font-mono cursor-pointer hover:text-[#1E4D3B] hover:underline underline-offset-4 transition-colors inline-flex items-center gap-1.5 group"
                                title="Click to copy full Qloo ID"
                              >
                                <span>{truncatedId}</span>
                                <svg
                                  className="w-3.5 h-3.5 text-stone-400 group-hover:text-[#1E4D3B] shrink-0 transition-colors"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
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
                                className="z-50 bg-stone-900 text-stone-100 px-3 py-2 rounded-lg shadow-lg text-xs font-mono flex items-center gap-3 select-all"
                              >
                                <div>
                                  <div className="text-[10px] text-stone-400 mb-0.5 font-sans">
                                    Full Qloo Entity ID
                                  </div>
                                  <div className="font-medium text-white">{item.qlooId}</div>
                                </div>
                                <span className="text-[10px] font-sans text-stone-300 bg-stone-800 px-1.5 py-0.5 rounded border border-stone-700">
                                  Click to copy
                                </span>
                                <Tooltip.Arrow className="fill-stone-900" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>

                      {/* 4. Type */}
                      <td className={`py-3.5 px-4 text-xs text-stone-600 ${cellBorder}`}>
                        <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 font-mono">
                          {item.qlooType.replace("urn:entity:", "")}
                        </span>
                      </td>

                      {/* 5. Confidence */}
                      <td className={`py-3.5 px-4 ${cellBorder}`}>
                        {getConfidenceBadge(item.confidence)}
                      </td>

                      {/* 6. Action */}
                      <td className={`py-3.5 px-4 text-right ${cellBorder}`}>
                        {isLowConfidence ? (
                          <div className="inline-flex items-center justify-end gap-2">
                            {isReResolving ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                                <svg className="animate-spin h-3.5 w-3.5 text-amber-600" fill="none" viewBox="0 0 24 24">
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
                                  className="inline-flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-stone-300 text-xs font-mono text-stone-800 hover:bg-stone-50 hover:border-stone-400 cursor-pointer shadow-2xs"
                                  aria-label="Override Qloo entity type"
                                >
                                  <Select.Value placeholder="Select type" />
                                  <Select.Icon className="text-stone-500">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </Select.Icon>
                                </Select.Trigger>
                                <Select.Portal>
                                  <Select.Content className="z-50 bg-white border border-stone-200 rounded-lg shadow-lg p-1 text-xs font-mono text-stone-800">
                                    <Select.Viewport className="p-0.5 space-y-0.5">
                                      {[
                                        "urn:entity:brand",
                                        "urn:entity:product",
                                        "urn:entity:restaurant",
                                      ].map((opt) => (
                                        <Select.Item
                                          key={opt}
                                          value={opt}
                                          className="px-2.5 py-1.5 rounded-md hover:bg-[#EDF5F0] hover:text-[#1E4D3B] cursor-pointer outline-none flex items-center justify-between gap-3 data-[highlighted]:bg-[#EDF5F0] data-[highlighted]:text-[#1E4D3B]"
                                        >
                                          <Select.ItemText>{opt}</Select.ItemText>
                                          <Select.ItemIndicator className="text-[#1E4D3B]">
                                            ✓
                                          </Select.ItemIndicator>
                                        </Select.Item>
                                      ))}
                                    </Select.Viewport>
                                  </Select.Content>
                                </Select.Portal>
                              </Select.Root>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-stone-600 font-medium">
                            <svg className="w-3.5 h-3.5 text-[#1E4D3B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Verified
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

        {/* Unresolved Products Section */}
        {unresolvedList.length > 0 && (
          <section
            aria-labelledby="unresolved-heading"
            className="bg-amber-50/60 border border-amber-200 rounded-xl p-5 space-y-3.5"
          >
            <div>
              <h2
                id="unresolved-heading"
                className="text-sm font-semibold text-amber-900 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Could not resolve ({unresolvedList.length})
              </h2>
              <p className="text-xs text-amber-800 mt-0.5">
                These products did not match an entity in Qloo. You can skip them to continue with the remaining catalog.
              </p>
            </div>

            <div className="space-y-2">
              {unresolvedList.map((item, i) => {
                const isSkipped = skippedUnresolved[i] ?? true;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg bg-white border border-amber-200/80 text-xs text-stone-800"
                  >
                    <div>
                      <div className="font-medium text-stone-900">{item.product.name}</div>
                      <div className="text-stone-500 mt-0.5">
                        Category: {item.product.category}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-stone-700 hover:text-stone-900">
                      <input
                        type="checkbox"
                        checked={isSkipped}
                        onChange={(e) =>
                          setSkippedUnresolved((prev) => ({
                            ...prev,
                            [i]: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 rounded border-stone-300 text-[#1E4D3B] focus:ring-[#1E4D3B] cursor-pointer"
                      />
                      <span className="text-xs font-medium">Skip this product</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Action Footer */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-3 border-t border-stone-200">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-4 py-2 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 text-xs sm:text-sm font-medium transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            &larr; Upload a different catalog
          </button>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {validResolvedCount < 2 && (
              <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-md text-center">
                Requires at least 2 resolved products
              </span>
            )}
            <button
              type="button"
              onClick={handleGenerateRecommendations}
              disabled={loadingRecs || validResolvedCount < 2}
              className="px-5 py-2.5 rounded-lg bg-[#1E4D3B] hover:bg-[#163B2D] disabled:bg-stone-200 text-white disabled:text-stone-500 font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {loadingRecs ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Generating recommendations...
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
