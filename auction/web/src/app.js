import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  ConnectionQuality,
} from "livekit-client";
import { publishingPolicy, visualMode, audioAllowed } from "./media-state.js";

const $ = (id) => document.getElementById(id);
const page =
  location.pathname === "/operator"
    ? "operator"
    : location.pathname === "/broadcast"
      ? "broadcaster"
      : "viewer";
let state,
  stateOnline = false,
  lastHeartbeat = 0,
  room,
  joined = false,
  sessionRole = "";
let videoTrack,
  audioTrack,
  videoHealthy = false,
  lastFrame = 0,
  frameMarker = -1;
let youtube,
  ytReady,
  ytLot,
  ytFailed = false,
  ytTimer,
  ytPlaying = false;
let localSafe = false,
  pendingDegrade = false,
  publishQueue = Promise.resolve(),
  poorTimer,
  wakeLock;
let lastVisual,
  activeBroadcast = false,
  startingBroadcast = false,
  controlsBusy = false;
const modes = {
  live: "Live camera + audio",
  audio: "Lot video + live audio",
  recorded: "Silent lot video",
  image: "Lot image + live audio",
};

function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
async function api(path, data, method = "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
function connected(yes) {
  stateOnline = yes;
  $("state-dot").classList.toggle("connected", yes);
  $("state-status").textContent = yes
    ? "Auction updates connected"
    : "Auction updates reconnecting…";
  updateControls();
  if (!yes && activeBroadcast) {
    localSafe = true;
    pendingDegrade = true;
    syncPublishing();
    $("broadcast-status").textContent =
      "Auction updates lost. Camera stopped; reconnecting.";
  }
}
function updateControls() {
  document
    .querySelectorAll("[data-mode], #change-lot")
    .forEach((el) => (el.disabled = !stateOnline || controlsBusy));
  $("start-broadcast").disabled =
    !stateOnline || activeBroadcast || startingBroadcast;
}
function applyState(next) {
  if (state && next.revision < state.revision) return;
  const previous = state;
  state = next;
  if (!previous) {
    for (const lot of state.lots) {
      const option = document.createElement("option");
      option.value = lot.number;
      option.textContent = `Lot ${String(lot.number).padStart(2, "0")}`;
      $("lot-select").append(option);
    }
  }
  if (!previous || previous.lotNumber !== state.lotNumber) {
    const lot = currentLot();
    const num = String(lot.number).padStart(2, "0");
    $("lot-number").textContent = num;
    $("screen-lot").textContent = `LOT ${num}`;
    $("lot-notes").textContent =
      lot.notes || "Explore the catalogue details below.";
    $("fallback-image").src = lot.photo;
    $("fallback-image").alt = `Photograph of lot ${num}`;
    $("detail-image").src = lot.image;
    $("detail-image").alt = `Catalogue details for lot ${num}`;
    $("detail-link").href = lot.image;
    $("lot-select").value = lot.number;
    ytFailed = false;
    ytPlaying = false;
    clearTimeout(ytTimer);
  }
  document
    .querySelectorAll("[data-mode]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.mode === state.mode)),
    );
  if (
    state.mode === "live" &&
    previous &&
    next.revision !== previous.revision &&
    !pendingDegrade
  )
    localSafe = false;
  if (state.mode !== "live") pendingDegrade = false;
  if (activeBroadcast) {
    syncPublishing();
    if (pendingDegrade && stateOnline)
      degrade(
        "Connection recovered; camera remains off until operator restores live.",
      );
  }
  renderMedia();
}
function currentLot() {
  return state?.lots.find((l) => l.number === state.lotNumber);
}
async function command(mode, lot = state.lotNumber) {
  controlsBusy = true;
  updateControls();
  notice("");
  try {
    applyState(
      await api("/api/control", {
        revision: state.revision,
        lotNumber: Number(lot),
        mode,
      }),
    );
  } catch (error) {
    notice(error.message);
    try {
      applyState(await api("/api/state", undefined, "GET"));
    } catch {
      connected(false);
    }
  } finally {
    controlsBusy = false;
    updateControls();
  }
}

async function loadYouTube() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("YouTube could not load")),
      12000,
    );
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("YouTube unavailable"));
    };
    document.head.append(script);
  });
  return ytReady;
}
function failYouTube() {
  ytFailed = true;
  clearTimeout(ytTimer);
  renderMedia();
}
async function playRecorded() {
  try {
    await loadYouTube();
    if (!state || lastVisual !== "recorded") return;
    const id = currentLot().youtubeId;
    if (!youtube) {
      ytLot = id;
      youtube = new window.YT.Player("youtube-player", {
        videoId: id,
        playerVars: {
          autoplay: 1,
          mute: 1,
          playsinline: 1,
          loop: 1,
          playlist: id,
          origin: location.origin,
          rel: 0,
        },
        events: {
          onReady: () => {
            youtube.mute();
            if (lastVisual !== "recorded") {
              youtube.pauseVideo();
              return;
            }
            ytLot = null;
            playRecorded();
          },
          onError: failYouTube,
          onAutoplayBlocked: failYouTube,
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              ytPlaying = true;
              clearTimeout(ytTimer);
            }
            if (
              event.data === window.YT.PlayerState.ENDED &&
              lastVisual === "recorded"
            ) {
              youtube.seekTo(0);
              youtube.playVideo();
            }
          },
        },
      });
    }
    if (youtube.loadVideoById && ytLot !== id) {
      ytLot = id;
      ytPlaying = false;
      youtube.mute();
      youtube.loadVideoById(id);
    } else if (youtube.playVideo && !ytPlaying) {
      youtube.mute();
      youtube.playVideo();
    }
    if (!ytPlaying && !ytFailed) {
      clearTimeout(ytTimer);
      ytTimer = setTimeout(failYouTube, 15000);
    }
  } catch {
    failYouTube();
  }
}
function renderMedia() {
  if (!state) return;
  if (page === "broadcaster") {
    const pub = room?.localParticipant.getTrackPublication(Track.Source.Camera);
    $("live-video").hidden = !(activeBroadcast && pub?.track && !pub.isMuted);
    $("fallback-image").hidden = !$("live-video").hidden;
    $("visual-label").textContent = !$("live-video").hidden
      ? "PHONE PREVIEW"
      : "CAMERA OFF";
    $("media-status").textContent = `Requested mode: ${modes[state.mode]}`;
    return;
  }
  const visual = visualMode({
    joined,
    mode: state.mode,
    videoHealthy,
    preferImage: $("prefer-image").checked,
    youtubeFailed: ytFailed,
  });
  $("live-video").hidden = visual !== "live";
  $("youtube-wrap").hidden = visual !== "recorded";
  $("fallback-image").hidden = visual !== "image";
  $("visual-label").textContent =
    visual === "live"
      ? "LIVE CAMERA"
      : visual === "recorded"
        ? "RECORDED LOT VIDEO"
        : "LOT IMAGE";
  if (
    visual !== lastVisual ||
    (visual === "recorded" && ytLot !== currentLot().youtubeId)
  ) {
    lastVisual = visual;
    if (visual === "recorded") playRecorded();
    else {
      youtube?.pauseVideo?.();
      ytPlaying = false;
      clearTimeout(ytTimer);
    }
  }
  const hasAudio =
    joined &&
    audioTrack &&
    !audioTrack.isMuted &&
    room?.state === ConnectionState.Connected &&
    audioAllowed(state.mode);
  $("audio-container")
    .querySelectorAll("audio")
    .forEach((el) => (el.muted = !audioAllowed(state.mode)));
  $("enable-audio").hidden = !hasAudio || !!room?.canPlaybackAudio;
  $("retry-video").hidden = !ytFailed || !joined || $("prefer-image").checked;
  $("media-status").textContent = !joined
    ? "Join to watch the auction broadcast."
    : hasAudio
      ? room.canPlaybackAudio
        ? "Live auctioneer audio"
        : "Tap “Enable live audio” to hear the auctioneer"
      : "Live audio unavailable · recorded footage is silent";
}
function subscribePreference() {
  if (!room || page === "broadcaster") return;
  for (const participant of room.remoteParticipants.values())
    for (const pub of participant.videoTrackPublications.values())
      pub.setSubscribed(state?.mode === "live" && !$("prefer-image").checked);
}
function configureViewer(r) {
  r.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
    if (participant.identity !== "venue-phone") return;
    if (track.kind === Track.Kind.Video) {
      videoTrack = track;
      track.attach($("live-video"));
      $("live-video").muted = true;
      lastFrame = 0;
      frameMarker = -1;
    }
    if (track.kind === Track.Kind.Audio) {
      audioTrack = track;
      const el = track.attach();
      el.autoplay = true;
      $("audio-container").replaceChildren(el);
    }
    renderMedia();
  });
  r.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => {
      if (el.tagName === "AUDIO") el.remove();
    });
    if (track === videoTrack) {
      videoTrack = null;
      videoHealthy = false;
    }
    if (track === audioTrack) audioTrack = null;
    renderMedia();
  });
  r.on(RoomEvent.TrackPublished, subscribePreference);
  for (const event of [
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.ParticipantDisconnected,
    RoomEvent.AudioPlaybackStatusChanged,
  ])
    r.on(event, () => {
      videoHealthy = false;
      renderMedia();
    });
  r.on(RoomEvent.Reconnecting, () => {
    videoHealthy = false;
    renderMedia();
  });
  r.on(RoomEvent.Disconnected, () => {
    joined = false;
    videoTrack = null;
    audioTrack = null;
    videoHealthy = false;
    $("join").disabled = false;
    $("join").textContent = "Reconnect to broadcast";
    renderMedia();
  });
}
async function joinViewer() {
  $("join").disabled = true;
  notice("");
  try {
    await room?.disconnect();
    const credentials = await api("/api/token", { publish: false });
    room = new Room({ adaptiveStream: false, dynacast: false });
    configureViewer(room);
    await room.connect(credentials.url, credentials.token);
    joined = true;
    await room.startAudio().catch(() => {});
    subscribePreference();
    $("join").textContent = "Watching rehearsal";
    renderMedia();
  } catch (error) {
    $("join").disabled = false;
    joined = true;
    notice(
      `Live connection unavailable. Showing recorded footage. ${error.message}`,
    );
    renderMedia();
  }
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      $("wake-status").textContent =
        "Screen wake lock active. Keep this page in the foreground.";
      wakeLock.addEventListener("release", () => {
        $("wake-status").textContent =
          "Screen wake lock released. Keep the screen awake manually.";
      });
    } else
      $("wake-status").textContent =
        "Keep the screen awake manually; this browser has no wake lock.";
  } catch {
    $("wake-status").textContent =
      "Keep the screen awake manually; wake lock unavailable.";
  }
}
function syncPublishing() {
  publishQueue = publishQueue
    .then(async () => {
      if (
        !activeBroadcast ||
        room?.state !== ConnectionState.Connected ||
        !state
      )
        return;
      const policy = publishingPolicy(
        state.mode,
        true,
        localSafe || !stateOnline,
      );
      await room.localParticipant.setCameraEnabled(policy.camera, {
        facingMode: "environment",
        resolution: { width: 640, height: 360, frameRate: 12 },
      });
      await room.localParticipant.setMicrophoneEnabled(policy.microphone, {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      const track = room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      )?.track;
      if (track) {
        track.attach($("live-video"));
        $("live-video").muted = true;
      }
      $("broadcast-status").textContent = policy.camera
        ? "Broadcasting live camera and microphone."
        : policy.microphone
          ? "Broadcasting microphone only. Camera upload stopped."
          : "Connected. Camera and microphone stopped; silent recorded video selected.";
      renderMedia();
    })
    .catch(async (error) => {
      // Camera failure must not prevent microphone-only broadcasting.
      localSafe = true;
      try {
        await room?.localParticipant.setCameraEnabled(false);
        if (activeBroadcast && state?.mode !== "recorded")
          await room?.localParticipant.setMicrophoneEnabled(true);
      } catch {}
      notice(`Broadcast device error: ${error.message}`);
      renderMedia();
    });
  return publishQueue;
}
async function degrade(message) {
  localSafe = true;
  pendingDegrade = true;
  await syncPublishing();
  $("broadcast-status").textContent = message;
  if (stateOnline) {
    try {
      applyState(await api("/api/degrade", {}));
      pendingDegrade = false;
    } catch (error) {
      notice(error.message);
    }
  }
}
async function startBroadcast() {
  if (activeBroadcast || startingBroadcast) return;
  if (!window.isSecureContext) {
    notice("The iPhone broadcast page requires HTTPS.");
    return;
  }
  startingBroadcast = true;
  updateControls();
  notice("");
  try {
    const credentials = await api("/api/token", { publish: true });
    room = new Room({
      adaptiveStream: false,
      dynacast: false,
      publishDefaults: {
        simulcast: false,
        videoCodec: "h264",
        backupCodec: false,
        videoEncoding: { maxBitrate: 350000, maxFramerate: 12 },
        audioPreset: { maxBitrate: 24000 },
        dtx: true,
        red: true,
        forceStereo: false,
        stopMicTrackOnMute: true,
      },
    });
    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant !== room.localParticipant) return;
      if (
        quality === ConnectionQuality.Poor ||
        quality === ConnectionQuality.Lost
      ) {
        if (poorTimer) return;
        poorTimer = setTimeout(() => {
          if (activeBroadcast)
            degrade(
              "Weak signal. Camera upload stopped; keeping audio where possible.",
            );
        }, 8000);
      } else {
        clearTimeout(poorTimer);
        poorTimer = null;
      }
    });
    room.on(RoomEvent.Reconnecting, () => {
      localSafe = true;
      pendingDegrade = true;
      $("broadcast-status").textContent =
        "Media reconnecting. Viewers can continue with recorded footage.";
    });
    room.on(RoomEvent.Reconnected, () =>
      degrade("Reconnected in audio-only mode. Operator can restore camera."),
    );
    room.on(RoomEvent.Disconnected, () => {
      activeBroadcast = false;
      clearTimeout(poorTimer);
      $("stop-broadcast").disabled = true;
      $("audio-only").disabled = true;
      updateControls();
      $("broadcast-status").textContent =
        "Broadcast disconnected. Tap Start to reconnect.";
      wakeLock?.release();
      renderMedia();
    });
    await room.connect(credentials.url, credentials.token, {
      autoSubscribe: false,
    });
    activeBroadcast = true;
    localSafe = false;
    pendingDegrade = false;
    $("stop-broadcast").disabled = false;
    $("audio-only").disabled = false;
    updateControls();
    await syncPublishing();
    await requestWakeLock();
  } catch (error) {
    activeBroadcast = false;
    await room?.disconnect();
    notice(`Unable to broadcast: ${error.message}`);
  } finally {
    startingBroadcast = false;
    updateControls();
  }
}
async function stopBroadcast() {
  activeBroadcast = false;
  clearTimeout(poorTimer);
  await room?.disconnect();
  await wakeLock?.release();
  $("stop-broadcast").disabled = true;
  $("audio-only").disabled = true;
  updateControls();
  renderMedia();
}

