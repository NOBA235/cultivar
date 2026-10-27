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
        throw new Error(
          data.error
            ? `${data.error}: ${JSON.stringify(data.detail || "")}`
            : `HTTP ${res.status}`
        );
      }

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
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-[28px] border border-[#e7ece6] bg-white px-6 py-7 shadow-[0_12px_42px_rgba(27,53,35,.045)] sm:px-10 sm:py-9">
        <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[#eef6ef] blur-3xl" />
        <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#dfe9df] bg-[#f7faf6] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#356448]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4b8a5e]" />
              Cultural product intelligence
            </div>
            <h1 className="max-w-xl text-[2.4rem] font-semibold leading-[1.06] tracking-[-0.055em] text-[#17211b] sm:text-5xl">
              Build products people already <span className="font-serif font-medium italic text-[#397653]">love.</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-stone-600 sm:text-[15px]">
              Turn the taste around your catalog into your next great product idea. Start with a simple product file.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-[#e8ede7] bg-[#fbfcfa] px-4 py-3.5">
            <div className="flex -space-x-2" aria-hidden="true">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#e6eee5] text-[10px] font-semibold text-[#3d684a]">01</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#f2eadc] text-[10px] font-semibold text-[#866b42]">02</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#e9e9f2] text-[10px] font-semibold text-[#5b5e85]">03</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-800">One clear workflow</p>
              <p className="mt-0.5 text-[10px] text-stone-500">Upload · Understand · Decide</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:gap-6">
        {/* Left: Upload Form Card */}
        <section
          aria-labelledby="upload-section-heading"
          className="space-y-5 rounded-2xl border border-[#e5ebe4] bg-white p-5 shadow-[0_8px_28px_rgba(27,53,35,.04)] sm:p-7 lg:col-span-7"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2
                id="upload-section-heading"
                className="text-[15px] font-semibold tracking-tight text-stone-900"
              >
                Catalog file upload
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Select a UTF-8 encoded CSV file or load the sample catalog to test the workflow.
              </p>
            </div>
            <span className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 font-mono text-[10px] font-medium text-stone-600">
              CSV · UTF-8
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-label="Upload product catalog CSV file"
              className={`cursor-pointer rounded-2xl border border-dashed p-8 text-center transition-all sm:p-12 ${
                isDragging
                  ? "border-[#397653] bg-[#f0f7f1] ring-4 ring-[#397653]/[0.06]"
                  : file
                  ? "border-[#cfe2d4] bg-[#f5faf5]"
                  : "border-[#dce4dc] bg-[#fafcf9] hover:border-[#9bb9a0] hover:bg-[#f7faf6]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex flex-col items-center justify-center space-y-2.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#e5ebe4] bg-white text-[#397653] shadow-[0_3px_10px_rgba(24,50,33,.06)]">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
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
                  <div className="space-y-1">
                    <p className="font-mono text-sm font-medium text-[#286344]">
                      {fileName}
                    </p>
                    <p className="text-xs text-stone-500">
                      Click or drop another CSV file to replace
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-stone-800">
                      Drop your catalog CSV here, or{" "}
                      <span className="text-[#1E4D3B] underline underline-offset-2">
                        browse files
                      </span>
                    </p>
                    <p className="text-xs text-stone-500">
                      Supports 2 to 50 products per run
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Error Alert */}
            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5"
              >
                <svg
                  className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="flex-1 font-mono break-all">{errorMessage}</div>
              </div>
            )}

            {/* Primary & Demo Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                      <button
                type="button"
                onClick={loadDemoCatalog}
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50"
              >
                <svg
                  className="w-4 h-4 text-[#1E4D3B]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Try demo catalog (Portland Coffee)
              </button>

              <button
                type="submit"
                disabled={loading || !file}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#20583d] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(32,88,61,.17)] hover:bg-[#194b34] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4 text-current"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
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
                    Resolving catalog...
                  </>
                ) : (
                  <>
                    Upload &amp; resolve
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
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
        </section>

        {/* Right: Schema & Demo Catalog Details */}
        <aside
          aria-label="Catalog format and demo details"
          className="space-y-4 lg:col-span-5"
        >
          {/* Supported Columns Card */}
          <div className="space-y-4 rounded-2xl border border-[#e5ebe4] bg-white p-5 shadow-[0_8px_28px_rgba(27,53,35,.035)] sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-900">
                A small file. A broader view.
              </h2>
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone-400">01 / Input</span>
            </div>

            <p className="text-xs leading-5 text-stone-500">Give us the essentials. We connect each product to cultural signals, then surface opportunities with evidence.</p>

            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600">
                  <tr>
                    <th className="py-2 px-3 font-medium">Column</th>
                    <th className="py-2 px-3 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 text-stone-700">
                  <tr>
                    <td className="py-2 px-3 font-mono text-[#1E4D3B] font-medium whitespace-nowrap">
                      product_name
                    </td>
                    <td className="py-2 px-3">
                      SKU or product title (e.g., <em>Alder Street Yirgacheffe</em>)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono text-[#1E4D3B] font-medium whitespace-nowrap">
                      category
                    </td>
                    <td className="py-2 px-3">
                      Product format or line (e.g., <em>single-origin beans</em>)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono text-[#1E4D3B] font-medium whitespace-nowrap">
                      description
                    </td>
                    <td className="py-2 px-3">
                      Tasting notes, ingredients, or packaging details
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Demo Catalog Summary Card */}
          <div className="relative overflow-hidden rounded-2xl border border-[#e5ebe4] bg-white p-5 shadow-[0_8px_28px_rgba(27,53,35,.035)] sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-900">Explore the sample</h2>
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone-400">Ready to run</span>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              The <strong>Portland Coffee</strong> sample catalog includes 5 artisanal coffee products (light-roast beans, chicory cold brew concentrate, espresso blend, canned oat latte, and Swiss Water decaf) pre-formatted for immediate resolution.
            </p>
            <div className="pt-1 flex flex-wrap gap-1.5">
              {[
                "Alder Street Yirgacheffe",
                "Foggy Ferry Cold Brew",
                "Night Shift Espresso",
                "Hawthorne Oat Latte",
                "Tabor Hill Decaf",
              ].map((item) => (
                <span
                  key={item}
                  className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
