'use strict';

const Homey = require('homey');
const mqtt = require('mqtt');

/** MQTT Client type from mqtt package */
type MQTTClientType = ReturnType<typeof mqtt.connect>;
type MQTTClientOptions = Parameters<typeof mqtt.connect>[0];

/**
 * MQTT Configuration interface
 */
interface MQTTConfig {
  /** MQTT broker host address */
  host: string;
  /** MQTT broker port */
  port: number;
  /** Optional username for authentication */
  username?: string;
  /** Optional password for authentication */
  password?: string;
  /** Unique client identifier */
  clientId: string;
}

/**
 * Interface for Homey's logging functionality
 */
interface HomeyLogger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/**
 * MQTT Client wrapper for Homey
 * Handles MQTT connection, subscriptions and message handling
 */
class MQTTClient extends Homey.SimpleClass {
  private client: MQTTClientType | null = null;
  private readonly topics: string[] = [];
  private readonly reconnectPeriod = 5000;

  /**
   * Create MQTT client instance
   * @param config - MQTT connection configuration
   * @param logger - Homey device/driver instance for logging
   */
  constructor(
    private readonly config: MQTTConfig,
    private readonly logger: HomeyLogger,
  ) {
    super();
  }

  /**
   * Connect to MQTT broker
   * @throws {Error} If connection fails
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const options: MQTTClientOptions = {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          clientId: this.config.clientId,
          reconnectPeriod: this.reconnectPeriod,
        };

        this.client = mqtt.connect(options);

        this.client.on('connect', () => {
          this.logger.log('Connected to MQTT broker');
          this.resubscribe().catch((error) => {
            this.logger.error('Failed to resubscribe:', error);
          });
          resolve();
        });

        this.client.on('message', (topic: string, message: Buffer) => {
          this.emit('message', topic, message);
        });

        this.client.on('error', (error: Error) => {
          this.logger.error('MQTT error:', error);
          this.emit('error', error);
          reject(error);
        });

        this.client.on('close', () => {
          this.logger.log('MQTT connection closed');
          this.emit('close');
        });
      } catch (error) {
        this.logger.error('Failed to connect to MQTT:', error);
        reject(error);
      }
    });
  }

  /**
   * Subscribe to MQTT topic
   * @param topic - Topic to subscribe to
   * @throws {Error} If client is not connected or subscription fails
   */
  public subscribe(topic: string): Promise<void> {
    if (!this.client) {
      return Promise.reject(new Error('MQTT client not connected'));
    }
    return new Promise((resolve, reject) => {
      this.client!.subscribe(topic, (error: Error | null) => {
        if (error) {
          this.logger.error(`Failed to subscribe to ${topic}:`, error);
          reject(error);
        } else {
          this.topics.push(topic);
          this.logger.log(`Subscribed to ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * Resubscribe to all previously subscribed topics
   * @private
   */
  private async resubscribe(): Promise<void> {
    for (const topic of this.topics) {
      try {
        await this.subscribe(topic);
      } catch (error) {
        this.logger.error(`Failed to resubscribe to ${topic}:`, error);
      }
    }
  }

  /**
   * Publish message to MQTT topic
   * @param topic - Topic to publish to
   * @param message - Message to publish
   * @throws {Error} If client is not connected or publish fails
   */
  public publish(topic: string, message: string): Promise<void> {
    if (!this.client) {
      return Promise.reject(new Error('MQTT client not connected'));
    }
    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, (error: Error | null) => {
        if (error) {
          this.logger.error(`Failed to publish to ${topic}:`, error);
          reject(error);
        } else {
          this.logger.log(`Published to ${topic}: ${message}`);
          resolve();
        }
      });
    });
  }

  /**
   * Disconnect from MQTT broker
   */
  public disconnect(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    return Promise.resolve();
  }
}

module.exports = MQTTClient;