async function showRole() {
  const allowed = page === "viewer" || sessionRole === page;
  $("login-panel").hidden = allowed;
  $("workspace").hidden = !allowed;
  $("logout").hidden = !sessionRole;
  $("operator-controls").hidden = page !== "operator";
  $("broadcast-controls").hidden = page !== "broadcaster";
  $("join").hidden = page === "broadcaster";
  $("image-preference").hidden = page === "broadcaster";
  if (page !== "viewer") {
    $("eyebrow").textContent =
      page === "operator" ? "AT THE AUCTION DESK" : "LIVE FROM THE RING";
    $("page-title").textContent =
      page === "operator"
        ? "Keep the ring connected."
        : "Bring the auction to life.";
    $("page-description").textContent =
      page === "operator"
        ? "Choose the current lot and control what your online audience sees."
        : "Broadcast from your iPhone. Audio comes first when the signal weakens.";
    $("login-title").textContent =
      page === "operator" ? "Operator sign in" : "Broadcaster sign in";
  }
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  notice("");
  try {
    const result = await api("/api/session", {
      role: page,
      password: $("password").value,
    });
    $("password").value = "";
    sessionRole = result.role;
    showRole();
  } catch (error) {
    notice(error.message);
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await stopBroadcast();
    await api("/api/session", undefined, "DELETE");
    sessionRole = "";
    showRole();
  } catch (error) {
    notice(error.message);
  }
});
$("join").addEventListener("click", joinViewer);
$("enable-audio").addEventListener("click", async () => {
  try {
    await room?.startAudio();
    renderMedia();
  } catch {
    notice("Audio is blocked. Check your browser sound settings.");
  }
});
$("prefer-image").addEventListener("change", () => {
  subscribePreference();
  renderMedia();
});
$("retry-video").addEventListener("click", () => {
  ytFailed = false;
  ytLot = null;
  lastVisual = null;
  if (!window.YT?.Player) ytReady = null;
  renderMedia();
});
$("change-lot").addEventListener("click", () =>
  command(state.mode, $("lot-select").value),
);
for (const button of document.querySelectorAll("[data-mode]"))
  button.addEventListener("click", () => command(button.dataset.mode));
