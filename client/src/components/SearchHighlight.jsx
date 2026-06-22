import { splitTextBySearchHighlights } from '../utils/searchNormalize';

export default function SearchHighlight({ text, query }) {
  if (!text) return null;
  if (!query?.trim()) return text;

  const parts = splitTextBySearchHighlights(text, query);
  if (parts.length === 1 && !parts[0].highlighted) return text;

  return (
    <>
      {parts.map((part, index) => (
        part.highlighted ? (
          <mark key={index} className="search-highlight">{part.text}</mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      ))}
    </>
  );
}
