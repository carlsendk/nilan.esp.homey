'use strict';

const Homey = require('homey');
const MQTTClient = require('../../lib/mqtt-client');

/**
 * Flow card argument types
 */
interface FlowCardTriggerArgs {
  /** Selected temperature sensor (indoor/outdoor/exhaust) */
  sensor?: 'indoor' | 'outdoor' | 'exhaust';
  /** Temperature threshold value */
  threshold?: number;
}

interface FlowCardConditionArgs {
  /** Fan mode selection */
  mode?: 'auto' | 'low' | 'medium' | 'high';
}

interface FlowCardActionArgs {
  /** Fan mode to set */
  mode: 'auto' | 'low' | 'medium' | 'high';
}

interface TemperatureState {
  /** Which temperature sensor triggered the event */
  sensor: 'indoor' | 'outdoor' | 'exhaust';
  /** Current temperature value */
  temperature: number;
}

/** Empty interface for states that don't need data */
interface EmptyState {}

interface MQTTSettings {
  mqttHost: string;
  mqttPort: number;
  mqttUsername?: string;
  mqttPassword?: string;
}

interface FanSpeedMap {
  [key: string]: string;
  low: string;
  medium: string;
  high: string;
  auto: string;
}

/**
 * Topic structure interface
 */
interface TopicStructure {
  [key: string]: string | TopicStructure;
}

interface NilanTopics {
  values: {
    temperature: {
      current: string;
      target: string;
      controller: string;
      inlet: string;
      outdoor: string;
      exhaust: string;
      outlet: string;
      room: string;
    };
    humidity: string;
    bypass: string;
    filter: string;
    fan: {
      inlet: string;
      exhaust: string;
      speed: string;
    };
    mode: string;
    run: string;
    vent: string;
    tempSet: string;
    efficiency: string;
    summerMode: string;
    userFunc: string;
  };
  commands: {
    mode: string;
    temperature: string;
    fan: {
      speed: string;
      power: string;
    };
    userFunc: string;
  };
}

interface MQTTError extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  address?: string;
  port?: number;
}

/**
 * Nilan HVAC Device implementation
 * Handles communication with a Nilan HVAC system via MQTT
 */
class NilanHVACDevice extends Homey.Device {
  private mqttClient: typeof MQTTClient | null = null;
  private mqttConnected = false;
  private readonly topics: NilanTopics = {
    values: {
      temperature: {
        current: 'ap/technical/ventilation/temp/T7_Inlet', // Main indoor temperature
        target: 'ap/technical/ventilation/control/TempSet', // Target temperature state
        controller: 'ap/technical/ventilation/temp/T0_Controller',
        outdoor: 'ap/technical/ventilation/temp/T8_Outdoor',
        exhaust: 'ap/technical/ventilation/temp/T3_Exhaust',
        outlet: 'ap/technical/ventilation/temp/T4_Outlet',
        room: 'ap/technical/ventilation/temp/T15_Room',
        inlet: '',
      },
      humidity: 'ap/technical/ventilation/humidity/RH',
      bypass: 'ap/technical/ventilation/display/AirBypass/IsOpen',
      filter: 'ap/technical/ventilation/info/AirFilter',
      fan: {
        inlet: 'ap/technical/ventilation/speed/InletSpeed',
        exhaust: 'ap/technical/ventilation/speed/ExhaustSpeed',
        speed: 'ap/technical/ventilation/control/VentSet',
      },
      mode: 'ap/technical/ventilation/control/ModeSet',
      run: 'ap/technical/ventilation/control/RunSet',
      vent: 'ap/technical/ventilation/control/VentSet',
      tempSet: 'ap/technical/ventilation/control/TempSet',
      efficiency: 'ap/technical/ventilation/inputairtemp/EffPct',
      summerMode: 'ap/technical/ventilation/inputairtemp/IsSummer',
      userFunc: 'ap/technical/ventilation/user/UserFuncAct',
    },
    commands: {
      mode: 'ap/technical/ventilation/control/ModeSet',
      temperature: 'convert/tempset', // Command topic for setting temperature
      fan: {
        speed: 'ap/technical/ventilation/ventset',
        power: 'ap/technical/ventilation/runset',
      },
      userFunc: 'ap/technical/ventilation/user/UserFuncSet',
    },
  };

