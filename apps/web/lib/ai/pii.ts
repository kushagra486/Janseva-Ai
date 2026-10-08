// Mask personal identifiers before text leaves this app for a hosted model.
// Ported 1:1 from apps/ai-service's privacy/pii_mask.py.

const DEV_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

const PATTERNS: [string, RegExp][] = [
  ["VID", /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g],
  ["AADHAAR", /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g],
  ["PHONE", /(?<![\d+])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g],
  ["PAN", /\b[A-Z]{5}\d{4}[A-Z]\b/g],
  ["EMAIL", /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
];

export function toAsciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (ch) => DEV_DIGITS[ch] ?? ch);
}

export function maskPii(text: string): { masked: string; counts: Record<string, number> } {
  let out = toAsciiDigits(text);
  const counts: Record<string, number> = {};
  for (const [kind, pat] of PATTERNS) {
    const matches = out.match(pat);
    if (matches?.length) {
      counts[kind] = matches.length;
      out = out.replace(pat, `[${kind}]`);
    }
  }
  return { masked: out, counts };
}
