# TURN deployment follow-up

M1 Compose exposes direct WebRTC UDP 7882 and TCP 7881. It does not yet include TURN, and it is not proven usable on the venue's mobile network.

Before auction deployment:

1. Choose the TURN hostname and networking layout for the actual Dokploy host.
2. Provide a publicly trusted certificate for that hostname. LiveKit supports embedded authenticated TURN. Its config accepts `turn.enabled`, `turn.domain`, `turn.tls_port`, `turn.cert_file` and `turn.key_file`; mount certificates read-only and arrange renewal.
3. Use TURN/TLS on externally reachable TCP 443 for restrictive networks. Dokploy already uses TCP 443, so give TURN a separate public IP/server or use a correctly configured layer-4 TLS/SNI router. A second hostname pointing to the same HTTP proxy does not solve this.
4. Configure direct ports, public IP advertisement, and optional TURN/UDP as appropriate. Do not expose Redis/PostgreSQL. Keep `enable_loopback_candidate: false` in containers: enabling it caused failed ICE negotiation during the local Docker Desktop test.
5. Test relay-only connections and actual iPhone Safari over mobile data. Validate certificate renewal/restart behaviour. Record host/IP/port decisions in the implementation plan, with no secrets.

Reference: https://docs.livekit.io/transport/self-hosting/deployment/ and https://docs.livekit.io/transport/self-hosting/ports-firewall/
