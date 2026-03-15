import type { ExpertTier } from "../lib/types.ts";
import { TierDot } from "./TierDot.tsx";
import { TimeLink } from "./TimeLink.tsx";

interface AttributionRowProps {
  readonly handle: string | null;
  readonly did: string;
  readonly avatar: string | null;
  readonly tier: ExpertTier;
  readonly createdAt: number;
  readonly uri: string;
  readonly topicLabel?: string | null | undefined;
}

export function AttributionRow({
  handle,
  did,
  avatar,
  tier,
  createdAt,
  uri,
  topicLabel
}: AttributionRowProps) {
  return (
    <div className="flex items-center gap-[7px]">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          className="size-[22px] rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="size-[22px] rounded-full bg-border shrink-0" aria-hidden="true" />
      )}
      <span className="font-ui text-[13px] leading-4 font-semibold text-heading tracking-[-0.01em] truncate">
        {handle ?? did}
      </span>
      <TierDot tier={tier} />
      <TimeLink uri={uri} handle={handle} createdAt={createdAt} />
      {topicLabel && (
        <>
          <span className="font-ui text-[11px] leading-[14px] text-whisper">in</span>
          <span className="font-ui text-[11px] leading-[14px] font-medium text-mid">
            {topicLabel}
          </span>
        </>
      )}
    </div>
  );
}
