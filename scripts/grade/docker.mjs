// npm run grade:docker: runs `npm run grade` inside a throwaway Docker
// container, so students' code never runs on your computer. Takes the same
// options as `npm run grade` (except --keep and --root).
//
//   export GH_TOKEN=github_pat_...   # read-only token for public repos
//   npm run grade:docker -- --module 0 --roster ~/cis591/roster.csv \
//     --deadline 2026-10-20T23:59-07:00
//
// The container gets only: GH_TOKEN, GRADING_GOOGLE_GENERATIVE_AI_API_KEY (with --evals),
// the roster and hidden tests (read-only) and the results folder.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const IMAGE = "copper-grader:local";
// Set in Dockerfile.grader; used to remove only this course's old images.
export const IMAGE_LABEL = "org.cis591.role=copper-grader";

// Locks the container down: no extra privileges beyond what the grader needs
// to run each student's code as its own user, and limits on memory and
// processes. Removed when the run ends.
export const CONTAINER_FLAGS = [
  "--rm",
  "--init",
  "--cap-drop=ALL",
  "--cap-add=CHOWN",
  "--cap-add=SETUID",
  "--cap-add=SETGID",
  "--cap-add=KILL",
  "--security-opt=no-new-privileges",
  "--memory=6g",
  "--pids-limit=4096",
];

/** The `docker run` arguments for one grading run. */
export function dockerRunArgs(opts, { root, moduleNumber }) {
  const roster = resolve(opts.roster);
  const out = resolve(
    opts.out ?? join(root, ".grading", `module-${moduleNumber}`),
  );
  const mounts = [
    "-v",
    `${roster}:/input/roster.csv:ro`,
    "-v",
    `${out}:/results`,
  ];
  const grade = [
    "--module",
    String(moduleNumber),
    "--roster",
    "/input/roster.csv",
    "--out",
    "/results",
  ];
  if (opts.hidden) {
    mounts.push("-v", `${resolve(opts.hidden)}:/input/hidden:ro`);
    grade.push("--hidden", "/input/hidden");
  }
  for (const name of ["deadline", "concurrency", "only", "repo-template"]) {
    if (opts[name] !== undefined) grade.push(`--${name}`, opts[name]);
  }
  if (opts["no-cache"]) grade.push("--no-cache");
  // Secrets are passed by name, so their values never appear in arguments.
  const env = ["-e", "GH_TOKEN", "-e", `GRADE_OUT_LABEL=${out}`];
  if (opts.evals) {
    grade.push("--evals");
    env.push("-e", "GRADING_GOOGLE_GENERATIVE_AI_API_KEY");
  }
  return {
    out,
    args: [
      "run",
      ...CONTAINER_FLAGS,
      ...env,
      ...mounts,
      IMAGE,
      "node",
      "scripts/grade/grade.mjs",
      ...grade,
    ],
  };
}

function main() {
  const fail = (message) => {
    console.error(`grade:docker: ${message}`);
    process.exit(1);
  };
  const { values: opts } = parseArgs({
    options: {
      roster: { type: "string" },
      module: { type: "string" },
      deadline: { type: "string" },
      hidden: { type: "string" },
      out: { type: "string" },
      concurrency: { type: "string" },
      evals: { type: "boolean", default: false },
      only: { type: "string" },
      "no-cache": { type: "boolean", default: false },
      "repo-template": { type: "string" },
    },
  });

  const root = process.cwd();
  const course = JSON.parse(
    readFileSync(join(root, "course.config.json"), "utf8"),
  );
  const moduleNumber =
    opts.module === undefined ? course.module : Number(opts.module);

  if (!opts.roster)
    fail("pass --roster <csv> (columns: name, github, vercel_url)");
  if (!existsSync(opts.roster)) fail(`roster not found: ${opts.roster}`);
  if (opts.hidden && !existsSync(opts.hidden))
    fail(`hidden tests folder not found: ${opts.hidden}`);
  if (!process.env.GH_TOKEN)
    fail(
      "set GH_TOKEN to a read-only GitHub token first (see teaching.md, " +
        '"Grading"). Never use your own login token.',
    );
  if (opts.evals && !process.env.GRADING_GOOGLE_GENERATIVE_AI_API_KEY)
    fail(
      "--evals needs GRADING_GOOGLE_GENERATIVE_AI_API_KEY (a grading-only key)",
    );
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0)
    fail("Docker isn't running. Start Docker Desktop and try again.");

  console.log("Building the grading image (fast unless packages changed)…");
  const build = spawnSync(
    "docker",
    ["build", "--quiet", "-f", "Dockerfile.grader", "-t", IMAGE, "."],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (build.status !== 0) fail("building the grading image failed");
  // Each rebuild leaves the previous image behind, untagged. Remove those
  // (only this course's grading images, never other projects').
  spawnSync(
    "docker",
    ["image", "prune", "--force", "--filter", `label=${IMAGE_LABEL}`],
    { stdio: "ignore" },
  );

  const { out, args } = dockerRunArgs(opts, { root, moduleNumber });
  mkdirSync(out, { recursive: true });
  const run = spawnSync("docker", args, { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

if (import.meta.main) main();
