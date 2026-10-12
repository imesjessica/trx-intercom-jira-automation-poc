import type { Ticket } from "./types";

// ---------------------------------------------------------------------------
// Decides whether two conversations describe the same thing, using TF-IDF
// cosine similarity over their words. It is a heuristic, not understanding:
// that is why every grouping can be overridden in the UI.
// Raise GROUP_THRESHOLD for fewer merges, lower it for more.
// ---------------------------------------------------------------------------
export const GROUP_THRESHOLD = 0.25;

const STOP = new Set(
  ("a about after all also am an and any are as at be been but by can could did do does for from get got had has have he her here " +
    "hi hello how i if in into is it its just like me more my no not of on one or our out please so some than thanks thank that the " +
    "their them then there these they this to up us was we were what when which who will with would you your today yesterday " +
    "morning team someone anyone every time still keeps seems sure ours side while").split(/\s+/)
);

function stem(w: string): string {
  return w
    .replace(/(ing|ed|es|s)$/, "")
    .replace(/(.)\1$/, "$1");
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z']+/g) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length > 2);
}

export const ticketText = (t: Pick<Ticket, "subject" | "body">) => `${t.subject} ${t.subject} ${t.body}`; // subject counts double

type Vec = Map<string, number>;

export interface Corpus {
  idf: Map<string, number>;
  vec(t: Pick<Ticket, "subject" | "body">): Vec;
}

export function buildCorpus(tickets: Pick<Ticket, "subject" | "body">[]): Corpus {
  const df = new Map<string, number>();
  for (const t of tickets) for (const w of new Set(tokens(ticketText(t)))) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(tickets.length, 1);
  const idf = new Map<string, number>();
  df.forEach((d, w) => idf.set(w, Math.log(1 + n / d)));
  return {
    idf,
    vec(t) {
      const tf = new Map<string, number>();
      for (const w of tokens(ticketText(t))) tf.set(w, (tf.get(w) ?? 0) + 1);
      const v: Vec = new Map();
      tf.forEach((c, w) => v.set(w, (1 + Math.log(c)) * (idf.get(w) ?? Math.log(1 + n))));
      return v;
    },
  };
}

function norm(v: Vec) {
  let s = 0;
  v.forEach((x) => (s += x * x));
  return Math.sqrt(s);
}

export interface Similarity {
  score: number;
  shared: string[]; // strongest shared words, for "why grouped"
}

export function similarity(a: Vec, b: Vec): Similarity {
  let dot = 0;
  const contrib: [string, number][] = [];
  a.forEach((x, w) => {
    const y = b.get(w);
    if (y) {
      dot += x * y;
      contrib.push([w, x * y]);
    }
  });
  const d = norm(a) * norm(b);
  contrib.sort((p, q) => q[1] - p[1]);
  return { score: d ? dot / d : 0, shared: contrib.slice(0, 4).map(([w]) => w) };
}

// Best match of `t` against the members of each candidate group.
// Uses the strongest single member, so one long group doesn't dilute the score.
export function bestGroup<K extends string>(
  t: Pick<Ticket, "subject" | "body">,
  groups: { key: K; members: Pick<Ticket, "subject" | "body">[] }[],
  corpus: Corpus,
  threshold = GROUP_THRESHOLD
): { key: K; score: number; shared: string[] } | null {
  const v = corpus.vec(t);
  let best: { key: K; score: number; shared: string[] } | null = null;
  for (const g of groups) {
    for (const m of g.members) {
      const s = similarity(v, corpus.vec(m));
      if (s.score >= threshold && (!best || s.score > best.score)) best = { key: g.key, ...s };
    }
  }
  return best;
}
