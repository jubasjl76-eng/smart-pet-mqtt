/**
 * MQTT Integration Service
 * Connects the backend to MQTT broker for IoT communication
 */

import { MQTTClient, createMQTTClient } from './client.js';

interface MQTTConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

class MQTTService {
  private client: MQTTClient | null = null;
  private config: MQTTConfig;

  constructor(config: MQTTConfig) {
    this.config = config;
  }

  /**
   * Initialize MQTT connection
   */
  async initialize(): Promise<void> {
    this.client = createMQTTClient(this.config);
    
    await this.client.connect();
    
    // Subscribe to all command topics
    this.subscribeToCommands();
    
    // Set up message handlers
    this.setupHandlers();
    
    console.log('[MQTT Service] Initialized and ready');
  }

  /**
   * Subscribe to device command topics
   */
  private subscribeToCommands(): void {
    if (!this.client) return;

    // Subscribe to all feeder commands
    this.client.subscribe('kennel/+/feeder/+/command', 2);
    this.client.subscribe('kennel/+/water/+/command', 2);
    this.client.subscribe('kennel/+/door/+/command', 2);
    this.client.subscribe('kennel/+/device/+/restart', 2);
  }

  /**
   * Set up message handlers for different device types
   */
  private setupHandlers(): void {
    if (!this.client) return;

    // Feeder commands
    this.client.onMessage('kennel/+/feeder/+/command', (topic, payload) => {
      console.log('[MQTT Service] Feeder command:', payload);
      // TODO: Call backend controller to execute command
    });

    // Water commands
    this.client.onMessage('kennel/+/water/+/command', (topic, payload) => {
      console.log('[MQTT Service] Water command:', payload);
      // TODO: Call backend controller to execute command
    });

    // Door commands
    this.client.onMessage('kennel/+/door/+/command', (topic, payload) => {
      console.log('[MQTT Service] Door command:', payload);
      // TODO: Call backend controller to execute command
    });

    // Device restart
    this.client.onMessage('kennel/+/device/+/restart', (topic, payload) => {
      console.log('[MQTT Service] Restart command:', payload);
      // TODO: Trigger device restart
    });
  }

  /**
   * Publish sensor data from a device
   */
  publishSensorData(kennelId: string, deviceId: string, type: string, value: number, unit?: string): void {
    if (!this.client?.isConnected()) {
      console.warn('[MQTT Service] Client not connected, cannot publish');
      return;
    }

    this.client.publishSensor(kennelId, deviceId, type, value, unit);
  }

  /**
   * Publish temperature sensor data
   */
  publishTemperature(kennelId: string, deviceId: string, temperature: number): void {
    this.publishSensorData(kennelId, deviceId, 'temperature', temperature, 'celsius');
  }

  /**
   * Publish humidity sensor data
   */
  publishHumidity(kennelId: string, deviceId: string, humidity: number): void {
    this.publishSensorData(kennelId, deviceId, 'humidity', humidity, 'percent');
  }

  /**
   * Publish feeder status
   */
  publishFeederStatus(kennelId: string, deviceId: string, status: any): void {
    if (!this.client?.isConnected()) return;

    const topic = `kennel/${kennelId}/feeder/${deviceId}/status`;
    this.client.publish(topic, {
      ...status,
      deviceId,
      kennelId,
      timestamp: Date.now()
    }, 1, true);
  }

  /**
   * Publish water dispenser status
   */
  publishWaterStatus(kennelId: string, deviceId: string, status: any): void {
    if (!this.client?.isConnected()) return;

    const topic = `kennel/${kennelId}/water/${deviceId}/status`;
    this.client.publish(topic, {
      ...status,
      deviceId,
      kennelId,
      timestamp: Date.now()
    }, 1, true);
  }

  /**
   * Publish GPS location
   */
  publishGPSLocation(kennelId: string, deviceId: string, location: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    battery?: number;
    speed?: number;
    heading?: number;
  }): void {
    if (!this.client?.isConnected()) return;

    const topic = `kennel/${kennelId}/gps/${deviceId}/location`;
    this.client.publish(topic, {
      deviceId,
      kennelId,
      timestamp: Date.now(),
      ...location
    }, 1, true);
  }

  /**
   * Disconnect MQTT client
   */
  disconnect(): void {
    this.client?.disconnect();
    console.log('[MQTT Service] Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }
}

export { MQTTService };
