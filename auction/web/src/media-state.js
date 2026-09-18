// Pure policy functions shared by the UI and tests. Desired mode is independent
// from actual track availability and the viewer's bandwidth preference.
export function publishingPolicy(mode, connected, safe = false) {
  return {
    camera: connected && mode === "live" && !safe,
    microphone: connected && mode !== "recorded",
  };
}
export function visualMode({
  joined,
  mode,
  videoHealthy,
  preferImage,
  youtubeFailed,
}) {
  if (!joined || preferImage || mode === "image") return "image";
  if (mode === "live" && videoHealthy) return "live";
  return youtubeFailed ? "image" : "recorded";
}
export function audioAllowed(mode) {
  return mode !== "recorded";
}
