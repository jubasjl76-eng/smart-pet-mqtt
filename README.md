# smart-pet-mqtt

The **protocol contract** for the Smart Pet device ecosystem plus a small
TypeScript client. Import this in the backend, the edge gateway, and any Node
service; the firmware SDK (`smart-pet-device-sdk`) mirrors the same scheme in C++.

> This is not a broker deployment. Mosquitto/EMQX live in the compose files of the
> services that need them.

## Topic scheme (v2)

```
kennel/{kennelId}/{deviceType}/{deviceId}/{leaf}
```

- `kennelId` — tenant string. Breeding-kennel slug (`home`) for B2B, household id for B2C. **Same scheme for both.**
- `deviceType` — `feeder | water | door | sensor | gps | camera | scale | hub`
- `leaf` — `status | command | event | ack | telemetry | location | presence | audio` or a single metric (`temperature`, `humidity`, `airquality`, `weight`, `tds`, `level`, `battery`)

### Delivery policy (`deliveryFor(leaf)`)

| leaf | QoS | retained |
|---|---|---|
| `command` | 2 | no |
| `status` (and the LWT) | 1 | **yes** |
| `event`, `ack`, `telemetry`, `location`, `presence`, `audio`, metrics | 1 | no |

### Examples

```
kennel/home/feeder/feeder-01/command      QoS 2   {command:"feed", id, params:{amount:40}}
kennel/home/feeder/feeder-01/status       QoS 1 retained
kennel/home/feeder/feeder-01/ack          QoS 1   {ackId, command:"feed", result:"ok"}
kennel/home/door/pen-3/command            QoS 2   {command:"door", params:{action:"unlock"}}
kennel/home/scale/bowl-1/weight           QoS 1   {value: 4120, unit:"g"}
kennel/home/feeder/feeder-01/presence     QoS 1   {tagId:"tag-7", rssi:-55}   ← multi-dog id
kennel/home/gps/collar-01/location        QoS 1
kennel/home/camera/cam-1/audio            QoS 1   {session, signal:{kind:"talk",state:"start"}}
```

Legacy `dogs/{id}/…` (collar) and `devices/{id}/…` are **not** part of v2 —
`isLegacyTopic()` / `parseTopic()` reject them.

## Usage

```ts
import {
  buildTopic, deliveryFor, buildFeed, buildDoor, CommandRouter,
} from 'smart-pet-mqtt';

// backend → device
const cmd = buildFeed('feeder-01', 'home', 40);
const topic = buildTopic('home', 'feeder', 'feeder-01', 'command');
client.publish(topic, JSON.stringify(cmd), deliveryFor('command'));

// inbound routing (device or backend side)
const router = new CommandRouter((t, p, policy) =>
  client.publish(t, JSON.stringify(p), { qos: policy.qos, retain: policy.retain })
);
router
  .onCommand('feeder', 'feed', async (cmd) => { await dispense(cmd.params.amount); })
  .onCommand('door', 'door', async (cmd) => { await door(cmd.params.action); })
  .onLeaf('kennel/+/+/+/event', (payload, ctx) => persistEvent(ctx.deviceId, payload));

client.on('message', (t, m) => router.handle(t, m)); // auto-publishes the ack
mqtt.subscribe(router.subscriptions());
```

`MQTTClient` / `MQTTService` (v1) still ship and work; the v2 helpers produce
topic strings and payloads you pass straight to `client.publish`.

## Scripts

```
npm run build       # tsc → dist/
npm run typecheck
npm test            # vitest (topics, payloads, CommandRouter)
```

## Modules

| file | purpose |
|---|---|
| `src/topics.ts` | topic build/parse, QoS/retain policy, wildcard filters |
| `src/payloads.ts` | typed payloads + builders + validators for every leaf |
| `src/dispatch.ts` | `CommandRouter` — inbound message → typed handler + ack |
| `src/client.ts` | v1 `MQTTClient` (connection, reconnect, pub/sub) |
| `src/service.ts` | v1 `MQTTService` |
| `docs/MQTT_PROTOCOL.md` | the full written contract |
