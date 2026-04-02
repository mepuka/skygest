/**
 * Effect 4 stub for `BunContext.layer` which was removed.
 *
 * In tests that don't actually spawn child processes or use platform APIs,
 * we provide stub implementations that throw on any call. Tests that mock
 * `WranglerCli` or `StagingOperatorClient` never hit the real services.
 */
import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, FileSystem, Layer, Path, Stdio, Stream, Terminal } from "effect";

const die = (label: string) => (..._args: Array<any>): any =>
  Effect.die(new Error(`${label} stub: not implemented in tests`));

export const layer = Layer.mergeAll(
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((_command) =>
      Effect.die(new Error("ChildProcessSpawner stub: not implemented in tests"))
    )
  ),
  Layer.succeed(FileSystem.FileSystem, {
    access: die("FileSystem.access"),
    copy: die("FileSystem.copy"),
    copyFile: die("FileSystem.copyFile"),
    chmod: die("FileSystem.chmod"),
    chown: die("FileSystem.chown"),
    exists: die("FileSystem.exists"),
    link: die("FileSystem.link"),
    makeDirectory: die("FileSystem.makeDirectory"),
    makeTempDirectory: die("FileSystem.makeTempDirectory"),
    makeTempDirectoryScoped: die("FileSystem.makeTempDirectoryScoped"),
    makeTempFile: die("FileSystem.makeTempFile"),
    makeTempFileScoped: die("FileSystem.makeTempFileScoped"),
    open: die("FileSystem.open"),
    readDirectory: die("FileSystem.readDirectory"),
    readFile: die("FileSystem.readFile"),
    readFileString: die("FileSystem.readFileString"),
    readLink: die("FileSystem.readLink"),
    realPath: die("FileSystem.realPath"),
    remove: die("FileSystem.remove"),
    rename: die("FileSystem.rename"),
    sink: die("FileSystem.sink"),
    stat: die("FileSystem.stat"),
    stream: die("FileSystem.stream"),
    symlink: die("FileSystem.symlink"),
    truncate: die("FileSystem.truncate"),
    utimes: die("FileSystem.utimes"),
    watch: die("FileSystem.watch"),
    writeFile: die("FileSystem.writeFile"),
    writeFileString: die("FileSystem.writeFileString")
  } as unknown as FileSystem.FileSystem),
  Layer.succeed(Path.Path, {
    sep: "/",
    basename: (p: string) => p.split("/").pop() ?? "",
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || ".",
    extname: (p: string) => { const m = p.match(/\.[^.]+$/); return m ? m[0] : ""; },
    format: () => "",
    fromFileUrl: () => Effect.die(new Error("Path.fromFileUrl stub")),
    isAbsolute: (p: string) => p.startsWith("/"),
    join: (...paths: ReadonlyArray<string>) => paths.join("/"),
    normalize: (p: string) => p,
    parse: () => ({ root: "", dir: "", base: "", ext: "", name: "" }),
    relative: () => "",
    resolve: (...segs: ReadonlyArray<string>) => segs.join("/"),
    toFileUrl: () => Effect.die(new Error("Path.toFileUrl stub")),
    toNamespacedPath: (p: string) => p
  } as unknown as Path.Path),
  Layer.succeed(Terminal.Terminal, {
    columns: Effect.succeed(80),
    readInput: Effect.die(new Error("Terminal.readInput stub")),
    readLine: Effect.die(new Error("Terminal.readLine stub")),
    display: () => Effect.void
  } as unknown as Terminal.Terminal),
  Layer.succeed(Stdio.Stdio, {
    args: Effect.succeed([]),
    stdout: () => die("Stdio.stdout")(),
    stderr: () => die("Stdio.stderr")(),
    stdin: Stream.empty as any
  } as unknown as Stdio.Stdio)
);
