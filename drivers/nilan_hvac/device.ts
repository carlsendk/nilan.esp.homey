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
 * Nilan HVAC Device implementation
 * Handles communication with a Nilan HVAC system via MQTT
 */
class NilanHVACDevice extends Homey.Device {
  private mqttClient: typeof MQTTClient | null = null;
  private mqttConnected = false;
  private readonly topics = {
    values: {
      temperature: {
        controller: 'ventilation/temp/T0_Controller',
        inlet: 'ventilation/temp/T7_Inlet',
        outdoor: 'ventilation/temp/T8_Outdoor',
        exhaust: 'ventilation/temp/T3_Exhaust',
        outlet: 'ventilation/temp/T4_Outlet',
        room: 'ventilation/temp/T15_Room',
      },
      humidity: 'ventilation/humidity/RH',
      bypass: {
        open: 'ventilation/output/BypassOpen',
        close: 'ventilation/output/BypassClose',
      },
      filter: 'ventilation/info/AirFilter',
      fan: {
        inlet: 'ventilation/speed/InletSpeed',
        exhaust: 'ventilation/speed/ExhaustSpeed',
        speed: 'ventilation/control/VentSet',
      },
      mode: 'ventilation/control/ModeSet',
      run: 'ventilation/control/RunSet',
      vent: 'ventilation/control/VentSet',
      tempSet: 'ventilation/control/TempSet',
      efficiency: 'ventilation/inputairtemp/EffPct',
      summerMode: 'ventilation/inputairtemp/IsSummer',
      userFunc: 'ventilation/user/UserFuncAct',
    },
    commands: {
      mode: 'ventilation/control/ModeSet',
      temperature: 'ventilation/control/TempSet',
      fan: {
        speed: 'ventilation/control/VentSet',
        power: 'ventilation/control/RunSet',
      },
      userFunc: 'ventilation/user/UserFuncSet',
    },
  };

  // Value conversions from config.yaml
  private valueConverters = {
    mode: {
      toDevice: (mode: string): string => {
        const modes: Record<string, string> = {
          off: '0', heat: '1', cool: '2', auto: '3',
        };
        return modes[mode] || '0';
      },
      fromDevice: (value: string): string => {
        const modes: Record<number, string> = {
          0: 'off', 1: 'heat', 2: 'cool', 3: 'auto',
        };
        return modes[parseInt(value, 10)] || 'off';
      },
    },
    temperature: {
      toDevice: (value: number): string => Math.round(value * 100).toString(),
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
      await this.subscribeToTopics();
    } catch (error) {
      this.mqttConnected = false;
      throw error;
    }
  }

  /**
   * Subscribe to all configured MQTT topics
   * @throws Error if subscription fails
   */
  private async subscribeToTopics() {
    if (!this.mqttClient) return;

    const valueTopics = Object.values(this.topics.values).flat();
    for (const topic of valueTopics) {
      await this.mqttClient.subscribe(topic);
    }
  }

  /**
   * Handle incoming MQTT messages
   */
  private async handleMessage(topic: string, message: Buffer): Promise<void> {
    try {
      const value = message.toString();
      this.log(`Received MQTT message - Topic: ${topic}, Value: ${value}`);

      if (!value || value.trim() === '') {
        throw new Error(`Empty value received for topic: ${topic}`);
      }

      switch (topic) {
        case this.topics.values.temperature.controller:
          await this.setCapabilityValue('measure_temperature_controller', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.temperature.inlet:
          await this.setCapabilityValue('measure_temperature_inlet', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.temperature.outdoor:
          await this.setCapabilityValue('measure_temperature_outdoor', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.temperature.exhaust:
          await this.setCapabilityValue('measure_temperature_exhaust', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.temperature.outlet:
          await this.setCapabilityValue('measure_temperature_outlet', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.temperature.room:
          await this.setCapabilityValue('measure_temperature_room', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.humidity:
          await this.setCapabilityValue('measure_humidity', parseFloat(value));
          break;
        case this.topics.values.bypass.open:
          await this.setCapabilityValue('nilan_bypass', true);
          break;
        case this.topics.values.bypass.close:
          await this.setCapabilityValue('nilan_bypass', false);
          break;
        case this.topics.values.filter: {
          const filterChange = value !== '0';
          await this.setCapabilityValue('alarm_filter_change', filterChange);
          break;
        }
        case this.topics.values.fan.inlet:
          await this.handleFanSpeed(value);
          break;
        case this.topics.values.fan.exhaust:
          await this.handleFanSpeed(value);
          break;
        case this.topics.values.mode:
          await this.setCapabilityValue('thermostat_mode', this.valueConverters.mode.fromDevice(value));
          break;
        case this.topics.values.run:
          // If system is off, set fan mode to off regardless of speed
          if (value === '0') {
            await this.setCapabilityValue('fan_mode', 'off');
          }
          break;
        case this.topics.values.vent:
          await this.setCapabilityValue('target_temperature', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.tempSet:
          await this.setCapabilityValue('target_temperature', this.valueConverters.temperature.fromDevice(value));
          break;
        case this.topics.values.efficiency:
          await this.setCapabilityValue('measure_heat_exchanger_efficiency', parseFloat(value));
          break;
        case this.topics.values.summerMode:
          await this.setCapabilityValue('measure_summer_mode', value === '1');
          break;
        case this.topics.values.userFunc:
          await this.setCapabilityValue('measure_user_function_active', value === '1');
          break;
        case this.topics.values.fan.speed:
          await this.handleFanSpeed(value);
          break;
        default:
          this.log(`Unhandled topic: ${topic}`);
      }
    } catch (error) {
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
}

module.exports = NilanHVACDevice;
