"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { StoredRecommendation } from "@/lib/memory";
import type { Recommendation, ResolvedEntity } from "@/lib/types";
import { MONTH_NAMES } from "@/lib/seasonal";

export default function HistoryPage() {
  const router = useRouter();

  const [records, setRecords] = useState<StoredRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Rerun & Diff states
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
    try {
      const res = await fetch("/api/memory");
      if (res.ok) {
        const data = await res.json();
        setRecords(Array.isArray(data.records) ? data.records : []);
      }
    } catch (err) {
      console.error("Failed to fetch memory records:", err);
      showToast("Failed to load history.");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleClearMemory = async () => {
    if (!confirm("Are you sure you want to clear all historical memory records?")) return;
    try {
      const res = await fetch("/api/memory", { method: "DELETE" });
      if (res.ok) {
        setRecords([]);
        setDiffResult(null);
        showToast("Memory cleared.");
      }
    } catch {
      showToast("Failed to clear memory.");
    }
  };

  // Phase 9: "Rerun this analysis" button that re-runs the pipeline and diffs results
  const handleRerunAnalysis = async (record: StoredRecommendation) => {
    setRerunningId(record.id);
    setDiffResult(null);

    try {
      // 1. Get resolved catalog from sessionStorage or fallback
      let resolved: ResolvedEntity[] = [];
      const rawResolved = sessionStorage.getItem("cultivar:resolved");
      if (rawResolved) {
        try {
          const parsed = JSON.parse(rawResolved);
          resolved = Array.isArray(parsed) ? parsed : parsed.resolved || [];
        } catch {}
      }

      if (resolved.length === 0) {
        showToast("No active catalog found. Load demo catalog on homepage first.");
        setRerunningId(null);
        return;
      }

      // 2. Call POST /api/recommend with original target month if present
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

      // 3. Diff against the top current recommendation
      const topCurrent = currentRecs[0];

      setDiffResult({
        original: record,
        current: topCurrent,
      });

      showToast(`Analysis completed. Diffs generated against ${record.recommendation.name}.`);
    } catch (err) {
      console.error("Rerun analysis error:", err);
      showToast("Analysis rerun failed.");
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30">
      {/* Header */}
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
            <span className="text-xs text-slate-500 font-mono">/ Memory &amp; Run History</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {records.length > 0 && (
            <button
              onClick={handleClearMemory}
              className="text-xs text-slate-400 hover:text-rose-400 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-rose-900/50 bg-slate-900 transition font-mono cursor-pointer"
            >
              Clear Memory
            </button>
          )}

          <div className="flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            Persistent JSON Store
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
        {/* Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Producer Memory &amp; Historical Runs
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Cultivar remembers accepted ideas and rejected proposals across sessions. When re-running the pipeline,
              the explanation agent checks historical decisions to personalize future cultural insights.
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs shrink-0">
            <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Accepted: <strong className="text-emerald-300">{acceptedCount}</strong></span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span>Rejected: <strong className="text-rose-300">{rejectedCount}</strong></span>
            </div>
          </div>
        </div>

        {/* Diff View Box (Rendered when "Rerun this analysis" is clicked) */}
        {diffResult && (
          <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-900/60 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-base font-bold text-white font-mono">
                  Analysis Re-Run Diff vs. Past Memory
                </h2>
              </div>
              <button
                onClick={() => setDiffResult(null)}
                className="text-xs text-slate-400 hover:text-white font-mono"
              >
                [Dismiss Diff]
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 font-mono text-xs">
              {/* Left: Original Record */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-slate-500 uppercase text-[10px] tracking-wider">
                  <span>Historical Record</span>
                  <span>{new Date(diffResult.original.savedAt).toLocaleDateString()}</span>
                </div>
                <div className="text-sm font-bold text-slate-200">
                  {diffResult.original.recommendation.name}
                </div>
                <div className="text-slate-400">
                  Category: {diffResult.original.recommendation.category} &bull; Confidence: {diffResult.original.recommendation.confidence}%
                </div>
                <div className="pt-2 text-slate-400 flex items-center gap-1.5">
                  <span>Producer Decision:</span>
                  <span className={diffResult.original.accepted ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                    {diffResult.original.accepted ? "Accepted (I'll try this)" : "Rejected (Not for us)"}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 pt-1">
                  Signals: {diffResult.original.recommendation.supportingSignals.map((s) => s.label).join(", ")}
                </div>
              </div>

              {/* Right: Current Re-Run */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-emerald-900/50 space-y-2">
                <div className="flex items-center justify-between text-emerald-400 uppercase text-[10px] tracking-wider">
                  <span>Current Pipeline Re-Run</span>
                  <span>Just now</span>
                </div>
                <div className="text-sm font-bold text-emerald-300">
                  {diffResult.current.name}
                </div>
                <div className="text-slate-300">
                  Category: {diffResult.current.category} &bull; Confidence: {diffResult.current.confidence}%
                </div>
                <div className="pt-2 text-slate-300">
                  <span className="text-slate-500">Signal Shift: </span>
                  {diffResult.original.recommendation.name === diffResult.current.name
                    ? "Consistent recommendation with refreshed signal affinities."
                    : `Shifted from ${diffResult.original.recommendation.name} due to active cross-domain affinity adjustments.`}
                </div>
                <div className="text-[11px] text-slate-400 pt-1">
                  Signals: {diffResult.current.supportingSignals.map((s) => s.label).join(", ")}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* History Records Table / Cards */}
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 font-mono text-sm">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading historical memory...
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-4">
            <div className="text-slate-400 font-mono text-sm">
              No recommendations saved to memory yet.
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Navigate to the Recommendations Dashboard and click <strong className="text-emerald-400">[I&apos;ll try this]</strong> or <strong className="text-rose-400">[Not for us]</strong> on any card to record a decision in <code className="text-slate-300 font-mono">/data/memory.json</code>.
            </p>
            <button
              onClick={() => router.push("/recommendations")}
              className="px-4 py-2 text-xs font-mono font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
            >
              Go to Recommendations
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {records.map((record, idx) => {
              const rec = record.recommendation;
              const dateStr = new Date(record.savedAt).toLocaleString();
              const isRerunning = rerunningId === record.id;
              const monthLabel = record.month ? MONTH_NAMES[record.month] : undefined;

              return (
                <div
                  key={record.id || idx}
                  className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700/80 transition flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs"
                >
                  {/* Left Info */}
                  <div className="space-y-2 max-w-xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                          record.accepted
                            ? "bg-emerald-950/70 border-emerald-600/80 text-emerald-300"
                            : "bg-rose-950/70 border-rose-600/80 text-rose-300"
                        }`}
                      >
                        {record.accepted ? "✓ Accepted (I'll try this)" : "✗ Rejected (Not for us)"}
                      </span>

                      <span className="text-slate-500 text-[11px]">{dateStr}</span>

                      {monthLabel && (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                          Target: {monthLabel}
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-white tracking-tight">
                        {rec.name}
                      </h3>
                      <div className="text-slate-400 mt-0.5 text-xs">
                        Category: <span className="text-slate-200">{rec.category}</span> &bull; Qloo Confidence:{" "}
                        <span className="text-emerald-400">{rec.confidence}%</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      <span className="text-slate-500">Supporting Signals ({rec.supportingSignals.length}): </span>
                      {rec.supportingSignals.slice(0, 4).map((s) => s.label).join(", ")}
                      {rec.supportingSignals.length > 4 && " ..."}
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => handleRerunAnalysis(record)}
                      disabled={isRerunning}
                      className="px-3.5 py-2 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/60 hover:border-emerald-700 text-emerald-300 text-xs font-mono transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isRerunning ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                          <span>Re-running...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
      </main>

      {/* Toast Notification */}
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
        CropSignal &bull; Phase 9 Memory &amp; Seasonality Engine &bull; Stored in /data/memory.json
      </footer>
    </div>
  );
}

