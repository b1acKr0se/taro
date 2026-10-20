/**
 * `node bench/run.ts --plugin <checkout> --task <name> --out <dir> [--owner-model <id>]
 * [--subagent-models <ids>] [--max-minutes N] [--max-usd N]`: one ticket end to end on a throwaway
 * Paseo daemon with the plugin from a detached copy of a checkout, a model playing the user, and a score
 * at the end (`<dir>/result.json`). See bench/README.md. Runs under Node type stripping: erasable
 * syntax, `.ts` import extensions, no packages.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { startDecider } from "./decider.ts";
import { BENCH_ROOT, cleanup, ensureDirectory, installPlugin, makePluginCopy, makeThrowaway, paseoArgs, pickPort, rpc, scratchDirectory, seedRepository, startDaemon, waitForThreads, type Throwaway } from "./daemon.ts";
import { run } from "./process.ts";
import { conformanceOf, countRecords, loggedViolations, runHidden, scoreQuestions, scoreStats, type TicketStatsLike } from "./score.ts";
import type { ResultFile } from "./report.ts";

const PROJECT = "notes-app";
const PREFIX = "NA";
const MANAGER_MODEL = "claude/claude-sonnet-5-5";
const DEFAULT_OWNER_MODEL = "claude/claude-opus-5-5";
const DEFAULT_SUBAGENT_MODELS = ["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"];

interface Options {
  plugin: string;
  task: string;
  out: string;
  ownerModel: string;
  subagentModels: string[];
  maxMinutes: number;
  maxUsd: number;
  playwright: string;
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) throw new Error(`bad arguments near ${flag ?? "the end"}`);
    values.set(flag.slice(2), value);
  }
  const need = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value === "") throw new Error(`--${name} is required`);
    return value;
  };
  const playwright = process.env.PLAYWRIGHT ?? "";
  if (playwright === "") throw new Error("set PLAYWRIGHT to a Playwright module directory, as tools/shot.cjs takes it");
  return {
    plugin: resolve(need("plugin")),
    task: need("task"),
    out: resolve(need("out")),
    ownerModel: values.get("owner-model") ?? DEFAULT_OWNER_MODEL,
    subagentModels: values.get("subagent-models")?.split(",").map((model) => model.trim()).filter((model) => model !== "") ?? DEFAULT_SUBAGENT_MODELS,
    maxMinutes: Number(values.get("max-minutes") ?? 90),
    maxUsd: Number(values.get("max-usd") ?? 25),
    playwright,
  };
}

function ownerPrompt(facts: { ticket: string; skill: string; repository: string; tracker: string; models: string[]; brief: string }): string {
  return [
    `You are the Taro task owner for ${facts.ticket}. Read ${facts.skill}/SKILL.md, ${facts.skill}/roles/owner.md and ${facts.skill}/reference/shell.md now.`,
    "",
    "Project facts:",
    `- project: ${PROJECT}; repository: ${facts.repository}; base branch: main`,
    `- tracker: ${facts.tracker}; skill: ${facts.skill}`,
    "- delivery: local-only; accept also merges: yes",
    `- models you may give subagents: ${facts.models.join(", ")}`,
    "",
    "Standing orders: none.",
    "",
    "Brief:",
    facts.brief,
  ].join("\n");
}

function readStats(throwaway: Throwaway, ticket: string): TicketStatsLike | null {
  const path = join(throwaway.home, "plugin-data", "taro", "state", "stats.json");
  if (!existsSync(path)) return null;
  try {
    const file = JSON.parse(readFileSync(path, "utf8")) as { tickets?: Record<string, TicketStatsLike> };
    return file.tickets?.[`${PROJECT}:${ticket}`] ?? null;
  } catch {
    return null;
  }
}

function ticketFile(tracker: string, ticket: string): string | null {
  const path = join(tracker, "tickets", `${ticket}.md`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const statusOf = (text: string | null): string => (text === null ? "?" : (/^status:\s*"([^"]+)"/m.exec(text)?.[1] ?? "?"));

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const taskDirectory = join(BENCH_ROOT, "bench", "tasks", options.task);
  if (!existsSync(join(taskDirectory, "brief.md"))) throw new Error(`no task ${options.task} under bench/tasks`);
  ensureDirectory(options.out);
  const runLog = (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    appendFileSync(join(options.out, "run.log"), `${stamped}\n`);
  };

  const sha = (await run("git", ["-C", options.plugin, "rev-parse", "HEAD"])).stdout.trim();
  if (sha === "") throw new Error(`${options.plugin} is not a git checkout`);
  const throwaway = makeThrowaway(options.plugin);
  let stop: ResultFile["stop"] = "error";
  // One cleanup however many callers (the end of the run, an error, Ctrl-C): later callers wait for the same one.
  let cleaning: Promise<{ leftoverProcesses: string[]; removed: string[] }> | null = null;
  const finish = (): Promise<{ leftoverProcesses: string[]; removed: string[] }> => {
    cleaning ??= cleanup(throwaway, runLog).then((outcome) => {
      runLog(`cleanup: removed ${outcome.removed.length} folders; leftover processes: ${outcome.leftoverProcesses.length === 0 ? "none" : outcome.leftoverProcesses.join(" | ")}`);
      return outcome;
    });
    return cleaning;
  };
  const onSignal = (signal: string): void => {
    runLog(`${signal}: cleaning up`);
    finish().then(
      () => process.exit(130),
      (error) => {
        runLog(`cleanup failed: ${String(error)}`);
        process.exit(131);
      },
    );
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const started = Date.now();
  let decider: ReturnType<typeof startDecider> | null = null;
  let ticket = "";
  let tracker = "";
  try {
    await waitForThreads(runLog);
    throwaway.home = scratchDirectory(throwaway, "home");
    throwaway.deciderDirectory = scratchDirectory(throwaway, "decider");
    throwaway.port = await pickPort();
    runLog(`plugin ${options.plugin} at ${sha.slice(0, 12)}; port ${throwaway.port}; home ${throwaway.home}`);
    await makePluginCopy(throwaway, sha);
    await seedRepository(throwaway, join(taskDirectory, "repo"));
    await startDaemon(throwaway);
    await installPlugin(throwaway);
    runLog("daemon and plugin are up");

    await rpc(throwaway, "taro.project.onboard", {
      project: PROJECT,
      settings: {
        repoPath: throwaway.repository,
        baseBranch: "main",
        ticketPrefix: PREFIX,
        manager: { model: MANAGER_MODEL, thinking: "" },
        owner: { model: options.ownerModel, thinking: "" },
        subagentModels: options.subagentModels,
        delivery: "local-only",
        acceptAlsoMerges: true,
        notify: false,
      },
      startManager: false,
    });
    const config = JSON.parse(readFileSync(join(throwaway.home, "plugin-data", "taro", "home", "projects", PROJECT, "taro.json"), "utf8")) as { paseoProjectId: string };
    tracker = join(throwaway.home, "plugin-data", "taro", "home", "projects", PROJECT, "tracker");
    const brief = readFileSync(join(taskDirectory, "brief.md"), "utf8").trim();
    const title = (JSON.parse(readFileSync(join(taskDirectory, "task.json"), "utf8")) as { title: string }).title;
    const created = await run(join(BENCH_ROOT, "bin", "taro"), ["ticket", "create", title, "-d", brief, "--tracker", tracker, "--plain"]);
    ticket = /\b([A-Z]+-\d+)\b/.exec(created.stdout)?.[1] ?? "";
    if (ticket === "") throw new Error(`could not file the ticket: ${created.stdout} ${created.stderr}`);
    runLog(`filed ${ticket}: ${title}`);

    // The owner is started as the manager starts it (skill/reference/paseo.md, "A task owner").
    const slug = ticket.toLowerCase();
    const skill = join(throwaway.pluginCopy, "skill");
    const workspaceResult = await run("paseo", ["workspace", "create", "--isolation", "worktree", "--path", throwaway.repository, "--project", config.paseoProjectId, "--new-branch", `taro/${slug}`, "--base", "main", "--worktree-slug", slug, "--title", `${ticket} · ${title}`, "--json", ...paseoArgs(throwaway)], { timeoutMs: 120_000 });
    if (workspaceResult.code !== 0) throw new Error(`workspace create failed: ${workspaceResult.stderr || workspaceResult.stdout}`);
    const workspace = JSON.parse(workspaceResult.stdout) as { workspaceId?: string; cwd?: string; id?: string };
    const workspaceId = workspace.workspaceId ?? workspace.id ?? "";
    const prompt = ownerPrompt({ ticket, skill, repository: throwaway.repository, tracker, models: options.subagentModels, brief });
    const ownerResult = await run(
      "paseo",
      ["run", "-d", "--workspace", workspaceId, "--provider", options.ownerModel, "--mode", "bypassPermissions", "--title", `${ticket} · ${title}`, "--label", `taro.project=${PROJECT}`, "--label", "taro.role=owner", "--label", `taro.ticket=${ticket}`, "--env", `TARO_TRACKER=${tracker}`, "--env", `TARO_PROJECT=${PROJECT}`, "--env", `TARO_SKILL=${skill}`, "--json", ...paseoArgs(throwaway), prompt],
      { timeoutMs: 180_000 },
    );
    if (ownerResult.code !== 0) throw new Error(`owner start failed: ${ownerResult.stderr || ownerResult.stdout}`);
    const ownerId = (JSON.parse(ownerResult.stdout) as { agentId?: string; id?: string }).agentId ?? (JSON.parse(ownerResult.stdout) as { id?: string }).id ?? "";
    await run(join(BENCH_ROOT, "bin", "taro"), ["ticket", "edit", ticket, "--append-notes", `EXECUTION ${new Date().toISOString().slice(0, 16)}Z — owner ${ownerId}, model ${options.ownerModel}, workspace ${workspaceId}, worktree ${workspace.cwd ?? ""}, branch taro/${slug}, host bench`, "--tracker", tracker]);
    runLog(`owner ${ownerId} started in ${workspaceId}`);

    decider = startDecider({ throwaway, project: PROJECT, ticket, tracker, spec: readFileSync(join(taskDirectory, "spec.md"), "utf8"), brief, playwright: options.playwright, out: options.out, log: runLog });

    const deadline = started + options.maxMinutes * 60_000;
    for (;;) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10_000));
      const text = ticketFile(tracker, ticket);
      const stats = readStats(throwaway, ticket);
      const cost = stats === null ? 0 : scoreStats(stats, new Date()).costUsd;
      if (statusOf(text) === "Done") {
        stop = "done";
        break;
      }
      if (cost > options.maxUsd) {
        stop = "cost";
        runLog(`cost $${cost.toFixed(2)} is over the cap $${options.maxUsd}`);
        break;
      }
      if (Date.now() > deadline) {
        stop = "time";
        runLog(`${options.maxMinutes} minutes are up`);
        break;
      }
      if (decider.failed() !== null) throw new Error(`the decider failed: ${decider.failed()}`);
    }

    await decider.stop();
    // Give the plugin a moment to write the last stats and records.
    await new Promise((resolveWait) => setTimeout(resolveWait, 4000));
    const finalText = ticketFile(tracker, ticket) ?? "";
    writeFileSync(join(options.out, "ticket.md"), finalText);
    const stats = readStats(throwaway, ticket);
    if (stats !== null) writeFileSync(join(options.out, "stats.json"), JSON.stringify(stats, null, 2));
    const scored = stats === null ? null : scoreStats(stats, new Date());
    let hidden: ResultFile["hidden"] = null;
    if (stop === "done") {
      const outcome = await runHidden(throwaway.repository, taskDirectory);
      hidden = outcome.score;
      writeFileSync(join(options.out, "hidden-output.txt"), outcome.output);
    }
    const deciderLog = existsSync(join(options.out, "decider.log")) ? readFileSync(join(options.out, "decider.log"), "utf8") : "";
    const result: ResultFile = {
      task: options.task,
      arm: { checkout: options.plugin, sha },
      models: { owner: options.ownerModel, subagents: options.subagentModels },
      stop,
      wallMs: Date.now() - started,
      costUsd: scored?.costUsd ?? 0,
      byRole: scored?.byRole ?? {},
      hidden,
      questions: scoreQuestions(deciderLog),
      conformance: conformanceOf(finalText, stats?.nudges ?? 0, false, stats?.transitions ?? []),
      records: countRecords(finalText),
      cardFailures: loggedViolations(deciderLog),
    };
    writeFileSync(join(options.out, "result.json"), `${JSON.stringify({ ...result, timePerStatusMs: scored?.timePerStatusMs ?? {}, decisions: scored?.decisions ?? 0, nudges: scored?.nudges ?? 0, recoveries: scored?.recoveries ?? 0 }, null, 2)}\n`);
    runLog(`done: stop ${stop}, cost $${result.costUsd.toFixed(2)}, hidden ${hidden === null ? "not run" : `${hidden.passed}/${hidden.total}`}`);
  } catch (error) {
    runLog(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    stop = "error";
    // A run that failed still leaves a result, so the report shows it as an error rather than missing.
    writeFileSync(join(options.out, "result.json"), `${JSON.stringify({ task: options.task, arm: { checkout: options.plugin, sha }, models: { owner: options.ownerModel, subagents: options.subagentModels }, stop, wallMs: Date.now() - started, costUsd: 0, byRole: {}, hidden: null, questions: { asked: 0, preferenceHits: 0, redundant: 0 }, conformance: [], records: { RISKS: 0, RULING: 0, EVIDENCE: 0, FINAL: 0 }, cardFailures: [] }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    if (decider !== null) await decider.stop().catch(() => undefined);
    const outcome = await finish();
    if (outcome.leftoverProcesses.length > 0) process.exitCode = 1;
  }
}

await main();
