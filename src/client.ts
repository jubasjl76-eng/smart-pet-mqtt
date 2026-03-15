/**
 * MQTT Client Library for Smart Pet System
 * Handles connection, reconnection, and message formatting
 */

import mqtt, { MqttClient, IClientOptions } from 'mqtt';

export interface MQTTConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  clientId?: string;
}

export interface SensorPayload {
  deviceId: string;
  kennelId: string;
  timestamp: number;
  value: number;
  unit?: string;
}

export interface StatusPayload {
  deviceId: string;
  kennelId: string;
  timestamp: number;
  status: 'online' | 'offline';
  [key: string]: any;
}

export interface CommandPayload {
  command: string;
  deviceId: string;
  kennelId: string;
  timestamp: number;
  params?: Record<string, any>;
}

export class MQTTClient {
  private client: MqttClient | null = null;
  private config: MQTTConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private messageHandlers: Map<string, (topic: string, payload: any) => void> = new Map();

  constructor(config: MQTTConfig) {
    this.config = {
      clientId: `smart-pet-${Math.random().toString(16).slice(2, 10)}`,
      ...config
    };
  }

  /**
   * Connect to MQTT broker
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `mqtt://${this.config.host}:${this.config.port}`;
      
      const options: IClientOptions = {
        clientId: this.config.clientId,
        clean: false,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        reconnectAttempts: this.maxReconnectAttempts,
      };

      if (this.config.username && this.config.password) {
        options.username = this.config.username;
        options.password = this.config.password;
      }

      console.log(`[MQTT] Connecting to ${url}...`);
      
      this.client = mqtt.connect(url, options);

      this.client.on('connect', () => {
        console.log('[MQTT] Connected successfully');
        this.reconnectAttempts = 0;
        resolve();
      });

      this.client.on('error', (error) => {
        console.error('[MQTT] Connection error:', error);
        reject(error);
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        console.log(`[MQTT] Reconnecting... (attempt ${this.reconnectAttempts})`);
      });

      this.client.on('offline', () => {
        console.log('[MQTT] Client offline');
      });

      this.client.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          console.log(`[MQTT] Message on ${topic}:`, payload);
          
          // Call registered handlers
          this.messageHandlers.forEach((handler, pattern) => {
            if (this.matchTopic(topic, pattern)) {
              handler(topic, payload);
            }
          });
        } catch (error) {
          console.error('[MQTT] Failed to parse message:', error);
        }
      });
    });
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic: string, qos: 0 | 1 | 2 = 1): void {
    if (!this.client) {
      throw new Error('MQTT client not connected');
    }
    
    this.client.subscribe(topic, { qos }, (err) => {
      if (err) {
        console.error(`[MQTT] Subscribe error for ${topic}:`, err);
      } else {
        console.log(`[MQTT] Subscribed to ${topic} (QoS ${qos})`);
      }
    });
  }

  /**
   * Publish to a topic
   */
  publish(topic: string, payload: any, qos: 0 | 1 | 2 = 1, retained: boolean = false): void {
    if (!this.client) {
      throw new Error('MQTT client not connected');
    }

    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client.publish(topic, message, { qos, retained });
    console.log(`[MQTT] Published to ${topic}:`, payload);
  }

  /**
   * Publish sensor data
   */
  publishSensor(kennelId: string, deviceId: string, type: string, value: number, unit?: string): void {
    const topic = `kennel/${kennelId}/sensor/${deviceId}/${type}`;
    const payload: SensorPayload = {
      deviceId,
      kennelId,
      timestamp: Date.now(),
      value,
      unit
    };
    this.publish(topic, payload, 1, true); // QoS 1, retained
  }

  /**
   * Publish device status
   */
  publishStatus(kennelId: string, deviceType: string, deviceId: string, status: StatusPayload): void {
    const topic = `kennel/${kennelId}/${deviceType}/${deviceId}/status`;
    this.publish(topic, status, 1, true); // QoS 1, retained
  }

  /**
   * Subscribe to commands for a device
   */
  subscribeToCommands(kennelId: string, deviceType: string, deviceId: string, handler: (payload: CommandPayload) => void): void {
    const topic = `kennel/${kennelId}/${deviceType}/${deviceId}/command`;
    this.subscribe(topic, 2); // QoS 2 for commands
    
    this.messageHandlers.set(topic, (_topic, payload) => {
      handler(payload as CommandPayload);
    });
  }

  /**
   * Register a message handler for a topic pattern
   */
  onMessage(topicPattern: string, handler: (topic: string, payload: any) => void): void {
    this.messageHandlers.set(topicPattern, handler);
    
    // Subscribe to the pattern
    if (this.client?.connected) {
      this.subscribe(topicPattern, 1);
    }
  }

  /**
   * Disconnect from broker
   */
  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      console.log('[MQTT] Disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Simple topic matching with wildcards
   */
  private matchTopic(topic: string, pattern: string): boolean {
    if (pattern === topic) return true;
    
    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') return true;
      if (patternParts[i] === '+') continue;
      if (patternParts[i] !== topicParts[i]) return false;
    }
    
    return patternParts.length === topicParts.length;
  }
}

// Factory function for quick setup
export function createMQTTClient(config: MQTTConfig): MQTTClient {
  return new MQTTClient(config);
}
