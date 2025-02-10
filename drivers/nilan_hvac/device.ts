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
  off: string;
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
      controller: string;
      inlet: string;
      outdoor: string;
      exhaust: string;
      outlet: string;
      room: string;
    };
    humidity: string;
    bypass: {
      open: string;
      close: string;
    };
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
        controller: 'ap/technical/ventilation/temp/T0_Controller',
        inlet: 'ap/technical/ventilation/temp/T7_Inlet',
        outdoor: 'ap/technical/ventilation/temp/T8_Outdoor',
        exhaust: 'ap/technical/ventilation/temp/T3_Exhaust',
        outlet: 'ap/technical/ventilation/temp/T4_Outlet',
        room: 'ap/technical/ventilation/temp/T15_Room',
      },
      humidity: 'ap/technical/ventilation/humidity/RH',
      bypass: {
        open: 'ap/technical/ventilation/output/BypassOpen',
        close: 'ap/technical/ventilation/output/BypassClose',
      },
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
      temperature: 'ap/technical/ventilation/control/TempSet',
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
  };

  private readonly fanSpeedMap: FanSpeedMap = {
    off: '0',
    low: '1',
    medium: '2',
    high: '3',
    auto: '4',
  };

  private readonly fanSpeedMapReverse: { [key: string]: string } = {
    0: 'off',
    1: 'low',
    2: 'medium',
    3: 'high',
    4: 'auto',
  };

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
    try {
      const capabilities = [
        { name: 'fan_mode', defaultValue: 'auto' },
        { name: 'nilan_bypass', defaultValue: false },
        { name: 'alarm_filter_change', defaultValue: false },
        { name: 'measure_humidity', defaultValue: 45 },
      ];

      for (const cap of capabilities) {
        if (!this.hasCapability(cap.name)) {
          await this.addCapability(cap.name);
          await this.setCapabilityValue(cap.name, cap.defaultValue);
          this.log(`Added capability: ${cap.name}`);
        }
      }
    } catch (error) {
      this.error('Failed to initialize capabilities:', error);
      throw error;
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
   * @param value - New temperature value
   */
  async onTargetTemperature(value: number): Promise<void> {
    try {
      this.log('Target temperature changed to:', value);
      await this.setCapabilityValue('target_temperature', value);

      if (this.mqttConnected && this.mqttClient) {
        await this.mqttClient.publish(this.topics.commands.temperature, this.valueConverters.temperature.toDevice(value));
      }
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
   * @param value - Fan mode to set (off/low/medium/high/auto)
   */
  async onFanMode(value: 'off' | 'low' | 'medium' | 'high' | 'auto'): Promise<void> {
    try {
      this.log('Fan mode changed to:', value);
      await this.setCapabilityValue('fan_mode', value);

      if (this.mqttConnected && this.mqttClient) {
        // Set fan speed
        await this.mqttClient.publish(
          this.topics.commands.fan.speed,
          this.fanSpeedMap[value],
        );

        // Set power state (on for any mode except off)
        await this.mqttClient.publish(
          this.topics.commands.fan.power,
          value === 'off' ? '0' : '1',
        );
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
    const mode = this.fanSpeedMapReverse[value] || 'off';
    await this.setCapabilityValue('fan_mode', mode);
  }

  /**
   * Initialize MQTT connection
   */
  private async initializeMQTT(): Promise<void> {
    try {
      const settings = this.getSettings();

      // Only try to connect if we have MQTT settings
      if (!settings.mqttHost) {
        this.log('No MQTT host configured, skipping connection');
        return;
      }

      this.mqttClient = new MQTTClient({
        host: settings.mqttHost,
        port: settings.mqttPort,
        username: settings.mqttUsername,
        password: settings.mqttPassword,
        clientId: `homey-nilan-${this.getData().id}`,
      }, this);

      this.mqttClient.on('message', this.handleMessage.bind(this));

      await this.mqttClient.connect();
      this.mqttConnected = true;
      this.log('MQTT connected, subscribing to topics...');
      await this.subscribeToTopics();
      this.log('Successfully subscribed to all topics');
    } catch (error) {
      this.mqttConnected = false;
      this.error('MQTT initialization failed:', error);
      throw error;
    }
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

          await this.setCapabilityValue(capability, convertedTemp);
          this.log(`Updated ${capability} to ${convertedTemp}°C`);
          break;
        }

        // Humidity (0-100%)
        case this.topics.values.humidity: {
          const humidity = validateNumber(value, 0, 100);
          await this.setCapabilityValue('measure_humidity', humidity);
          this.log(`Updated humidity to ${humidity}%`);
          break;
        }

        // Fan speeds (0-100%)
        case this.topics.values.fan.inlet:
        case this.topics.values.fan.exhaust: {
          const speed = validateNumber(value, 0, 10000); // Raw value is 0-10000
          const speedPercent = this.valueConverters.fanSpeed.fromDevice(speed.toString());
          await this.handleFanSpeed(speedPercent.toString());
          this.log(`Updated fan speed to ${speedPercent}%`);
          break;
        }

        // Binary states
        case this.topics.values.bypass.open:
        case this.topics.values.bypass.close: {
          const isOpen = topic.endsWith('open') ? value === '1' : value === '0';
          await this.setCapabilityValue('nilan_bypass', isOpen);
          this.log(`Updated bypass state to ${isOpen ? 'open' : 'closed'}`);
          break;
        }

        // Filter status
        case this.topics.values.filter: {
          const filterChange = value !== '0';
          await this.setCapabilityValue('alarm_filter_change', filterChange);
          if (filterChange) {
            this.log('Filter change required!');
            // Trigger flow card
            await this.homey.flow.getDeviceTriggerCard('filter_change_required')
              .trigger(this, {}, {});
          }
          break;
        }

        // Operation mode
        case this.topics.values.mode: {
          if (!['0', '1', '2', '3'].includes(value)) {
            throw new Error(`Invalid mode value: ${value}`);
          }
          const mode = this.valueConverters.mode.fromDevice(value);
          await this.setCapabilityValue('thermostat_mode', mode);
          this.log(`Updated thermostat mode to ${mode}`);
          break;
        }

        // Efficiency (0-100%)
        case this.topics.values.efficiency: {
          const efficiency = validateNumber(value, 0, 10000); // Raw value is 0-10000
          const efficiencyPercent = this.valueConverters.fanSpeed.fromDevice(efficiency.toString());
          await this.setCapabilityValue('measure_heat_exchanger_efficiency', efficiencyPercent);
          this.log(`Updated efficiency to ${efficiencyPercent}%`);
          break;
        }

        default:
          this.log(`Unhandled topic: ${topic} with value: ${value}`);
      }
    } catch (error) {
      this.error(`Failed to handle MQTT message for topic ${topic}:`, error);
      // Could add error tracking here for monitoring
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
   * Disconnect from MQTT broker
   */
  private async disconnectMQTT() {
    if (this.mqttClient) {
      await this.mqttClient.disconnect();
      this.mqttClient = null;
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
    if (topic.includes('controller')) {
      return 'measure_temperature_controller';
    }
    if (topic.includes('inlet')) {
      return 'measure_temperature_inlet';
    }
    if (topic.includes('outdoor')) {
      return 'measure_temperature_outdoor';
    }
    if (topic.includes('exhaust')) {
      return 'measure_temperature_exhaust';
    }
    if (topic.includes('outlet')) {
      return 'measure_temperature_outlet';
    }
    return 'measure_temperature_room';
  }
}

module.exports = NilanHVACDevice;
