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
  stringifyUnknown
} from "../platform/Json";
import type { RpcResult } from "../platform/Rpc";

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

type ResolverRpcError = {
  readonly message: string;
  readonly status: number;
  readonly postUri?: ResolvePostRequestValue["postUri"];
  readonly operation?: string;
};

type ResolverRpcOptions = {
  readonly requestId?: string;
  readonly [RESOLVER_REQUEST_ID_HEADER]?: string;
};

export type ResolverBinding = {
  readonly resolvePost: (
    input: ResolvePostRequestValue,
    options?: ResolverRpcOptions
  ) => Promise<RpcResult<unknown, ResolverRpcError>>;
  readonly resolveBulk: (
    input: ResolveBulkRequestValue,
    options?: ResolverRpcOptions
  ) => Promise<RpcResult<unknown, ResolverRpcError>>;
};

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
  static readonly layerFromBinding = (binding: ResolverBinding) =>
    Layer.succeed(
      ResolverClient,
      ResolverClient.of({
        resolvePost: (input, options) =>
          Effect.tryPromise({
            try: () =>
              binding.resolvePost(input, {
                ...(options?.requestId === undefined
                  ? {}
                  : {
                      requestId: options.requestId,
                      [RESOLVER_REQUEST_ID_HEADER]: options.requestId
                    })
              }),
            catch: (cause) =>
              new ResolverClientError({
                message: stringifyUnknown(cause),
                status: 500,
                postUri: input.postUri,
                operation: "ResolverClient.resolvePost"
              })
          }).pipe(
            Effect.flatMap((result) =>
              result.ok
                ? decodeResponse(
                    ResolvePostResponse,
                    result.value,
                    new ResolverClientError({
                      message: "invalid resolver response",
                      status: 502,
                      postUri: input.postUri,
                      operation: "ResolverClient.resolvePost"
                    })
                  )
                : Effect.fail(
                    new ResolverClientError({
                      message: result.error.message,
                      status: result.error.status,
                      postUri: result.error.postUri ?? input.postUri,
                      operation:
                        result.error.operation ?? "ResolverClient.resolvePost"
                    })
                  )
            )
          ),
        resolveBulk: (input, options) =>
          Effect.tryPromise({
            try: () =>
              binding.resolveBulk(input, {
                ...(options?.requestId === undefined
                  ? {}
                  : {
                      requestId: options.requestId,
                      [RESOLVER_REQUEST_ID_HEADER]: options.requestId
                    })
              }),
            catch: (cause) =>
              new ResolverClientError({
                message: stringifyUnknown(cause),
                status: 500,
                operation: "ResolverClient.resolveBulk"
              })
          }).pipe(
            Effect.flatMap((result) =>
              result.ok
                ? decodeResponse(
                    ResolveBulkResponse,
                    result.value,
                    new ResolverClientError({
                      message: "invalid resolver bulk response",
                      status: 502,
                      operation: "ResolverClient.resolveBulk"
                    })
                  )
                : Effect.fail(
                    new ResolverClientError({
                      message: result.error.message,
                      status: result.error.status,
                      ...(result.error.postUri === undefined
                        ? {}
                        : { postUri: result.error.postUri }),
                      operation:
                        result.error.operation ?? "ResolverClient.resolveBulk"
                    })
                  )
            )
          )
      })
    );
}
