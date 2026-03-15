export type ExpertTier = "energy-focused" | "general-outlet" | "independent";

export type PublicationTier = "energy-focused" | "general-outlet" | "unknown";

export interface TopicEntry {
  readonly slug: string;
  readonly label: string;
}
