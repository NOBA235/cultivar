"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith(".csv")) {
        setFile(droppedFile);
        setFileName(droppedFile.name);
        setErrorMessage(null);
      } else {
        setErrorMessage("Please upload a valid .csv file.");
      }
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);
      setErrorMessage(null);
    }
  };

  const loadDemoCatalog = async () => {
    setErrorMessage(null);
    try {
      setLoading(true);
      const res = await fetch("/demo-catalog.csv");
      if (!res.ok) throw new Error("Could not load /demo-catalog.csv");
      const text = await res.text();
      const demoFile = new File([text], "demo-catalog.csv", { type: "text/csv" });
      setFile(demoFile);
      setFileName("demo-catalog.csv (5 Portland Coffee Products)");

      // Directly resolve
      await submitFile(demoFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to load demo catalog: ${msg}`);
      setLoading(false);
    }
  };

  const submitFile = async (fileToSubmit: File) => {
    setLoading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", fileToSubmit);

    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ? `${data.error}: ${JSON.stringify(data.detail || "")}` : `HTTP ${res.status}`);
      }

      // Store in sessionStorage under cultivar:resolved
      sessionStorage.setItem("cultivar:resolved", JSON.stringify(data));
      router.push("/resolve");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMessage("Please select or drop a CSV catalog first.");
      return;
    }
    submitFile(file);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30">
      {/* Navigation */}
      <header className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between backdrop-blur bg-slate-950/60 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400">
            CS
          </div>
          <div>
            <span className="font-semibold tracking-tight text-white">CropSignal</span>
            <span className="text-xs text-slate-500 ml-2 font-mono">v0.1</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Qloo Taste Graph API
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center w-full">
        <div className="text-center mb-10 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 mb-2">
            Independent Food & Beverage Producers
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Cultural Supply Chain Intelligence for Independent Producers
          </h1>
          <p className="text-slate-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Ground your product catalog in Qloo&apos;s cross-domain cultural taste graph across dining, music, film, and lifestyle affinities to surface high-conviction product opportunities.
          </p>
        </div>

        {/* Upload Card */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Drag & Drop Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? "border-emerald-500 bg-emerald-500/5 scale-[0.99]"
                  : file
                  ? "border-emerald-500/50 bg-slate-900"
                  : "border-slate-700/80 hover:border-slate-600 bg-slate-950/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>

                {fileName ? (
                  <div>
                    <p className="text-sm font-semibold text-emerald-400 font-mono">
                      {fileName}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click or drag another file to replace
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      Drop your product catalog CSV here, or{" "}
                      <span className="text-emerald-400 underline underline-offset-2">browse</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1 font-mono">
                      Required columns: product_name, category, description
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-sm flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-rose-400 shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="flex-1 font-mono text-xs overflow-x-auto">
                  {errorMessage}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={loadDemoCatalog}
                disabled={loading}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-sm font-medium transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <svg
                  className="w-4 h-4 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                Try demo catalog (Portland Coffee)
              </button>

              <button
                type="submit"
                disabled={loading || !file}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-semibold text-sm transition shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-slate-950"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    Resolving with Qloo...
                  </>
                ) : (
                  <>
                    Upload & Resolve
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14 5l7 7m0 0l-7 7m7-7H3"
                      />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600 font-mono">
        CropSignal &bull; Qloo Agentic Hackathon Submission &bull; Powered by Qloo Live Graph
      </footer>
    </div>
  );
}
