/**
 * Tooltip — Radix primitive styled for Skygest.
 *
 * Used by: TierDot (expert/publication tier labels)
 */

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const Provider = RadixTooltip.Provider;

export function Tip({
  children,
  content,
  side = "top",
}: {
  children: ReactNode;
  content: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={4}
          className="rounded-[3px] bg-heading px-2 py-1 font-ui text-[10px] text-surface"
        >
          {content}
          <RadixTooltip.Arrow className="fill-heading" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
