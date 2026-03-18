/**
 * M3: Chart Strip — horizontal row of numbered chart thumbnails.
 *
 * Feed: ~100×64px thumbnails with number badge, scroll on overflow.
 * Detail: larger thumbnails in grid layout.
 */

import { HorizontalScroll } from "../primitives/index.ts";

interface ChartImage {
  readonly thumb: string;
  readonly fullsize: string;
  readonly alt: string | null;
}

interface ChartStripProps {
  readonly images: readonly ChartImage[];
  readonly variant?: "feed" | "detail";
}

function ChartThumbnail({
  image,
  index,
  variant,
}: {
  image: ChartImage;
  index: number;
  variant: "feed" | "detail";
}) {
  const size = variant === "feed"
    ? "w-[100px] h-16"
    : "w-[130px] h-[88px]";

  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className={`${size} relative rounded-sm bg-recessed overflow-hidden`}>
        <img
          src={image.thumb}
          alt={image.alt ?? `Chart ${index + 1}`}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <span className="absolute top-1 left-1 rounded-sm px-1 py-px bg-data-text font-data-mono text-[9px] font-medium text-surface leading-3">
          {index + 1}
        </span>
      </div>
    </div>
  );
}

export function ChartStrip({ images, variant = "feed" }: ChartStripProps) {
  if (images.length === 0) return null;

  const visible = variant === "feed" && images.length > 4
    ? images.slice(0, 3)
    : images;

  const remaining = variant === "feed" && images.length > 4
    ? images.length - 3
    : 0;

  return (
    <HorizontalScroll>
      {visible.map((img, i) => (
        <ChartThumbnail key={i} image={img} index={i} variant={variant} />
      ))}
      {remaining > 0 && (
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="w-[100px] h-16 flex items-center justify-center rounded-sm bg-recessed">
            <span className="font-data-mono text-[11px] text-data-secondary">
              +{remaining} more
            </span>
          </div>
        </div>
      )}
    </HorizontalScroll>
  );
}
