import test from "node:test";
import assert from "node:assert/strict";
import { publishingPolicy, visualMode, audioAllowed } from "./media-state.js";

test("fallback stops camera at publisher and silent mode stops microphone", () => {
  assert.deepEqual(publishingPolicy("live", true), {
    camera: true,
    microphone: true,
  });
  assert.deepEqual(publishingPolicy("audio", true), {
    camera: false,
    microphone: true,
  });
  assert.deepEqual(publishingPolicy("recorded", true), {
    camera: false,
    microphone: false,
  });
  assert.deepEqual(publishingPolicy("live", true, true), {
    camera: false,
    microphone: true,
  });
  assert.deepEqual(publishingPolicy("live", false), {
    camera: false,
    microphone: false,
  });
});
test("missing or frozen live video falls back independently of bidding", () => {
  const base = {
    joined: true,
    mode: "live",
    videoHealthy: true,
    preferImage: false,
    youtubeFailed: false,
  };
  assert.equal(visualMode(base), "live");
  assert.equal(visualMode({ ...base, videoHealthy: false }), "recorded");
  assert.equal(
    visualMode({ ...base, videoHealthy: false, youtubeFailed: true }),
    "image",
  );
  assert.equal(visualMode({ ...base, mode: "recorded" }), "recorded");
  assert.equal(visualMode({ ...base, preferImage: true }), "image");
  assert.equal(visualMode({ ...base, joined: false }), "image");
  assert.equal(audioAllowed("recorded"), false);
  assert.equal(audioAllowed("audio"), true);
});
