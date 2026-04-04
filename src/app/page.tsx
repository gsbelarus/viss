const summaryCards = [
  { label: "Tracked channels", value: "24", detail: "+3 this week" },
  { label: "Captured shorts", value: "186", detail: "42 pending review" },
  { label: "Script drafts", value: "61", detail: "14 updated today" },
  { label: "Active alerts", value: "02", detail: "Queue and API watch" },
];

const trendRows = [
  {
    topic: "Hook-first finance explainers",
    source: "US Shorts",
    velocity: "+18%",
    status: "Tracking",
  },
  {
    topic: "Fast recipe voiceovers",
    source: "Global food",
    velocity: "+12%",
    status: "Captured",
  },
  {
    topic: "AI tool comparisons",
    source: "Creator tech",
    velocity: "+27%",
    status: "Queued",
  },
  {
    topic: "Street interview edits",
    source: "Lifestyle",
    velocity: "+09%",
    status: "Review",
  },
];

const activityItems = [
  "Three new shorts added to the priority watchlist.",
  "Transcript reconstruction completed for 8 queued videos.",
  "One ingestion warning remains open for the EU capture worker.",
];

export default function Home() {
  return (
    <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.85fr)]">
      <div className="space-y-4">
        <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            Overview
          </p>
          <h2 className="mt-3 max-w-2xl text-xl font-semibold tracking-tight text-stone-950 sm:text-2xl">
            Trend monitoring control center
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
            Review current capture volume, follow fast-moving formats, and move
            directly into download or script reconstruction workflows from a single
            compact workspace.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {summaryCards.map((card) => (
            <article
              key={card.label}
              className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] px-4 py-3 shadow-[0_12px_30px_rgba(28,25,23,0.05)]"
            >
              <p className="text-[0.78rem] font-medium text-stone-500">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-stone-950">
                {card.value}
              </p>
              <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-emerald-800">
                {card.detail}
              </p>
            </article>
          ))}
        </section>

        <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
          <div className="flex items-center justify-between gap-4 border-b border-stone-900/8 px-5 py-4">
            <div>
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                Priority Signals
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Highest-velocity themes being tracked across monitored shorts.
              </p>
            </div>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
              Updated 09:40 UTC
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-900/8 bg-stone-950/[0.02]">
                  <th className="px-5 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Topic
                  </th>
                  <th className="px-5 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Source
                  </th>
                  <th className="px-5 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Velocity
                  </th>
                  <th className="px-5 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {trendRows.map((row) => (
                  <tr key={row.topic} className="border-b border-stone-900/8 last:border-b-0">
                    <td className="px-5 py-3.5 text-sm font-medium text-stone-950">
                      {row.topic}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-stone-600">{row.source}</td>
                    <td className="px-5 py-3.5 font-mono text-[0.76rem] uppercase tracking-[0.16em] text-emerald-800">
                      {row.velocity}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-stone-600">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-stone-500">
            Activity
          </p>
          <div className="mt-3 space-y-3">
            {activityItems.map((item) => (
              <div key={item} className="border-b border-stone-900/8 pb-3 last:border-b-0 last:pb-0">
                <p className="text-sm leading-6 text-stone-600">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-stone-500">
            Focus
          </p>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            Prioritize creator formats with strong hook repetition, fast replay
            loops, and reusable scene structure for script extraction.
          </p>
        </section>
      </aside>
    </div>
  );
}
