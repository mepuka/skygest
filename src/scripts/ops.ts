import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";
import { runOpsCli } from "../ops/Cli";
import { OperatorSecret } from "../ops/OperatorSecret";
import { StagingOperatorClient } from "../ops/StagingOperatorClient";
import { WranglerCli } from "../ops/WranglerCli";

// Scraper layer is provided lazily per twitter command in Cli.ts via ScraperLayer.ts
// to avoid HttpClient service tag conflicts with StagingOperatorClient's FetchHttpClient.
const appLayer = Layer.mergeAll(
  BunServices.layer,
  WranglerCli.live.pipe(Layer.provide(BunServices.layer)),
  OperatorSecret.live,
  StagingOperatorClient.live
);

Effect.suspend(() => runOpsCli(process.argv)).pipe(
  Effect.provide(appLayer),
  BunRuntime.runMain
);
