const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Marks every occurrence of the search words in `text`. The text is only ever rendered as React
 * text nodes (never as HTML), so nothing in a record can inject markup.
 */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text || terms.length === 0) return <>{text}</>;
  // Longest first, so "FPGA aging" is one mark, not two overlapping ones. The capture group makes
  // split() keep the matches at the odd indexes.
  const pattern = new RegExp(`(${[...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}
