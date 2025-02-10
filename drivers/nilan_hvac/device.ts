'use strict';

const Homey = require('homey');

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

/**
 * Nilan HVAC Device implementation
 * Handles communication with a Nilan HVAC system via MQTT
 */
class NilanHVACDevice extends Homey.Device {
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL = 30000; // 30 seconds

  /**
   * Device initialization
   * Sets up capabilities, flow cards, and starts update polling
   */
  async onInit(): Promise<void> {
    try {
      this.log('Initializing Nilan HVAC device');

      await this.initializeCapabilities();
      await this.registerCapabilityListeners();
      await this.registerFlowCards();

      this.startMockUpdates();

      this.log('Nilan HVAC device initialized successfully');
    } catch (error) {
      this.error('Failed to initialize device:', error);
      throw error; // Let Homey know initialization failed
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
    } catch (error) {
      this.error('Failed to set target temperature:', error);
      throw error;
    }
  }

  /**
   * Handle thermostat mode changes
   */
  async onThermostatMode(value: 'auto' | 'heat' | 'cool') {
    await this.log('Thermostat mode changed to:', value);
    await this.setCapabilityValue('thermostat_mode', value);
  }

  /**
   * Handle fan mode changes
   */
  async onFanMode(value: 'auto' | 'low' | 'medium' | 'high') {
    await this.log('Fan mode changed to:', value);
    await this.setCapabilityValue('fan_mode', value);

    // Here you would typically send the command to your actual device
    // For example:
    // await this.sendFanModeCommand(value);
  }

  /**
   * Start mock temperature updates
   */
  private startMockUpdates() {
    if (this.updateInterval) {
      this.homey.clearInterval(this.updateInterval);
    }

    this.updateInterval = this.homey.setInterval(async () => {
      try {
        // Indoor temperature (existing)
        const mockTemp = 20 + (Math.random() * 2 - 1);
        await this.setCapabilityValue('measure_temperature', mockTemp);

        // Outdoor temperature
        const mockOutdoorTemp = 15 + (Math.random() * 5 - 2.5);
        await this.setCapabilityValue('measure_temperature_outdoor', mockOutdoorTemp);

        // Exhaust temperature
        const mockExhaustTemp = 22 + (Math.random() * 3 - 1.5);
        await this.setCapabilityValue('measure_temperature_exhaust', mockExhaustTemp);

        // Update humidity (mock data)
        const mockHumidity = Math.floor(40 + (Math.random() * 20)); // Random between 40-60%
        await this.setCapabilityValue('measure_humidity', mockHumidity);

        // Update bypass status (randomly for mock)
        const bypassActive = Math.random() > 0.5;
        await this.setCapabilityValue('nilan_bypass', bypassActive);

        // Update filter status (mock: trigger every 30 days)
        const now = new Date();
        const filterNeedsChange = (now.getDate() === 1); // True on first day of month
        await this.setCapabilityValue('alarm_filter_change', filterNeedsChange);
        if (filterNeedsChange) {
          await this.homey.flow.triggerDevice('filter_change_required', {}, this);
        }

        // Trigger bypass activated
        if (bypassActive) {
          await this.homey.flow.getDeviceTriggerCard('bypass_activated')
            .trigger(this, {}, {});
        }

        // Check temperature thresholds
        const temps = {
          indoor: await this.getCapabilityValue('measure_temperature'),
          outdoor: await this.getCapabilityValue('measure_temperature_outdoor'),
          exhaust: await this.getCapabilityValue('measure_temperature_exhaust'),
        };

        // Trigger temperature thresholds with proper types
        Object.entries(temps).forEach(([sensor, temp]) => {
          const state: TemperatureState = {
            sensor: sensor as 'indoor' | 'outdoor' | 'exhaust',
            temperature: temp,
          };
          this.homey.flow.getDeviceTriggerCard('temperature_threshold')
            .trigger(this, {}, state);
        });
      } catch (error) {
        this.error('Failed to update device values:', error);
      }
    }, 30000);
  }

  /**
   * Device deleted handler
   */
  async onDeleted() {
    if (this.updateInterval) {
      this.homey.clearInterval(this.updateInterval);
    }
    await this.log('NilanHVAC device deleted');
  }
}

module.exports = NilanHVACDevice;
