# SimpleZepp

A fork of [SimpleWear](https://github.com/SimpleAppProjects/SimpleWear) by Dave Antoine that works with
**Zepp OS** watches (Amazfit) instead of Wear OS. Control your Android phone from the watch.

[Русская версия](README-ru.md)

## Features

- **Toggles:** Wi-Fi, Bluetooth, mobile data, location, flashlight, Do Not Disturb, ringer mode
  (sound / vibrate / silent), hotspot, NFC, battery saver, lock screen
- **Volume** per stream (media, ringtone, call, alarm) and **screen brightness** (incl. auto mode);
  Up/Down buttons change the value
- **App launcher:** start any app on the phone from the watch
- **Phone battery** level on the main screen
- **Shortcut card:** Wi-Fi and cellular signal level, ringer mode and battery at a glance; tap or Select opens the app

Music and call controls from SimpleWear are left out: Zepp OS already has both.

## How it works

```
Watch app (JS) ⇄ Zepp app on the phone (app-side JS) ⇄ HTTP 127.0.0.1:47821 ⇄ SimpleZepp Android app
```

- A Zepp OS app-side can only make HTTP requests, so the Android app runs a small HTTP server on the
  **loopback interface** (`ZeppBridgeService`, a foreground service). Watch → phone messages use the same
  paths and JSON as SimpleWear's Wear OS Data Layer and go through the unchanged SimpleWear logic
  (`WearMessageHandler`). Phone → watch messages are queued and collected with a long poll.
- Zepp's `fetch` gives up after ~10 s, so long polls are answered within 8 s.
- **Pairing:** the first connection shows an *Allow / Deny* notification on the phone; the app-side then
  keeps a token. Any app on the phone could reach a loopback port, so every request needs that token.
- **Built-in Helper.** Upstream ships a separate *SimpleWear Helper* app with `targetSdk 28` for toggles that
  newer Android versions block (Wi-Fi, Bluetooth, …). This fork is sideloaded, so the whole app targets SDK 28
  and the Helper's action code (`wearsettings/…/actions`, root and Shizuku support) is compiled in.
- Signal levels (`/status/signal`) are an addition of this fork; SimpleWear only sends on/off states.
- Firebase and Play Store update checks are removed.

Code: `mobile/…/zepp/` (bridge), `zepp/` (watch app, app-side, shortcut card).

## Limitations

- **Android only.** iOS doesn't allow any of this.
- The phone app must stay alive in the background. Some vendors freeze background apps even with a foreground
  service (seen on Honor / MagicOS): allow it to run in the background manually (see below).
- Status updates are live only while the watch app or the shortcut card is on screen; otherwise the card shows
  the last known state.
- Mobile data, hotspot and some other toggles need Shizuku or root access (as in upstream).
- `targetSdk 28`: Android may warn that the app was built for an older version. Not for Google Play.
- No watch UI yet for timed actions and gestures (the phone side supports them).
- The watch UI is in Russian only for now.
- Tested on Amazfit Active 3 Premium (Zepp OS 6, 466×466 round) with an Honor Magic V2 on Android 16.

## Installation

### 1. Phone app

**Download:** [SimpleZepp-0.1.0.apk](https://github.com/iArti/SimpleZepp/releases/download/v0.1.0/SimpleZepp-0.1.0.apk)
from [Releases](https://github.com/iArti/SimpleZepp/releases/latest) (signed with the author's key) and install it,
or build it yourself. An APK signed with a different key can't update it: uninstall first.

To build: JDK 17+ (e.g. the one bundled with Android Studio) and the Android SDK.

```bash
./gradlew :mobile:assembleDebug
adb install -r mobile/build/outputs/apk/debug/mobile-debug.apk
```

Without `keystore/keystore.properties` the APK is signed with your debug key (see `signing.gradle`).

Then open **SimpleZepp** on the phone and grant what you need on the permissions screen. Also:

- **Notifications** must be allowed: pairing is confirmed from a notification.
- Exclude the app from battery optimisation. On Honor / Huawei: *Battery → App launch → SimpleZepp →
  manage manually*, enable all three switches.
- For mobile data, hotspot etc. either grant [Shizuku](https://shizuku.rikka.app/) access in the app or:
  ```bash
  adb shell pm grant dev.iarti.simplewear android.permission.WRITE_SECURE_SETTINGS
  ```

### 2. Watch app

Requirements: Node.js and [zeus-cli](https://docs.zepp.com/docs/guides/tools/cli/), Zepp app in
*Developer Mode* (Profile → Settings → About → tap the Zepp icon 7 times).

```bash
cd zepp
npm install
npx zeus login
npx zeus preview
```

Pick your watch and scan the QR code in Zepp → Profile → Developer Mode → Scan.

`appId` 1145144 is registered to the author's developer account. If `zeus preview` refuses it, create an app
in the [Zepp developer console](https://console.zepp.com/) and put its id into `zepp/app.json` and
`APP_ID` in `zepp/app-widget/index.js`.

### 3. Pair

Open SimpleZepp on the watch, tap the status line under the battery (*«Нажмите, чтобы привязать»*) and press
**Allow** in the notification on the phone.
The shortcut card is added like any other in the watch's shortcut card settings.

Icons: `python zepp/tools/make_icons.py` (needs ImageMagick) renders them from SimpleWear's vector drawables.

## License

    Copyright 2019 Dave Antoine
    Copyright 2026 iArti (Zepp OS fork)

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
