import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  PublicReadRequestSchemas,
  PublicReadResponseSchemas,
  ServiceUnavailableError,
  UnauthorizedError,
  UpstreamFailureError
} from "../domain/api";

export const PublicReadApi = HttpApi.make("public-read")
  .add(
    HttpApiGroup.make("posts")
      .add(
        HttpApiEndpoint.get("search", "/posts/search")
          .setUrlParams(PublicReadRequestSchemas.searchPosts)
          .addSuccess(PublicReadResponseSchemas.postsPage)
      )
      .add(
        HttpApiEndpoint.get("recent", "/posts/recent")
          .setUrlParams(PublicReadRequestSchemas.recentPosts)
          .addSuccess(PublicReadResponseSchemas.postsPage)
      )
      .add(
        HttpApiEndpoint.get("explainTopics", "/posts/:uri/topics")
          .setPath(PublicReadRequestSchemas.postUriPath)
          .addSuccess(PublicReadResponseSchemas.explainedTopics)
      )
  )
  .add(
    HttpApiGroup.make("links")
      .add(
        HttpApiEndpoint.get("list", "/links")
          .setUrlParams(PublicReadRequestSchemas.links)
          .addSuccess(PublicReadResponseSchemas.linksPage)
      )
  )
  .add(
    HttpApiGroup.make("experts")
      .add(
        HttpApiEndpoint.get("list", "/experts")
          .setUrlParams(PublicReadRequestSchemas.experts)
          .addSuccess(PublicReadResponseSchemas.experts)
      )
      .add(
        HttpApiEndpoint.get("posts", "/experts/:did/posts")
          .setPath(PublicReadRequestSchemas.expertPath)
          .setUrlParams(PublicReadRequestSchemas.expertPosts)
          .addSuccess(PublicReadResponseSchemas.postsPage)
      )
  )
  .add(
    HttpApiGroup.make("publications")
      .add(
        HttpApiEndpoint.get("list", "/publications")
          .setUrlParams(PublicReadRequestSchemas.publications)
          .addSuccess(PublicReadResponseSchemas.publications)
      )
  )
  .add(
    HttpApiGroup.make("topics")
      .add(
        HttpApiEndpoint.get("list", "/topics")
          .setUrlParams(PublicReadRequestSchemas.topics)
          .addSuccess(PublicReadResponseSchemas.topics)
      )
      .add(
        HttpApiEndpoint.get("get", "/topics/:slug")
          .setPath(PublicReadRequestSchemas.topicPath)
          .addSuccess(PublicReadResponseSchemas.topic)
      )
      .add(
        HttpApiEndpoint.get("expand", "/topics/:slug/expand")
          .setPath(PublicReadRequestSchemas.topicPath)
          .setUrlParams(PublicReadRequestSchemas.expandTopic)
          .addSuccess(PublicReadResponseSchemas.expandedTopics)
      )
  )
  .prefix("/api")
  .addError(BadRequestError)
  .addError(UnauthorizedError)
  .addError(ForbiddenError)
  .addError(NotFoundError)
  .addError(UpstreamFailureError)
  .addError(ServiceUnavailableError)
  .addError(InternalServerError);
