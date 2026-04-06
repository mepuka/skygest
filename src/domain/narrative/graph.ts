import { Schema } from "effect";
import { ArgumentPatternFrontmatter } from "./argument-pattern";
import { EditionFrontmatter } from "./edition";
import { NarrativeFrontmatter } from "./narrative";
import { PostAnnotationFrontmatter } from "./post-annotation";
import { StoryFrontmatter, NonEmptyNarrativeText } from "./story";

const GraphNodeId = NonEmptyNarrativeText;
const GraphFilePath = NonEmptyNarrativeText;

const GraphEdgeMetadata = Schema.Record(Schema.String, Schema.Unknown);

export const NarrativeNode = Schema.Struct({
  // [derived] node discriminator for the parser graph
  _tag: Schema.Literal("narrative"),
  // [derived] file path for the narrative markdown document
  path: GraphFilePath,
  // [derived] stable node id derived by the parser
  id: GraphNodeId,
  // [derived] ancestor narrative ids from root to parent
  parent_chain: Schema.Array(GraphNodeId),
  // [editorial/hydratable/cache] parsed narrative frontmatter
  frontmatter: NarrativeFrontmatter,
  // [editorial] markdown body content
  body: Schema.String
});
export type NarrativeNode = Schema.Schema.Type<typeof NarrativeNode>;

export const StoryNode = Schema.Struct({
  // [derived] node discriminator for the parser graph
  _tag: Schema.Literal("story"),
  // [derived] file path for the story markdown document
  path: GraphFilePath,
  // [derived] stable node id derived by the parser
  id: GraphNodeId,
  // [derived] primary narrative id inferred from the containing directory
  primary_narrative: GraphNodeId,
  // [editorial/hydratable/cache] parsed story frontmatter
  frontmatter: StoryFrontmatter,
  // [editorial] markdown body content
  body: Schema.String
});
export type StoryNode = Schema.Schema.Type<typeof StoryNode>;

export const PostAnnotationNode = Schema.Struct({
  // [derived] node discriminator for the parser graph
  _tag: Schema.Literal("post_annotation"),
  // [derived] file path for the annotation markdown document
  path: GraphFilePath,
  // [editorial/hydratable/cache] parsed annotation frontmatter
  frontmatter: PostAnnotationFrontmatter,
  // [editorial] markdown body content
  body: Schema.String
});
export type PostAnnotationNode = Schema.Schema.Type<
  typeof PostAnnotationNode
>;

export const ArgumentPatternNode = Schema.Struct({
  // [derived] node discriminator for the parser graph
  _tag: Schema.Literal("argument_pattern"),
  // [derived] file path for the argument-pattern markdown document
  path: GraphFilePath,
  // [derived] stable node id derived by the parser
  id: GraphNodeId,
  // [editorial/hydratable/cache] parsed argument-pattern frontmatter
  frontmatter: ArgumentPatternFrontmatter,
  // [editorial] markdown body content
  body: Schema.String
});
export type ArgumentPatternNode = Schema.Schema.Type<
  typeof ArgumentPatternNode
>;

export const EditionNode = Schema.Struct({
  // [derived] node discriminator for the parser graph
  _tag: Schema.Literal("edition"),
  // [derived] file path for the edition markdown document
  path: GraphFilePath,
  // [derived] stable node id derived by the parser
  id: GraphNodeId,
  // [editorial/hydratable/cache] parsed edition frontmatter
  frontmatter: EditionFrontmatter,
  // [editorial] markdown body content
  body: Schema.String
});
export type EditionNode = Schema.Schema.Type<typeof EditionNode>;

export const GraphNode = Schema.Union([
  NarrativeNode,
  StoryNode,
  PostAnnotationNode,
  ArgumentPatternNode,
  EditionNode
]);
export type GraphNode = Schema.Schema.Type<typeof GraphNode>;

export const EdgeType = Schema.Literals([
  "narrative_parent",
  "narrative_related",
  "story_narrative",
  "story_pattern",
  "story_post",
  "annotation_pattern",
  "edition_story"
]);
export type EdgeType = Schema.Schema.Type<typeof EdgeType>;

export const GraphEdge = Schema.Struct({
  // [derived] source node id
  from: GraphNodeId,
  // [derived] target node id
  to: GraphNodeId,
  // [derived] semantic relationship between the two nodes
  type: EdgeType,
  // [derived] parser-supplied edge metadata when needed
  metadata: Schema.optionalKey(GraphEdgeMetadata)
});
export type GraphEdge = Schema.Schema.Type<typeof GraphEdge>;
