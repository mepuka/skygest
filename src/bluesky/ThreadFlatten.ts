import { Schema } from "effect";
import { ThreadViewPostNode, type ThreadPostView } from "./ThreadTypes.ts";

export interface FlattenedPost {
  readonly post: ThreadPostView;
  readonly depth: number;
  readonly parentUri: string | null;
  readonly dfsIndex: number;
}

export interface FlattenedThread {
  readonly ancestors: ReadonlyArray<FlattenedPost>;
  readonly focus: FlattenedPost;
  readonly replies: ReadonlyArray<FlattenedPost>;
}

const tryDecodeNodeFull = (value: unknown) => {
  try {
    return Schema.decodeUnknownSync(ThreadViewPostNode)(value);
  } catch {
    return null;
  }
};

/** Sort comparator: likes DESC, reposts DESC, replies DESC */
const byEngagement = (a: { post: ThreadPostView }, b: { post: ThreadPostView }): number => {
  const aLikes = a.post.likeCount ?? 0;
  const bLikes = b.post.likeCount ?? 0;
  if (aLikes !== bLikes) return bLikes - aLikes;
  const aReposts = a.post.repostCount ?? 0;
  const bReposts = b.post.repostCount ?? 0;
  if (aReposts !== bReposts) return bReposts - aReposts;
  const aReplies = a.post.replyCount ?? 0;
  const bReplies = b.post.replyCount ?? 0;
  return bReplies - aReplies;
};

export const flattenThread = (threadData: unknown): FlattenedThread | null => {
  const root = tryDecodeNodeFull(threadData);
  if (!root) return null;

  const focus: FlattenedPost = { post: root.post, depth: 0, parentUri: null, dfsIndex: 0 };
  const seen = new Set<string>([focus.post.uri]);

  // Walk parent chain upward (iterative, not recursive)
  const ancestors: FlattenedPost[] = [];
  let currentParent = root.parent;
  while (currentParent != null) {
    const parentNode = tryDecodeNodeFull(currentParent);
    if (!parentNode || seen.has(parentNode.post.uri)) break;
    seen.add(parentNode.post.uri);
    ancestors.unshift({ post: parentNode.post, depth: 0, parentUri: null, dfsIndex: 0 }); // depth set below
    currentParent = parentNode.parent;
  }

  // Assign ancestor depths: oldest = -(ancestors.length), newest = -1
  for (let i = 0; i < ancestors.length; i++) {
    const depth = -(ancestors.length - i);
    const parentUri = i === 0 ? null : ancestors[i - 1]!.post.uri;
    ancestors[i] = { post: ancestors[i]!.post, depth, parentUri, dfsIndex: 0 };
  }

  // Set focus parentUri to last ancestor if present
  const focusParentUri = ancestors.length > 0 ? ancestors[ancestors.length - 1]!.post.uri : null;
  const focusPost: FlattenedPost = { post: root.post, depth: 0, parentUri: focusParentUri, dfsIndex: 0 };

  // Walk replies via DFS with engagement sorting
  const replies: FlattenedPost[] = [];
  // Stack entries: [raw node data, depth, parentUri]
  type StackEntry = { raw: unknown; depth: number; parentUri: string };

  // Decode and sort root's direct replies, then push in reverse for DFS
  const rootReplies = (root.replies ?? [])
    .map(r => {
      const node = tryDecodeNodeFull(r);
      return node ? { node, raw: r } : null;
    })
    .filter((x): x is { node: typeof root; raw: unknown } => x !== null && !seen.has(x.node.post.uri));

  // Sort by engagement (highest first)
  rootReplies.sort((a, b) => byEngagement({ post: a.node.post }, { post: b.node.post }));

  // Push in reverse so highest-engagement is processed first (stack is LIFO)
  const stack: StackEntry[] = [];
  for (let i = rootReplies.length - 1; i >= 0; i--) {
    stack.push({ raw: rootReplies[i]!.raw, depth: 1, parentUri: focusPost.post.uri });
  }

  let replyDfsIndex = 0;
  while (stack.length > 0) {
    const { raw, depth, parentUri } = stack.pop()!;
    const replyNode = tryDecodeNodeFull(raw);
    if (!replyNode || seen.has(replyNode.post.uri)) continue;
    seen.add(replyNode.post.uri);
    replies.push({ post: replyNode.post, depth, parentUri, dfsIndex: replyDfsIndex++ });

    // Decode, sort, and push children in reverse
    if (replyNode.replies && replyNode.replies.length > 0) {
      const children = replyNode.replies
        .map(r => {
          const node = tryDecodeNodeFull(r);
          return node ? { node, raw: r } : null;
        })
        .filter((x): x is { node: typeof root; raw: unknown } => x !== null && !seen.has(x.node.post.uri));

      children.sort((a, b) => byEngagement({ post: a.node.post }, { post: b.node.post }));

      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ raw: children[i]!.raw, depth: depth + 1, parentUri: replyNode.post.uri });
      }
    }
  }

  return { ancestors, focus: focusPost, replies };
};
