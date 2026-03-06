export interface SearchableTokenText {
  symbol: string;
  name: string;
}

const SYMBOL_EXACT_SCORE = 300;
const NAME_EXACT_SCORE = 280;
const SYMBOL_PREFIX_SCORE = 200;
const NAME_PREFIX_SCORE = 180;
const SYMBOL_INCLUDES_SCORE = 120;
const NAME_INCLUDES_SCORE = 100;

export const POOL_QUERY_SPLIT_REGEX = /[\s,/+\\-]+/;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function scoreTermAgainstField(
  term: string,
  value: string,
  exactScore: number,
  prefixScore: number,
  includesScore: number,
): number {
  if (!value) return 0;
  if (value === term) return exactScore;
  if (value.startsWith(term)) return prefixScore;
  if (value.includes(term)) return includesScore;
  return 0;
}

export function scoreTermAgainstToken(
  term: string,
  metadata: { name: string; symbol: string },
): number {
  const name = normalizeText(metadata.name);
  const symbol = normalizeText(metadata.symbol);
  const symbolScore = scoreTermAgainstField(
    term,
    symbol,
    SYMBOL_EXACT_SCORE,
    SYMBOL_PREFIX_SCORE,
    SYMBOL_INCLUDES_SCORE,
  );
  const nameScore = scoreTermAgainstField(
    term,
    name,
    NAME_EXACT_SCORE,
    NAME_PREFIX_SCORE,
    NAME_INCLUDES_SCORE,
  );

  return symbolScore > nameScore ? symbolScore : nameScore;
}

export function scorePoolSearchTerms(
  terms: string[],
  tokens: [{ name: string; symbol: string }, { name: string; symbol: string }],
): number | null {
  if (terms.length === 0) return 0;

  let totalScore = 0;
  for (const term of terms) {
    let bestTermScore = 0;
    for (const token of tokens) {
      const termScore = scoreTermAgainstToken(term, token);
      if (termScore > bestTermScore) bestTermScore = termScore;
    }

    if (bestTermScore === 0) return null;
    totalScore += bestTermScore;
  }

  return totalScore;
}
