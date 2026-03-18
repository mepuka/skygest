/**
 * M5: Expert Discussion — collapsed reply thread with expand.
 *
 * Collapsed: "N expert replies ▾"
 * Expanded: indented reply posts with avatars and engagement.
 */

import { useState } from "react";
import { Collapsible } from "../primitives/index.ts";

interface Reply {
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly avatar: string | null;
  readonly text: string;
  readonly createdAt: string;
  readonly likeCount: number | null;
  readonly repostCount: number | null;
}

interface ExpertDiscussionProps {
  readonly replyCount: number;
  readonly replies?: readonly Reply[];
}

function ReplyItem({ reply }: { reply: Reply }) {
  return (
    <div className="flex gap-2.5 py-2.5 border-t border-border">
      <div className="w-0.5 bg-border shrink-0 rounded-full" />
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5">
          {reply.avatar ? (
            <img
              src={reply.avatar}
              alt=""
              className="size-[18px] rounded-full shrink-0"
            />
          ) : (
            <div className="size-[18px] rounded-full bg-border shrink-0" />
          )}
          <span className="font-ui text-[12px] font-semibold text-heading truncate">
            {reply.displayName ?? reply.handle ?? "Unknown"}
          </span>
          <span className="font-ui text-[10px] text-whisper shrink-0">
            {reply.createdAt}
          </span>
        </div>
        <p className="font-body text-[15px] leading-[23px] text-primary">
          {reply.text}
        </p>
        <div className="flex gap-3">
          {reply.likeCount != null && reply.likeCount > 0 && (
            <span className="font-ui text-[10px] text-ghost">
              {reply.likeCount} likes
            </span>
          )}
          {reply.repostCount != null && reply.repostCount > 0 && (
            <span className="font-ui text-[10px] text-ghost">
              {reply.repostCount} reposts
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExpertDiscussion({ replyCount, replies }: ExpertDiscussionProps) {
  const [open, setOpen] = useState(false);

  if (replyCount === 0) return null;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="gap-1">
        <span className="font-ui text-[12px] text-secondary">
          {replyCount} expert {replyCount === 1 ? "reply" : "replies"}
        </span>
        <Collapsible.Chevron open={open} />
      </Collapsible.Trigger>

      <Collapsible.Content>
        {replies?.map((reply, i) => (
          <ReplyItem key={i} reply={reply} />
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
