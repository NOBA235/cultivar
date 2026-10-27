export function Footer() {
  return (
    <footer className="mt-12 border-t border-[#e9ede8] bg-white/75 px-4 py-5 text-[11px] text-stone-500 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
          <span className="font-semibold tracking-tight text-stone-700">Cultivar</span>
          <span className="text-stone-300" aria-hidden="true">/</span>
          <span>Product intelligence for independent makers</span>
        </div>
        <p className="text-center text-stone-500 sm:text-right">
          Taste signals by Qloo · Explanations by Gemini · Recommendations are planning aids
        </p>
      </div>
    </footer>
  );
}
