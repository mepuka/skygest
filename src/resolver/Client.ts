import { ServiceMap, Effect, Layer, Schema } from "effect";
import {
  ResolveBulkResponse,
  ResolvePostResponse,
  type ResolveBulkRequest as ResolveBulkRequestValue,
  type ResolveBulkResponse as ResolveBulkResponseValue,
  type ResolvePostRequest as ResolvePostRequestValue,
  type ResolvePostResponse as ResolvePostResponseValue
} from "../domain/resolution";
import { ResolverClientError } from "../domain/errors";
import {
  formatSchemaParseError,
  stringifyUnknown,
  stripUndefined
} from "../platform/Json";

export const RESOLVER_REQUEST_ID_HEADER = "x-skygest-request-id";

const decodeResponse = <S extends Schema.Decoder<unknown>>(
  schema: S,
  body: unknown,
  error: ResolverClientError
) =>
  Schema.decodeUnknownEffect(schema)(body).pipe(
    Effect.mapError(
      (decodeError) =>
        new ResolverClientError({
          message: formatSchemaParseError(decodeError),
          status: error.status,
          ...(error.postUri === undefined ? {} : { postUri: error.postUri }),
          ...(error.operation === undefined
            ? {}
            : { operation: error.operation })
        })
    )
  );

const parseJsonBody = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const makeHeaders = (operatorSecret: string, requestId?: string) =>
  stripUndefined({
    "content-type": "application/json",
    authorization: `Bearer ${operatorSecret}`,
    [RESOLVER_REQUEST_ID_HEADER]: requestId
  });

export class ResolverClient extends ServiceMap.Service<
  ResolverClient,
  {
    readonly resolvePost: (
      input: ResolvePostRequestValue,
      options?: { readonly requestId?: string }
    ) => Effect.Effect<ResolvePostResponseValue, ResolverClientError>;
    readonly resolveBulk: (
      input: ResolveBulkRequestValue,
      options?: { readonly requestId?: string }
    ) => Effect.Effect<ResolveBulkResponseValue, ResolverClientError>;
  }
>()("@skygest/ResolverClient") {
  static readonly layerFromFetcher = (fetcher: Fetcher, operatorSecret: string) =>
    Layer.succeed(
      ResolverClient,
      ResolverClient.of({
        resolvePost: (input, options) =>
          Effect.tryPromise({
            try: async () => {
              const response = await fetcher.fetch(
                new Request("https://resolver.internal/v1/resolve/post", {
                  method: "POST",
                  headers: makeHeaders(operatorSecret, options?.requestId),
                  body: JSON.stringify(input)
                })
              );
              const body = await parseJsonBody(response);
              const error = new ResolverClientError({
                message:
                  response.ok
                    ? "invalid resolver response"
                    : (
                        (body as Record<string, unknown> | null)?.message as
                          | string
                          | undefined
                      ) ?? `resolver request failed with ${response.status}`,
                status: response.status,
                postUri: input.postUri,
                operation: "ResolverClient.resolvePost"
              });

              if (!response.ok) {
                throw error;
              }

              return { body, error };
            },
            catch: (cause) =>
              cause instanceof ResolverClientError
                ? cause
                : new ResolverClientError({
                    message: stringifyUnknown(cause),
                    status: 500,
                    postUri: input.postUri,
                    operation: "ResolverClient.resolvePost"
                  })
          }).pipe(
            Effect.flatMap(({ body, error }) =>
              decodeResponse(ResolvePostResponse, body, error)
            )
          ),
        resolveBulk: (input, options) =>
          Effect.tryPromise({
            try: async () => {
              const response = await fetcher.fetch(
                new Request("https://resolver.internal/v1/resolve/bulk", {
                  method: "POST",
                  headers: makeHeaders(operatorSecret, options?.requestId),
                  body: JSON.stringify(input)
                })
              );
              const body = await parseJsonBody(response);
              const firstPostUri = input.posts[0]?.postUri;
              const error = new ResolverClientError({
                message:
                  response.ok
                    ? "invalid resolver bulk response"
                    : (
                        (body as Record<string, unknown> | null)?.message as
                          | string
                          | undefined
                      ) ?? `resolver bulk request failed with ${response.status}`,
                status: response.status,
                ...(firstPostUri === undefined ? {} : { postUri: firstPostUri }),
                operation: "ResolverClient.resolveBulk"
              });

              if (!response.ok) {
                throw error;
              }

              return { body, error };
            },
            catch: (cause) =>
              cause instanceof ResolverClientError
                ? cause
                : new ResolverClientError({
                    message: stringifyUnknown(cause),
                    status: 500,
                    operation: "ResolverClient.resolveBulk"
                  })
          }).pipe(
            Effect.flatMap(({ body, error }) =>
              decodeResponse(ResolveBulkResponse, body, error)
            )
          )
      })
    );
}
