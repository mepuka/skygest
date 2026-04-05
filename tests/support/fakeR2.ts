type StoredObject = {
  readonly body: string;
  readonly httpMetadata: R2HTTPMetadata;
  readonly customMetadata: Record<string, string>;
  readonly uploaded: Date;
};

type FakeR2Options = {
  readonly failPut?: boolean;
  readonly failGet?: boolean;
  readonly failDelete?: boolean;
  readonly failText?: boolean;
};

export const makeStoredObject = (
  body: string,
  metadata?: Partial<Pick<StoredObject, "httpMetadata" | "customMetadata" | "uploaded">>
): StoredObject => ({
  body,
  httpMetadata: metadata?.httpMetadata ?? {},
  customMetadata: metadata?.customMetadata ?? {},
  uploaded: metadata?.uploaded ?? new Date()
});

export const createFakeR2Bucket = (options: FakeR2Options = {}) => {
  const objects = new Map<string, StoredObject>();

  const normalizeHttpMetadata = (
    value: Headers | R2HTTPMetadata | undefined
  ): R2HTTPMetadata =>
    value == null || value instanceof Headers ? {} : value;

  const toMetadataObject = (key: string, object: StoredObject) =>
    ({
      key,
      version: "v1",
      size: object.body.length,
      etag: "etag",
      httpEtag: '"etag"',
      uploaded: object.uploaded,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      storageClass: "Standard",
      checksums: {}
    }) as R2Object;

  const bucket = {
    put: async (
      key: string,
      value: string,
      putOptions?: R2PutOptions
    ) => {
      if (options.failPut === true) {
        throw new Error("forced put failure");
      }

      const object = makeStoredObject(value, {
        httpMetadata: normalizeHttpMetadata(putOptions?.httpMetadata),
        ...(putOptions?.customMetadata === undefined
          ? {}
          : { customMetadata: putOptions.customMetadata })
      });
      objects.set(key, object);
      return toMetadataObject(key, object);
    },
    get: async (key: string) => {
      if (options.failGet === true) {
        throw new Error("forced get failure");
      }

      const object = objects.get(key);
      if (object === undefined) {
        return null;
      }

      return {
        ...toMetadataObject(key, object),
        body: new Response(object.body).body,
        text: async () => {
          if (options.failText === true) {
            throw new Error("forced text failure");
          }

          return object.body;
        },
        json: async () => JSON.parse(object.body),
        arrayBuffer: async () => new TextEncoder().encode(object.body).buffer
      } as R2ObjectBody;
    },
    head: async (key: string) => {
      const object = objects.get(key);
      return object === undefined ? null : toMetadataObject(key, object);
    },
    delete: async (key: string) => {
      if (options.failDelete === true) {
        throw new Error("forced delete failure");
      }

      objects.delete(key);
    }
  } as R2Bucket;

  return {
    bucket,
    objects
  };
};
