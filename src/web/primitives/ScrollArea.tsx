/**
 * ScrollArea — Radix primitive styled for Skygest.
 *
 * Used by: M3 (Chart Strip horizontal scroll), M7 (Topic pills mobile scroll)
 */

import * as RadixScrollArea from "@radix-ui/react-scroll-area";
import type { ReactNode } from "react";

export function HorizontalScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixScrollArea.Root className={`overflow-hidden ${className ?? ""}`}>
      <RadixScrollArea.Viewport className="w-full">
        <div className="flex gap-2">{children}</div>
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="horizontal"
        className="flex h-1 touch-none select-none p-px"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  );
}
