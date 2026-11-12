// Owns the trial run on the server (F4). One runner per process holds a lock, so a second start is refused and
import { setActiveAssumptions } from "../assumptions";
// leaving the page doesn't stop the run. State lives in .data/trial-run.json; .data/trial.json (F3's handoff) is
// read and never written. Pause takes effect at the next day boundary; resume and restart replay the ledger.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConnectError } from "../braintree";
import type { SyncCache } from "../sync";
import type { Trial } from "../trial";
import { runEngine, totalDays, type Audit, type DayEvent, type EngineEvent, type RunSettings } from "./engine";
import { isoDateOfDay } from "./calendar";
import { failuresForDay, trialCustomers, type TrialCustomer } from "./failures";
import type { GatewayKind, TrialGateway } from "./gateway";
import { Ledger } from "./ledger";
import { StandInGateway, standInToken } from "./standin-gateway";
import { BraintreeTrialGateway, loadBraintreeCustomers } from "./braintree-gateway";

export type RunStatus = "idle" | "preparing" | "running" | "pausing" | "paused" | "error" | "stopped" | "complete";

export type RunState = {
  status: RunStatus;
  runId: string | null;
  trialId: string | null;
  gateway: GatewayKind | null;
  startDate: string | null;
  nextDay: number;
  totalDays: number;
  lengthDays: number;
  windowDays: number;
  days: DayEvent[];
  error: { title: string; fix: string } | null;
  stop: { day: number; rule: string; reason: string; discarded?: boolean } | null;
  audit: Audit | null;
  updatedAt: string;
};

export type RunnerOptions = {
  dir?: string; // folder holding .data/ (the app's working directory by default)
  gateway?: () => TrialGateway;
  loadCustomers?: (ids: string[], gateway: TrialGateway, needed: string[]) => Promise<TrialCustomer[]>;
};

type Listener = (e: EngineEvent | { type: "state"; state: RunState }) => void;

const idle = (): RunState => ({
  status: "idle",
  runId: null,
  trialId: null,
  gateway: null,
  startDate: null,
  nextDay: 0,
  totalDays: 0,
  lengthDays: 0,
  windowDays: 0,
  days: [],
  error: null,
  stop: null,
  audit: null,
  updatedAt: new Date().toISOString(),
});

export function gatewayFromEnv(): TrialGateway {
  if (process.env.TRIAL_GATEWAY === "standin") return new StandInGateway();
  return new BraintreeTrialGateway(); // throws a ConnectError naming any missing key
}

async function standInCustomers(ids: string[]): Promise<TrialCustomer[]> {
  return trialCustomers(ids).map((c) => ({ ...c, paymentMethodToken: standInToken(c.customerId), subscriptionId: `standin-sub-${c.customerId}` }));
}

// Customers with a failed renewal during enrollment: the only ones the trial charges.
function chargedCustomers(ids: string[], startDate: string, lengthDays: number): string[] {
  const all = trialCustomers(ids);
  const charged = new Set<string>();
  for (let day = 0; day < lengthDays; day++) for (const f of failuresForDay(all, startDate, day)) charged.add(f.customer.customerId);
  return [...charged];
}


export class TrialRunner {
  private current: RunState;
  private active: Promise<void> | null = null;
  private pauseRequested = false;
  private gateway: TrialGateway | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly dir: string;

  constructor(private readonly opts: RunnerOptions = {}) {
    this.dir = opts.dir ?? ".";
    this.current = this.read() ?? idle();
    // A run the file says was going, with no runner in this process, was interrupted: it resumes from its ledger.
    if (["preparing", "running", "pausing"].includes(this.current.status)) this.current = { ...this.current, status: "paused" };
  }

  private path = (name: string) => join(this.dir, ".data", name);
  private read(): RunState | null {
    try {
      return JSON.parse(readFileSync(this.path("trial-run.json"), "utf8")) as RunState;
    } catch {
      return null;
    }
  }
  private trial(): Trial | null {
    try {
      return JSON.parse(readFileSync(this.path("trial.json"), "utf8")) as Trial;
    } catch {
      return null;
    }
  }
  private save(patch: Partial<RunState>) {
    this.current = { ...this.current, ...patch, updatedAt: new Date().toISOString() };
    mkdirSync(join(this.dir, ".data"), { recursive: true });
    writeFileSync(this.path("trial-run.json"), JSON.stringify(this.current));
    for (const l of this.listeners) l({ type: "state", state: this.current });
  }

