import { AtomHttpApi } from "effect/unstable/reactivity";
import { FetchHttpClient } from "effect/unstable/http";
import { PublicReadApi } from "../../api/PublicReadApi.ts";

interface SkygestApiId {
  readonly _: unique symbol;
}

export const SkygestApi = AtomHttpApi.Service<SkygestApiId>()("SkygestApi", {
  api: PublicReadApi,
  httpClient: FetchHttpClient.layer
});