  // Value conversions from config.yaml
  private valueConverters = {
    mode: {
      toDevice: (mode: string): string => {
        const modes: Record<string, string> = {
          off: '0',
          heat: '1',
          cool: '2',
          auto: '3',
        };
        return modes[mode] || '0';
      },
      fromDevice: (value: string): string => {
        const modes: Record<string, string> = {
          0: 'off',
          1: 'heat',
          2: 'cool',
          3: 'auto',
        };
        return modes[value] || 'off';
      },
    },
    temperature: {
      // HA uses multiply(0.01) for temperature values
      toDevice: (value: number): string => Math.round(value * 100).toString(),
      fromDevice: (value: string): number => parseFloat(value) * 0.01,
    },
    fanSpeed: {
      // HA uses multiply(0.01) for fan speed percentage
      fromDevice: (value: string): number => parseFloat(value) * 0.01,
    },
    efficiency: {
      // Convert raw value (0-10000) to percentage (0-100)
      fromDevice: (value: string): number => {
        const rawValue = parseFloat(value);
        return Math.round(rawValue * 0.01); // Convert to percentage and round
      },
    },
  };

  private readonly fanSpeedMap: FanSpeedMap = {
    low: '1',
    medium: '2',
    high: '3',
    auto: '4',
  };

  private readonly fanSpeedMapReverse: { [key: string]: string } = {
    1: 'low',
    2: 'medium',
    3: 'high',
    4: 'auto',
  };

  private readonly MQTT_RETRY_INTERVAL = 30000; // 30 seconds
  private mqttReconnectTimer: NodeJS.Timeout | null = null;

  /**
   * Device initialization
   */
  async onInit(): Promise<void> {
    try {
      this.log('Initializing Nilan HVAC device');

      await this.initializeCapabilities();
      await this.registerCapabilityListeners();
      await this.registerFlowCards();

      // Try MQTT connection but don't fail if it doesn't work
      try {
        await this.initializeMQTT();
      } catch (error) {
        this.error('MQTT connection failed, device will work with limited functionality:', error);
        // Device can still work without MQTT, just with limited functionality
      }

      this.log('Nilan HVAC device initialized successfully');
    } catch (error) {
      this.error('Failed to initialize device:', error);
      throw error;
    }
  }

  /**
   * Initialize device capabilities and set default values
   */
  private async initializeCapabilities(): Promise<void> {
    const capabilities = [
      { name: 'fan_mode', defaultValue: 'auto' },
      { name: 'nilan_bypass', defaultValue: false },
      { name: 'alarm_filter_change', defaultValue: false },
      { name: 'measure_humidity', defaultValue: 45 },
      { name: 'measure_temperature', defaultValue: 20 },
      { name: 'measure_temperature_outdoor', defaultValue: 20 },
      { name: 'measure_temperature_exhaust', defaultValue: 20 },
      { name: 'measure_heat_exchanger_efficiency', defaultValue: 0 },
    ];

    for (const cap of capabilities) {
      try {
        if (!this.hasCapability(cap.name)) {
          this.log(`Adding missing capability: ${cap.name}`);
          await this.addCapability(cap.name);
        }
        await this.setCapabilityValueSafe(cap.name, cap.defaultValue);
      } catch (error) {
        this.error(`Failed to initialize capability ${cap.name}:`, error);
        // Continue with other capabilities even if one fails
      }
    }
  }

