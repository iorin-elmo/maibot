import assert from "node:assert/strict";
import test from "node:test";
import { renderCandidate } from "../commands.js";

test("候補表示は達成率とランクの桁数に関係なく列がそろう", () => {
  const under100 = renderCandidate({
    score: { title: "Under", difficulty: "MASTER", rating: 290, chartKind: "new", achievements: 99.5, internalLevel: 14.4 },
    nextAchievement: 100, nextRank: "SSS", ratingAtNextRank: 310, ratingGain: 3, achievementGap: 0.5
  }, 0);
  const over100 = renderCandidate({
    score: { title: "Over", difficulty: "MASTER", rating: 310, chartKind: "new", achievements: 100, internalLevel: 14.4 },
    nextAchievement: 100.5, nextRank: "SSS+", ratingAtNextRank: 323, ratingGain: 13, achievementGap: 0.5
  }, 1);

  assert.match(under100, /^#01 \[14\.4\]  99\.5000% → SSS  \(\+ 3\) \/ Under$/);
  assert.match(over100, /^#02 \[14\.4\] 100\.0000% → SSS\+ \(\+13\) \/ Over$/);
  assert.equal(under100.indexOf("%"), over100.indexOf("%"));
  assert.equal(under100.indexOf("→"), over100.indexOf("→"));
  assert.equal(under100.indexOf("(+"), over100.indexOf("(+"));
  assert.equal(under100.indexOf("/ "), over100.indexOf("/ "));
});
