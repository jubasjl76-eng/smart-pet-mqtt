# Changelog

All notable changes to `@jubasjl76-eng/mqtt-contract`.

## 2.3.0 — 2026-09-10

- **W3C Trace Context on the envelope** (`traceparent` / `tracestate`, both
  optional) — hardening Phase 16. Set by the message originator so a
  command → ack/status/event round trip stays on one distributed trace;
  devices echo the command's `traceparent` back on the matching ack.
  `copyTrace(dst, src)` helper + `TraceCarrier` type. AsyncAPI `envelope`
  schema updated.

## 2.2.0 — 2026-09-10

- **AsyncAPI 3.1 spec** (`asyncapi.yaml`) — the machine-readable MQTT contract
  (Phase 14, A1). Channels for every protocol-v2 leaf (status, command, ack,
  event, telemetry, metric, location, presence, audio) + payload schemas
  mirroring `src/payloads.ts`. Validated in CI (`@asyncapi/parser`). Included in
  the published package `files`.

## 2.1.1 — 2026-09-09

- Add a `prepare` script (build `dist/` on install) so the package can be
  consumed as a **git-tag dependency**
  (`github:jubasjl76-eng/smart-pet-mqtt#mqtt-contract-v<version>`). GitHub
  Packages npm requires a token even for public packages and per-repo Actions
  access grants; a git dep needs neither (this repo is public). The
  `release.yml` still publishes to GitHub Packages and, more importantly, cuts
  the `mqtt-contract-v<version>` tag consumers pin to.

## 2.1.0 — 2026-09-09

- **Published as a package.** Renamed `smart-pet-mqtt` → `@jubasjl76-eng/mqtt-contract`
  and set up publishing to GitHub Packages. First release of the hardening
  track's Phase 11 (repo boundaries — `SMART-PET-HARDENING-PLAN.md` A7, ADR-0001).
- `exports` map + `engines.node >= 20` + `prepack` build hook. No API changes.
- Consumers (`smart-pet-backend`, `pet-iot-edge-gateway`,
  `pet-iot-sensors-service`, `pet-iot-camera-service`, `smart-pet-simulator`)
  move from vendored copies to a dependency in follow-up PRs.

## 2.0.0 — protocol v2 (pre-package)

- Canonical topic scheme `kennel/{kennelId}/{deviceType}/{deviceId}/{leaf}`,
  typed payloads, `CommandRouter`. See `docs/MQTT_PROTOCOL.md`.
