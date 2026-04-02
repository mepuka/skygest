import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import {
  PublicReadRequestSchemas,
  PublicReadResponseSchemas,
  ApiErrorSchemas
} from "../domain/api";

export const PublicReadApi = HttpApi.make("public-read")
  .add(
    HttpApiGroup.make("posts")
      .add(
        HttpApiEndpoint.get("search", "/posts/search", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.searchPosts,
          success: PublicReadResponseSchemas.postsPage,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("recent", "/posts/recent", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.recentPosts,
          success: PublicReadResponseSchemas.postsPage,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("explainTopics", "/posts/:uri/topics", {
          disableCodecs: true,
          params: PublicReadRequestSchemas.postUriPath,
          success: PublicReadResponseSchemas.explainedTopics,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("thread", "/posts/:uri/thread", {
          disableCodecs: true,
          params: PublicReadRequestSchemas.postUriThreadPath,
          query: PublicReadRequestSchemas.thread,
          success: PublicReadResponseSchemas.thread,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("enrichments", "/posts/:uri/enrichments", {
          disableCodecs: true,
          params: PublicReadRequestSchemas.postUriPath,
          success: PublicReadResponseSchemas.enrichments,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("curated", "/posts/curated", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.curatedFeed,
          success: PublicReadResponseSchemas.curatedPostsPage,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("links")
      .add(
        HttpApiEndpoint.get("list", "/links", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.links,
          success: PublicReadResponseSchemas.linksPage,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("experts")
      .add(
        HttpApiEndpoint.get("list", "/experts", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.experts,
          success: PublicReadResponseSchemas.experts,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("posts", "/experts/:did/posts", {
          disableCodecs: true,
          params: PublicReadRequestSchemas.expertPath,
          query: PublicReadRequestSchemas.expertPosts,
          success: PublicReadResponseSchemas.postsPage,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("publications")
      .add(
        HttpApiEndpoint.get("list", "/publications", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.publications,
          success: PublicReadResponseSchemas.publications,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("topics")
      .add(
        HttpApiEndpoint.get("list", "/topics", {
          disableCodecs: true,
          query: PublicReadRequestSchemas.topics,
          success: PublicReadResponseSchemas.topics,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("get", "/topics/:slug", {
          disableCodecs: true,
          params: PublicReadRequestSchemas.topicPath,
          success: PublicReadResponseSchemas.topic,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("expand", "/topics/:slug/expand", {
          disableCodecs: true,
          params: PublicReadRequestSchemas.topicPath,
          query: PublicReadRequestSchemas.expandTopic,
          success: PublicReadResponseSchemas.expandedTopics,
          error: ApiErrorSchemas
        })
      )
  )
  .prefix("/api");
