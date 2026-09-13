import assert from "node:assert/strict";
import test from "node:test";
import { truncateSongTitle } from "../text.js";

test("曲名は全角12文字または半角20文字相当で切り詰める", () => {
  assert.equal(truncateSongTitle("あいうえおかきくけこさしす"), "あいうえおかきくけこさし");
  assert.equal(truncateSongTitle("abcdefghijklmnopqrstuv"), "abcdefghijklmnopqrst");
  assert.equal(truncateSongTitle("maimaiでらっくすABCDEFGHIJK"), "maimaiでらっくすABCDE");
});
