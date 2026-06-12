import test from "node:test";
import assert from "node:assert/strict";
import {
  exactMaxPayout,
  makeBreakoutNote,
  makeLadderNote,
  makeRangeNote,
  payoffAt,
} from "./templates.ts";

test("range note pays only inside (lower, higher]", () => {
  const note = makeRangeNote({ lowerStrike: 60_000n, higherStrike: 70_000n, quantity: 1_000_000n });

  assert.equal(payoffAt(note.legs, 60_000n), 0n);
  assert.equal(payoffAt(note.legs, 60_001n), 1_000_000n);
  assert.equal(payoffAt(note.legs, 70_000n), 1_000_000n);
  assert.equal(payoffAt(note.legs, 70_001n), 0n);
  assert.equal(exactMaxPayout(note.legs), note.maxPayout);
});

test("breakout note pays outside the corridor", () => {
  const note = makeBreakoutNote({ lowerStrike: 60_000n, higherStrike: 70_000n, quantity: 2_000_000n });

  assert.equal(payoffAt(note.legs, 59_999n), 2_000_000n);
  assert.equal(payoffAt(note.legs, 60_000n), 2_000_000n);
  assert.equal(payoffAt(note.legs, 65_000n), 0n);
  assert.equal(payoffAt(note.legs, 70_001n), 2_000_000n);
  assert.equal(exactMaxPayout(note.legs), note.maxPayout);
});

test("ladder note accumulates one payout per crossed strike", () => {
  const note = makeLadderNote({
    strikes: [61_000n, 64_000n, 67_000n],
    quantity: 1_000_000n,
  });

  assert.equal(payoffAt(note.legs, 61_000n), 0n);
  assert.equal(payoffAt(note.legs, 61_001n), 1_000_000n);
  assert.equal(payoffAt(note.legs, 64_001n), 2_000_000n);
  assert.equal(payoffAt(note.legs, 67_001n), 3_000_000n);
  assert.equal(exactMaxPayout(note.legs), note.maxPayout);
});
