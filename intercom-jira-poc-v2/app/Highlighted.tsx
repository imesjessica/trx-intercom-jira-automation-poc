"use client";

import type { CSSProperties } from "react";
import { segment, type Kind } from "@/lib/keywords";

const STYLES: Record<Kind, CSSProperties> = {
  bug: { background: "#fbe9e7", color: "#b3261e", borderRadius: 3, padding: "0 3px", fontWeight: 600 },
  feedback: { background: "#e3f3ec", color: "#1d6b4f", borderRadius: 3, padding: "0 3px", fontWeight: 600 },
};

// Renders text with problem words (red) and request words (green) highlighted.
export function Highlighted({ text }: { text: string }) {
  return (
    <>
      {segment(text).map((part, i) =>
        part.kind ? (
          <mark key={i} style={STYLES[part.kind]}>
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
    <span style={{ fontSize: 12 }}>
      <mark style={STYLES.bug}>problem words</mark> <mark style={STYLES.feedback}>request words</mark>
    </span>
  );
}
