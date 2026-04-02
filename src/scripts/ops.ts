import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, FileSystem, Layer, Path, Runtime, Stdio, Stream, Terminal } from "effect";
import {
  CookieManager,
  GuestAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterTweets
} from "@pooks/twitter-scraper";
import { runOpsCli } from "../ops/Cli";
import { OperatorSecret } from "../ops/OperatorSecret";
import { StagingOperatorClient } from "../ops/StagingOperatorClient";
import { WranglerCli } from "../ops/WranglerCli";

const die = (label: string) => (..._args: Array<any>): any =>
  Effect.die(new Error(`${label}: not used in ops CLI`));

// Twitter scraper layer stack (CLI-only, reads TWITTER_* env vars via Effect Config)
const scraperLayer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterTweets.layer
).pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(TwitterHttpClient.fetchLayer),
  Layer.provideMerge(CookieManager.liveLayer),
  Layer.provideMerge(TwitterConfig.fromEnvLayer)
);

// TODO(effect4): provide a real ChildProcessSpawner implementation for Bun
const wranglerLayer = WranglerCli.live;
const liveLayer = Layer.mergeAll(
  wranglerLayer,
  OperatorSecret.live
).pipe(
  Layer.provideMerge(StagingOperatorClient.live),
  Layer.provideMerge(scraperLayer)
);

// CLI Environment stubs — the ops CLI doesn't use these directly
const cliEnvLayer = Layer.mergeAll(
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((_command) =>
      Effect.die(new Error("ChildProcessSpawner: not used in ops CLI"))
    )
  ),
  Layer.succeed(FileSystem.FileSystem, {
    exists: die("FileSystem.exists"),
    readFileString: die("FileSystem.readFileString"),
    writeFileString: die("FileSystem.writeFileString")
  } as unknown as FileSystem.FileSystem),
  Layer.succeed(Path.Path, {
    sep: "/",
    basename: (p: string) => p.split("/").pop() ?? "",
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || ".",
    extname: () => "",
    format: () => "",
    fromFileUrl: die("Path.fromFileUrl"),
    isAbsolute: (p: string) => p.startsWith("/"),
    join: (...paths: ReadonlyArray<string>) => paths.join("/"),
    normalize: (p: string) => p,
    parse: () => ({ root: "", dir: "", base: "", ext: "", name: "" }),
    relative: () => "",
    resolve: (...segs: ReadonlyArray<string>) => segs.join("/"),
    toFileUrl: die("Path.toFileUrl"),
    toNamespacedPath: (p: string) => p
  } as unknown as Path.Path),
  Layer.succeed(Terminal.Terminal, {
    columns: Effect.succeed(80),
    readInput: Effect.die(new Error("Terminal.readInput: not used")),
    readLine: Effect.die(new Error("Terminal.readLine: not used")),
    display: () => Effect.void
  } as unknown as Terminal.Terminal),
  Layer.succeed(Stdio.Stdio, {
    args: Effect.succeed(process.argv),
    stdout: die("Stdio.stdout"),
    stderr: die("Stdio.stderr"),
    stdin: Stream.empty as any
  } as unknown as Stdio.Stdio)
);

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => process.exit(code)));
});

Effect.suspend(() => runOpsCli(process.argv)).pipe(
  Effect.provide(liveLayer.pipe(Layer.provideMerge(cliEnvLayer))),
  runMain
);
