import { describe, expect, it } from "@effect/vitest";
import type { State, StateStore } from "alchemy";

import { ENTITY_SEARCH_CUSTOM_METADATA } from "../packages/ontology-store/src/Provisioning";
import {
  AiSearchCustomMetadataDriftError,
  ensureAiSearchCustomMetadataForPhase,
  type AiSearchMetadataClient
} from "../alchemy/ai-search-metadata";

const inMemoryStateStore = (
  initial: Record<string, State> = {}
): {
  store: StateStore;
  data: Map<string, State>;
} => {
  const data = new Map<string, State>(Object.entries(initial));
  const store: StateStore = {
    list: async () => [...data.keys()],
    count: async () => data.size,
    get: async (key) => data.get(key),
    getBatch: async (ids) =>
      Object.fromEntries(
        ids.flatMap((id) => {
          const value = data.get(id);
          return value === undefined ? [] : [[id, value] as const];
        })
      ),
    all: async () => Object.fromEntries(data),
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    }
  };
  return { store, data };
};

const stateOf = (
  resourceId: string,
  output: Record<string, unknown>
): State => ({
  status: "created",
  kind: "cloudflare::AiSearch",
  id: resourceId,
  fqn: `skygest-cloudflare/staging/${resourceId}`,
  seq: 1,
  data: {},
  props: undefined,
  output: output as unknown as State["output"]
});

const instance = (
  customMetadata?: ReadonlyArray<unknown> | null,
  extra?: Readonly<Record<string, unknown>>
) =>
  ({
    id: "instance-id",
    custom_metadata: customMetadata,
    ...extra
  }) as Awaited<ReturnType<AiSearchMetadataClient["getInstance"]>>;

describe("ensureAiSearchCustomMetadataForPhase", () => {
  it("does not call Cloudflare in destroy phase", async () => {
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

  it("treats null custom metadata as missing", async () => {
    const calls: Array<string> = [];
    const client = {
      createApi: async () => ({}),
      getInstance: async () => {
        calls.push("getInstance");
        return instance(null);
      },
      updateInstance: async () => {
        calls.push("updateInstance");
        return instance(ENTITY_SEARCH_CUSTOM_METADATA);
      }
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "up",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });

    expect(calls).toEqual(["getInstance", "updateInstance"]);
  });

  it("omits null instance fields from the update payload", async () => {
    let payload: { readonly [key: string]: unknown } | undefined;
    const client = {
      createApi: async () => ({}),
      getInstance: async () =>
        instance(null, {
          source: null,
          type: null,
          metadata: null,
          public_endpoint_params: null,
          source_params: null
        }),
      updateInstance: async (
        _api: unknown,
        _namespace: string,
        _instanceId: string,
        nextPayload: { readonly [key: string]: unknown }
      ) => {
        payload = nextPayload;
        return instance(ENTITY_SEARCH_CUSTOM_METADATA);
      }
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "up",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });

    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty("source");
    expect(payload).not.toHaveProperty("type");
    expect(payload).not.toHaveProperty("metadata");
    expect(payload).not.toHaveProperty("public_endpoint_params");
    expect(payload).not.toHaveProperty("source_params");
    expect(payload?.custom_metadata).toEqual(ENTITY_SEARCH_CUSTOM_METADATA);
  });

  it("reconciles a stale local state file after a successful update", async () => {
    const { store, data } = inMemoryStateStore({
      "entity-search": stateOf("entity-search", { customMetadata: null })
    });
    const client = {
      createApi: async () => ({}),
      getInstance: async () => instance(null),
      updateInstance: async () => instance(ENTITY_SEARCH_CUSTOM_METADATA)
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "up",
      resourceId: "entity-search",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client,
      stateStore: store
    });

    const reconciled = data.get("entity-search");
    expect(reconciled?.output).toMatchObject({
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA
    });
  });

  it("auto-heals state on read when the live instance matches spec", async () => {
    const { store, data } = inMemoryStateStore({
      "entity-search": stateOf("entity-search", { customMetadata: null })
    });
    const calls: Array<string> = [];
    const client = {
      createApi: async () => ({}),
      getInstance: async () => {
        calls.push("getInstance");
        return instance(ENTITY_SEARCH_CUSTOM_METADATA);
      },
      updateInstance: async () => {
        calls.push("updateInstance");
        return instance(ENTITY_SEARCH_CUSTOM_METADATA);
      }
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "read",
      resourceId: "entity-search",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client,
      stateStore: store
    });

    expect(calls).toEqual(["getInstance"]);
    const reconciled = data.get("entity-search");
    expect(reconciled?.output).toMatchObject({
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA
    });
  });

  it("throws drift on read when live custom_metadata diverges from spec", async () => {
    const { store } = inMemoryStateStore({
      "entity-search": stateOf("entity-search", { customMetadata: null })
    });
    const client = {
      createApi: async () => ({}),
      getInstance: async () => instance([]),
      updateInstance: async () => instance(ENTITY_SEARCH_CUSTOM_METADATA)
    } as unknown as AiSearchMetadataClient;

    await expect(
      ensureAiSearchCustomMetadataForPhase({
        phase: "read",
        resourceId: "entity-search",
        namespace: "energy-intel",
        instanceName: "entity-search",
        customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
        client,
        stateStore: store
      })
    ).rejects.toBeInstanceOf(AiSearchCustomMetadataDriftError);
  });

  it("no-ops state reconciliation when no resourceId is provided", async () => {
    const { data } = inMemoryStateStore();
    const client = {
      createApi: async () => ({}),
      getInstance: async () => instance(ENTITY_SEARCH_CUSTOM_METADATA),
      updateInstance: async () => instance(ENTITY_SEARCH_CUSTOM_METADATA)
    } as unknown as AiSearchMetadataClient;

    await ensureAiSearchCustomMetadataForPhase({
      phase: "up",
      namespace: "energy-intel",
      instanceName: "entity-search",
      customMetadata: ENTITY_SEARCH_CUSTOM_METADATA,
      client
    });

    expect(data.size).toBe(0);
  });
});
