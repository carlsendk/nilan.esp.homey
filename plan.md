# Nilan HVAC Implementation Plan

## Implementation Phases

### Phase 1: Core Functionality

- [x] MQTT client implementation
  - [x] Basic connection handling
  - [x] Topic subscription
  - [x] Error handling
  - [x] Reconnection logic

- [x] Basic device communication
  - [x] Message handling
  - [x] Value conversion
  - [x] State tracking

- [x] Fan speed control
  - [x] Speed mapping (0-4)
  - [x] Auto mode support
  - [x] Power state handling
  - [x] Status monitoring

- [ ] Temperature control
  - [x] Temperature reading
  - [x] Multiple sensor support
  - [ ] Target temperature setting
  - [ ] Mode control

### Phase 2: Advanced Features

- [ ] Climate mode control
  - [ ] Mode switching
  - [ ] State monitoring
  - [ ] Auto mode logic

- [ ] Bypass monitoring
  - [x] State tracking
  - [x] Flow triggers
  - [ ] Manual control

- [x] Filter status
  - [x] Status monitoring
  - [x] Alert handling
  - [x] Flow triggers

- [x] Humidity monitoring
  - [x] Value reading
  - [x] Status tracking
  - [x] Alert thresholds

### Phase 3: Program Control

- [ ] Week program support
- [ ] User functions
- [ ] Advanced automations

## MQTT Topic Structure

### State Topics (Subscribe)

```yaml
Temperature Sensors:
  controller: "ventilation/temp/T0_Controller"  # Controller temperature
  inlet: "ventilation/temp/T7_Inlet"           # Main inlet temperature
  outdoor: "ventilation/temp/T8_Outdoor"       # Outside temperature
  exhaust: "ventilation/temp/T3_Exhaust"       # Exhaust temperature
  outlet: "ventilation/temp/T4_Outlet"         # Outlet temperature
  room: "ventilation/temp/T15_Room"            # Room temperature

Operation Status:
  humidity: "ventilation/humidity/RH"          # Current humidity (%)
  bypass:
    open: "ventilation/output/BypassOpen"      # Bypass open state
    close: "ventilation/output/BypassClose"    # Bypass close state
  filter: "ventilation/info/AirFilter"         # Filter status
  fan:
    inlet: "ventilation/speed/InletSpeed"      # Inlet fan speed (0-100%)
    exhaust: "ventilation/speed/ExhaustSpeed"  # Exhaust fan speed (0-100%)
  mode: "ventilation/control/ModeSet"          # Current operation mode
  run: "ventilation/control/RunSet"            # Running status
  vent: "ventilation/control/VentSet"          # Ventilation setting
  temp_set: "ventilation/control/TempSet"      # Temperature setpoint

Additional Info:
  efficiency: "ventilation/inputairtemp/EffPct"    # Heat exchanger efficiency
  summer_mode: "ventilation/inputairtemp/IsSummer" # Summer/winter mode
  user_func: "ventilation/user/UserFuncAct"        # User function active
```

### Command Topics (Publish)

```yaml
Control:
  mode: "ventilation/control/ModeSet"          # Set operation mode (0-3)
  temperature: "ventilation/control/TempSet"    # Set target temp (value*100)
  fan:
    speed: "ventilation/control/VentSet"       # Set fan speed (0-4)
    power: "ventilation/control/RunSet"        # On/Off (1/0)
  user_func: "ventilation/user/UserFuncSet"    # Set user function
```

## Value Conversions

### Temperature
