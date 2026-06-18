import React from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';

export default function VirtualList<T>({ items, height = 400, itemHeight = 48, renderItem }: { items: T[]; height?: number; itemHeight?: number; renderItem: (item: T, index: number) => React.ReactNode }) {
  const Row = ({ index, style }: ListChildComponentProps) => {
    const item = items[index] as T;
    return <div style={style}>{renderItem(item, index)}</div>;
  };

  return (
    <List
      height={height}
      itemCount={items.length}
      itemSize={itemHeight}
      width="100%"
    >
      {Row}
    </List>
  );
}
