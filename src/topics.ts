/**
 * Canonical Smart Pet MQTT topic scheme (protocol v2).
 *
 *   kennel/{kennelId}/{deviceType}/{deviceId}/{leaf}
 *
 * `kennelId` is a tenant string — a breeding kennel slug ("home") for B2B, or a
 * household id for B2C. Same scheme for both. Every device type lives under it,
 * so a backend can subscribe `kennel/{id}/#` and get everything.
 *
 * This module is the single source of truth for topic strings, the QoS/retain
 * policy per leaf, and the wildcard filters a subscriber should use.
 */

export const TOPIC_ROOT = 'kennel';

export type DeviceType =
  | 'feeder'
  | 'water'
  | 'door'
  | 'sensor'
  | 'gps'
  | 'camera'
  | 'scale'
  | 'hub';

export const DEVICE_TYPES: readonly DeviceType[] = [
  'feeder', 'water', 'door', 'sensor', 'gps', 'camera', 'scale', 'hub',
] as const;

/**
 * Leaves (last topic segment).
 *
 *  status       retained device state (also the LWT topic)
 *  command      backend → device instructions (QoS 2)
 *  event        device → backend discrete events (fed, jam, door_open, boot…)
 *  ack          device → backend command acknowledgement
 *  telemetry    device → backend rolling metrics bundle
 *  location     GPS fixes
 *  presence     BLE tag sightings (which animal is at a shared device / pen)
 *  audio        two-way audio signalling (WebRTC offer/answer/ice, or relay ctl)
 *  <metric>     a single sensor metric (temperature | humidity | airquality | weight | tds …)
 */
export type Leaf =
  | 'status'
  | 'command'
  | 'event'
  | 'ack'
  | 'telemetry'
  | 'location'
  | 'presence'
  | 'audio'
  | string; // metric leaves

export const SENSOR_METRICS = [
  'temperature', 'humidity', 'airquality', 'weight', 'tds', 'level', 'battery',
] as const;
export type SensorMetric = (typeof SENSOR_METRICS)[number];

export interface TopicParts {
  kennelId: string;
  deviceType: DeviceType;
  deviceId: string;
  leaf: Leaf;
}

const SEGMENT_OK = /^[A-Za-z0-9._:-]+$/;

export function isValidSegment(s: string): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= 128 && SEGMENT_OK.test(s);
}

export function buildTopic(
  kennelId: string,
  deviceType: DeviceType,
  deviceId: string,
  leaf: Leaf
): string {
  for (const [k, v] of Object.entries({ kennelId, deviceType, deviceId, leaf })) {
    if (!isValidSegment(v)) throw new Error(`Invalid topic segment ${k}="${v}"`);
  }
  return `${TOPIC_ROOT}/${kennelId}/${deviceType}/${deviceId}/${leaf}`;
}

export function parseTopic(topic: string): TopicParts | null {
  const parts = topic.split('/');
  if (parts.length !== 5) return null;
  const [root, kennelId, deviceType, deviceId, leaf] = parts;
  if (root !== TOPIC_ROOT) return null;
  if (!DEVICE_TYPES.includes(deviceType as DeviceType)) return null;
  if (!isValidSegment(kennelId) || !isValidSegment(deviceId) || !isValidSegment(leaf)) return null;
  return { kennelId, deviceType: deviceType as DeviceType, deviceId, leaf };
}

// Convenience builders ───────────────────────────────────────────────────────
export const statusTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'status');
export const commandTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'command');
export const eventTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'event');
export const ackTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'ack');
export const telemetryTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'telemetry');
export const locationTopic = (k: string, d: string) => buildTopic(k, 'gps', d, 'location');
export const presenceTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'presence');
export const audioTopic = (k: string, t: DeviceType, d: string) => buildTopic(k, t, d, 'audio');
export const metricTopic = (k: string, t: DeviceType, d: string, metric: SensorMetric | string) =>
  buildTopic(k, t, d, metric);

// QoS / retain policy ────────────────────────────────────────────────────────
export type Qos = 0 | 1 | 2;

export interface DeliveryPolicy {
  qos: Qos;
  retain: boolean;
}

/**
 * The contract's delivery guarantees, keyed by leaf.
 *  - commands: exactly-once (QoS 2), never retained
 *  - status:   at-least-once, retained (new subscribers get last known state; LWT clears)
 *  - events / ack: at-least-once, not retained
 *  - telemetry / metrics / location / presence: at-least-once, not retained
 *  - audio signalling: at-least-once, not retained
 */
export function deliveryFor(leaf: Leaf): DeliveryPolicy {
  switch (leaf) {
    case 'command': return { qos: 2, retain: false };
    case 'status': return { qos: 1, retain: true };
    case 'event':
    case 'ack':
    case 'telemetry':
    case 'location':
    case 'presence':
    case 'audio':
      return { qos: 1, retain: false };
    default:
      // metric leaves
      return { qos: 1, retain: false };
  }
}

// Subscription filters ───────────────────────────────────────────────────────

/** Everything for one kennel. */
export const kennelWildcard = (kennelId: string) => `${TOPIC_ROOT}/${kennelId}/#`;

/** One leaf across every device of a type, in every kennel (backend fan-in). */
export const allOf = (deviceType: DeviceType, leaf: Leaf) =>
  `${TOPIC_ROOT}/+/${deviceType}/+/${leaf}`;

/** Every command a single device must listen to. */
export const deviceCommandFilter = (kennelId: string, deviceType: DeviceType, deviceId: string) =>
  commandTopic(kennelId, deviceType, deviceId);

/** The set of filters a backend consumer typically wants. */
export function backendSubscriptions(): Array<{ filter: string; qos: Qos }> {
  return [
    { filter: allOf('feeder', 'status'), qos: 1 },
    { filter: allOf('water', 'status'), qos: 1 },
    { filter: allOf('door', 'status'), qos: 1 },
    { filter: allOf('scale', 'status'), qos: 1 },
    { filter: allOf('hub', 'status'), qos: 1 },
    { filter: `${TOPIC_ROOT}/+/+/+/event`, qos: 1 },
    { filter: `${TOPIC_ROOT}/+/+/+/ack`, qos: 1 },
    { filter: `${TOPIC_ROOT}/+/+/+/telemetry`, qos: 1 },
    { filter: `${TOPIC_ROOT}/+/sensor/+/+`, qos: 1 },
    { filter: `${TOPIC_ROOT}/+/gps/+/location`, qos: 1 },
    { filter: `${TOPIC_ROOT}/+/+/+/presence`, qos: 1 },
  ];
}

/** True for topics that are NOT part of the v2 scheme (legacy `dogs/…`, `devices/…`). */
export function isLegacyTopic(topic: string): boolean {
  return topic.startsWith('dogs/') || topic.startsWith('devices/') || topic.includes('/telemetry/');
}

/** MQTT wildcard match (`+` one level, `#` rest). */
export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] === '+') continue;
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
