import { McpServer } from "@effect/ai";
import { Effect, Layer, Schema } from "effect";

/**
 * MCP prompt parameters with optional `hours`.
 *
 * `@effect/ai`'s `McpServer.prompt` constrains `ParamsI extends Record<string, string>`,
 * which rejects `Schema.optional` (encoded type includes `undefined`).
 * At runtime `registerPrompt` correctly reads `isOptional` from the AST and
 * emits `required: false` in the prompt argument list, so the cast is safe.
 */
const TopicWithOptionalHours = Schema.Struct({
  topic: Schema.String.annotations({
    description: "Topic slug to curate, e.g. 'solar' or 'hydrogen'"
  }),
  hours: Schema.optional(Schema.String.annotations({
    description: "Hours to look back (default: 24)"
  }))
}) as unknown as Schema.Schema<
  { readonly topic: string; readonly hours?: string | undefined },
  Record<string, string>,
  never
>;

export const CurateDigestPrompt = McpServer.prompt({
  name: "curate-digest",
  description:
    "Guide an agent through curating editorial picks for a topic digest",
  parameters: TopicWithOptionalHours,
  content: ({ topic, hours }) => {
    const h = hours || "24";
    return Effect.succeed(
      `You are curating editorial picks for the Skygest energy knowledge base. Your goal: identify the 3-5 most valuable posts on "${topic}" from the last ${h} hours.

WORKFLOW:
1. ORIENT — Call list_topics(view: "facets") to confirm the topic exists. Call get_topic(slug: "${topic}") for its description and matching terms.
2. GATHER — Call get_recent_posts(topic: "${topic}", since: <now minus ${h}h in epoch ms>, limit: 20). Note each post's uri, text, handle, tier, and topics. "energy-focused" tier experts carry higher baseline credibility.
3. CHECK LINKS — Call get_post_links(topic: "${topic}", since: <same>) for article metadata. Posts sharing original reporting from known energy publications are stronger candidates.
4. DEDUPLICATE — Call list_editorial_picks(since: <24h ago>) to see existing picks. Do not re-pick duplicates.
5. EVALUATE each post on: informational value, source quality (expert tier + link domain reputation from step 3), topical fit, and original insight.
6. OUTPUT for each recommended pick: postUri, score (0-100: 80+=must-read, 60-79=strong, 40-59=notable), reason (1-2 sentences), category (breaking/analysis/discussion/data/opinion).

Submit picks using the submit_editorial_pick tool, or if you only have read access, present your recommendations for manual submission.`
    );
  }
});

export const ExploreTopicPrompt = McpServer.prompt({
  name: "explore-topic",
  description:
    "Explore a topic area by navigating the ontology and finding relevant posts",
  parameters: Schema.Struct({
    query: Schema.String.annotations({
      description: "Topic name, slug, or keyword to explore"
    })
  }),
  content: ({ query }) =>
    Effect.succeed(
      `Explore the Skygest energy knowledge base to map out the topic area around "${query}".

WORKFLOW:
1. FIND — Call list_topics(view: "facets") to scan categories. If "${query}" matches a slug, proceed. Otherwise try list_topics(view: "concepts") or search_posts(query: "${query}", limit: 5) and inspect topic slugs in results.
2. INSPECT — Call get_topic(slug: <slug>) for label, description, matching terms, hashtags, and signal domains.
3. EXPAND — Call expand_topics(slugs: [<slug>], mode: "descendants") for narrower sub-topics, then mode: "ancestors" for broader parents. Note the hierarchy.
4. SAMPLE — Call get_recent_posts(topic: <slug>, limit: 10). If interesting sub-topics emerged, sample 3-5 posts from those too.
5. EXPLAIN — Pick 2-3 surprising posts. Call explain_post_topics(postUri: <uri>) to audit match signals and scores.
6. REPORT — Topic overview, sub-topic structure, content landscape (volume, expert coverage, source quality), classifier observations.`
    )
});

