// Pure relevance scoring for global search (W3-6). Higher is a better match.
// Kept dependency-free and deterministic so both the API and clients can rank
// (or explain) results the same way.

/**
 * Score how well `haystack` matches `needle` (both compared case-insensitively,
 * trimmed): exact 100, prefix 70, word-boundary 50, substring 30, else 0.
 */
export function scoreText(haystack: string | null | undefined, needle: string): number {
  if (!haystack) return 0;
  const h = haystack.toLowerCase().trim();
  const n = needle.toLowerCase().trim();
  if (n === '' || h === '') return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 70;
  // Word-boundary match (a token in the haystack starts with the needle).
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escaped}`).test(h)) return 50;
  if (h.includes(n)) return 30;
  return 0;
}

/** The best `scoreText` across several fields (e.g. title, username, caption). */
export function bestScore(fields: (string | null | undefined)[], needle: string): number {
  let best = 0;
  for (const f of fields) {
    const s = scoreText(f, needle);
    if (s > best) best = s;
  }
  return best;
}
