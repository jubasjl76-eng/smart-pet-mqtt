// Protocol v2 — canonical topic scheme, payloads, and command routing.
export * from './topics.js';
export * from './payloads.js';
export { CommandRouter } from './dispatch.js';
export type { CommandHandler, LeafHandler, InboundContext, PublishFn } from './dispatch.js';

// v1 client/service (still supported; v2 topic helpers work with client.publish).
export { MQTTClient, createMQTTClient } from './client.js';
export { MQTTService } from './service.js';
