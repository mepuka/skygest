import type { SqlClient } from "@effect/sql";

export const topicFilterExists = (
  sql: SqlClient.SqlClient,
  topicSlugs: ReadonlyArray<string>
) => sql`EXISTS (
  SELECT 1
  FROM post_topics filter_pt
  WHERE filter_pt.post_uri = p.uri
    AND (${sql.join(" OR ", false)(
      topicSlugs.map((topicSlug) => sql`filter_pt.topic_slug = ${topicSlug}`)
    )})
)`;
