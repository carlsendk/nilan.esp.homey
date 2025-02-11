# Nilan HVAC Homey App

Control and monitor your Nilan HVAC system through Homey using MQTT communication.

## MQTT Topic Mappings

| MQTT Topic | Homey Capability | MQTT Format | Homey Format | Description |
|------------|------------------|-------------|--------------|-------------|
| `ap/technical/ventilation/temp/T7_Inlet` | `measure_temperature` | Number (×100) | Number (°C) | Main indoor temperature |
| `ap/technical/ventilation/temp/T8_Outdoor` | `measure_temperature_outdoor` | Number (×100) | Number (°C) | Outdoor temperature |
| `ap/technical/ventilation/temp/T3_Exhaust` | `measure_temperature_exhaust` | Number (×100) | Number (°C) | Exhaust temperature |
| `ap/technical/ventilation/control/TempSet` | `target_temperature` | Number (×100) | Number (°C) | Target temperature |
| `ap/technical/ventilation/humidity/RH` | `measure_humidity` | Number (%) | Number (%) | Current humidity |
| `ap/technical/ventilation/display/AirBypass/IsOpen` | `nilan_bypass` | Binary (0/1) | Boolean | Bypass state |
| `ap/technical/ventilation/info/AirFilter` | `alarm_filter_change` | Binary (0/1) | Boolean | Filter status (1=change needed) |
| `ap/technical/ventilation/speed/InletSpeed` | `fan_mode` | Number (0-10000) | Enum | Fan speed inlet |
| `ap/technical/ventilation/speed/ExhaustSpeed` | `fan_mode` | Number (0-10000) | Enum | Fan speed exhaust |
| `ap/technical/ventilation/control/VentSet` | `fan_mode` | Number (1-4) | Enum | Fan mode setting |
| `ap/technical/ventilation/control/RunSet` | `onoff` | Binary (0/1) | Boolean | System power state |
| `ap/technical/ventilation/inputairtemp/EffPct` | `measure_heat_exchanger_efficiency` | Number (×100) | Number (%) | Heat exchanger efficiency |

### Fan Mode Mapping

| MQTT Value | Homey Value | Description |
|------------|-------------|-------------|
| 1 | 'low' | Low speed |
| 2 | 'medium' | Medium speed |
| 3 | 'high' | High speed |
| 4 | 'auto' | Automatic mode |

### Temperature Conversion

- MQTT format: Raw value × 100 (e.g., 2100 = 21.0°C)
- Homey format: Decimal degrees (e.g., 21.0)

### Fan Speed Conversion

- MQTT format: Raw value 0-10000 (0-100%)
- Homey format: Enum ('low', 'medium', 'high', 'auto')

### Binary States

- MQTT format: 0 or 1
- Homey format: Boolean (true/false)

## Missing/TODO Mappings

| MQTT Topic | Suggested Capability | MQTT Format | Description |
|------------|---------------------|-------------|-------------|
| `ap/technical/ventilation/text/Text_1_2Text_3_4Text_5_6Text_7_8` | `ventilation_mode_text` | String | Current ventilation mode text |
| `ap/technical/ventilation/text/Text_9_10Text_11_12Text_13_14Text_15_16` | `ventilation_step_text` | String | Current step and temperature text |
| `ventilation/inputairtemp/IsSummer` | `summer_mode` | Binary (0/1) | Summer/Winter mode ("Drift") |
| `ap/technical/ventilation/user/UserFuncAct` | `kitchen_hood_active` | Binary (3/0) | Kitchen hood active state |
| `ap/technical/ventilation/control/ModeSet` | `thermostat_mode` | Number (0-3) | Operation mode |

### Thermostat Mode Mapping (To Implement)

| MQTT Value | Homey Value | Description |
|------------|-------------|-------------|
| 0 | 'off' | System off |
| 1 | 'heat' | Heating mode |
| 2 | 'cool' | Cooling mode |
| 3 | 'auto' | Automatic mode |

### Power State Mapping

| MQTT Value | Homey Value | Description |
|------------|-------------|-------------|
| 0 | false | System off |
| 1 | true | System on |

Note: The power state (`RunSet`) is currently mapped to fan_mode but should be mapped to the `onoff` capability for proper power control.

### Required Capabilities

These capabilities need to be created in `.homeycompose/capabilities/`:

- `ventilation_mode_text`
- `ventilation_step_text`
- `summer_mode`
- `kitchen_hood_active`

### Required Flow Cards

New triggers needed for:

- Summer/Winter mode changes
- Kitchen hood activation
- Operation mode changes

## Features

- Temperature monitoring and control
- Fan speed control
- Operation mode selection
- Bypass monitoring
- Filter status
- Humidity monitoring
- Week program support

## Installation

1. Install the app from Homey App Store
2. Configure MQTT connection settings
3. Add your Nilan HVAC device

## Configuration

### MQTT Settings

- Host: Your MQTT broker address
- Port: MQTT port (default: 1883)
- Username: (optional)
- Password: (optional)

## Documentation

See the following documentation files:

- [Implementation Details](docs/IMPLEMENTATION.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [Development Setup](docs/DEVELOPMENT.md)

## Custom Capabilities Implementation

### 1. Define Capability in .homeycompose/capabilities/

Create a new file for each capability (e.g., `.homeycompose/capabilities/summer_mode.json`):

```json
{
  "type": "boolean",
  "title": {
    "en": "Summer Mode"
  },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "insights": true,
  "icon": "/assets/summer_mode.svg"
}
```

### 2. Add to Driver Capabilities

In `.homeycompose/app.json`, add to driver capabilities:

```json
{
  "drivers": [{
    "capabilities": [
      "existing_capability",
      "summer_mode"
    ],
    "capabilitiesOptions": {
      "summer_mode": {
        "title": {
          "en": "Summer Mode"
        },
        "insights": true,
        "visibility": {
          "homepage": true
        }
      }
    }
  }]
}
```

### 3. Implement in Device Class

In `drivers/nilan_hvac/device.ts`:

```typescript
// Add to topics
private readonly topics = {
  values: {
    summerMode: 'ventilation/inputairtemp/IsSummer',
    // ... other topics
  }
};

// Initialize capability
private async initializeCapabilities(): Promise<void> {
  const capabilities = [
    { name: 'summer_mode', defaultValue: false },
    // ... other capabilities
  ];
}

// Handle MQTT messages
private async handleMessage(topic: string, message: Buffer): Promise<void> {
  switch (topic) {
    case this.topics.values.summerMode: {
      const isSummer = value === '1';
      await this.setCapabilityValueSafe('summer_mode', isSummer);
      break;
    }
  }
}
```

### 4. Add Flow Cards (Optional)

In `.homeycompose/flow/`:

```json
{
  "triggers": [{
    "id": "summer_mode_changed",
    "title": {
      "en": "Summer mode changed"
    },
    "args": [{
      "name": "device",
      "type": "device",
      "filter": "driver_id=nilan_hvac"
    }]
  }]
}
```

### Common Capability Types

- `boolean`: For on/off states
- `number`: For measurements with units
- `string`: For text values
- `enum`: For predefined options

### UI Components

- `sensor`: Read-only display
- `toggle`: Boolean switch
- `slider`: Number input
- `picker`: Enum selection

### Capability Properties

- `type`: Data type (boolean/number/string/enum)
- `title`: Display name
- `getable`: Can be read
- `setable`: Can be written
- `uiComponent`: How it displays
- `insights`: Include in insights
- `units`: Measurement unit
- `decimals`: For numbers
- `min`/`max`: Value range
- `values`: For enum options
