/**
 * Renders text with FTS5 highlight markers 【...】 as highlighted spans.
 * Shared across unified search, judgments, and gazette pages.
 */
export function HighlightedSnippet({ text, className }: { text: string; className?: string }) {
  if (!text) return <span className="text-muted-foreground">--</span>;

  const parts = text.split(/(【[^】]+】)/g);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith("【") && part.endsWith("】")) {
          return (
            <mark
              key={i}
              className="bg-yellow-200/80 text-foreground rounded px-0.5 font-medium"
            >
              {part.slice(1, -1)}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
