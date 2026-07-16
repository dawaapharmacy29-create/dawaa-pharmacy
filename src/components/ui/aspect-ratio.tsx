import { forwardRef, type HTMLAttributes } from 'react';

type AspectRatioProps = HTMLAttributes<HTMLDivElement> & {
  ratio?: number;
};

const AspectRatio = forwardRef<HTMLDivElement, AspectRatioProps>(
  ({ ratio = 1, style, ...props }, ref) => (
    <div ref={ref} style={{ aspectRatio: String(ratio), ...style }} {...props} />
  )
);

AspectRatio.displayName = 'AspectRatio';

export { AspectRatio };
