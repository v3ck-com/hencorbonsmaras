# Hencor auction

Go + PostgreSQL + LiveKit, deployed with Docker Compose/Dokploy. The current implementation is **M1: media rehearsal**, not a production bidding platform. It reuses the parent Hencor catalogue's assets and theme without changing that site.

Read [the implementation plan and maintained checklist](docs/IMPLEMENTATION_PLAN.md) before continuing work. Registration, FICA intake and binding bids are intentionally not enabled yet.

## Local rehearsal

Requires Docker Compose. From this directory:

```sh
./scripts/init-local.sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Open `http://localhost:8097` for the viewer, `/operator` for the operator and `/broadcast` for the phone role. Use **different browser profiles/contexts** when testing operator and broadcaster on one computer; they intentionally share one role cookie per browser. Local credentials are generated in the gitignored `.env` with owner-only permissions. Read that file locally to obtain the two role passwords; never commit it.

1. Sign into `/operator` using `OPERATOR_PASSWORD`. Choose a lot and **Live camera + audio**.
2. In another browser profile, sign into `/broadcast` using `BROADCAST_PASSWORD`; tap **Start broadcast** and permit microphone/camera access.
3. Open the viewer in a third context and tap **Join rehearsal**. Enable audio if the browser asks.
4. Select **Lot video + live audio** on the operator. Verify the phone camera turns off, microphone remains active and the viewer sees a muted YouTube recording.
5. Select **Silent lot video**. Both camera and microphone stop publishing. Recorded footage continues independently of the phone.
6. Change lots and confirm all clients update. Select **Lot image + live audio** or the viewer's **Save data** option to avoid downloading YouTube video.
7. Restore **Live camera + audio** explicitly. Disconnect the phone and check the viewer falls back.

The default mode is silent recorded footage. Starting the phone in that mode connects it to the room but leaves both devices off until the operator chooses a live mode. A broadcaster credential cannot operate the auction; an operator credential cannot publish camera/microphone.

The local override binds the web app/database/signalling to localhost. **It is not a configuration for an iPhone over LAN or 3G.** iPhone camera/microphone require a trusted HTTPS deployment and reachable WebRTC media ports. A desktop fake-camera test does not establish iPhone compatibility.

Stop without deleting persisted auction state:

```sh
docker compose -f compose.yaml -f compose.local.yaml down
```

## Development and verification

Node 24 and Go 1.25+ are used by the build. The generated JS bundle is ignored; build it before running Go outside Docker.

```sh
npm ci
npm run build
npm test
go test ./...
go vet ./...
```

Database integration tests create and drop a uniquely named schema, not your live tables. With the local stack running, load your local environment and run:

```sh
set -a
. ./.env
set +a
TEST_DATABASE_URL="postgres://auction:${POSTGRES_PASSWORD}@localhost:55439/auction?sslmode=disable" go test -race ./internal/server -v
```

Browser tests use the real local app, PostgreSQL and LiveKit with fake camera/microphone devices, plus a deterministic YouTube API stub for fallback assertions. YouTube availability and physical devices must also be tested manually. After installing Chromium (`npx playwright install chromium`):

```sh
npm run test:browser
```

Tests read the local `.env` and do not print passwords. They change the rehearsal's selected lot and media mode. Do not point them at an active auction.

## Dokploy

1. Use this repository and Compose file `auction/compose.yaml`. Its build context is the repository root, because it copies the public catalogue assets.
2. Supply the variables from `.env.example` in Dokploy. Generate distinct random hexadecimal secrets. Set `APP_ORIGIN=https://auction.hencorbonsmaras.co.za` with no trailing slash.
3. Route that domain to service `app`, port `8080`, using Dokploy HTTPS. Route a second signalling hostname, e.g. `media.auction.hencorbonsmaras.co.za`, to `livekit`, port `7880`, with WebSocket support. Set `LIVEKIT_URL=wss://media.auction.hencorbonsmaras.co.za`.
4. Set `LIVEKIT_NODE_IP` to the actual public IPv4 of the host. Permit **TCP 7881** and **UDP 7882** directly through the firewall/NAT. These are WebRTC ports, not HTTP routes. Do not put the media hostname behind an HTTP-only proxy for these direct ports.
5. Keep PostgreSQL and Redis private. The base Compose file has no app/database host port mappings. Use Dokploy's generated proxy networking, and verify it can reach the selected services.
6. The existing volume persists PostgreSQL across redeploys. No backup service or Caddy is included. FICA storage will be added privately in M2.
7. Verify signalling, UDP and TCP from the actual iPhone on mobile data. **TURN/TLS has not been configured in this milestone.** Some restrictive/mobile networks will fail without it. Add a TURN domain/certificate and resolve TCP 443 sharing with Dokploy (separate public IP/host or layer-4 routing). Do not assume Dokploy's normal HTTPS route provides TURN. See `deploy/TURN.md`.

Docker health checks establish that the app and database are reachable; they do not prove working end-to-end media. Media bandwidth grows with viewers on the server, not on the phone. Test the actual host before admitting bidders.

## Security and operational limits of M1

- Role passwords are rehearsal credentials supplied via environment. Sessions are random, stored as SHA-256 hashes in PostgreSQL, expire after 12 hours, and use HttpOnly/SameSite cookies (Secure on HTTPS).
- Mutating API calls require the configured Origin; commands are role checked. Viewer LiveKit tokens cannot publish or administer the room. Publisher tokens only permit camera/microphone. Tokens last five minutes for joining, not a forced five-minute disconnect.
- Login limits deliberately use the direct peer IP, not untrusted forwarding headers. Behind Dokploy, operators may share a proxy-wide limit of 20 login attempts/minute. Configure a trusted-proxy policy before expanding authentication.
- Command revisions prevent a stale operator tab from overwriting newer state. Every successful mode/lot change creates an audit record in the same transaction.
- Public viewers can join the rehearsal. Admission policy and approved bidder identities belong to M2/M3.
- Camera quality degradation and state-connection loss stop the publisher's camera. Video returns through explicit operator control. Browser background suspension, dropped cellular connectivity and phone calls cannot be repaired by JavaScript; foreground Safari/device rehearsal is mandatory.
- Registration/FICA, bidder approval, operator lease, pending/accepted bids, sold results and sales exports are still outstanding. The UI explicitly disables bidding.

## Current validation status

Go/database tests and a real LiveKit browser rehearsal have been run. The committed Compose configuration validates, but its full image build/start is still pending because image downloads stalled during this session. The media test used the verified LiveKit v1.13.7 release binary in a temporary container instead. See the plan's verification evidence for the exact boundary and next steps.

Keep `enable_loopback_candidate: false` inside the LiveKit container. Enabling it caused ICE negotiation to fail in the local Docker Desktop rehearsal even though signalling worked.
