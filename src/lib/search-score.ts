/**
 * Tiny dependency-free relevance scorer for the Library search.
 *
 * AND semantics: every whitespace-separated query token must appear in the
 * haystack (case-insensitive) or the score is 0. Per token: word-boundary
 * matches beat bare substrings, prefix matches beat both. Shorter haystacks
 * win ties so precise items rank above rambling ones.
 *
 * Callers should pass a pre-lowercased haystack for speed; the query is
 * lowercased here.
 */
export function scoreMatch(query: string, lowercaseHaystack: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of tokens) {
    const index = lowercaseHaystack.indexOf(token);
    if (index < 0) {
      return 0;
    }
    if (index === 0) {
      score += 5;
    } else if (!isWordChar(lowercaseHaystack.charCodeAt(index - 1))) {
      score += 3;
    } else {
      score += 1;
    }
  }
  if (lowercaseHaystack === query.toLowerCase().trim()) {
    score += 4;
  }
  return score - lowercaseHaystack.length / 1000;
}

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) // A-Z
  );
}
