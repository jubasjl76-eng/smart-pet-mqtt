/**
 * Payload shapes + builders for protocol v2.
 *
 * Every message carries `deviceId`, `kennelId`, `timestamp` (epoch ms). Builders
 * fill those; validators are permissive on extra keys but strict on the core.
 */
import type { DeviceType } from './topics.js';

export interface Envelope {
  deviceId: string;
  kennelId: string;
  /** epoch milliseconds (device wall-clock after NTP sync; 0 in an LWT) */
  timestamp: number;
  /**
   * W3C Trace Context (hardening Phase 16). Set by whoever originates the
   * message so a command → ack/status/event round trip stays on one
   * distributed trace. Devices don't create spans — they just echo the
   * command's `traceparent` back on the matching ack. Optional everywhere.
   */
  traceparent?: string;
  tracestate?: string;
}

/** The two Trace Context fields, as a plain carrier for propagation.inject/extract. */
export type TraceCarrier = { traceparent?: string; tracestate?: string };

/** Copy `traceparent` / `tracestate` from `src` onto `dst` (in place). Returns `dst`. */
export function copyTrace<T extends TraceCarrier>(dst: T, src: TraceCarrier | undefined): T {
  if (src?.traceparent) dst.traceparent = src.traceparent;
  if (src?.tracestate) dst.tracestate = src.tracestate;
  return dst;
}

// ── status / lwt ────────────────────────────────────────────────────────────
export interface StatusPayload extends Envelope {
  status: 'online' | 'offline' | 'degraded';
  fw?: string;
  rssi?: number;
  uptimeS?: number;
  /** device-type specific fields (foodLevel, waterLevel, tds, doorState, …) */
  [k: string]: unknown;
}

export interface LwtPayload extends Envelope {
  timestamp: 0;
  status: 'offline';
}

export function buildStatus(args: {
  deviceId: string; kennelId: string; status: StatusPayload['status'];
  fw?: string; rssi?: number; uptimeS?: number; extra?: Record<string, unknown>;
}): StatusPayload {
  return {
    deviceId: args.deviceId, kennelId: args.kennelId, timestamp: Date.now(),
    status: args.status, fw: args.fw, rssi: args.rssi, uptimeS: args.uptimeS,
    ...(args.extra ?? {}),
  };
}

export function buildLwt(deviceId: string, kennelId: string): LwtPayload {
  return { deviceId, kennelId, timestamp: 0, status: 'offline' };
}

// ── commands ────────────────────────────────────────────────────────────────
export interface CommandBase extends Envelope {
  command: string;
  /** unique id so the device can ack precisely and the backend can de-dup */
  id?: string;
  params?: Record<string, unknown>;
}

export type FeedCommand = CommandBase & { command: 'feed'; params: { amount: number } };
export type DispenseCommand = CommandBase & { command: 'dispense'; params: { seconds?: number; ml?: number } };
export type ScheduleEntry = { id: string; time: string; amount: number; enabled: boolean };
export type ScheduleSetCommand = CommandBase & { command: 'schedule_set'; params: { schedules: ScheduleEntry[] } };
export type DoorCommand = CommandBase & {
  command: 'door';
  params: { action: 'lock' | 'unlock' | 'open' | 'close' | 'noop'; reason?: string; holdMs?: number };
};
export type RelayCommand = CommandBase & {
  command: 'relay';
  params: { relay: string; state: 'on' | 'off'; forMs?: number };
};
export type OtaCommand = CommandBase & {
  command: 'ota';
  params: { url: string; version: string; sha256?: string };
};
export type RestartCommand = CommandBase & { command: 'restart' };
export type SetIntervalCommand = CommandBase & { command: 'set_interval'; params: { seconds: number } };
export type IdentifyCommand = CommandBase & { command: 'identify'; params?: { seconds?: number } };

export type AnyCommand =
  | FeedCommand | DispenseCommand | ScheduleSetCommand | DoorCommand | RelayCommand
  | OtaCommand | RestartCommand | SetIntervalCommand | IdentifyCommand | CommandBase;

