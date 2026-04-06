import { McpServer } from "effect/unstable/ai";
import { Effect, Layer, Schema } from "effect";

/**
 * MCP prompt parameters with optional `hours`.
 *
 * `@effect/ai`'s `McpServer.prompt` constrains `ParamsI extends Record<string, string>`,
 * which rejects `Schema.optional` (encoded type includes `undefined`).
 * At runtime `registerPrompt` correctly reads `isOptional` from the AST and
 * emits `required: false` in the prompt argument list, so the cast is safe.
 */
const TopicWithOptionalHoursFields = {
  topic: Schema.String.annotate({
    description: "Topic slug to curate, e.g. 'solar' or 'hydrogen'"
  }),
  hours: Schema.optionalKey(Schema.String.annotate({
    description: "Hours to look back (default: 24)"
  }))
};

export const CurateDigestPrompt = McpServer.prompt({
  name: "curate-digest",
  description:
    "Guide an agent through curating editorial picks for a topic digest",
  parameters: TopicWithOptionalHoursFields,
  content: ({ topic, hours }) => {
    const h = hours || "24";
    return Effect.succeed(
      `You are curating editorial picks for the Skygest energy knowledge base. Your goal: identify the 3-5 most valuable posts on "${topic}" from the last ${h} hours.

The core unit of editorial value is the expert-data-argument link: which expert chose which data to make which argument. A chart alone is not the product. An expert's name alone is not the product. It is the expert's choice to use specific data to make a specific argument — that is what makes a post worth curating.

EDITORIAL STANCE: Skygest is on the side of honest data analysis. Do not extend false equivalence to bad-faith actors or captured institutions. Within credible expert discourse, present genuine disagreements fairly — identify the question they disagree about and the data each is using.

WORKFLOW:
1. ORIENT — Call list_topics(view: "facets") to confirm the topic exists. Call get_topic(slug: "${topic}") for its description and matching terms.
2. GATHER — Call get_recent_posts(topic: "${topic}", since: <now minus ${h}h in epoch ms>, limit: 20). Note each post's uri, text, handle, tier, and topics.
3. CHECK LINKS — Call get_post_links(topic: "${topic}", since: <same>) for article metadata. Posts sharing original reporting or primary data sources from known energy publications are stronger candidates.
4. DEDUPLICATE — Call list_editorial_picks(since: <24h ago>) to see existing picks. Do not re-pick duplicates.
5. EVALUATE each post on three credibility dimensions plus editorial value:
   - Analytical honesty: does the expert derive conclusions from data, or work backward from ideology?
   - Track record: has the expert's analysis been directionally correct? Do they update positions when evidence changes?
   - Rigorous data treatment: does the expert cite primary sources, contextualize data, and note limitations?
   - Expert-data-argument link strength: is the expert making a specific argument using specific data, or just sharing without analysis?
   The expert tier (energy-focused, general-outlet, independent) indicates domain coverage but not credibility — a rigorous independent analyst outranks a sloppy energy-focused one.
6. OUTPUT for each recommended pick: postUri, score (0-100: 80+=must-read, 60-79=strong, 40-59=notable), reason (1-2 sentences naming the expert-data-argument link), category (breaking/analysis/discussion/data/opinion).

Submit picks using the submit_editorial_pick tool, or if you only have read access, present your recommendations for manual submission.`
    );
  }
});

