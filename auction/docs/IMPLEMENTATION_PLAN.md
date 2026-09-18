# Hencor live auction — implementation and handoff

Last updated: 2026-09-18. Keep this file current in every implementation session.

## Objective and accepted scope

Build a Go application at `https://auction.hencorbonsmaras.co.za`, deployed with Docker Compose through Dokploy. Reuse the parent catalogue's logo, cream/oxblood/clay/sage palette, Georgia headings, rounded cards and existing catalogue images. Do not modify the public catalogue inadvertently.

The event is a live physical cattle auction with fewer than 50 online viewers. An iPhone on 3G publishes camera and microphone; a separate laptop operates the auction. Online bids are requests until explicitly accepted by the operator. Pre-auction registration includes private FICA document upload and human review. Payments, invoices/payment reconciliation, backup services and Caddy are outside v1. Persistent database and document volumes are still required.

Store lot number, catalogue image, optional notes and YouTube video ID. No structured pedigree/breeding database. Parent `index.html` contains the current 25 video IDs and notes. Parent `assets/katalogus-tables/lot-NN.png` contains catalogue detail images; `assets/bull-images/` contains photographs.

Media modes: live camera/audio; recorded lot video with live audio; silent recorded lot video; static lot image. Silent recorded footage is explicitly acceptable and does not stop bidding. Operator controls restore to live. A failed operator connection must pause online bidding; a failed buyer connection disables that buyer's bidding. The media stream never determines the authoritative price or winner.

## Current milestone and how to continue

Implement M1 first: a runnable media rehearsal, not a production auction. Expose a clear rehearsal label and no working bid button until registration and transactional bidding are implemented. Next agent should read this file, README, existing code and git diff, run the documented checks, then work on the first unchecked milestone. Never mark a physical-device or deployment test complete based on a browser mock.

Checklist notation: `[x]` implemented and verified to the extent documented; `[ ]` outstanding. Add evidence/limitations below rather than treating every checkbox as production readiness. Keep outstanding items when handing off.

## Architecture

- `auction/cmd/auction`: executable and environment configuration.
- `auction/internal/server`: HTTP handlers, PostgreSQL state, role sessions, media tokens and tests.
- `auction/web`: server-rendered HTML shell, shared styling, browser code bundled with esbuild and pinned LiveKit client.
- `auction/deploy`: LiveKit development/production configuration and Compose support.
- Go serves the app and public catalogue assets, PostgreSQL stores durable state, LiveKit relays media, Redis supports LiveKit. Use short authenticated POSTs for commands and SSE snapshots for state updates. Do not send bidding commands over LiveKit data channels.
- Keep public catalogue files separate from future FICA files. Never expose the FICA volume through a static handler.
- Initially run one Go application instance. Persist state in PostgreSQL; no in-memory authority for bids. M1 sessions are role-specific rehearsal credentials, not the eventual buyer identity system.
- Browser gets short-lived room-scoped LiveKit tokens. Viewer: subscribe only, no publish/data. Broadcaster: publish camera/microphone only, no room administration. Only server holds the signing secret.

## M1 — prove media and operator control

- [x] Create Go module, configuration validation, health endpoints and graceful shutdown.
- [x] PostgreSQL schema/init, durable selected lot and media mode, monotonic revision and audit events.
- [x] Import all 25 lots from existing catalogue; reuse public assets without copying sensitive documents.
- [x] Hencor-styled responsive viewer, operator and iPhone broadcast pages.
- [x] Separate operator and broadcaster sessions with secure cookies, CSRF/origin checks and login throttling.
- [x] Viewer token cannot publish; broadcaster token cannot administer rooms.
- [x] Operator selects lot and requests live/audio-only/recorded/image modes; stale commands reject.
- [x] State changes reach viewers and broadcaster through SSE; reconnect loads complete state.
- [x] Phone publishes one low-bitrate stream with separate audio and video tracks.
- [x] Switching away from live stops video at the phone, not just at the viewer.
- [x] Muted YouTube playback loops the active lot; unavailable/blocked video falls back to catalogue image.
- [x] Viewer media preference allows static image/audio-only without changing everyone else's mode.
- [x] Media loss automatically reveals fallback; recovery to camera requires operator action after degraded mode.
- [x] Best-effort screen wake lock and explicit instructions to keep Safari foregrounded.
- [x] Dockerfile, Compose, example configuration and Dokploy instructions.
- [x] Automated tests for auth, role grants, stale updates, invalid lots/modes, persistence and browser media transitions.
- [ ] Run actual local Compose rehearsal with PostgreSQL and LiveKit.
- [ ] Verify iPhone Safari permissions, rear camera, microphone, audio autoplay, lock/call/background interruption and wake-lock behaviour.
- [ ] Verify each YouTube ID allows embedding; test fallback on restricted network and Safari.
- [ ] Rehearse actual 3G venue connection for at least 30 minutes, including loss/recovery and simultaneous laptop control.
- [ ] Verify target host UDP/TCP/TURN reachability and HTTPS from an external mobile network.

