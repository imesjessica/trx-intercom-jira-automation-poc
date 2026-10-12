"use client";

import { segment, type Kind } from "@/lib/keywords";

const MARK: Record<Kind, string> = {
  bug: "rounded bg-destructive-soft px-1 font-semibold text-destructive",
  feedback: "rounded bg-success-soft px-1 font-semibold text-success",
  billing: "rounded bg-amber-100 px-1 font-semibold text-amber-900",
  inquiry: "rounded bg-slate-200 px-1 font-semibold text-slate-700",
};

// Renders text with problem words (red) and request words (green) highlighted.
export function Highlighted({ text }: { text: string }) {
  return (
    <>
      {segment(text).map((part, i) =>
        part.kind ? (
          <mark key={i} className={MARK[part.kind]}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

export function HighlightLegend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <mark className={MARK.bug}>problem words</mark>
      <mark className={MARK.feedback}>request words</mark>
      <mark className={MARK.billing}>billing words</mark>
      <mark className={MARK.inquiry}>question words</mark>
    </span>
  );
}
