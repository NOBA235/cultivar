"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { StoredRecommendation } from "@/lib/memory";
import type { Recommendation, ResolvedEntity } from "@/lib/types";
import { MONTH_NAMES } from "@/lib/seasonal";
import { readLocalMemory, clearLocalMemory, mergeMemory } from "@/lib/localMemory";

export default function HistoryPage() {
  const router = useRouter();

  const [records, setRecords] = useState<StoredRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<{
    original: StoredRecommendation;
    current: Recommendation;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    const local = readLocalMemory();
    let server: StoredRecommendation[] = [];
    try {
      const res = await fetch("/api/memory");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.records)) server = data.records;
      }
    } catch (err) {
      console.warn("Failed to fetch server memory file:", err);
    } finally {
      setRecords(mergeMemory(local, server));
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleClearMemory = async () => {
    if (!confirm("Are you sure you want to clear all saved history records?")) return;
    clearLocalMemory();
    try {
      await fetch("/api/memory", { method: "DELETE" });
    } catch (err) {
      console.warn("Failed to clear server memory:", err);
    }
    setRecords([]);
    setDiffResult(null);
    showToast("History cleared.");
  };

  const handleRerunAnalysis = async (record: StoredRecommendation) => {
    setRerunningId(record.id);
    setDiffResult(null);

    try {
      let resolved: ResolvedEntity[] = [];
      const rawResolved = sessionStorage.getItem("cultivar:resolved");
      if (rawResolved) {
        try {
          const parsed = JSON.parse(rawResolved);
          resolved = Array.isArray(parsed) ? parsed : parsed.resolved || [];
        } catch {}
      }

      if (resolved.length === 0) {
        showToast("No active catalog found. Load a catalog on the Upload screen first.");
        setRerunningId(null);
        return;
      }

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolved,
          month: record.month ?? 10,
        }),
      });

      if (!res.ok) {
        throw new Error(`Recommend failed: HTTP ${res.status}`);
      }

      const data = await res.json();
      const currentRecs: Recommendation[] = data.recommendations || [];
      if (currentRecs.length === 0) {
        throw new Error("No recommendations returned");
      }

      const topCurrent = currentRecs[0];

      setDiffResult({
        original: record,
        current: topCurrent,
      });

      showToast(`Re-run complete. Comparing against ${record.recommendation.name}.`);
    } catch (err) {
      console.error("Rerun analysis error:", err);
      showToast("Analysis re-run failed.");
    } finally {
      setRerunningId(null);
    }
  };

  const { acceptedCount, rejectedCount } = useMemo(() => {
    let acc = 0;
    let rej = 0;
    records.forEach((r) => {
      if (r.accepted) acc++;
      else rej++;
    });
    return { acceptedCount: acc, rejectedCount: rej };
  }, [records]);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      {/* Page Header */}
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
            <span>History</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#17211b] sm:text-3xl">
            Saved evaluations &amp; analysis history
          </h1>
          <p className="text-sm text-stone-600">
            Review past product evaluations (stored in browser-local memory and local demo file). Re-run analyses to compare ranking shifts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium tabular-nums">
            Accepted: {acceptedCount}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-800 font-medium tabular-nums">
            Rejected: {rejectedCount}
          </span>
          {records.length > 0 && (
            <button
              type="button"
              onClick={handleClearMemory}
              className="text-xs px-2.5 py-1 rounded-md bg-white hover:bg-rose-50 text-stone-600 hover:text-rose-800 border border-stone-200 hover:border-rose-200 transition-colors cursor-pointer font-medium"
            >
              Clear history
            </button>
          )}
        </div>
      </div>

      {/* Analysis Re-Run Diff Panel */}
      {diffResult && (
        <section
          aria-labelledby="diff-heading"
          className="space-y-4 rounded-2xl border border-[#cfe2d4] bg-white p-5 shadow-[0_8px_28px_rgba(27,53,35,.04)]"
        >
          <div className="flex items-center justify-between border-b border-stone-200 pb-3">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#1E4D3B]" />
              <h2 id="diff-heading" className="text-sm font-semibold text-stone-900">
                Analysis re-run comparison
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setDiffResult(null)}
              className="text-xs text-stone-500 hover:text-stone-900 font-medium cursor-pointer"
            >
              Dismiss
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Saved Historical Record */}
            <div className="p-4 rounded-lg bg-stone-50 border border-stone-200 space-y-2">
              <div className="flex items-center justify-between text-stone-500 font-medium">
                <span>Saved record</span>
                <span>{new Date(diffResult.original.savedAt).toLocaleDateString()}</span>
              </div>
              <div className="text-sm font-semibold text-stone-900">
                {diffResult.original.recommendation.name}
              </div>
              <div className="text-stone-600">
                Category: {diffResult.original.recommendation.category} &bull; Relative rank score:{" "}
                <span className="font-mono font-medium">
                  {diffResult.original.recommendation.confidence} / 100
                </span>
              </div>
              <div className="pt-1 flex items-center gap-1.5">
                <span className="text-stone-500">Decision:</span>
                <span
                  className={
                    diffResult.original.accepted
                      ? "text-emerald-800 font-medium"
                      : "text-rose-800 font-medium"
                  }
                >
                  {diffResult.original.accepted
                    ? "Accepted (I'll try this)"
                    : "Rejected (Not for us)"}
                </span>
              </div>
              <div className="text-stone-500 pt-1">
                Signals:{" "}
                {diffResult.original.recommendation.supportingSignals
                  .map((s) => s.label)
                  .join(", ")}
              </div>
            </div>

            {/* Current Re-run */}
            <div className="p-4 rounded-lg bg-[#EDF5F0]/50 border border-[#C5DFD0] space-y-2">
              <div className="flex items-center justify-between text-[#1E4D3B] font-medium">
                <span>Current pipeline re-run</span>
                <span>Just now</span>
              </div>
              <div className="text-sm font-semibold text-stone-900">
                {diffResult.current.name}
              </div>
              <div className="text-stone-700">
                Category: {diffResult.current.category} &bull; Relative rank score:{" "}
                <span className="font-mono font-medium">{diffResult.current.confidence} / 100</span>
              </div>
              <div className="pt-1 text-stone-700">
                <span className="text-stone-500">Comparison: </span>
                {diffResult.original.recommendation.name === diffResult.current.name
                  ? "Matches historical top recommendation with current signal affinities."
                  : `Shifted from ${diffResult.original.recommendation.name} based on current catalog and seasonal weights.`}
              </div>
              <div className="text-stone-600 pt-1">
                Signals: {diffResult.current.supportingSignals.map((s) => s.label).join(", ")}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Records List */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-5 rounded-xl bg-white border border-stone-200 flex justify-between items-center"
            >
              <div className="space-y-2 w-2/3">
                <div className="h-4 w-32 bg-stone-200 rounded animate-pulse" />
                <div className="h-5 w-48 bg-stone-200 rounded animate-pulse" />
                <div className="h-3.5 w-64 bg-stone-100 rounded animate-pulse" />
              </div>
              <div className="h-8 w-32 bg-stone-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="p-10 text-center rounded-xl bg-white border border-stone-200 shadow-2xs space-y-3">
          <div className="text-stone-900 font-medium text-sm">
            No saved recommendations yet
          </div>
          <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
            Record a decision using <strong>I&apos;ll try this</strong> or{" "}
            <strong>Not for us</strong> on any recommendation card to track your product evaluations over time.
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => router.push("/recommendations")}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[#1E4D3B] hover:bg-[#163B2D] text-white transition-colors cursor-pointer"
            >
              View recommendations
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record, idx) => {
            const rec = record.recommendation;
            const dateStr = new Date(record.savedAt).toLocaleString();
            const isRerunning = rerunningId === record.id;
            const monthLabel = record.month ? MONTH_NAMES[record.month] : undefined;

            return (
              <div
                key={record.id || idx}
                className="p-5 rounded-xl bg-white border border-stone-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-2 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                        record.accepted
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-rose-50 border-rose-200 text-rose-800"
                      }`}
                    >
                      {record.accepted
                        ? "Accepted — I'll try this"
                        : "Rejected — Not for us"}
                    </span>

                    {monthLabel && (
                      <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 text-stone-700 font-medium">
                        Target: {monthLabel}
                      </span>
                    )}

                    <span className="text-stone-500">{dateStr}</span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-stone-900">
                      {rec.name}
                    </h3>
                    <div className="text-stone-600 mt-0.5">
                      Category: <span className="text-stone-800 font-medium">{rec.category}</span>{" "}
                      &bull; Relative rank score:{" "}
                      <span className="font-mono font-medium text-[#1E4D3B] tabular-nums">
                        {rec.confidence} / 100
                      </span>
                    </div>
                  </div>

                  <div className="text-stone-500">
                    <span className="font-medium text-stone-600">
                      Supporting signals ({rec.supportingSignals.length}):{" "}
                    </span>
                    {rec.supportingSignals
                      .slice(0, 4)
                      .map((s) => s.label)
                      .join(", ")}
                    {rec.supportingSignals.length > 4 && " ..."}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRerunAnalysis(record)}
                    disabled={isRerunning}
                    className="px-3.5 py-2 rounded-lg bg-white hover:bg-stone-50 border border-stone-300 text-stone-800 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-2xs"
                  >
                    {isRerunning ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-[#1E4D3B] border-t-transparent rounded-full animate-spin" />
                        <span>Re-running...</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3.5 h-3.5 text-[#1E4D3B]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        <span>Rerun this analysis</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
  );
}
