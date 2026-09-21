import assert from "node:assert/strict";
import test from "node:test";
import { plateByName, progressKindSatisfied } from "../progress.js";

test("plate names resolve to their version and objective", () => {
  assert.deepEqual(plateByName("熊神"), { name: "熊神", label: "maimai でらっくす", versions: ["maimaiでらっくす"], goal: "AP", excludedTitles: ["前前前世"] });
  assert.equal(plateByName("存在しない神"), undefined);
});

test("progress requirements accept higher combo and rank states", () => {
  const score = { title: "Song", difficulty: "MASTER", rating: 0, achievements: 100.5, comboStatus: "AP+" as const, syncStatus: "FDX" as const };
  assert.equal(progressKindSatisfied(score, "AP"), true);
  assert.equal(progressKindSatisfied(score, "FC+"), true);
  assert.equal(progressKindSatisfied(score, "SSS+"), true);
  assert.equal(progressKindSatisfied(score, "FDX"), true);
});
