export function Footer() {
  return (
    <footer className="border-t border-slate-900 bg-slate-950/80 px-6 py-8 text-center text-xs text-slate-500 font-mono space-y-1.5 selection:bg-emerald-500/30">
      <p className="text-slate-400 font-medium">
        Built for the Qloo Agentic Hackathon.
      </p>
      <p className="text-slate-500">
        Recommendations are planning aids, not guarantees.
      </p>
      <p className="text-slate-500 text-[11px]">
        Powered by Qloo&apos;s cross-domain taste graph. Explanations by Gemini 2.5 Flash.
      </p>
    </footer>
  );
}
