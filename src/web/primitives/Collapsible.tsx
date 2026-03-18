/**
 * Collapsible — Radix primitive styled for Skygest.
 *
 * Used by: M5 (Expert Discussion), D6 (Data Collapse Bar)
 */

import * as RadixCollapsible from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";

export const Root = RadixCollapsible.Root;
export const Content = RadixCollapsible.CollapsibleContent;

export function Trigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixCollapsible.CollapsibleTrigger
      className={`flex w-full items-center justify-between transition-colors ${className ?? ""}`}
    >
      {children}
    </RadixCollapsible.CollapsibleTrigger>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={`text-secondary transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline
        points="3,4.5 6,7.5 9,4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
