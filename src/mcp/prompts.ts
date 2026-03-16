import { McpServer } from "@effect/ai";
import { Effect, Layer, Schema } from "effect";

export const CurateDigestPrompt = McpServer.prompt({
  name: "curate-digest",
  description:
    "Guide an agent through curating editorial picks for a topic digest",
  parameters: Schema.Struct({
    topic: Schema.String.annotations({
      description: "Topic slug to curate, e.g. 'solar' or 'hydrogen'"
    }),
    hours: Schema.String.annotations({
      description: "Hours to look back (default: 24)"
    })
  }),
  content: ({ topic, hours }) => {
    const h = hours || "24";
    return Effect.succeed(
      `You are curating editorial picks for the Skygest energy knowledge base. Your goal: identify the 3-5 most valuable posts on "${topic}" from the last ${h} hours.

WORKFLOW:
1. ORIENT — Call list_topics(view: "facets") to confirm the topic exists. Call get_topic(slug: "${topic}") for its description and matching terms.
2. GATHER — Call get_recent_posts(topic: "${topic}", since: <now minus ${h}h in epoch ms>, limit: 20). Note each post's uri, text, handle, tier, and topics. "energy-focused" tier experts carry higher baseline credibility.
3. CHECK LINKS — Call get_post_links(topic: "${topic}", since: <same>) for article metadata. Posts sharing original reporting from known energy publications are stronger candidates.
4. DEDUPLICATE — Call list_editorial_picks(since: <24h ago>) to see existing picks. Do not re-pick duplicates.
5. EVALUATE each post on: informational value, source quality (expert tier + publication tier), topical fit, and original insight.
6. OUTPUT for each recommended pick: postUri, score (0-100: 80+=must-read, 60-79=strong, 40-59=notable), reason (1-2 sentences), category (breaking/analysis/discussion/data/opinion).

Submit picks via POST /admin/editorial/pick with the operator secret header.`
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
5. CROSS-REF — Call search_posts(query: <handle>, limit: 5) to find mentions by other experts.
6. REPORT — Profile (handle, tier, source), posting cadence, topical focus, source quality, classifier accuracy, tier adjustment recommendation.`
    );
  }
});

export const PromptsLayer = Layer.mergeAll(
  CurateDigestPrompt,
  ExploreTopicPrompt,
  AssessExpertPrompt
);
