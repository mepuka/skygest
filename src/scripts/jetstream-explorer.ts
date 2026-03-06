import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import {
  Clock,
  Console,
  DateTime,
  Duration,
  Effect,
  Logger,
  LogLevel,
  Metric,
  Option,
  pipe,
  Ref,
  Schedule,
  Stream
} from "effect"
import { Jetstream, JetstreamConfig, JetstreamMessage } from "effect-jetstream"
import { encodeJsonString } from "../platform/Json"

// ─────────────────────────────────────────────────────────────────────────────
// Metrics (following ClusterMetrics pattern)
// ─────────────────────────────────────────────────────────────────────────────

const eventCounter = Metric.counter("jetstream_explorer_events", {
  description: "Total events processed"
})

const bytesGauge = Metric.gauge("jetstream_explorer_bytes_total", {
  description: "Total bytes processed"
})

const textBytesGauge = Metric.gauge("jetstream_explorer_bytes_text", {
  description: "Text-only bytes"
})

const embedBytesGauge = Metric.gauge("jetstream_explorer_bytes_embed", {
  description: "Embed bytes"
})

const facetBytesGauge = Metric.gauge("jetstream_explorer_bytes_facet", {
  description: "Facet bytes"
})

// ─────────────────────────────────────────────────────────────────────────────
// Stats Model (immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface Stats {
  readonly eventCount: number
  readonly totalBytes: number
  readonly textOnlyBytes: number
  readonly embedBytes: number
  readonly facetBytes: number
  readonly startTimeMs: number
}

const makeInitialStats = (startTimeMs: number): Stats => ({
  eventCount: 0,
  totalBytes: 0,
  textOnlyBytes: 0,
  embedBytes: 0,
  facetBytes: 0,
  startTimeMs
})

// ─────────────────────────────────────────────────────────────────────────────
// Pure Formatting Functions
// ─────────────────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(2)} MB`

const formatRate = (bytes: number, seconds: number): string => {
  if (seconds === 0) return "0 B/s"
  const rate = bytes / seconds
  return rate < 1024 ? `${rate.toFixed(0)} B/s`
    : rate < 1024 * 1024 ? `${(rate / 1024).toFixed(1)} KB/s`
    : `${(rate / (1024 * 1024)).toFixed(2)} MB/s`
}

// ─────────────────────────────────────────────────────────────────────────────
// Size Calculation (pure)
// ─────────────────────────────────────────────────────────────────────────────

interface Sizes {
  readonly total: number
  readonly text: number
  readonly embed: number
  readonly facets: number
}

