export default function ScriptsPage() {
  return (
    <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
      <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
          Output
        </p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-stone-950">
          Script reconstruction workspace
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
          This area can hold transcript output, extracted scene structure, and the
          final script view for each analyzed short.
        </p>
      </section>

      <aside className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-stone-500">
          Ready For
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Versioned script drafts, notes, structured prompts, and editorial review.
        </p>
      </aside>
    </div>
  );
}