  state = () => this.current;
  ledgerFile = (runId = this.current.runId) => this.path(`trial-ledger-${runId}.jsonl`);
  isActive = () => this.active != null;
  settled = () => this.active ?? Promise.resolve();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Starts a new run, or resumes a paused or failed one. Refused while a run is active.
  start(): { ok: true } | { ok: false; status: number; error: string } {
    if (this.active) return { ok: false, status: 409, error: "A trial run is already in progress." };
    const trial = this.trial();
    setActiveAssumptions(trial?.assumptions);
    if (!trial || trial.status !== "running")
      return { ok: false, status: 409, error: "Start the trial from setup first: the trial isn't running yet." };
    const resuming = ["paused", "error"].includes(this.current.status) && this.current.trialId === trial.id;
    if (!resuming && ["complete", "stopped"].includes(this.current.status) && this.current.trialId === trial.id)
      return { ok: false, status: 409, error: "This trial has finished. Reset it to run again." };
    this.pauseRequested = false;
    this.active = this.loop(trial, resuming).finally(() => (this.active = null));
    return { ok: true };
  }

  pause() {
    if (!this.active) return;
    this.pauseRequested = true;
    this.save({ status: "pausing" });
  }

  // Forgets the run so the trial can be run again under a new run ID. The sandbox keeps old runs' sales.
  async reset() {
    if (this.active) {
      this.pause();
      await this.active;
    }
    if (this.current.runId) rmSync(this.ledgerFile(), { force: true });
    rmSync(this.path("trial-run.json"), { force: true });
    this.current = idle();
    for (const l of this.listeners) l({ type: "state", state: this.current });
  }

  private async loop(trial: Trial, resuming: boolean) {
    try {
      const cache = existsSync(this.path("sync-cache.json")) ? (JSON.parse(readFileSync(this.path("sync-cache.json"), "utf8")) as SyncCache) : null;
      if (!cache) throw new ConnectError("No synced merchant data", "Connect the sandbox merchant first, then start the trial again.");
      const runId = resuming && this.current.runId ? this.current.runId : `${trial.id.replace(/^trial-/, "")}-${randomUUID().slice(0, 4)}`;
      const startDate = resuming && this.current.startDate ? this.current.startDate : isoDateOfDay(cache.summary.historyEnd ?? cache.summary.syncedAt.slice(0, 10), 1);
      this.gateway ??= (this.opts.gateway ?? gatewayFromEnv)();
      const gateway = this.gateway;
      this.save({
        status: "preparing",
        runId,
        trialId: trial.id,
        gateway: gateway.kind,
        startDate,
        totalDays: totalDays({ lengthDays: trial.lengthDays, windowDays: trial.recoveryWindowDays }),
        lengthDays: trial.lengthDays,
        windowDays: trial.recoveryWindowDays,
        error: null,
        ...(resuming ? {} : { days: [], nextDay: 0, stop: null, audit: null }),
      });
      const ids = cache.customerIds ?? [];
      const customers = gateway.kind === "standin" ? await standInCustomers(ids) : await (this.opts.loadCustomers ?? loadBraintreeCustomers)(ids, gateway, chargedCustomers(ids, startDate, trial.lengthDays));
      const settings: RunSettings = {
        runId,
        seed: trial.seed,
        splitB: trial.splitB,
        lengthDays: trial.lengthDays,
        windowDays: trial.recoveryWindowDays,
        startDate,
        earlyStop: trial.earlyStop,
        merchantAccountIds: process.env.BRAINTREE_ROUTE_B_ACCOUNT_ID?.trim() ? { B: process.env.BRAINTREE_ROUTE_B_ACCOUNT_ID.trim() } : undefined,
      };
      this.save({ status: "running" });
      const shouldPause = () => this.pauseRequested || this.trial()?.id !== trial.id;
      for await (const e of runEngine(settings, { gateway, customers, ledger: new Ledger(this.ledgerFile(runId)), shouldPause, resume: resuming })) {
        for (const l of this.listeners) l(e);
        if (e.type === "day") this.save({ days: [...this.current.days.filter((d) => d.day < e.day), e], nextDay: e.day + 1 });
        else if (e.type === "paused") {
          if (this.trial()?.id !== trial.id)
            this.save({ status: "stopped", stop: { day: e.nextDay, rule: "Trial discarded", reason: "The trial was discarded or replaced in setup, so the run stopped.", discarded: true } });
          else this.save({ status: "paused", nextDay: e.nextDay });
        } else if (e.type === "stopped") this.save({ status: "stopped", stop: { day: e.day, rule: e.rule, reason: e.reason }, audit: e.audit });
        else this.save({ status: "complete", audit: e.audit, nextDay: this.current.totalDays });
      }
    } catch (err) {
      const e = err instanceof ConnectError ? err : new ConnectError("The trial run stopped on an error", `${(err as Error).message} Resume to continue from the last finished day.`);
      this.save({ status: "error", error: { title: e.title, fix: e.fix } });
    }
  }
}

// One runner per server process.
const g = globalThis as unknown as { __secondmintRunner?: TrialRunner };
export const getRunner = () => (g.__secondmintRunner ??= new TrialRunner());
