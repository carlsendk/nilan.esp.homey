'use strict';

const Homey = require('homey');

// Add these interfaces at the top of the file
interface FlowCardTriggerArgs {
  sensor?: 'indoor' | 'outdoor' | 'exhaust';
  threshold?: number;
}

interface FlowCardConditionArgs {
  mode?: 'auto' | 'low' | 'medium' | 'high';
}

interface FlowCardActionArgs {
  mode: 'auto' | 'low' | 'medium' | 'high';
}

interface TemperatureState {
  sensor: 'indoor' | 'outdoor' | 'exhaust';
  temperature: number;
}

// Empty interface for states that don't need data
interface EmptyState {}

/**
 * Nilan HVAC Device implementation
 */
class NilanHVACDevice extends Homey.Device {
  private updateInterval = null;

  /**
   * Device initialization
   */
  async onInit() {
    await this.log('NilanHVAC device initialized');

    // Set initial values if not set
    if (!this.hasCapability('fan_mode')) {
      await this.addCapability('fan_mode');
      await this.setCapabilityValue('fan_mode', 'auto');
    }

    await this.registerCapabilityListener('target_temperature', this.onTargetTemperature.bind(this));
    await this.registerCapabilityListener('thermostat_mode', this.onThermostatMode.bind(this));
    await this.registerCapabilityListener('fan_mode', this.onFanMode.bind(this));

    await this.initializeCapabilities();
    this.startMockUpdates();

    // Register flow card triggers with proper types and null checks
    this.homey.flow.getDeviceTriggerCard('bypass_activated')
      .registerRunListener((args: FlowCardTriggerArgs, state: EmptyState) => {
        return true;
      });

    this.homey.flow.getDeviceTriggerCard('temperature_threshold')
      .registerRunListener((args: FlowCardTriggerArgs, state: TemperatureState) => {
        if (typeof args.threshold === 'undefined') return false;
        return state.temperature >= args.threshold;
      });

    // Register conditions with proper types and null checks
    this.homey.flow.getConditionCard('is_bypass_active')
      .registerRunListener(async (args: FlowCardConditionArgs, state: EmptyState) => {
        return await this.getCapabilityValue('nilan_bypass') === 'true';
      });

    this.homey.flow.getConditionCard('fan_mode_is')
      .registerRunListener(async (args: FlowCardConditionArgs, state: EmptyState) => {
        if (typeof args.mode === 'undefined') return false;
        return await this.getCapabilityValue('fan_mode') === args.mode;
      });

    // Register actions with proper types
    this.homey.flow.getActionCard('set_fan_mode')
      .registerRunListener(async (args: FlowCardActionArgs, state: EmptyState) => {
        await this.setCapabilityValue('fan_mode', args.mode);
        return true;
      });
  }

  /**
   * Handle target temperature changes
   */
  async onTargetTemperature(value: number) {
    await this.log('Target temperature changed to:', value);
    await this.setCapabilityValue('target_temperature', value);
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
   * Initialize all capabilities
   */
  private async initializeCapabilities() {
    // Existing capability checks...
    if (!this.hasCapability('nilan_bypass')) {
      await this.addCapability('nilan_bypass');
      await this.setCapabilityValue('nilan_bypass', false);
    }

    if (!this.hasCapability('alarm_filter_change')) {
      await this.addCapability('alarm_filter_change');
      await this.setCapabilityValue('alarm_filter_change', false);
    }

    if (!this.hasCapability('measure_humidity')) {
      await this.addCapability('measure_humidity');
      await this.setCapabilityValue('measure_humidity', 45); // Default value
    }
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
