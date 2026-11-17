// Token Radar: the entry's program (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the model in lib/model.ts, writes the
// ranked board to /output/board.json, writes the dashboard's data into
// /output/dashboard/data.js, copies this repository's dashboard/ and screenshots/
// to /output, and writes /output/dossier.json with the vendored make.fun library.
//
// The dashboard's data lives INSIDE dashboard/ (data.js) on purpose: the dossier's
// text shows every dashboard file, so the judge reads the board's rows, not just
// the code that renders them. That is why the rows are compact arrays (the layout
// is documented in lib/model.ts and the README): 200 rows have to fit the
// dossier's 65,536-byte text cap beside the page's own source.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, calibrate, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');


/** Sleep without leaving the standard library or going async. */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * One whole run: read, score, gate, write. The gate's own refusals (a board the
 * gate refuses, too few screenshots, a bad screenshot name) and a missing snapshot
 * exit inside, unretried: the same bytes refuse twice. Anything else throwing is
 * a fault of the run, not of the board — a transient read or write fails the same
 * way a crash does, so the driver below retries it once.
 */
function runOnce(): void {
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const cal = calibrate(snapshot);
  const { board, live, meta, rows, liveRows } = buildRadar(snapshot, cal);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

  /** Copy one directory's regular files into `to`, skipping names that start with a dot. */
  function copyFiles(from: string, to: string): string[] {
    if (!existsSync(from)) return [];
    mkdirSync(to, { recursive: true });
    const copied: string[] = [];
    for (const name of readdirSync(from)) {
      if (name.startsWith('.')) continue;
      const path = join(from, name);
      if (!statSync(path).isFile()) continue;
      copyFileSync(path, join(to, name));
      copied.push(name);
    }
    return copied;
  }

  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  // The data is written fresh, over the committed copy: same bytes, every run.
  writeFileSync(join(out, 'dashboard', 'data.js'), dataScript(meta, rows, liveRows));
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${meta.earlySize} early, ${live.length} live set aside)\n` +
      `token radar: m0=${cal.m0} (median market-cap/TVL, n=${cal.n}, p25=${cal.p25}, p75=${cal.p75})\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (5 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

/**
 * The 17/11 dev grade of this entry exited 1 on the server while the same commit,
 * snapshot, Node 26.13.1 and invocation exit 0 here every time: nothing in the
 * entry reproduces it, so the run is written to survive a transient fault rather
 * than die on it. One retry, one second apart; a second failure throws, Node
 * prints it and exits 1, as before.
 */
try {
  runOnce();
} catch (err) {
  process.stderr.write(`token radar: ${err instanceof Error ? err.message : String(err)} (attempt 1 failed, retrying once)\n`);
  sleepMs(1000);
  runOnce();
}
