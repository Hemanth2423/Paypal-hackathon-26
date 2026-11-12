import { test } from "node:test";
import assert from "node:assert/strict";
import { echoesRules } from "../src/lib/analyst/analyst";

test("detects an answer that repeats the analyst's rules", () => {
  assert.ok(echoesRules("Never state, estimate or imply real-world PayPal or Smart Retries performance."));
  assert.ok(echoesRules("Rules:\n1. Answer only from tool results."));
  assert.equal(echoesRules("Route B recovery rate 40.3% vs Route A 28.2%."), false);
});