export const ExploreTopicPrompt = McpServer.prompt({
  name: "explore-topic",
  description:
    "Explore a topic area by navigating the ontology and finding relevant posts",
  parameters: {
    query: Schema.String.annotate({
      description: "Topic name, slug, or keyword to explore"
    })
  },
  content: ({ query }) =>
    Effect.succeed(
      `Explore the Skygest energy knowledge base to map out the topic area around "${query}".

WORKFLOW:
1. FIND — Call list_topics(view: "facets") to scan categories. If "${query}" matches a slug, proceed. Otherwise try list_topics(view: "concepts") or search_posts(query: "${query}", limit: 5) and inspect topic slugs in results.
   Search tips: use quoted phrases for exact wording (e.g. "solar storage"), OR / NOT for alternatives or exclusions, prefix search with * for partial tokens (e.g. electro*), and pass a full Bluesky handle like solar-desk.bsky.social when you want exact handle matching.
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
  parameters: {
    domain: Schema.String.annotate({
      description: "Knowledge domain (default: 'energy')"
    })
  },
  content: ({ domain }) => {
    const d = domain || "energy";
    return Effect.succeed(
      `Assess expert contributions in the Skygest ${d} knowledge base.

WORKFLOW:
1. IDENTIFY — Call list_experts(domain: "${d}", active: true). Select an expert to assess (or let the user choose).
2. POSTS — Call get_recent_posts(expertDid: <did>, limit: 20). Note posting frequency, topic distribution, and content style (original analysis vs. link-sharing).
3. LINKS — From posts with links, note hostnames. Do they share primary sources (government reports, trade press) or aggregation?
4. TOPICS — For their top 2-3 topics, call get_topic(slug: <slug>). Call explain_post_topics(postUri: <uri>) on 2-3 posts to verify classification accuracy.
5. CROSS-REF — Call search_posts(query: <handle>, limit: 5) to find this expert's posts or posts that mention the full handle. Pass the full handle string (for example solar-desk.bsky.social), not fragments. search_posts also matches stored topic terms, so use it to probe adjacent concepts when an expert's language is more specialized than the canonical topic slug.
6. REPORT — Profile (handle, tier, source), posting cadence, topical focus, source quality, classifier accuracy, tier adjustment recommendation.`
    );
  }
});

export const CurateSessionPrompt = McpServer.prompt({
  name: "curate-session",
  description:
    "Run a complete curation session: discover candidates, evaluate, curate (Candidate \u2192 Enriching), verify enrichment readiness, and accept briefs (Reviewable \u2192 Accepted)",
  parameters: TopicWithOptionalHoursFields,
  content: ({ topic, hours }) => {
    const h = hours || "24";
    return Effect.succeed(
      `You are running a complete curation session for the Skygest energy knowledge base. Your goal: identify, curate, enrich, and editorially accept the best "${topic}" discourse from the last ${h} hours.

The core unit of editorial value is the expert-data-argument link: which expert chose which data to make which argument. Prioritize posts where this link is strong — an expert making a specific argument using specific data — over posts that merely share links or offer commentary without evidence.

EDITORIAL STANCE: Skygest is on the side of honest data analysis. Do not extend false equivalence to bad-faith actors or captured institutions. Name political motivations when they shape what data is surfaced or suppressed. Within credible expert discourse, present genuine disagreements fairly — identify the question they disagree about and the data each is using.

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
   Assess on three credibility dimensions:
   - Analytical honesty: conclusions derived from data, not ideology. Acknowledges uncertainty.
   - Track record: directionally correct over time. Updates positions when evidence changes.
   - Rigorous data treatment: cites primary sources, contextualizes appropriately, notes limitations.
   Expert tier (energy-focused, general-outlet, independent) indicates domain coverage, not credibility.
   Posts with visual embeds (charts, data) are especially valuable — they carry the strongest expert-data-argument links.

4. CURATE — Candidate → Enriching
   Call curate_post(postUri: <uri>, action: "curate", note: "<1 sentence naming the expert-data-argument link>").
   This captures the post's embed data for enrichment.
   Reject weak candidates: curate_post(postUri: <uri>, action: "reject", note: "<reason>").

5. START ENRICHMENT
   Call start_enrichment(postUri: <uri>) to queue enrichment processing.
   The enrichment type is auto-detected: vision for charts/screenshots, source-attribution for links.
   You can override: start_enrichment(postUri: <uri>, enrichmentType: "vision").
   For visual posts, the workflow automatically chains source-attribution after vision completes —
   you only need to call start_enrichment once.

6. VERIFY READINESS — Enriching → Reviewable
   Call get_post_enrichments(postUri: <uri>) to check readiness.
   Readiness values: none (not started), pending (running), complete (ready), failed, needs-review.
   If pending: continue evaluating other candidates and check back later.
   If complete: proceed to step 8 (ACCEPT BRIEF).
   If failed or needs-review: note the issue and skip for now.

7. DEDUPLICATE
   Call list_editorial_picks(since: <24h ago>) to see existing picks.
   Do not re-pick posts that are already active editorial picks.

8. ACCEPT BRIEF — Reviewable → Accepted
   Call submit_editorial_pick(postUri: <uri>, score: <0-100>, reason: "<1-2 sentences naming the expert-data-argument link>", category: "<type>").
   Score guide: 80+=must-read, 60-79=strong, 40-59=notable.
   Categories: breaking, analysis, discussion, data, opinion.

9. REPORT
   Summarize: candidates reviewed, curated, rejected, accepted. Note any posts still awaiting enrichment.
   For each accepted pick, state the expert-data-argument link in one sentence.`
    );
  }
});

const AssembleStoriesOptionalFields = {
  hours: Schema.optionalKey(Schema.String.annotate({
    description: "Hours to look back for editorial picks (default: 48)"
  }))
};

export const AssembleStoriesPrompt = McpServer.prompt({
  name: "assemble-stories",
  description:
    "Cluster editorial picks into story briefs using question-based grouping with discourse level analysis. Two-stage process: analysis (clustering proposal) then assembly (story brief writing) with an editor checkpoint between stages.",
  parameters: AssembleStoriesOptionalFields,
  content: ({ hours }) => {
    const h = hours || "48";
    return Effect.succeed(
      `You are assembling story briefs from editorial picks in the Skygest energy knowledge base. Your goal: cluster recent picks into stories organized by the implicit question being debated, then write structured briefs with expert-data-argument links.

The core unit of editorial value is the expert-data-argument link: which expert chose which data to make which argument at which discourse level. Story briefs make this link legible to readers.

EDITORIAL STANCE: Skygest is on the side of honest data analysis. Lead with what the data shows, then the discourse around it. Always attribute: name the source, name the expert, name the provider. Do not extend false equivalence to bad-faith actors. When experts disagree, identify the question they disagree about and the data each is using. When in doubt, show the chart.

DISCOURSE LEVELS: A single post operates at multiple levels simultaneously. A data point at the bottom ripples upward.
- Technical: can the technology do what is claimed?
- Economic: do the unit economics work?
- Policy: is the regulatory/market framework supportive?
- Political: what political forces shape the discourse?
- Strategic: what is the right long-term pathway?

STORY MODES:
- Breaking (0-6h): speed + attribution — what happened, who reported, what data
- Developing (6-48h): facts + interpretation — initial reports plus expert analysis
- Analysis (48h+): depth — best analysis threads, authoritative data, consensus/dissent
- Recurring (periodic): data brief — known report drops with chart analysis

== STAGE 1: ANALYSIS ==

1. GATHER PICKS
   Call list_editorial_picks(since: <now minus ${h}h in epoch ms>).
   For picks with enrichments, call get_post_enrichments(postUri: <uri>) to retrieve vision analysis and source attribution data.

2. IDENTIFY IMPLICIT QUESTIONS
   Cluster picks by the question being debated, NOT by topic label. "Can new nuclear be built affordably?" is a story; "Nuclear news roundup" is not.
   Story headlines name the question and the tension: "NuScale costs cast doubt on SMR economics as DOE doubles down on loan support."

3. USE CLUSTERING SIGNALS
   Primary signal: shared implicit question — are these experts responding to the same underlying question?
   Supporting signals (evidence, not deterministic rules):
   - Shared URL: posts referencing the same report or dataset likely respond to the same trigger
   - Entity co-occurrence: posts mentioning the same organization, regulation, or person
   - Topic overlap: same ontology topics suggest the same domain (but not necessarily the same question)
   - Temporal proximity: posts within hours of each other may respond to the same trigger event

4. MAP DISCOURSE LEVELS
   For each proposed cluster, identify the primary discourse level (technical, economic, policy, political, strategic) and note where evidence ripples across levels.

5. DETECT TRIGGER EVENTS
   Identify data releases, policy announcements, corporate events, or market events that explain why this discourse is happening now. Not every story has an explicit trigger.

6. NOTE GEOGRAPHIC CONTEXT
   Geography in energy discourse operates at three levels:
   - Inherent: data inseparable from its region (ERCOT generation mix, CAISO curtailment)
   - Narrative-scoping: claims meaningful only within a boundary (LNG exports for producers vs. importers)
   - Geopolitical: the event itself is geographic (trade disruptions, regional policy)

7. PRESENT CLUSTERING PROPOSAL
   For each proposed story cluster, output:
   - Headline (names the question and tension)
   - Assigned picks with URIs
   - Primary discourse level
   - Trigger event (if identified)
   - Suggested story mode (breaking, developing, analysis, recurring)
   - Geographic scope (if relevant)

== EDITOR CHECKPOINT ==
Stop here and present the clustering proposal. Wait for the editor to confirm, merge, split, or reframe clusters before proceeding to Stage 2.

== STAGE 2: ASSEMBLY ==

8. WRITE STORY BRIEFS
   For each confirmed cluster, produce a story brief with these sections:

   FRONTMATTER:
   - id, headline, question, status (draft), created, topics, entities
   - mode, discourse_level, narrative_arc, trigger
   - posts array with uri, role (lead/supporting/data/reaction), editorial_score

   SUMMARY: 2-3 sentences. Lead with the data, then frame the disagreement or development.

   KEY DATA: Charts and data points with full provenance. For each, explain why the expert chose this data and what it reveals about the question being debated. Provenance is not just attribution — it is pedagogy. The reader should understand: "this expert looked at this specific dataset and concluded X, which matters because Y."

   EXPERT VOICES: 2-3 attributed positions showing distinct takes via the expert-data-argument link. Format: "{Expert} uses {data source} to argue {position}." Show how different experts use different data — or the same data differently — to reach different conclusions.

   WHAT TO WATCH: Connect to the broader narrative arc. What would change the story? What data release or policy decision would shift the discourse?

   DATA SOURCES REFERENCED: Providers and publications cited, building reader familiarity over time.

9. REPORT
   Summarize: total picks processed, stories assembled, picks not clustered (with reason). For each story, state the central question in one sentence.`
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
  CurateSessionPrompt,
  AssembleStoriesPrompt
);

/** @deprecated Use ReadOnlyPromptsLayer or WorkflowPromptsLayer */
export const PromptsLayer = ReadOnlyPromptsLayer;