  /**
   * Register capability listeners for user interactions
   */
  private async registerCapabilityListeners(): Promise<void> {
    try {
      await this.registerCapabilityListener('target_temperature', this.onTargetTemperature.bind(this));
      await this.registerCapabilityListener('thermostat_mode', this.onThermostatMode.bind(this));
      await this.registerCapabilityListener('fan_mode', this.onFanMode.bind(this));
    } catch (error) {
      this.error('Failed to register capability listeners:', error);
      throw error;
    }
  }

  /**
   * Register flow cards for automation
   */
  private async registerFlowCards(): Promise<void> {
    try {
      // Register triggers
      await this.homey.flow.getDeviceTriggerCard('bypass_activated')
        .registerRunListener((args: FlowCardTriggerArgs, state: EmptyState) => {
          this.log('Bypass activation triggered');
          return true;
        });

      this.homey.flow.getDeviceTriggerCard('temperature_threshold')
        .registerRunListener((args: FlowCardTriggerArgs, state: TemperatureState) => {
          if (typeof args.threshold === 'undefined') {
            this.error('Temperature threshold not defined');
            return false;
          }
          this.log(`Temperature threshold check: ${state.temperature} >= ${args.threshold}`);
          return state.temperature >= args.threshold;
        });

      // Register conditions
      this.homey.flow.getConditionCard('is_bypass_active')
        .registerRunListener(async (args: FlowCardConditionArgs, state: EmptyState) => {
          const bypassState = await this.getCapabilityValue('nilan_bypass');
          this.log(`Bypass state check: ${bypassState}`);
          return bypassState === 'true';
        });

      this.homey.flow.getConditionCard('fan_mode_is')
        .registerRunListener(async (args: FlowCardConditionArgs, state: EmptyState) => {
          if (typeof args.mode === 'undefined') {
            this.error('Fan mode not defined in condition');
            return false;
          }
          const currentMode = await this.getCapabilityValue('fan_mode');
          this.log(`Fan mode check: ${currentMode} === ${args.mode}`);
          return currentMode === args.mode;
        });

      // Register actions
      this.homey.flow.getActionCard('set_fan_mode')
        .registerRunListener(async (args: FlowCardActionArgs, state: EmptyState) => {
          this.log(`Setting fan mode to: ${args.mode}`);
          await this.setCapabilityValue('fan_mode', args.mode);
          return true;
        });
    } catch (error) {
      this.error('Failed to register flow cards:', error);
      throw error;
    }
  }

  /**
   * Handle target temperature changes
   * @param value - New temperature value (10-28°C)
   */
  async onTargetTemperature(value: number): Promise<void> {
    try {
      this.log('Target temperature changed to:', value);

      // Validate temperature range
      if (value < 10 || value > 28) {
        throw new Error(`Temperature out of range [10-28]: ${value}`);
      }

      if (this.mqttConnected && this.mqttClient) {
        // Convert to device format (multiply by 100)
        const deviceValue = Math.round(value * 100).toString();
        await this.mqttClient.publish('convert/tempset', deviceValue);
        this.log(`Published target temperature: ${value}°C (${deviceValue})`);
      }

      await this.setCapabilityValue('target_temperature', value);
    } catch (error) {
      this.error('Failed to set target temperature:', error);
      throw error;
    }
  }

  /**
   * Handle thermostat mode changes
   */
  async onThermostatMode(value: 'auto' | 'heat' | 'cool'): Promise<void> {
    try {
      await this.log('Thermostat mode changed to:', value);
      await this.setCapabilityValue('thermostat_mode', value);

      if (this.mqttConnected && this.mqttClient) {
        await this.mqttClient.publish(this.topics.commands.mode, this.valueConverters.mode.toDevice(value));
      }
    } catch (error) {
      this.error('Failed to set thermostat mode:', error);
      throw error;
    }
  }

