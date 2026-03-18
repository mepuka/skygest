/**
 * D6: Data Collapse Bar — progressive disclosure for mobile.
 *
 * Collapsed: "N findings · N sources" + chevron
 * Expanded: reveals finding/source cards inline, pushes content down.
 * Surface: warm tan (#F0EDE8) bridging magazine → data transition.
 */

import { useState, type ReactNode } from "react";
import { Collapsible } from "../primitives/index.ts";

interface DataCollapseBarProps {
  readonly findingCount: number;
  readonly sourceCount: number;
  readonly children: ReactNode;
}

export function DataCollapseBar({
  findingCount,
  sourceCount,
  children,
}: DataCollapseBarProps) {
  const [open, setOpen] = useState(false);

  if (findingCount === 0 && sourceCount === 0) return null;

  const parts: string[] = [];
  if (findingCount > 0) parts.push(`${findingCount} ${findingCount === 1 ? "finding" : "findings"}`);
  if (sourceCount > 0) parts.push(`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`);
  const summary = parts.join(" · ");

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger
        className={`rounded-[--radius-data-card] px-3 py-2 ${
          open
            ? "bg-data-collapse-active rounded-b-none"
            : "bg-data-collapse"
        }`}
      >
        <span className={`font-ui text-[11px] text-data-text ${open ? "font-medium" : ""}`}>
          {summary}
        </span>
        <Collapsible.Chevron open={open} />
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div className="flex flex-col gap-2.5 bg-data-surface border border-data-border border-t-0 rounded-b-[--radius-data-card] p-3">
          {children}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
