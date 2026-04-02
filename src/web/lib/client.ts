import { AtomHttpApi } from "@effect-atom/atom";
import { FetchHttpClient } from "effect/unstable/http";
import { PublicReadApi } from "../../api/PublicReadApi.ts";

interface SkygestApiId {
  readonly _: unique symbol;
}

export const SkygestApi = AtomHttpApi.Tag<SkygestApiId>()("SkygestApi", {
  // @ts-expect-error — @effect-atom/atom types lag behind Effect 4 HttpApi changes
  api: PublicReadApi,
  // @ts-expect-error — @effect-atom/atom types lag behind Effect 4 HttpApi changes
  httpClient: FetchHttpClient.layer
});
