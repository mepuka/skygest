import { HttpClientError } from "effect/unstable/http";

export const getResponseStatus = (cause: unknown): number | undefined =>
  HttpClientError.isHttpClientError(cause) ? cause.response?.status : undefined;

export const isHttpStatusError = (
  cause: unknown
): cause is HttpClientError.HttpClientError & {
  readonly reason: HttpClientError.StatusCodeError;
} =>
  HttpClientError.isHttpClientError(cause) &&
  cause.reason._tag === "StatusCodeError";

export const isDecodeError = (cause: unknown): boolean =>
  HttpClientError.isHttpClientError(cause) &&
  cause.reason._tag === "DecodeError";
