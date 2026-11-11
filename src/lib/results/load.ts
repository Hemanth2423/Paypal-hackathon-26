// Reads the current run's ledger and builds its report (F5). Shared by the Results API, its CSV export and the analyst.
// The report is rebuilt only when the run's state or its ledger file changes.

import { statSync } from "node:fs";
import { getRunner } from "../run/runner";
import { Ledger } from "../run/ledger";
import { buildReport, type Report } from "./report";

export type LoadedReport = { report: Report; runId: string } | { report: null; reason: "no_run" };

let memo: { key: string; value: LoadedReport } | null = null;

// Changes whenever the run moves on or its ledger grows: a run ID, status, day and the ledger file's size and time.
export function reportKey(): string | null {
  const runner = getRunner();
  const s = runner.state();
  if (!s.runId || !s.startDate || s.status === "idle") return null;
  let size = 0;
  let mtime = 0;
  try {
    const st = statSync(runner.ledgerFile(s.runId));
    size = st.size;
    mtime = st.mtimeMs;
  } catch {
    // no ledger yet
  }
  return `${s.runId}|${s.status}|${s.nextDay}|${size}|${mtime}`;
}

export function loadReport(): LoadedReport {
  const key = reportKey();
  if (!key) return { report: null, reason: "no_run" };
  if (memo?.key === key) return memo.value;
  const runner = getRunner();
  const s = runner.state();
  const ledger = new Ledger(runner.ledgerFile(s.runId));
  const value: LoadedReport = {
    runId: s.runId!,
    report: buildReport(ledger.records, {
      status: s.status,
      startDate: s.startDate!,
      lengthDays: s.lengthDays,
      windowDays: s.windowDays,
      nextDay: s.nextDay,
      gateway: s.gateway,
      stop: s.stop,
    }),
  };
  memo = { key, value };
  return value;
}
