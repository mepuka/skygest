import { describe, expect, it } from "@effect/vitest";

import { ENTITY_SEARCH_CUSTOM_METADATA } from "../packages/ontology-store/src/Provisioning";
import {
  ensureAiSearchCustomMetadataForPhase,
  type AiSearchMetadataClient
} from "../alchemy/ai-search-metadata";

const instance = (customMetadata?: ReadonlyArray<unknown>) =>
  ({
    id: "instance-id",
    custom_metadata: customMetadata
  }) as Awaited<ReturnType<AiSearchMetadataClient["getInstance"]>>;

describe("ensureAiSearchCustomMetadataForPhase", () => {
  it("does not call Cloudflare in read or destroy phases", async () => {
    const calls: Array<string> = [];
    const client = {
      createApi: async () => {
        calls.push("createApi");
        return {};
      },
      getInstance: async () => instance(),
      updateInstance: async () => instance()
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "read",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });
    await ensureAiSearchCustomMetadataForPhase({
      phase: "destroy",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });

    expect(calls).toEqual([]);
  });

  it("skips the update when custom metadata already matches", async () => {
    const calls: Array<string> = [];
    const client = {
      createApi: async () => {
        calls.push("createApi");
        return {};
      },
      getInstance: async () => {
        calls.push("getInstance");
        return instance(ENTITY_SEARCH_CUSTOM_METADATA);
      },
      updateInstance: async () => {
        calls.push("updateInstance");
        return instance();
      }
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "up",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });

    expect(calls).toEqual(["createApi", "getInstance"]);
  });

  it("updates custom metadata after the instance can be loaded", async () => {
    const calls: Array<ReadonlyArray<unknown>> = [];
    const client = {
      createApi: async () => {
        const api = { marker: "api" };
        calls.push(["createApi", api]);
        return api;
      },
      getInstance: async (
        api: unknown,
        namespace: string,
        instanceName: string
      ) => {
        calls.push(["getInstance", api, namespace, instanceName]);
        return instance([]);
      },
      updateInstance: async (
        api: unknown,
        namespace: string,
        instanceId: string,
        payload: { readonly custom_metadata?: ReadonlyArray<unknown> }
      ) => {
        calls.push([
          "updateInstance",
          api,
          namespace,
          instanceId,
          payload.custom_metadata
        ]);
        return instance(payload.custom_metadata);
      }
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "up",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });

    expect(calls).toEqual([
      ["createApi", { marker: "api" }],
      ["getInstance", { marker: "api" }, "energy-intel", "entity-search"],
      [
        "updateInstance",
        { marker: "api" },
        "energy-intel",
        "instance-id",
        ENTITY_SEARCH_CUSTOM_METADATA
      ]
    ]);
  });
});
