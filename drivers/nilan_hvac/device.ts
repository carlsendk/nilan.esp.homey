'use strict';

const Homey = require('homey');

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

    await this.registerCapabilityListener('target_temperature', this.onTargetTemperature.bind(this));
    await this.registerCapabilityListener('thermostat_mode', this.onThermostatMode.bind(this));
    await this.registerCapabilityListener('fan_speed', this.onFanSpeed.bind(this));

    this.startMockUpdates();
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
   * Handle fan speed changes
   */
  async onFanSpeed(value: 'low' | 'medium' | 'high') {
    await this.log('Fan speed changed to:', value);
    await this.setCapabilityValue('fan_speed', value);
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
        const mockTemp = 20 + (Math.random() * 2 - 1);
        await this.setCapabilityValue('measure_temperature', mockTemp);
      } catch (error) {
        this.error('Failed to update temperature:', error);
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