export const AssessExpertPrompt = McpServer.prompt({
  name: "assess-expert",
  description:
    "Evaluate a domain expert's recent contributions, topics, and source quality",
  parameters: Schema.Struct({
    domain: Schema.String.annotations({
      description: "Knowledge domain (default: 'energy')"
    })
  }),
  content: ({ domain }) => {
    const d = domain || "energy";
    return Effect.succeed(
      `Assess expert contributions in the Skygest ${d} knowledge base.

WORKFLOW:
1. IDENTIFY — Call list_experts(domain: "${d}", active: true). Select an expert to assess (or let the user choose).
2. POSTS — Call get_recent_posts(expertDid: <did>, limit: 20). Note posting frequency, topic distribution, and content style (original analysis vs. link-sharing).
3. LINKS — From posts with links, note hostnames. Do they share primary sources (government reports, trade press) or aggregation?
4. TOPICS — For their top 2-3 topics, call get_topic(slug: <slug>). Call explain_post_topics(postUri: <uri>) on 2-3 posts to verify classification accuracy.
5. CROSS-REF — Call search_posts(query: <handle>, limit: 5) to find posts mentioning this expert (best-effort — searches post text, may miss mentions using display names).
6. REPORT — Profile (handle, tier, source), posting cadence, topical focus, source quality, classifier accuracy, tier adjustment recommendation.`
    );
  }
});

export const CurateSessionPrompt = McpServer.prompt({
  name: "curate-session",
  description:
    "Run a complete curation session: discover candidates, evaluate, curate (Candidate \u2192 Enriching), verify enrichment readiness, and accept briefs (Reviewable \u2192 Accepted)",
  parameters: TopicWithOptionalHours,
  content: ({ topic, hours }) => {
    const h = hours || "24";
    return Effect.succeed(
      `You are running a complete curation session for the Skygest energy knowledge base. Your goal: identify, curate, enrich, and editorially accept the best "${topic}" discourse from the last ${h} hours.

WORKFLOW:

1. ORIENT
   Call list_topics(view: "facets") to confirm "${topic}" exists.
   Call get_topic(slug: "${topic}") for its description and matching terms.

2. DISCOVER CANDIDATES
   Call list_curation_candidates(status: "flagged", topic: "${topic}", since: <now minus ${h}h in epoch ms>, limit: 20).
   Note each candidate's signalScore and predicatesApplied.
   Higher signal scores indicate stronger curation signals.

3. EVALUATE (for each promising candidate)
   Call get_thread_document(postUri: <uri>) to read the full thread and assess quality.
   Consider: informational value, source quality, original insight, topical fit.
   Posts with visual embeds (charts, data) are especially valuable.

4. CURATE \u2014 Candidate \u2192 Enriching
   Call curate_post(postUri: <uri>, action: "curate", note: "<1 sentence reason>").
   This fetches embed data and queues enrichment automatically.
   Reject weak candidates: curate_post(postUri: <uri>, action: "reject", note: "<reason>").

5. VERIFY READINESS \u2014 Enriching \u2192 Reviewable
   Call get_post_enrichments(postUri: <uri>) to check enrichment status.
   If enrichment is still pending, continue evaluating other candidates and check back.
   Vision enrichment extracts chart data; source attribution identifies the content source.

6. DEDUPLICATE
   Call list_editorial_picks(since: <24h ago>) to see existing picks.
   Do not re-pick posts that are already active editorial picks.

7. ACCEPT BRIEF \u2014 Reviewable \u2192 Accepted
   Call submit_editorial_pick(postUri: <uri>, score: <0-100>, reason: "<1-2 sentences>", category: "<type>").
   Score guide: 80+=must-read, 60-79=strong, 40-59=notable.
   Categories: breaking, analysis, discussion, data, opinion.

8. REPORT
   Summarize: candidates reviewed, curated, rejected, accepted. Note any posts still awaiting enrichment.`
    );
  }
});

export const ReadOnlyPromptsLayer = Layer.mergeAll(
  CurateDigestPrompt,
  ExploreTopicPrompt,
  AssessExpertPrompt
);

export const WorkflowPromptsLayer = Layer.mergeAll(
  CurateDigestPrompt,
  ExploreTopicPrompt,
  AssessExpertPrompt,
  CurateSessionPrompt
);

/** @deprecated Use ReadOnlyPromptsLayer or WorkflowPromptsLayer */
export const PromptsLayer = ReadOnlyPromptsLayer;
