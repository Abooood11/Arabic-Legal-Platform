// Grid-based numbered item for RTL legal text rendering.
// See: docs/extraction/boe_formatting_playbook.md (section D)
interface NumberedItemProps {
  marker: string;
  children: React.ReactNode;
  level?: number;
  markerColor?: string;
  className?: string;
  "data-testid"?: string;
}

export function NumberedItem({
  marker,
  children,
  level = 0,
  markerColor = "text-primary",
  className = "",
  "data-testid": testId
}: NumberedItemProps) {
  const indentRight = level === 2 ? 60 : level === 1 ? 30 : 0;

  return (
    <div
      dir="rtl"
      className={className}
      style={{ paddingInlineStart: `${indentRight}px` }}
      data-testid={testId}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8 }}>
        <div className={`${markerColor} font-bold shrink-0 whitespace-nowrap`}>
          {marker}
        </div>
        <div
          className="min-w-0 text-justify"
          style={{
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere'
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default NumberedItem;
