const checks = [
  {
    name: "Trend collection",
    status: "Healthy",
    note: "Source polling and cache refresh are responding normally.",
  },
  {
    name: "Transcription",
    status: "Pending",
    note: "Waiting for analysis workers to be connected.",
  },
  {
    name: "OpenAI pipeline",
    status: "Healthy",
    note: "No recent request failures reported.",
  },
];

export default function DiagnosticsPage() {
  return (
    <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
      <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
          Health
        </p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-stone-950">
          System diagnostics overview
        </h2>
        <div className="mt-4 divide-y divide-stone-900/8 border border-stone-900/8 bg-white/40">
          {checks.map((check) => (
            <div key={check.name} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-stone-950">{check.name}</p>
                <p className="mt-1 text-sm leading-5 text-stone-600">{check.note}</p>
              </div>
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-stone-500">
                {check.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <aside className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-stone-500">
          Current Target
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Use this page for API reachability, worker status, and billing or quota
          checks across the analysis pipeline.
        </p>
      </aside>
    </div>
  );
}