### Media implementation detail

Phone opens `/broadcast`, signs in, and taps Start. Use 640×360 target video at 10–15 fps with roughly 250–400 kbps cap and mono Opus around 24–32 kbps as initial targets. Avoid multiple simulcast encodings on the constrained publisher. Browser/device may choose different actual capture resolution. The server relays to viewers; it does not multiply phone upload by viewer count.

Operator opens `/operator`. Commands persist lot/mode before notifying clients. Distinguish desired mode from actually available tracks. Viewer must not show a frozen picture as live: react to muted/unpublished/disconnected tracks and stalled decoded frames. Detect sustained poor publishing quality and disable camera, retaining microphone. If audio also fails, show silent recorded footage. Never use a video element's existence alone as proof it is live. Avoid rapid recovery oscillation: require explicit operator restoration after automatic degradation.

Use YouTube's IFrame API with `loop=1`, `playlist=VIDEO_ID`, `playsinline=1`, current origin and explicit mute. Never download/rebroadcast YouTube content. On lot change, switch to the corresponding clip. Label it as recorded. On player error or playback timeout show the lot image and a retry control. Provide a user gesture for live audio and handle autoplay failure visibly. A buyer with poor download bandwidth should be able to select the image instead of YouTube.

An operator command to stop camera must reach the publisher even when media is degraded. If the state channel disconnects, broadcaster conservatively disables camera; viewer shows state reconnection separately from media status. If all connectivity is lost no web code can preserve live audio. For M2 bidding, operator lease expiration must enforce pause on the server, not merely grey out buttons.

## M2 — accounts, registration and FICA review

- [ ] Buyer accounts with password hashing, verified contact, password reset, session expiry/revocation and rate limiting.
- [ ] Per-auction registration: draft → submitted → changes requested / approved / rejected; immutable review history.
- [ ] Agree exact individual/company document checklist with the auctioneer; do not infer legal verification from upload.
- [ ] Private uploads with size/type limits, generated filenames, content inspection, quarantine/scanning and authenticated downloads.
- [ ] Encryption at rest with keys kept outside document volumes; restricted reviewers and document-access audit records.
- [ ] Admin MFA; separate reviewer/operator/broadcaster capabilities.
- [ ] Terms/privacy notice version accepted and timestamp captured; retention/deletion policy confirmed by responsible organisation.
- [ ] Stable bidder number assigned on approval; approval/revocation checked server-side on every bid.
- [ ] Test unauthorized document access, malicious files, cross-user access, reviewer permissions and revocation.

## M3 — operator-approved bidding

- [ ] Model auction/lot status, opening and asking prices, accepted bid and sold/passed result. Money as integer cents.
- [ ] Acquire an operator controller lease bound to a session; renew every few seconds. Reject competing controllers unless explicit takeover. Expiry/restart pauses bidding until operator resumes.
- [ ] Keep asking price, pending/accepted status and bid control adjacent to the player on mobile, above catalogue details.
- [ ] Buyer submits unique request ID, lot ID, asking-price revision and exact amount. Reject stale/closed/paused/unapproved requests.
- [ ] Queue pending bids in authoritative received order; buyer sees submitted/pending, accepted or declined/stale distinctly.
- [ ] Accept a pending bid inside a PostgreSQL transaction locking the lot. Floor/telephone bids go through the same transaction and increment the same revision.
- [ ] Acceptance invalidates other pending bids at the old price. Retry returns original outcome without duplicate bid.
- [ ] Set next asking price separately/atomically according to agreed increments. No automatic winning status for pending requests.
- [ ] Close sold/passed atomically with bid acceptance; no late accept after close. Audit every operator action and correction.
- [ ] Server rejects bids after controller lease expiry, even if UI appears connected.
- [ ] Bidder reconnect reloads authoritative state and their outstanding requests; never blindly resubmits at a new price.
- [ ] Sales CSV export with bidder number, buyer, lot, accepted price; escape spreadsheet formula injection.
- [ ] Concurrency tests: simultaneous acceptance/floor/close, duplicate IDs, changed lots, lease expiry, restart, revoked bidder and network retry.

## M4 — deployment and auction rehearsal

