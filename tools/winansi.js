// The PDF tool draws with the standard PDF fonts, which only know the WinAnsi character set. Test applications may
// use other characters (the Hawaiian ʻokina in a name, for example), so those are swapped for the nearest WinAnsi
// character. The scorer applies the same swap to answer-key quotes, so they still match the PDF text.

const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const NEAREST = { 'ʻ': '‘', 'ʼ': '’', '′': "'", '″': '"', '‐': '-', '‑': '-', '−': '-', ' ': ' ' };

const encodable = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || ch === '\n' || EXTRA.has(ch);
};

/** The text with every character the standard PDF fonts can't draw replaced by its nearest one, or "?". */
export function toWinAnsi(text) {
  return [...String(text)].map((ch) => {
    if (encodable(ch)) return ch;
    if (NEAREST[ch]) return NEAREST[ch];
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return [...base].every(encodable) && base ? base : '?';
  }).join('');
}

/** A deep copy of a JSON value with every string passed through toWinAnsi. */
export function deepWinAnsi(value) {
  if (typeof value === 'string') return toWinAnsi(value);
  if (Array.isArray(value)) return value.map(deepWinAnsi);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepWinAnsi(v)]));
  return value;
}
