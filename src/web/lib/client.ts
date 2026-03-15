import { AtomHttpApi } from "@effect-atom/atom";
import { FetchHttpClient } from "@effect/platform";
import { PublicReadApi } from "../../api/PublicReadApi.ts";

interface SkygestApiId {
  readonly _: unique symbol;
}

export const SkygestApi = AtomHttpApi.Tag<SkygestApiId>()("SkygestApi", {
  api: PublicReadApi,
  httpClient: FetchHttpClient.layer
});