$("start-broadcast").addEventListener("click", startBroadcast);
$("stop-broadcast").addEventListener("click", stopBroadcast);
$("audio-only").addEventListener("click", () =>
  degrade("Audio-only requested. Operator can restore camera."),
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activeBroadcast)
    requestWakeLock();
});
$("fallback-image").addEventListener("error", () => {
  if (currentLot() && !$("fallback-image").src.endsWith(currentLot().image))
    $("fallback-image").src = currentLot().image;
});

// Decoded-frame progress catches frozen pictures, including when the room stays connected.
function frameCallback() {
  lastFrame = Date.now();
  $("live-video").requestVideoFrameCallback?.(frameCallback);
}
$("live-video").requestVideoFrameCallback?.(frameCallback);
setInterval(() => {
  if (lastHeartbeat && Date.now() - lastHeartbeat > 9000 && stateOnline)
    connected(false);
  if (page === "broadcaster") {
    $("mic-level").value = room?.localParticipant.audioLevel || 0;
    return;
  }
  const v = $("live-video");
  if (!v.requestVideoFrameCallback && v.currentTime !== frameMarker) {
    frameMarker = v.currentTime;
    lastFrame = Date.now();
  }
  videoHealthy =
    !!videoTrack &&
    !videoTrack.isMuted &&
    room?.state === ConnectionState.Connected &&
    lastFrame > 0 &&
    Date.now() - lastFrame < 5000;
  renderMedia();
}, 1000);

async function init() {
  try {
    const result = await api("/api/session", undefined, "GET");
    sessionRole = result.role;
  } catch {}
  showRole();
  const events = new EventSource("/api/events");
  events.addEventListener("state", (event) => {
    lastHeartbeat = Date.now();
    connected(true);
    applyState(JSON.parse(event.data));
    subscribePreference();
  });
  events.addEventListener("heartbeat", () => {
    lastHeartbeat = Date.now();
    const was = stateOnline;
    connected(true);
    if (!was && activeBroadcast && pendingDegrade)
      degrade("Reconnected; retaining audio only.");
  });
  events.onerror = () => connected(false);
}
init();