let seq = 0;
export function commandId(): string {
  seq = (seq + 1) % 1e6;
  return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

function baseCmd(command: string, deviceId: string, kennelId: string, params?: Record<string, unknown>): CommandBase {
  return { command, deviceId, kennelId, timestamp: Date.now(), id: commandId(), params };
}

export const buildFeed = (d: string, k: string, amount: number): FeedCommand =>
  ({ ...baseCmd('feed', d, k, { amount }), command: 'feed', params: { amount } });

export const buildDispense = (d: string, k: string, p: { seconds?: number; ml?: number }): DispenseCommand =>
  ({ ...baseCmd('dispense', d, k, p), command: 'dispense', params: p });

export const buildScheduleSet = (d: string, k: string, schedules: ScheduleEntry[]): ScheduleSetCommand =>
  ({ ...baseCmd('schedule_set', d, k, { schedules }), command: 'schedule_set', params: { schedules } });

export const buildDoor = (d: string, k: string, p: DoorCommand['params']): DoorCommand =>
  ({ ...baseCmd('door', d, k, p), command: 'door', params: p });

export const buildRelay = (d: string, k: string, p: RelayCommand['params']): RelayCommand =>
  ({ ...baseCmd('relay', d, k, p), command: 'relay', params: p });

export const buildOta = (d: string, k: string, p: OtaCommand['params']): OtaCommand =>
  ({ ...baseCmd('ota', d, k, p), command: 'ota', params: p });

export const buildRestart = (d: string, k: string): RestartCommand =>
  ({ ...baseCmd('restart', d, k), command: 'restart' });

export const buildSetInterval = (d: string, k: string, seconds: number): SetIntervalCommand =>
  ({ ...baseCmd('set_interval', d, k, { seconds }), command: 'set_interval', params: { seconds } });

// ── ack ─────────────────────────────────────────────────────────────────────
export interface AckPayload extends Envelope {
  /** the command id being acknowledged */
  ackId: string;
  command: string;
  result: 'ok' | 'error' | 'rejected' | 'queued';
  detail?: string;
}

export function buildAck(args: {
  deviceId: string; kennelId: string; ackId: string; command: string;
  result: AckPayload['result']; detail?: string;
  /** echo the acknowledged command's traceparent so the round trip links */
  traceparent?: string; tracestate?: string;
}): AckPayload {
  return { ...args, timestamp: Date.now() };
}

// ── events ──────────────────────────────────────────────────────────────────
export type EventName =
  | 'boot' | 'fed' | 'dispensed' | 'jam' | 'door_open' | 'door_closed'
  | 'low_food' | 'low_water' | 'tamper' | 'button' | 'ota_applied' | 'offline_recovered';

export interface EventPayload extends Envelope {
  event: EventName | string;
  data?: Record<string, unknown>;
}

export function buildEvent(deviceId: string, kennelId: string, event: EventName | string, data?: Record<string, unknown>): EventPayload {
  return { deviceId, kennelId, timestamp: Date.now(), event, data };
}

// ── telemetry (rolling bundle) ──────────────────────────────────────────────
export interface TelemetryPayload extends Envelope {
  metrics: Record<string, number>;
}

export function buildTelemetry(deviceId: string, kennelId: string, metrics: Record<string, number>): TelemetryPayload {
  return { deviceId, kennelId, timestamp: Date.now(), metrics };
}

// ── single sensor metric ────────────────────────────────────────────────────
export interface MetricPayload extends Envelope {
  value: number;
  unit?: string;
}
export function buildMetric(deviceId: string, kennelId: string, value: number, unit?: string): MetricPayload {
  return { deviceId, kennelId, timestamp: Date.now(), value, unit };
}

// ── gps location ────────────────────────────────────────────────────────────
export interface LocationPayload extends Envelope {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  battery?: number;
  fix?: boolean;
}
export function buildLocation(deviceId: string, kennelId: string, loc: Omit<LocationPayload, keyof Envelope>): LocationPayload {
  return { deviceId, kennelId, timestamp: Date.now(), ...loc };
}

// ── presence (BLE tag sighting → multi-dog identification) ───────────────────
export interface PresencePayload extends Envelope {
  /** BLE tag id seen strongest right now, or null when nothing in range */
  tagId: string | null;
  rssi?: number;
  /** other tags in range, strongest first */
  nearby?: Array<{ tagId: string; rssi: number }>;
}
export function buildPresence(deviceId: string, kennelId: string, tagId: string | null, rssi?: number, nearby?: PresencePayload['nearby']): PresencePayload {
  return { deviceId, kennelId, timestamp: Date.now(), tagId, rssi, nearby };
}

// ── two-way audio signalling ────────────────────────────────────────────────
export type AudioSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: string }
  | { kind: 'play'; url: string; loop?: boolean }
  | { kind: 'stop' }
  | { kind: 'talk'; state: 'start' | 'end' };

export interface AudioPayload extends Envelope {
  signal: AudioSignal;
  /** call/session id so both ends correlate */
  session: string;
}
export function buildAudio(deviceId: string, kennelId: string, session: string, signal: AudioSignal): AudioPayload {
  return { deviceId, kennelId, timestamp: Date.now(), session, signal };
}

// ── validation ──────────────────────────────────────────────────────────────
export function isEnvelope(x: unknown): x is Envelope {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.deviceId === 'string'
    && typeof o.kennelId === 'string'
    && typeof o.timestamp === 'number';
}

/** Parse + minimally validate an inbound command. Returns null if malformed. */
export function parseCommand(raw: unknown): (CommandBase & Record<string, unknown>) | null {
  if (!isEnvelope(raw)) return null;
  const o = raw as unknown as Record<string, unknown>;
  if (typeof o.command !== 'string' || o.command.length === 0) return null;
  return o as CommandBase & Record<string, unknown>;
}

export function parseStatus(raw: unknown): StatusPayload | null {
  if (!isEnvelope(raw)) return null;
  const o = raw as unknown as Record<string, unknown>;
  const status = o.status;
  if (status !== 'online' && status !== 'offline' && status !== 'degraded') return null;
  return o as StatusPayload;
}

/** Normalise lastFeed/lastSeen style values (epoch s, epoch ms, ISO) to ms. */
export function toMs(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e12 ? Math.round(v * 1000) : v) : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export const DEVICE_TYPE_OF_COMMAND: Record<string, DeviceType> = {
  feed: 'feeder',
  schedule_set: 'feeder',
  dispense: 'water',
  door: 'door',
  relay: 'door',
};