  /**
   * Handle fan mode changes
   */
  async onFanMode(value: 'low' | 'medium' | 'high' | 'auto'): Promise<void> {
    try {
      this.log('Fan mode changed to:', value);

      if (this.mqttConnected && this.mqttClient) {
        // Always set RunSet to 1 (on) when changing speed
        await this.mqttClient.publish(
          this.topics.commands.fan.power,
          '1',
        );

        // Set the fan speed
        await this.mqttClient.publish(
          this.topics.commands.fan.speed,
          this.fanSpeedMap[value],
        );

        await this.setCapabilityValue('fan_mode', value);
      }
    } catch (error) {
      this.error('Failed to set fan mode:', error);
      throw error;
    }
  }

  /**
   * Handle incoming fan speed messages
   */
  private async handleFanSpeed(value: string): Promise<void> {
    // Convert percentage to fan mode
    const speedPercent = this.valueConverters.fanSpeed.fromDevice(value);
    let mode: string;

    if (speedPercent <= 25) {
      mode = 'low';
    } else if (speedPercent <= 50) {
      mode = 'medium';
    } else if (speedPercent <= 75) {
      mode = 'high';
    } else {
      mode = 'auto';
    }

    await this.setCapabilityValue('fan_mode', mode);
    this.log(`Mapped fan speed ${speedPercent}% to mode: ${mode}`);
  }

