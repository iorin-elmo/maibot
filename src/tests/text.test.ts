import assert from "node:assert/strict";
import test from "node:test";
import { displayWidth, padDisplayEnd, truncateSongTitle } from "../text.js";

test("曲名は全角12文字または半角20文字相当で切り詰める", () => {
  assert.equal(truncateSongTitle("あいうえおかきくけこさしす"), "あいうえおかきくけこさし");
  assert.equal(truncateSongTitle("abcdefghijklmnopqrstuv"), "abcdefghijklmnopqrst");
  assert.equal(truncateSongTitle("maimaiでらっくすABCDEFGHIJK"), "maimaiでらっくすABCDE");
});

test("monospace padding keeps Japanese and ASCII prefixes aligned", () => {
  assert.equal(displayWidth("\u65b0#01"), 5);
  assert.equal(displayWidth(padDisplayEnd("#01", 5)), 5);
  assert.equal(displayWidth(padDisplayEnd("\u65b0#01", 5)), 5);
});
