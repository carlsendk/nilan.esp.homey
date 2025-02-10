'use strict';

const Homey = require('homey');

/**
 * Nilan HVAC App implementation
 */
class NilanApp extends Homey.App {
  /**
   * App initialization
   */
  async onInit() {
    await this.log('Nilan HVAC app is running...');
  }
}

module.exports = NilanApp;
