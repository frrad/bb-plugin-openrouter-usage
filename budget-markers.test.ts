import assert from "node:assert/strict";
import { test } from "node:test";
import { markerBackground, percentFromText } from "./budget-markers.ts";

test("percent comes from the money or percent figure beside a bar", () => {
  assert.equal(percentFromText("$32.76 / $3.23"), (32.76 / 3.23) * 100);
  assert.equal(percentFromText("$1,250.00 / $100"), 1250);
  assert.equal(percentFromText("1016%"), 1016);
  assert.equal(percentFromText("41% used"), 41);
  assert.equal(percentFromText("$5 / $0"), null);
  assert.equal(percentFromText("3d"), null);
  assert.equal(percentFromText("Today $32.76"), null);
});

test("the line sits at budget / spend of the bar", () => {
  assert.equal(markerBackground(100), null);
  assert.equal(markerBackground(41), null);
  assert.equal(markerBackground(Number.NaN), null);
  const background = markerBackground(400)!;
  assert.match(background, /calc\(25% - 1px\)/u);
  assert.match(background, /calc\(25% \+ 1px\)/u);
  assert.match(markerBackground(1016)!, /calc\(9\.843% - 1px\)/u);
});
