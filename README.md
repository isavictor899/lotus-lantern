Lumina Web — BLE LED Controller
A Progressive Web App for controlling generic RGB LED strips over Bluetooth Low Energy, built with React + Vite. No app store, no installation — runs entirely in the browser.
Live: https://lotus-lantern.vercel.app
Repo: https://github.com/isavictor899/lotus-lantern
Features
Connectivity
Web Bluetooth API — works in Chrome and Edge on Android, Windows, macOS
Auto-detects device protocol on connect (7E or 0x56 family)
Targeted BLE scan filters for fast device discovery
GATT retry with exponential backoff
Auto-reconnect on signal drop (3 attempts at 1s / 3s / 6s)
Remembers last device — silently reconnects on page load
Queued BLE writes — no "operation in progress" errors
writeValueWithoutResponse for ~3× faster command delivery
Diagnostic scanner — enumerates all GATT services when device UUID is unknown
Supported Devices
Protocol
Services
Examples
7E
fff0/fff3, fff0/fff4
Most cheap BLE RGB strips
0x56
ffd5/ffd9, ffe5/ffe9
ELK-BLED01, Triones, SP110E
UART
HM-10 (ffe0/ffe1), NUS (6e400001)
Various modules
Light Control
Full RGB color picker + 12 preset swatches
Brightness slider (0–100%)
Power on/off button with real 7E power packet
Pin sequence remapping (RGB, GRB, RBG, GBR, BRG, BGR) for wrong-color fixes
Effects (FX Tab)
Built-in effects: 40+ modes across Gradual Change, Jump/Flash, and Strobe categories — dual protocol codes auto-selected
Chase / Trail effects (software-driven):
Comet — sharp spike with exponential decay tail
Rainbow — full HSV spectrum sweep
Twinkle — random sparkle bursts
Speed control (Slow → Fast) per effect
Sync Modes
Mic Sync — FFT bass frequency analysis drives brightness in real time
TV Camera Sync — rear camera samples ambient screen color at 10 Hz and pushes it to the strip; live RGB readout in the UI
Scheduler
Daily on/off schedule with multi-day selection (Sun–Sat)
Multiple schedules with per-schedule enable/disable toggle
Getting Started
Prerequisites
Node.js 18+
Chrome or Edge (Web Bluetooth is not supported in Firefox or Safari)# lotus-lantern

git clone https://github.com/isavictor899/lotus-lantern.git
cd lotus-lantern
npm install
npm run dev