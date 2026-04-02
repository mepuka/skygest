import { AtomHttpApi } from "@effect-atom/atom";
import { FetchHttpClient } from "effect/unstable/http";
import { PublicReadApi } from "../../api/PublicReadApi.ts";

interface SkygestApiId {
  readonly _: unique symbol;
}

export const SkygestApi = AtomHttpApi.Tag<SkygestApiId>()("SkygestApi", {
  api: PublicReadApi,
  httpClient: FetchHttpClient.layer
});
