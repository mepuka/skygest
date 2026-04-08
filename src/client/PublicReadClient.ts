import { Effect } from "effect";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import { PublicReadApi } from "../api/PublicReadApi";

export const makePublicReadClient = (baseUrl: string | URL) =>
  HttpApiClient.make(PublicReadApi, { baseUrl });

export type PublicReadClient = HttpApiClient.ForApi<typeof PublicReadApi>;