  /**
   * Initialize MQTT connection with retry
   */
  private async initializeMQTT(): Promise<void> {
    try {
      const settings = this.getSettings();

      if (!settings.mqttHost) {
        this.log('No MQTT host configured, skipping connection');
        return;
      }

      // Clear any existing reconnect timer
      if (this.mqttReconnectTimer) {
        this.homey.clearTimeout(this.mqttReconnectTimer);
        this.mqttReconnectTimer = null;
      }

      this.mqttClient = new MQTTClient({
        host: settings.mqttHost,
        port: settings.mqttPort,
        username: settings.mqttUsername,
        password: settings.mqttPassword,
        clientId: `homey-nilan-${this.getData().id}`,
        reconnectPeriod: 5000, // Try reconnect every 5 seconds
        keepalive: 60,
      }, this);

      // Handle connection events
      this.mqttClient.on('connect', () => {
        this.mqttConnected = true;
        this.log('MQTT connected, subscribing to topics...');
        this.subscribeToTopics().catch((err) => {
          this.error('Failed to subscribe to topics:', err);
        });
      });

      this.mqttClient.on('close', () => {
        this.mqttConnected = false;
        this.log('MQTT connection closed');
        this.scheduleReconnect();
      });

      this.mqttClient.on('error', (error: MQTTError) => {
        this.error('MQTT error:', error);
        this.scheduleReconnect();
      });

      this.mqttClient.on('message', this.handleMessage.bind(this));

      await this.mqttClient.connect();
      this.log('MQTT connection initialized');
    } catch (error) {
      this.mqttConnected = false;
      this.error('MQTT initialization failed:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule MQTT reconnection
   */
  private scheduleReconnect(): void {
    if (!this.mqttReconnectTimer) {
      this.log(`Scheduling MQTT reconnect in ${this.MQTT_RETRY_INTERVAL / 1000} seconds`);
      this.mqttReconnectTimer = this.homey.setTimeout(() => {
        this.mqttReconnectTimer = null;
        this.log('Attempting MQTT reconnection...');
        this.initializeMQTT().catch((err) => {
          this.error('MQTT reconnection failed:', err);
        });
      }, this.MQTT_RETRY_INTERVAL);
    }
  }

  /**
   * Clean up MQTT resources
   */
  private async disconnectMQTT(): Promise<void> {
    // Clear reconnect timer first
    if (this.mqttReconnectTimer) {
      this.homey.clearTimeout(this.mqttReconnectTimer);
      this.mqttReconnectTimer = null;
    }

    if (this.mqttClient) {
      await this.mqttClient.disconnect();
      this.mqttClient = null;
    }
    this.mqttConnected = false;
  }

  /**
   * Subscribe to all configured MQTT topics
   * @throws Error if subscription fails
   */
  private async subscribeToTopics() {
    if (!this.mqttClient) return;
    const allTopics = this.getAllTopics(this.topics.values);

    for (const topic of allTopics) {
      await this.mqttClient.subscribe(topic);
      this.log(`Subscribed to topic: ${topic}`); // Add logging
    }
  }

  /**
   * Get all topics from nested object
   * @param obj - Nested topic structure
   * @returns Array of topic strings
   */
  private getAllTopics(obj: TopicStructure): string[] {
    return Object.entries(obj).reduce<string[]>((topics, [_, value]) => {
      if (typeof value === 'string') {
        topics.push(value);
      } else {
        topics.push(...this.getAllTopics(value));
      }
      return topics;
    }, []);
  }

  /**
   * Safely set capability value with validation
   */
  private async setCapabilityValueSafe(capability: string, value: string | number | boolean): Promise<void> {
    try {
      // Check if capability exists
      if (!this.hasCapability(capability)) {
        this.error(`Capability ${capability} not found on device`);
        return;
      }

      await this.setCapabilityValue(capability, value);
      this.log(`Updated ${capability} to ${value}`);
    } catch (error) {
      this.error(`Failed to set capability ${capability}:`, error);
    }
  }

  /**
   * Handle incoming MQTT messages
   */
  private async handleMessage(topic: string, message: Buffer): Promise<void> {
    try {
      const value = message.toString();
      this.log(`Received MQTT message - Topic: ${topic}, Value: ${value}`);

      // Basic validation
      if (!value || value.trim() === '') {
        throw new Error(`Empty value received for topic: ${topic}`);
      }

      // Value validation helper
      const validateNumber = (val: string, min: number, max: number): number => {
        const num = parseFloat(val);
        if (Number.isNaN(num)) {
          throw new Error(`Invalid number value: ${val}`);
        }
        if (num < min || num > max) {
          throw new Error(`Value out of range [${min}-${max}]: ${num}`);
        }
        return num;
      };

      try {
        switch (topic) {
          // Temperature sensors (-50 to 100°C)
          case this.topics.values.temperature.controller:
          case this.topics.values.temperature.inlet:
          case this.topics.values.temperature.outdoor:
          case this.topics.values.temperature.exhaust:
          case this.topics.values.temperature.outlet:
          case this.topics.values.temperature.room: {
            const temp = validateNumber(value, -50, 100);
            const convertedTemp = this.valueConverters.temperature.fromDevice(temp.toString());
            const capability = this.getTemperatureCapability(topic);
            await this.setCapabilityValueSafe(capability, convertedTemp);
            break;
          }

          // Humidity (0-100%)
          case this.topics.values.humidity: {
            const humidity = validateNumber(value, 0, 100);
            await this.setCapabilityValueSafe('measure_humidity', humidity);
            break;
          }

          // Fan speeds (0-100%)
          case this.topics.values.fan.inlet:
          case this.topics.values.fan.exhaust: {
            const speed = validateNumber(value, 0, 10000); // Raw value is 0-10000
            const speedPercent = this.valueConverters.fanSpeed.fromDevice(speed.toString());
            await this.handleFanSpeed(speedPercent.toString());
            break;
          }

          // Bypass state
          case this.topics.values.bypass: {
            const bypassActive = value === '1'; // 1 = active, 0 = inactive
            await this.setCapabilityValueSafe('nilan_bypass', bypassActive);
            if (bypassActive) {
              await this.homey.flow.getDeviceTriggerCard('bypass_activated').trigger(this, {}, {});
            }
            break;
          }

          // Filter status (inverted logic)
          case this.topics.values.filter: {
            const filterChange = value === '1'; // 1 = change needed, 0 = ok
            await this.setCapabilityValueSafe('alarm_filter_change', filterChange);
            if (filterChange) {
              await this.homey.flow.getDeviceTriggerCard('filter_change_required').trigger(this, {}, {});
            }
            break;
          }

          // Operation mode
          case this.topics.values.mode: {
            if (!['0', '1', '2', '3'].includes(value)) {
              throw new Error(`Invalid mode value: ${value}`);
            }
            const mode = this.valueConverters.mode.fromDevice(value);
            await this.setCapabilityValueSafe('thermostat_mode', mode);
            break;
          }

          // Efficiency (0-100%)
          case this.topics.values.efficiency: {
            // Validate raw value but we only use the converted value
            validateNumber(value, 0, 15000); // Allow margin for raw values
            const efficiencyPercent = this.valueConverters.efficiency.fromDevice(value);
            await this.setCapabilityValueSafe('measure_heat_exchanger_efficiency', efficiencyPercent);
            break;
          }

          // Target temperature state
          case this.topics.values.temperature.target: {
            const temp = parseFloat(value);
            if (!Number.isNaN(temp)) {
              const targetTemp = Math.round(temp * 0.01 * 10) / 10; // Convert from device format (÷100)
              await this.setCapabilityValueSafe('target_temperature', targetTemp);
              this.log(`Updated target temperature to ${targetTemp}°C`);
            }
            break;
          }

          default:
            this.log(`Unhandled topic: ${topic} with value: ${value}`);
        }
      } catch (error) {
        // Handle specific message processing errors
        this.error(`Failed to process message for topic ${topic}:`, error);
      }
    } catch (error) {
      // Handle general message handling errors
      this.error('Failed to handle MQTT message:', error);
    }
  }

  /**
   * Handle device settings changes
   * @param oldSettings - Previous settings
   * @param newSettings - New settings
   * @param changedKeys - List of changed setting keys
   */
  async onSettings({ oldSettings, newSettings, changedKeys }: {
    oldSettings: MQTTSettings;
    newSettings: MQTTSettings;
    changedKeys: string[];
  }): Promise<void> {
    // Reconnect MQTT if connection settings changed
    if (changedKeys.some((key) => key.startsWith('mqtt'))) {
      await this.disconnectMQTT();
      await this.initializeMQTT();
    }
  }

  /**
   * Device deleted handler
   */
  async onDeleted() {
    await this.disconnectMQTT();
    await this.log('NilanHVAC device deleted');
  }

  /**
   * Handle capability changes
   * @param value - The new value of the capability
   * @param opts - Options for the capability change
   */
  private async onCapabilityChange(value: string | number | boolean, opts: { topic: string }): Promise<void> {
    // Only try to publish if MQTT is connected
    if (!this.mqttConnected) {
      this.log('MQTT not connected, skipping command publish');
      return; // Exit early if MQTT is not connected
    }

    // Publish to MQTT if connected
    if (this.mqttClient) {
      await this.mqttClient.publish(opts.topic, value.toString());
    }
  }

  /**
   * Get capability name for temperature topic
   */
  private getTemperatureCapability(topic: string): string {
    if (topic.includes('T7_Inlet')) {
      return 'measure_temperature'; // Main indoor temperature
    }
    if (topic.includes('T8_Outdoor')) {
      return 'measure_temperature_outdoor';
    }
    if (topic.includes('T3_Exhaust') || topic.includes('T4_Outlet')) {
      return 'measure_temperature_exhaust';
    }
    // Room and controller temps are additional readings, not main temperature
    if (topic.includes('T15_Room') || topic.includes('T0_Controller')) {
      this.log(`Additional temperature reading from ${topic}, not mapping to main temperature`);
      return 'measure_temperature_exhaust'; // or we could skip these readings
    }

    this.log(`Unmapped temperature topic: ${topic}`);
    return 'measure_temperature_exhaust'; // Default to exhaust to avoid confusion with main temp
  }
}

module.exports = NilanHVACDevice;
