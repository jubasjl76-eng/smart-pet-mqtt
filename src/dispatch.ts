/**
 * CommandRouter — turn inbound MQTT messages into typed handler calls, and
 * produce the matching ack. Replaces the per-device-type TODO stubs.
 *
 * Works on either side:
 *  - a device registers handlers for its own `(deviceType, command)` pairs
 *  - a backend registers handlers for `event` / `ack` / `status` / metric leaves
 *
 * It does not own an MQTT connection; feed it `(topic, rawPayload)` and it calls
 * back with `publish(topic, payload, policy)` when a handler returns an ack.
 */
import {
  parseTopic, deliveryFor, type DeviceType, type Leaf, type DeliveryPolicy,
  topicMatches,
} from './topics.js';
import {
  parseCommand, buildAck, type AckPayload, type CommandBase,
} from './payloads.js';

export interface InboundContext {
  topic: string;
  kennelId: string;
  deviceType: DeviceType;
  deviceId: string;
  leaf: Leaf;
  raw: unknown;
}

export type CommandHandler = (
  cmd: CommandBase & Record<string, unknown>,
  ctx: InboundContext
) => void | AckPayload | Promise<void | AckPayload>;

export type LeafHandler = (payload: unknown, ctx: InboundContext) => void | Promise<void>;

export interface PublishFn {
  (topic: string, payload: unknown, policy: DeliveryPolicy): void | Promise<void>;
}

type CommandKey = `${DeviceType | '*'}:${string}`;

export class CommandRouter {
  private commandHandlers = new Map<CommandKey, CommandHandler>();
  private leafHandlers: Array<{ filter: string; handler: LeafHandler }> = [];
  private publish?: PublishFn;

  constructor(publish?: PublishFn) {
    this.publish = publish;
  }

  setPublisher(fn: PublishFn): void {
    this.publish = fn;
  }

  /** Register a handler for a command, optionally scoped to a device type. */
  onCommand(command: string, handler: CommandHandler): this;
  onCommand(deviceType: DeviceType, command: string, handler: CommandHandler): this;
  onCommand(a: string, b: string | CommandHandler, c?: CommandHandler): this {
    if (typeof b === 'function') {
      this.commandHandlers.set(`*:${a}`, b);
    } else if (c) {
      this.commandHandlers.set(`${a as DeviceType}:${b}`, c);
    }
    return this;
  }

  /** Register a handler for a non-command leaf, by topic filter (wildcards ok). */
  onLeaf(filter: string, handler: LeafHandler): this {
    this.leafHandlers.push({ filter, handler });
    return this;
  }

  /** The set of subscription filters implied by the registered handlers. */
  subscriptions(): string[] {
    const subs = new Set<string>();
    for (const key of this.commandHandlers.keys()) {
      const [dt] = key.split(':') as [DeviceType | '*'];
      subs.add(dt === '*' ? 'kennel/+/+/+/command' : `kennel/+/${dt}/+/command`);
    }
    for (const { filter } of this.leafHandlers) subs.add(filter);
    return [...subs];
  }

  /** Feed one inbound message. Returns the ack it published (if any). */
  async handle(topic: string, rawPayload: Buffer | string | unknown): Promise<AckPayload | null> {
    const parts = parseTopic(topic);
    if (!parts) return null;

    let raw: unknown = rawPayload;
    if (Buffer.isBuffer(rawPayload) || typeof rawPayload === 'string') {
      try { raw = JSON.parse(rawPayload.toString()); } catch { return null; }
    }
    const ctx: InboundContext = { topic, ...parts, raw };

    if (parts.leaf === 'command') {
      return this.dispatchCommand(ctx);
    }
    for (const { filter, handler } of this.leafHandlers) {
      if (topicMatches(filter, topic)) await handler(raw, ctx);
    }
    return null;
  }

  private async dispatchCommand(ctx: InboundContext): Promise<AckPayload | null> {
    const cmd = parseCommand(ctx.raw);
    if (!cmd) return null;

    const handler =
      this.commandHandlers.get(`${ctx.deviceType}:${cmd.command}`) ??
      this.commandHandlers.get(`*:${cmd.command}`);

    if (!handler) {
      return this.emitAck(ctx, cmd, 'rejected', `no handler for ${ctx.deviceType}:${cmd.command}`);
    }

    try {
      const result = await handler(cmd, ctx);
      if (result && typeof result === 'object' && 'ackId' in result) {
        await this.publishAck(ctx, result as AckPayload);
        return result as AckPayload;
      }
      return this.emitAck(ctx, cmd, 'ok');
    } catch (err) {
      return this.emitAck(ctx, cmd, 'error', (err as Error).message);
    }
  }

  private async emitAck(
    ctx: InboundContext,
    cmd: CommandBase,
    result: AckPayload['result'],
    detail?: string
  ): Promise<AckPayload> {
    const ack = buildAck({
      deviceId: ctx.deviceId, kennelId: ctx.kennelId,
      ackId: cmd.id ?? '', command: cmd.command, result, detail,
    });
    await this.publishAck(ctx, ack);
    return ack;
  }

  private async publishAck(ctx: InboundContext, ack: AckPayload): Promise<void> {
    if (!this.publish) return;
    const topic = `kennel/${ctx.kennelId}/${ctx.deviceType}/${ctx.deviceId}/ack`;
    await this.publish(topic, ack, deliveryFor('ack'));
  }
}
