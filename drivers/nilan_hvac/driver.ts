'use strict';

const Homey = require('homey');

/**
 * Driver for Nilan HVAC devices
 */
class NilanHVACDriver extends Homey.Driver {
  /**
   * Driver initialization
   */
  async onInit() {
    await this.log('NilanHVAC driver initialized');
  }

  /**
   * Discover devices during pairing
   */
  async onPairListDevices() {
    await this.log('Starting device discovery');
    return [
      {
        data: {
          id: 'nilan-mock-001',
        },
        name: 'Nilan HVAC Mock',
      },
    ];
  }
}

module.exports = NilanHVACDriver;
