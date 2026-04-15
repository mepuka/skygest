import { Effect } from "effect";

import { distillEntities } from "./mapping/reverse";
import { type RdfStore } from "./Service/RdfStore";

export const distill = Effect.fn("distill")(function* (store: RdfStore) {
  return yield* distillEntities(store);
});
