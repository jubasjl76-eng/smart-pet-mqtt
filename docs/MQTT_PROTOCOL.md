# MQTT Communication Protocol
## Smart Pet Kennel System

---

## Topic Structure

### Sensor Topics (Publish/Subscribe)

| Topic | Description | QoS |
|-------|-------------|-----|
| `kennel/{kennelId}/sensor/{deviceId}/temperature` | Temperature sensor data | 1 |
| `kennel/{kennelId}/sensor/{deviceId}/humidity` | Humidity sensor data | 1 |
| `kennel/{kennelId}/sensor/{deviceId}/status` | Generic sensor status | 1 |

### Device Status Topics

| Topic | Description | QoS |
|-------|-------------|-----|
| `kennel/{kennelId}/door/{deviceId}/status` | Door open/close status | 1 |
| `kennel/{kennelId}/feeder/{deviceId}/status` | Feeder status + food level | 1 |
| `kennel/{kennelId}/water/{deviceId}/status` | Water dispenser status | 1 |
| `kennel/{kennelId}/camera/{deviceId}/status` | Camera status | 1 |
| `kennel/{kennelId}/gps/{deviceId}/location` | GPS collar location | 1 |

### Command Topics (Subscribe)

| Topic | Description | QoS |
|-------|-------------|-----|
| `kennel/{kennelId}/feeder/{deviceId}/command` | Feeder commands | 2 |
| `kennel/{kennelId}/water/{deviceId}/command` | Water commands | 2 |
| `kennel/{kennelId}/door/{deviceId}/command` | Door commands | 2 |
| `kennel/{kennelId}/device/{deviceId}/restart` | Device restart | 2 |

---

## Payload Formats

### Sensor Payload
```json
{
  "deviceId": "sensor-23",
  "kennelId": "kennel-01",
  "timestamp": 17123123123,
  "value": 21.5,
  "unit": "celsius"
}
```

### Status Payload
```json
{
  "deviceId": "feeder-01",
  "kennelId": "kennel-01",
  "timestamp": 17123123123,
  "status": "online",
  "foodLevel": 75,
  "lastFeed": 1712300000
}
```

### Command Payload
```json
{
  "command": "feed",
  "deviceId": "feeder-01",
  "kennelId": "kennel-01",
  "timestamp": 17123123123,
  "params": {
    "amount": 100
  }
}
```

### GPS Location Payload
```json
{
  "deviceId": "gps-collar-01",
  "kennelId": "kennel-01",
  "timestamp": 17123123123,
  "latitude": 40.4167,
  "longitude": -3.7033,
  "accuracy": 5.2,
  "battery": 85,
  "speed": 3.5,
  "heading": 180
}
```

---

## QoS Levels

| Level | Name | Use Case |
|--------|------|----------|
| 0 | At most once | Sensor data (occasional loss OK) |
| 1 | At least once | Status updates (no loss) |
| 2 | Exactly once | Commands (critical, no duplicates) |

---

## Retained Messages

All status topics should use **retained messages** so new subscribers get the last known state immediately.

---

## MQTT Broker Configuration

### Recommended Brokers
- **EMQX** - Production, scalable
- **Mosquitto** - Lightweight
- **HiveMQ** - Enterprise features

### Connection Parameters
```javascript
{
  host: 'mqtt://localhost:1883',
  clientId: 'smart-pet-client',
  username: 'mqtt-user',
  password: 'mqtt-password',
  cleanSession: false,
  reconnectPeriod: 5000,
  connectTimeout: 30000
}
```

---

## Device Implementation Guide

### ESP32 Example
```cpp
#include <PubSubClient.h>

// Topics
#define TEMP_TOPIC "kennel/kennel-01/sensor/temp-01/temperature"
#define CMD_TOPIC "kennel/kennel-01/feeder/feeder-01/command"

// Reconnection logic
void reconnect() {
  while (!mqttClient.connected()) {
    if (mqttClient.connect("esp32-client", MQTT_USER, MQTT_PASS)) {
      mqttClient.subscribe(CMD_TOPIC, 2); // QoS 2 for commands
    } else {
      delay(5000);
    }
  }
}

void publishSensor(float temperature) {
  DynamicJsonDocument doc(256);
  doc["deviceId"] = "temp-01";
  doc["kennelId"] = "kennel-01";
  doc["timestamp"] = millis();
  doc["value"] = temperature;
  doc["unit"] = "celsius";
  
  String payload;
  serializeJson(doc, payload);
  
  mqttClient.publish(TEMP_TOPIC, payload.c_str(), true, 1); // retained, QoS 1
}
```

