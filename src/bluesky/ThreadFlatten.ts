import { Schema } from "effect";
import { ThreadViewPostNode, type ThreadPostView } from "./ThreadTypes.ts";

export interface FlattenedThread {
  readonly ancestors: ReadonlyArray<ThreadPostView>;
  readonly focus: ThreadPostView;
  readonly replies: ReadonlyArray<ThreadPostView>;
}

const tryDecodeNodeFull = (value: unknown) => {
  try {
    return Schema.decodeUnknownSync(ThreadViewPostNode)(value);
  } catch {
    return null;
  }
};

export const flattenThread = (threadData: unknown): FlattenedThread | null => {
  const root = tryDecodeNodeFull(threadData);
  if (!root) return null;

  const focus = root.post;
  const seen = new Set<string>([focus.uri]);

  // Walk parent chain upward (iterative, not recursive)
  const ancestors: ThreadPostView[] = [];
  let currentParent = root.parent;
  while (currentParent != null) {
    const parentNode = tryDecodeNodeFull(currentParent);
    if (!parentNode || seen.has(parentNode.post.uri)) break;
    seen.add(parentNode.post.uri);
    ancestors.unshift(parentNode.post); // oldest first
    currentParent = parentNode.parent;
  }

  // Walk replies (BFS, one level at a time)
  const replies: ThreadPostView[] = [];
  const replyQueue: unknown[] = [...(root.replies ?? [])];
  while (replyQueue.length > 0) {
    const next = replyQueue.shift()!;
    const replyNode = tryDecodeNodeFull(next);
    if (!replyNode || seen.has(replyNode.post.uri)) continue;
    seen.add(replyNode.post.uri);
    replies.push(replyNode.post);
    if (replyNode.replies) {
      replyQueue.push(...replyNode.replies);
    }
  }

  return { ancestors, focus, replies };
};
