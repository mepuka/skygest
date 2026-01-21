import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";

export const app = HttpRouter.empty.pipe(
  HttpRouter.get("/health", HttpServerResponse.text("ok"))
);