const calculateSizes = (record: unknown): Sizes => {
  const r = record as Record<string, unknown> | null
  const fullJson = encodeJsonString(record)
  const text = typeof r?.text === "string" ? r.text : ""
  const embed = r?.embed ? encodeJsonString(r.embed) : ""
  const facets = r?.facets ? encodeJsonString(r.facets) : ""
  return {
    total: fullJson.length,
    text: text.length,
    embed: embed.length,
    facets: facets.length
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats Update (pure function, returns Effect to update metrics)
// ─────────────────────────────────────────────────────────────────────────────

const updateStats = (
  stats: Stats,
  event: JetstreamMessage.JetstreamMessage
): Effect.Effect<Stats> => {
  if (event._tag === "CommitCreate" || event._tag === "CommitUpdate") {
    const sizes = calculateSizes(event.commit.record)
    const newStats: Stats = {
      ...stats,
      eventCount: stats.eventCount + 1,
      totalBytes: stats.totalBytes + sizes.total,
      textOnlyBytes: stats.textOnlyBytes + sizes.text,
      embedBytes: stats.embedBytes + sizes.embed,
      facetBytes: stats.facetBytes + sizes.facets
    }
    return Effect.gen(function* () {
      yield* Metric.increment(eventCounter)
      yield* bytesGauge(Effect.succeed(newStats.totalBytes))
      yield* textBytesGauge(Effect.succeed(newStats.textOnlyBytes))
      yield* embedBytesGauge(Effect.succeed(newStats.embedBytes))
      yield* facetBytesGauge(Effect.succeed(newStats.facetBytes))
      return newStats
    })
  }
  return pipe(
    Metric.increment(eventCounter),
    Effect.as({ ...stats, eventCount: stats.eventCount + 1 })
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Effectful Output (using Effect Console + Clock + DateTime)
// ─────────────────────────────────────────────────────────────────────────────

const printStats = (stats: Stats) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const elapsed = (now - stats.startTimeMs) / 1000
    const eventsPerSec = elapsed > 0 ? stats.eventCount / elapsed : 0
    const separator = "─".repeat(60)

    yield* Console.error(`\n${separator}`)
    yield* Console.error(`📊 STATS (${elapsed.toFixed(1)}s elapsed)`)
    yield* Console.error(separator)
    yield* Console.error(`Events:     ${stats.eventCount} (${eventsPerSec.toFixed(1)}/sec)`)
    yield* Console.error(`Total data: ${formatBytes(stats.totalBytes)} (${formatRate(stats.totalBytes, elapsed)})`)

    if (stats.totalBytes > 0) {
      const textPct = ((stats.textOnlyBytes / stats.totalBytes) * 100).toFixed(1)
      const embedPct = ((stats.embedBytes / stats.totalBytes) * 100).toFixed(1)
      const facetPct = ((stats.facetBytes / stats.totalBytes) * 100).toFixed(1)
      const otherBytes = stats.totalBytes - stats.textOnlyBytes - stats.embedBytes - stats.facetBytes

      yield* Console.error(`  Text:     ${formatBytes(stats.textOnlyBytes)} (${textPct}%)`)
      yield* Console.error(`  Embeds:   ${formatBytes(stats.embedBytes)} (${embedPct}%)`)
      yield* Console.error(`  Facets:   ${formatBytes(stats.facetBytes)} (${facetPct}%)`)
      yield* Console.error(`  Other:    ${formatBytes(otherBytes)}`)
      yield* Console.error(`Avg event:  ${formatBytes(stats.totalBytes / stats.eventCount)}`)
    }
    yield* Console.error(`${separator}\n`)
  })

const outputJsonl = (event: JetstreamMessage.JetstreamMessage) =>
  Effect.gen(function* () {
    if (event._tag === "CommitCreate" || event._tag === "CommitUpdate") {
      const output = {
        _tag: event._tag,
        did: event.did,
        time_us: event.time_us,
        collection: event.commit.collection,
        rkey: event.commit.rkey,
        cid: event.commit.cid,
        record: event.commit.record
      }
      yield* Console.log(encodeJsonString(output))
    } else if (event._tag === "CommitDelete") {
      const output = {
        _tag: event._tag,
        did: event.did,
        time_us: event.time_us,
        collection: event.commit.collection,
        rkey: event.commit.rkey
      }
      yield* Console.log(encodeJsonString(output))
    }
  })

const logEventSample = (event: JetstreamMessage.JetstreamMessage) =>
  Effect.gen(function* () {
    // Use DateTime.formatIso for proper timestamp formatting
    const timestamp = pipe(
      DateTime.unsafeMake(event.time_us / 1000),
      DateTime.formatIso
    )
    yield* Console.error(`\n[${timestamp}] ${event._tag}`)

    if (event._tag === "CommitCreate" || event._tag === "CommitUpdate") {
      const record = event.commit.record as Record<string, unknown>
      const text = String(record?.text ?? "").slice(0, 100)
      yield* Console.error(`  Text: ${text}${text.length >= 100 ? "..." : ""}`)
      yield* Console.error(`  Has embed: ${!!record?.embed}`)
      yield* Console.error(`  Has facets: ${!!record?.facets}`)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// CLI Definition
// ─────────────────────────────────────────────────────────────────────────────

const jsonlOption = Options.boolean("jsonl").pipe(
  Options.withDescription("Output raw JSONL to stdout instead of interactive stats")
)

const limitOption = Options.integer("limit").pipe(
  Options.withDescription("Stop after processing N events"),
  Options.optional
)

const endpointOption = Options.text("endpoint").pipe(
  Options.withDescription("Jetstream WebSocket endpoint"),
  Options.withDefault("wss://jetstream1.us-east.bsky.network/subscribe")
)

const collectionOption = Options.text("collection").pipe(
  Options.withDescription("Collection to filter"),
  Options.withDefault("app.bsky.feed.post")
)

// ─────────────────────────────────────────────────────────────────────────────
// Main Command Handler
// ─────────────────────────────────────────────────────────────────────────────

const runExplorer = (config: {
  readonly jsonl: boolean
  readonly limit: Option.Option<number>
  readonly endpoint: string
  readonly collection: string
}) =>
  Effect.gen(function* () {
    const { jsonl, limit, endpoint, collection } = config

    yield* Console.error(
      jsonl
        ? "JSONL mode: streaming records to stdout..."
        : "Interactive mode: showing stats (use --jsonl for raw output)"
    )
    yield* Console.error(
      `Limit: ${Option.getOrElse(limit, () => "unlimited" as const)} events`
    )
    yield* Console.error(`Endpoint: ${endpoint}`)
    yield* Console.error(`Collection: ${collection}\n`)

    const jetstreamConfig = JetstreamConfig.JetstreamConfig.make({
      endpoint,
      wantedCollections: [collection]
    })

    // Use Clock.currentTimeMillis for start time (Effect-native)
    const startTimeMs = yield* Clock.currentTimeMillis
    const statsRef = yield* Ref.make(makeInitialStats(startTimeMs))

    const streamProgram = Effect.gen(function* () {
      // Background stats printer (every 5 seconds) - only in non-jsonl mode
      if (!jsonl) {
        const statsPrinter = Ref.get(statsRef).pipe(
          Effect.flatMap(printStats),
          Effect.repeat(Schedule.spaced(Duration.seconds(5)))
        )
        yield* Effect.forkScoped(statsPrinter)
      }

      const jetstream = yield* Jetstream.Jetstream
      yield* Console.error("Connected to Jetstream!\n")

      // Base stream with stats update
      let stream = jetstream.stream.pipe(
        Stream.mapEffect((event) =>
          Ref.get(statsRef).pipe(
            Effect.flatMap((oldStats) =>
              updateStats(oldStats, event).pipe(
                Effect.flatMap((newStats) =>
                  Ref.set(statsRef, newStats).pipe(Effect.as(event))
                )
              )
            )
          )
        )
      )

      // Mode-specific processing
      if (jsonl) {
        stream = stream.pipe(Stream.tap(outputJsonl))
      } else {
        stream = stream.pipe(
          Stream.zipWithIndex,
          Stream.tap(([event, idx]) =>
            idx % 100 === 0 ? logEventSample(event) : Effect.void
          ),
          Stream.map(([event]) => event)
        )
      }

      // Apply limit if specified
      const limitedStream = Option.match(limit, {
        onNone: () => stream,
        onSome: (n) => Stream.take(stream, n)
      })

      yield* Stream.runDrain(limitedStream)
    })

    yield* streamProgram.pipe(
      Effect.provide(Jetstream.live(jetstreamConfig)),
      Effect.scoped
    )

    // Print final stats
    const finalStats = yield* Ref.get(statsRef)
    yield* printStats(finalStats)
  })

// ─────────────────────────────────────────────────────────────────────────────
// CLI Assembly
// ─────────────────────────────────────────────────────────────────────────────

const command = Command.make(
  "jetstream-explorer",
  { jsonl: jsonlOption, limit: limitOption, endpoint: endpointOption, collection: collectionOption },
  runExplorer
)

const cli = Command.run(command, {
  name: "Jetstream Explorer",
  version: "1.0.0"
})

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point (Bun)
// ─────────────────────────────────────────────────────────────────────────────

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(BunContext.layer),
  Logger.withMinimumLogLevel(LogLevel.None),
  BunRuntime.runMain
)
