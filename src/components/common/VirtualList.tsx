import React from 'react';

export default function VirtualList<T>({
  items,
  height = 400,
  itemHeight = 48,
  renderItem,
}: {
  items: T[];
  height?: number;
  itemHeight?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  const [List, setList] = React.useState<any>(null);

  React.useEffect(() => {
    let mounted = true;
    import('react-window').then((m) => {
      if (mounted) setList(() => m.FixedSizeList);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const Row = ({ index, style }: any) => {
    const item = items[index] as T;
    return <div style={style}>{renderItem(item, index)}</div>;
  };

  if (!List) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading list...</div>
      </div>
    );
  }

  return <List height={height} itemCount={items.length} itemSize={itemHeight} width="100%">{Row}</List>;
}
