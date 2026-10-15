// Message paths and enums of the SimpleWear phone app (shared_resources/.../helpers, .../actions).
// The phone side is unchanged SimpleWear logic, so these must match the Kotlin constants.

export const PATH = {
  APP_STATE: "/app_state",
  ACTIONS: "/actions",
  STATUS: "/status",
  BATTERY: "/status/battery",
  WIFI: "/status/wifi",
  BT: "/status/bt",
  UPDATE: "/update/all",
  AUDIO_STATUS: "/status/audio",
  AUDIO_VOLUME: "/status/audio/volume",
  VALUE_STATUS: "/status/valueaction",
  VALUE_SET: "/status/valueaction/setvalue",
  BRIGHTNESS_MODE: "/status/brightness/mode",
  APPS: "/apps",
  LAUNCH_APP: "/apps/start-activity",
};

// Actions enum: name -> ordinal value used by intToBytes() on the phone
export const ACTION_VALUE = {
  WIFI: 0,
  BLUETOOTH: 1,
  MOBILEDATA: 2,
  LOCATION: 3,
  TORCH: 4,
  LOCKSCREEN: 5,
  VOLUME: 6,
  DONOTDISTURB: 7,
  RINGER: 8,
  MUSICPLAYBACK: 9,
  SLEEPTIMER: 10,
  APPS: 11,
  PHONE: 12,
  BRIGHTNESS: 13,
  HOTSPOT: 14,
  GESTURES: 15,
  TIMEDACTION: 16,
  NFC: 17,
  BATTERYSAVER: 18,
};

export const RINGER = ["SILENT", "VIBRATION", "SOUND"];
export const STREAMS = ["MUSIC", "RINGTONE", "VOICE_CALL", "ALARM"];

// Gson RuntimeTypeAdapterFactory tags subclasses with "type"; SimpleWear's Gson writes and
// expects enum values in lower case ("wifi", "unknown"), so action types here are lower case
export function toggleAction(actionType, isEnabled) {
  return { type: "ToggleAction", actionType, isEnabled, isActionSuccessful: true, actionStatus: "unknown" };
}

export function multiChoiceAction(actionType, value) {
  return { type: "MultiChoiceAction", actionType, value, isActionSuccessful: true, actionStatus: "unknown" };
}

export function normalAction(actionType) {
  return { type: "NormalAction", actionType, isActionSuccessful: true, actionStatus: "unknown" };
}

// Big-endian Int like ByteBuffer.putInt on the phone
export function intBytes(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