---

## Topic Wildcards

| Wildcard | Meaning |
|----------|---------|
| `#` | All subtopics |
| `+` | Single level wildcard |

Examples:
- `kennel/+/sensor/+/temperature` - All temperature sensors in all kennels
- `kennel/kennel-01/#` - All devices in kennel-01

---

## Security

1. **Authentication** - Username/Password or client certificates
2. **Authorization** - ACL to restrict topics per client
3. **TLS/SSL** - Use `mqtts://` for encrypted connections
4. **Firewall** - Only allow known IPs

---

## Error Handling

| Error | Action |
|-------|--------|
| Connection lost | Auto-reconnect with exponential backoff |
| QoS 2 timeout | Retry with duplicate flag |
| Invalid payload | Log error, skip processing |
| Device offline | Publish last will message |

---

# Protocol v2 (adds device types + leaves; same shape)

v2 keeps `kennel/{kennelId}/{deviceType}/{deviceId}/{leaf}` and generalises it so
one scheme covers **breeding kennels (B2B) and pet-owner homes (B2C)** and every
device. `kennelId` is just the tenant string (kennel slug or household id).

`src/topics.ts` + `src/payloads.ts` are the machine-readable version of this section.

## Device types

`feeder | water | door | sensor | gps | camera | scale | hub`

- `door`  — pen / run door: servo or maglock, with an access audit trail
- `scale` — load-cell platform / bowl (HX711): weight readings, "eaten" vs "dispensed"
- `hub`   — the low-cost home Pet Hub / kennel edge box running a trimmed gateway
- `camera` — adds two-way audio signalling on the `audio` leaf

## Leaves

| leaf | dir | QoS | retained | payload |
|---|---|---|---|---|
| `status` | dev→ | 1 | **yes** | `{…,status:"online"|"offline"|"degraded", fw, rssi, uptimeS, …}` |
| `command` | →dev | 2 | no | `{command, id, params}` |
| `ack` | dev→ | 1 | no | `{ackId, command, result:"ok"|"error"|"rejected"|"queued", detail}` |
| `event` | dev→ | 1 | no | `{event, data}` — `boot|fed|dispensed|jam|door_open|low_food|tamper|…` |
| `telemetry` | dev→ | 1 | no | `{metrics:{…}}` rolling bundle |
| `location` | dev→ | 1 | no | `{latitude,longitude,accuracy,altitude,speed,heading,battery,fix}` |
| `presence` | dev→ | 1 | no | `{tagId, rssi, nearby:[{tagId,rssi}]}` — **multi-dog identification** |
| `audio` | both | 1 | no | `{session, signal}` — `offer|answer|ice|play|stop|talk` |
| `<metric>` | dev→ | 1 | no | `{value, unit}` — one of temperature/humidity/airquality/weight/tds/level/battery |

Every payload carries `deviceId`, `kennelId`, `timestamp` (epoch ms; `0` in an LWT).

## Command ids + ack

Every `command` gets an `id`. The device replies on `…/ack` with `ackId` = that id
and `result`. The backend correlates ack + the retained `status` change to close
the loop (feed → ack `ok` → status `foodLevel` drop).

## New commands

| command | device | params |
|---|---|---|
| `feed` | feeder | `{amount}` |
| `schedule_set` | feeder | `{schedules:[{id,time,amount,enabled}]}` |
| `dispense` | water | `{seconds?, ml?}` |
| `door` | door | `{action:"lock"|"unlock"|"open"|"close"|"noop", reason?, holdMs?}` |
| `relay` | door/hub | `{relay, state:"on"|"off", forMs?}` — fans, heat lamps, lights |
| `ota` | any | `{url, version, sha256?}` |
| `restart` | any | — |
| `set_interval` | gps | `{seconds}` |
| `identify` | any | `{seconds?}` — blink LED / chirp to find a device |

## Collar migration

Old: `dogs/{deviceId}/location`, `dogs/{deviceId}/command`.
New: `kennel/{kennelId}/gps/{deviceId}/location`, `…/gps/{deviceId}/command`.
`parseTopic()` rejects the old form; `isLegacyTopic()` detects it for a shim.

## Security (unchanged intent, restated)

- Per-device credentials, username `device:{deviceId}` (never shared, minted on claim)
- Broker ACL: a device may PUB only its own `…/{deviceId}/{status,event,ack,telemetry,location,presence}` and SUB only its own `…/{deviceId}/command`
- `mqtts://` + client certs in production
- `hub` devices get a wider ACL scoped to their kennel prefix