- [ ] Configure Dokploy domain `auction.hencorbonsmaras.co.za` → app:8080 and media signalling hostname → LiveKit:7880.
- [ ] Set independent random role credentials/session secrets, database password and LiveKit API credentials; no committed production secrets.
- [ ] Configure trusted HTTPS origin and secure cookies. Do not expose PostgreSQL or Redis publicly.
- [ ] LiveKit direct UDP/TCP ports and public IP advertisement; prove TURN fallback from restrictive networks.
- [ ] Resolve TURN/TLS 443 conflict with Dokploy using a separate public IP/host or appropriate layer-4 routing. Ordinary HTTP routing is not sufficient for TURN.
- [ ] Persistent database and future document volumes survive redeploy. No backup service in v1, per user.
- [ ] Use exact tested image/dependency versions; record updates deliberately.
- [ ] Load test up to 50 viewers and concurrent bid bursts with expected media bitrate. Measure bandwidth/CPU and media delay.
- [ ] Operator rehearsal: pending bids, floor bids, lot changes, sold/passed, phone loss, laptop loss and server restart.
- [ ] Decide auction-day support ownership and manual pause/recovery procedure.

## Verification evidence and known gaps

### 2026-09-18 implementation session

M1 code is implemented in `auction/`. M2/M3 are not started. The existing catalogue was left unchanged; repository-level `.dockerignore` was added to keep secrets and dependencies out of the Docker build context.

Implemented: Go HTTP application, PostgreSQL singleton media state and transactional audit, role sessions and origin validation, room-scoped media JWTs, responsive Hencor viewer/operator/broadcast pages, all 25 lot mappings, LiveKit publisher/subscriber, muted per-lot YouTube loop with image fallback, low-data preference, publisher camera shutdown on fallback/state heartbeat loss, conservative poor-quality handling, best-effort wake lock, Dockerfile and Compose/Dokploy setup.

Verification (update if rerunning changes these results):

- `npm run build`, `npm test`, `go test ./...`, `go vet ./...` pass.
- `TEST_DATABASE_URL=… go test -race ./... -v` passes against a real PostgreSQL container. Integration tests create an isolated schema and cover origin rejection, role isolation, publish permissions, invalid/stale commands, concurrent revision arbitration, atomic audit, degradation, state persistence, SSE and session revocation.
- Playwright uses real Go/PostgreSQL/LiveKit, separate operator/phone/viewer contexts, simulated camera/microphone and a deterministic YouTube player stub. Tests verify camera/audio, stopping camera upload while preserving audio, silent mode, lot/video sync, image preference, restored live video, publisher loss and narrow-screen layout. Final run: **3 browser tests passed** (20.8 seconds), including auction-state heartbeat loss with live audio retained, blocked YouTube image fallback, and mobile/private-screen checks.
- The temporary native app and test containers were stopped and removed after verification; no background rehearsal is left running. The gitignored `.env` and compiled `bin/auction` remain for local development.
- Desktop/mobile screenshots are generated in ignored `auction/test-results/`. Browser tests load generated credentials from ignored `.env`; never commit that file.
- Compose configuration validates. The full canonical image build/start has **not** completed: Docker Hub image downloads were extremely slow and were stopped. To verify the media path independently, the session ran the native Go binary, a cached PostgreSQL image, and the checksum-verified **LiveKit v1.13.7 Linux ARM64 release binary** inside a temporary Docker container. This is real media-server verification, but not a successful build of the committed Dockerfile or the complete Redis-backed Compose stack.
- Found and fixed a container networking issue: `enable_loopback_candidate: true` caused failed ICE negotiation on Docker Desktop. Set it to **false**. With that setting, `node_ip: 127.0.0.1` works for the desktop localhost test; production must advertise the host's actual reachable public IP.

Still unverified: complete canonical Compose build, Dokploy routing, TURN/TLS, physical iPhone Safari, actual YouTube embedding for every lot, venue 3G endurance and 50-viewer load. M1 remains a rehearsal until those deployment/device checks are done. There are no FICA uploads or binding bids in this version.

Next agent priorities:

1. Run the complete Compose build when image downloads are available; verify Redis-backed LiveKit and app health. Do not mistake the temporary test harness for the production deployment.
2. Configure the actual Dokploy HTTPS/media/TURN topology and test the iPhone on mobile data. Keep publishing and bidding state independent.
3. Rehearse low signal and iPhone interruptions. Inspect actual audio/video bitrate and verify all YouTube embeds. Tune degradation timing from measurements.
4. Implement M2 registration/FICA and then M3 operator-approved bidding using the acceptance rules above. Keep the rehearsal warning and disabled bidding until those pieces are complete.


## References

- Existing catalogue and source: https://hencorbonsmaras.co.za/ and parent `index.html`.
- LiveKit publishing: https://docs.livekit.io/transport/media/publish/
- LiveKit deployment: https://docs.livekit.io/transport/self-hosting/deployment/
- Ports/TURN: https://docs.livekit.io/transport/self-hosting/ports-firewall/
- Token permissions: https://docs.livekit.io/frontends/reference/tokens-grants/
- YouTube loop/player parameters: https://developers.google.com/youtube/player_parameters
- Browser media security: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

These explain integration mechanics; exact versions and runtime behaviour must be verified in the code and on the deployment host.
