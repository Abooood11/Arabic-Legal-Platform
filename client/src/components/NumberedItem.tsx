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
      className={`flex gap-3 ${className}`}
      style={{ 
        marginRight: `${indentRight}px`,
        direction: 'rtl'
      }}
      data-testid={testId}
    >
      <div 
        className={`${markerColor} font-bold shrink-0 whitespace-nowrap`}
      >
        {marker}
      </div>
      <div 
        className="flex-1 text-justify"
        style={{ 
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default NumberedItem;
