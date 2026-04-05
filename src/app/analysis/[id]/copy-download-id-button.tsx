"use client";

import { useState } from "react";

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path
        d="M9 9.75A1.75 1.75 0 0 1 10.75 8h7.5A1.75 1.75 0 0 1 20 9.75v9.5A1.75 1.75 0 0 1 18.25 21h-7.5A1.75 1.75 0 0 1 9 19.25v-9.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 8V6.75A1.75 1.75 0 0 0 13.25 5h-7.5A1.75 1.75 0 0 0 4 6.75v9.5A1.75 1.75 0 0 0 5.75 18H9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="m5 12.5 4.2 4.2L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CopyDownloadIdButton({
  downloadId,
}: {
  downloadId: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(downloadId);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Download id copied" : "Copy download id"}
      title={copied ? "Copied" : "Copy download id"}
      className="inline-flex size-7 items-center justify-center border border-stone-900/10 bg-white/80 text-stone-600 transition hover:border-stone-900/20 hover:bg-stone-50 hover:text-stone-900"
    >
      {copied ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <CopyIcon className="size-3.5" aria-hidden="true" />}
    </button>
  );
}