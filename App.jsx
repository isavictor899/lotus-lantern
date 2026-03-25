import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bluetooth, BluetoothOff, Zap, Sun, Play,
  Trash2, RefreshCcw, AlertCircle, Mic, MicOff,
  ChevronRight, X, Power, Calendar, CheckCircle,
  Circle, Settings, ChevronDown, ChevronUp, Camera, CameraOff
} from 'lucide-react';

// ─── BLE CONFIG ───────────────────────────────────────────────────────────────

// Every known LED/RGB BLE controller service UUID found in the wild
const KNOWN_LED_SERVICES = [
  // ── ELK-BLED / Triones / SP110E ──
  '0000ffd5-0000-1000-8000-00805f9b34fb',
  '0000ffd0-0000-1000-8000-00805f9b34fb',
  // ── Magic Home / LampSmart ──
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  // ── HM-10 / JDY-08 UART ──
  '0000ffe1-0000-1000-8000-00805f9b34fb', // sometimes listed as service too
  // ── Common 0xff__ short UUIDs ──
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ff01-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000ff03-0000-1000-8000-00805f9b34fb',
  '0000ff10-0000-1000-8000-00805f9b34fb',
  '0000ff12-0000-1000-8000-00805f9b34fb',
  '0000ff20-0000-1000-8000-00805f9b34fb',
  // ── ZengGe / iLedBlue ──
  '0000a002-0000-1000-8000-00805f9b34fb',
  '00001910-0000-1000-8000-00805f9b34fb',
  // ── ISSC / Microchip UART ──
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  // ── Nordic UART (NUS) ──
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  // ── Silicon Labs OTA / BG ──
  '1d14d6ee-fd63-4fa1-bfa4-8f47b42119f0',
  // ── Govee / Minger ──
  '00010203-0405-0607-0809-0a0b0c0d1910',
  // ── YiLight / MiPow ──
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000fff5-0000-1000-8000-00805f9b34fb',
  // ── Generic BLE LED common variants ──
  '0000180a-0000-1000-8000-00805f9b34fb', // device info (sometimes writable)
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000be00-0000-1000-8000-00805f9b34fb',
  '0000af00-0000-1000-8000-00805f9b34fb',
  '0000cc00-0000-1000-8000-00805f9b34fb',
  '0000aa00-0000-1000-8000-00805f9b34fb',
  '0000ab00-0000-1000-8000-00805f9b34fb',
  '0000b000-0000-1000-8000-00805f9b34fb',
];

// Ordered list of {svc, chr} pairs tried during normal connect
const SERVICE_MAP = [
  // ── 0x56 protocol (ELK-BLED01, Triones, SP110E, ffd5/ffd9) ──
  { svc:'0000ffd5-0000-1000-8000-00805f9b34fb', chr:'0000ffd9-0000-1000-8000-00805f9b34fb', proto:'0x56' },
  { svc:'0000ffe5-0000-1000-8000-00805f9b34fb', chr:'0000ffe9-0000-1000-8000-00805f9b34fb', proto:'0x56' },
  { svc:'0000ffe0-0000-1000-8000-00805f9b34fb', chr:'0000ffe1-0000-1000-8000-00805f9b34fb', proto:'0x56' },
  { svc:'0000ff01-0000-1000-8000-00805f9b34fb', chr:'0000ff02-0000-1000-8000-00805f9b34fb', proto:'0x56' },
  // ── 7E protocol (fff0/fff3, fff0/fff4 — most common cheap BLE RGB strips) ──
  { svc:'0000fff0-0000-1000-8000-00805f9b34fb', chr:'0000fff3-0000-1000-8000-00805f9b34fb', proto:'7e' },
  { svc:'0000fff0-0000-1000-8000-00805f9b34fb', chr:'0000fff4-0000-1000-8000-00805f9b34fb', proto:'7e' },
  // ── 7E protocol variants ──
  { svc:'0000aa00-0000-1000-8000-00805f9b34fb', chr:'0000aa01-0000-1000-8000-00805f9b34fb', proto:'7e' },
  { svc:'0000ae00-0000-1000-8000-00805f9b34fb', chr:'0000ae01-0000-1000-8000-00805f9b34fb', proto:'7e' },
  { svc:'0000be00-0000-1000-8000-00805f9b34fb', chr:'0000be01-0000-1000-8000-00805f9b34fb', proto:'7e' },
  // ── UART bridge (NUS / ISSC) ──
  { svc:'49535343-fe7d-4ae5-8fa9-9fafd205e455', chr:'49535343-1e4d-4bd9-ba61-23c647249616', proto:'7e' },
  { svc:'6e400001-b5a3-f393-e0a9-e50e24dcca9e', chr:'6e400002-b5a3-f393-e0a9-e50e24dcca9e', proto:'7e' },
  { svc:'00010203-0405-0607-0809-0a0b0c0d1910', chr:'00010203-0405-0607-0809-0a0b0c0d2b12', proto:'7e' },
];

// ─── COMMAND BUILDERS ─────────────────────────────────────────────────────────

/**
 * 0x56 protocol  — older ELK/Triones/SP110E family
 *   SET COLOR : 56 RR GG BB 00 F0 AA
 *   SET MODE  : 56 00 00 00 <mode> F0 AA
 *   POWER OFF : 56 00 00 00 00 F0 AA  (black = off for this family)
 */
function build0x56(r, g, b, mode) {
  return new Uint8Array([0x56, r, g, b, mode, 0xf0, 0xaa]);
}

/**
 * 7E protocol — fff0/fff3 family and most newer cheap BLE strips
 *   SET COLOR : 7E 07 05 03 RR GG BB 10 EF
 *   SET EFFECT: 7E 05 03 <0x00–0x17> 03 FF FF 00 EF
 *   POWER ON  : 7E 04 04 01 FF FF FF 00 EF
 *   POWER OFF : 7E 04 04 00 FF FF FF 00 EF
 *   BRIGHTNESS: 7E 04 01 <0–100> FF FF FF 00 EF
 *
 * Pass mode=null for static color, mode=number (0x00–0x17) for effects.
 * This avoids the collision where effect code 0x00 looks like "no effect".
 */
function build7E(r, g, b, mode) {
  if (mode !== null && mode !== undefined) {
    // Effect packet — mode is 0x00–0x17
    return new Uint8Array([0x7e, 0x05, 0x03, mode & 0xff, 0x03, 0xff, 0xff, 0x00, 0xef]);
  }
  // Static color packet
  return new Uint8Array([0x7e, 0x07, 0x05, 0x03, r & 0xff, g & 0xff, b & 0xff, 0x10, 0xef]);
}

function build7E_power(on) {
  return new Uint8Array([0x7e, 0x04, 0x04, on ? 0x01 : 0x00, 0xff, 0xff, 0xff, 0x00, 0xef]);
}

function build7E_brightness(pct) {
  const val = Math.max(0, Math.min(100, Math.round(pct)));
  return new Uint8Array([0x7e, 0x04, 0x01, val, 0xff, 0xff, 0xff, 0x00, 0xef]);
}

// Maps a characteristic UUID → which protocol to use
// This is the ground truth — used even when the service map is bypassed
const CHAR_UUID_PROTO_MAP = {
  '0000fff3-0000-1000-8000-00805f9b34fb': '7e',
  '0000fff4-0000-1000-8000-00805f9b34fb': '7e',
  '0000ffe1-0000-1000-8000-00805f9b34fb': '7e',
  '0000ffe9-0000-1000-8000-00805f9b34fb': '0x56',
  '0000ffd9-0000-1000-8000-00805f9b34fb': '0x56',
  '0000ff02-0000-1000-8000-00805f9b34fb': '0x56',
  '0000aa01-0000-1000-8000-00805f9b34fb': '7e',
  '0000ae01-0000-1000-8000-00805f9b34fb': '7e',
  '0000be01-0000-1000-8000-00805f9b34fb': '7e',
  '49535343-1e4d-4bd9-ba61-23c647249616': '7e',
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e': '7e',
};

function protoFromCharUUID(uuid) {
  return CHAR_UUID_PROTO_MAP[uuid?.toLowerCase()] ?? '7e'; // default to 7e for unknowns
}

// De-duplicated list of all service UUIDs (needed for optionalServices)
const ALL_SERVICES = [...new Set([
  ...KNOWN_LED_SERVICES,
  ...SERVICE_MAP.map(s => s.svc),
])];

// Known LED controller name prefixes
const BLE_NAME_PREFIXES = [
  'ELK','LED','Triones','Magic','SP1','MELK','QHM','HM','BLE','iLC',
  'ZJ','Lamp','Light','Strip','RGB','LEDBLE','RGBW','MagicLight','Govee',
  'YeeLight','MiPow','iLight','IBLE','AK','LD','XQ','BT',
];

const LAST_DEVICE_KEY    = 'lumina_last_device_id';
const GATT_MAX_RETRIES   = 3;
const GATT_RETRY_MS      = 600;
const CONNECT_TIMEOUT_MS = 8000;

// ─── BLE HELPERS ──────────────────────────────────────────────────────────────

const withTimeout = (p, ms, msg='Timeout') =>
  Promise.race([p, new Promise((_,rej) => setTimeout(() => rej(new Error(msg)), ms))]);

async function connectGATT(bleDevice, retries = GATT_MAX_RETRIES) {
  for (let i = 1; i <= retries; i++) {
    try { return await withTimeout(bleDevice.gatt.connect(), CONNECT_TIMEOUT_MS, 'GATT timeout'); }
    catch (err) { if (i === retries) throw err; await new Promise(r => setTimeout(r, GATT_RETRY_MS * i)); }
  }
}

async function resolveCharacteristic(server) {
  for (const { svc, chr, proto } of SERVICE_MAP) {
    try {
      const service = await server.getPrimaryService(svc);
      const char    = await service.getCharacteristic(chr);
      return { char, proto };
    } catch { /* try next */ }
  }
  // Last resort: ask for ALL declared services and return first writable char
  try {
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      const writable = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (writable) return { char: writable, proto: '7e' }; // assume 7e for unknown
    }
  } catch {}
  throw new Error('NO_SERVICE');
}

function buildRequestOptions() {
  return {
    filters: [
      ...ALL_SERVICES.map(s => ({ services: [s] })),
      ...BLE_NAME_PREFIXES.map(p => ({ namePrefix: p })),
    ],
    optionalServices: ALL_SERVICES,
  };
}

// ─── PIN SEQUENCES ────────────────────────────────────────────────────────────
const PIN_SEQUENCES = {
  RGB: (r,g,b) => [r,g,b],
  RBG: (r,g,b) => [r,b,g],
  GRB: (r,g,b) => [g,r,b],
  GBR: (r,g,b) => [g,b,r],
  BRG: (r,g,b) => [b,r,g],
  BGR: (r,g,b) => [b,g,r],
};

// ─── LIGHTING MODES ───────────────────────────────────────────────────────────
// code56 = 0x56 protocol  |  code7e = 7E protocol (fff0/fff3, valid range 0x00–0x17)
const MODE_GROUPS = [
  {
    label: 'Static Colors',
    color: 'rgba(0,255,255,0.6)',
    modes: [
      { id:'static_red',    name:'Static Red',    staticColor:{r:255,g:0,  b:0}   },
      { id:'static_green',  name:'Static Green',  staticColor:{r:0,  g:255,b:0}   },
      { id:'static_blue',   name:'Static Blue',   staticColor:{r:0,  g:0,  b:255} },
      { id:'static_white',  name:'Static White',  staticColor:{r:255,g:255,b:255} },
      { id:'static_yellow', name:'Static Yellow', staticColor:{r:255,g:255,b:0}   },
      { id:'static_cyan',   name:'Static Cyan',   staticColor:{r:0,  g:255,b:255} },
      { id:'static_purple', name:'Static Purple', staticColor:{r:160,g:32, b:240} },
      { id:'static_orange', name:'Static Orange', staticColor:{r:255,g:100,b:0}   },
      { id:'static_pink',   name:'Static Pink',   staticColor:{r:255,g:20, b:147} },
    ]
  },
  {
    label: 'Gradual Change',
    color: 'rgba(100,200,255,0.6)',
    modes: [
      { id:'grad_7',      name:'7-Color Gradual',         code56:0x25, code7e:0x00 },
      { id:'grad_red',    name:'Red Gradual',             code56:0x26, code7e:0x01 },
      { id:'grad_green',  name:'Green Gradual',           code56:0x27, code7e:0x02 },
      { id:'grad_blue',   name:'Blue Gradual',            code56:0x28, code7e:0x03 },
      { id:'grad_yellow', name:'Yellow Gradual',          code56:0x29, code7e:0x04 },
      { id:'grad_cyan',   name:'Cyan Gradual',            code56:0x2a, code7e:0x05 },
      { id:'grad_purple', name:'Purple Gradual',          code56:0x2b, code7e:0x06 },
      { id:'grad_white',  name:'White Gradual',           code56:0x2c, code7e:0x07 },
      { id:'grad_3',      name:'3-Color Gradual (R→G→B)', code56:0x2d, code7e:0x08 },
    ]
  },
  {
    label: 'Crossfade',
    color: 'rgba(150,100,255,0.6)',
    modes: [
      { id:'cross_7',  name:'7-Color Crossfade', code56:0x25, code7e:0x00 },
      { id:'cross_3',  name:'3-Color Crossfade', code56:0x2d, code7e:0x08 },
      { id:'cross_rg', name:'Red ↔ Green',       code56:0x2d, code7e:0x08 },
      { id:'cross_rb', name:'Red ↔ Blue',        code56:0x2e, code7e:0x08 },
      { id:'cross_gb', name:'Green ↔ Blue',      code56:0x2f, code7e:0x08 },
    ]
  },
  {
    label: 'Jump / Flash',
    color: 'rgba(255,200,0,0.6)',
    modes: [
      { id:'jump_7',      name:'7-Color Jump',    code56:0x38, code7e:0x09 },
      { id:'flash_7',     name:'7-Color Flash',   code56:0x30, code7e:0x0a },
      { id:'flash_red',   name:'Red Flash',       code56:0x31, code7e:0x0b },
      { id:'flash_green', name:'Green Flash',     code56:0x32, code7e:0x0c },
      { id:'flash_blue',  name:'Blue Flash',      code56:0x33, code7e:0x0d },
      { id:'flash_yellow',name:'Yellow Flash',    code56:0x34, code7e:0x0e },
      { id:'flash_cyan',  name:'Cyan Flash',      code56:0x35, code7e:0x0f },
      { id:'flash_purple',name:'Purple Flash',    code56:0x36, code7e:0x10 },
      { id:'flash_white', name:'White Flash',     code56:0x37, code7e:0x11 },
    ]
  },
  {
    label: 'Strobe',
    color: 'rgba(255,50,100,0.6)',
    modes: [
      { id:'strobe_red',    name:'Red Strobe',      code56:0x31, code7e:0x12 },
      { id:'strobe_green',  name:'Green Strobe',    code56:0x32, code7e:0x13 },
      { id:'strobe_blue',   name:'Blue Strobe',     code56:0x33, code7e:0x14 },
      { id:'strobe_yellow', name:'Yellow Strobe',   code56:0x34, code7e:0x15 },
      { id:'strobe_cyan',   name:'Cyan Strobe',     code56:0x35, code7e:0x16 },
      { id:'strobe_white',  name:'White Strobe',    code56:0x37, code7e:0x17 },
    ]
  },
];

const PRESET_COLORS = [
  {r:255,g:0,  b:0  }, {r:0,  g:255,b:0  }, {r:0,  g:0,  b:255}, {r:255,g:255,b:255},
  {r:255,g:100,b:0  }, {r:255,g:255,b:0  }, {r:0,  g:255,b:255}, {r:160,g:32, b:240},
  {r:255,g:20, b:147}, {r:0,  g:255,b:127}, {r:75, g:0,  b:130}, {r:255,g:69, b:0  },
];

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
const NeonCard = ({ children, className='', style={} }) => (
  <div className={`rounded-2xl ${className}`}
    style={{ background:'rgba(0,15,35,0.7)', border:'1px solid rgba(0,255,255,0.08)', ...style }}>
    {children}
  </div>
);

const GroupSection = ({ group, activeDynamic, onSelect }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(0,255,255,0.07)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 transition-all"
        style={{ background: open ? 'rgba(0,30,60,0.8)' : 'rgba(0,15,35,0.6)' }}>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full" style={{ background: group.color, boxShadow:`0 0 6px ${group.color}` }}/>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">{group.label}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
            style={{ background:'rgba(0,255,255,0.06)', color:'rgba(0,255,255,0.4)' }}>
            {group.modes.length}
          </span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500"/> : <ChevronDown className="w-3.5 h-3.5 text-slate-500"/>}
      </button>
      {open && (
        <div className="p-2 space-y-1" style={{ background:'rgba(0,8,20,0.5)' }}>
          {group.modes.map(m => (
            <button key={m.id} onClick={() => onSelect(m)}
              className="w-full px-4 py-3 rounded-xl flex items-center justify-between transition-all"
              style={activeDynamic === m.id
                ? { background:'rgba(0,255,255,0.09)', border:`1px solid ${group.color}`, color:'#e2e8f0' }
                : { background:'transparent', border:'1px solid transparent', color:'#64748b' }}>
              <div className="flex items-center gap-3">
                {m.staticColor && (
                  <div className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor:`rgb(${m.staticColor.r},${m.staticColor.g},${m.staticColor.b})`,
                      boxShadow:`0 0 6px rgba(${m.staticColor.r},${m.staticColor.g},${m.staticColor.b},0.5)` }}/>
                )}
                <span className="text-xs font-bold tracking-tight text-left">{m.name}</span>
              </div>
              <div className="p-1.5 rounded-lg transition-all flex-shrink-0"
                style={activeDynamic === m.id
                  ? { background: group.color.replace('0.6','0.2'), boxShadow:`0 0 8px ${group.color}` }
                  : { background:'rgba(255,255,255,0.04)' }}>
                <Play className="w-2.5 h-2.5" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Connection
  const [device, setDevice]                 = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [isConnected, setIsConnected]       = useState(false);
  const [isConnecting, setIsConnecting]     = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [bleError, setBleError]             = useState('');
  const [bleSupported]                      = useState(() => !!navigator?.bluetooth);
  const [connStatus, setConnStatus]         = useState('idle'); // idle | scanning | connecting | connected | lost
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [diagMode, setDiagMode]             = useState(false);   // diagnostic scan mode
  const [diagServices, setDiagServices]     = useState([]);      // [{svcUuid, chars:[{uuid, props}]}]
  const [diagScanning, setDiagScanning]     = useState(false);
  const [customChar, setCustomChar]         = useState(null);    // user-selected characteristic from diag

  // Light
  const [color, setColor]               = useState({ r:0, g:200, b:255 });
  const [brightness, setBrightness]     = useState(100);
  const [activeTab, setActiveTab]       = useState('static');
  const [activeDynamic, setActiveDynamic] = useState(null);

  // Pin sequence — default GRB for +,G,R,B wired strips
  const [pinSeq, setPinSeq]             = useState('GRB');
  const [pinDrawerOpen, setPinDrawerOpen] = useState(false);

  // Mic
  const [isMicActive, setIsMicActive]   = useState(false);

  // Camera sync
  const [isCamActive, setIsCamActive]   = useState(false);
  const [camColor,    setCamColor]      = useState({ r:0, g:0, b:0 });
  const [camError,    setCamError]      = useState('');

  // Power
  const [isPoweredOn, setIsPoweredOn]   = useState(true);

  // Protocol detected from connected service ('0x56' | '7e' | 'auto')
  const [protocol, setProtocol]         = useState('auto');

  // Chase / trail effect
  const [chaseMode, setChaseMode]       = useState(null); // null | 'pulse' | 'rainbow' | 'twinkle'
  const [chaseSpeed, setChaseSpeed]     = useState(3);    // 1–5

  // Scheduler
  const [schedules, setSchedules]       = useState([]);
  const [schedInput, setSchedInput]     = useState({ onTime:'18:00', offTime:'23:00', days:[1,2,3,4,5] });

  // Refs
  const charRef        = useRef(null);
  const brightnessRef  = useRef(brightness);
  const colorRef       = useRef(color);
  const pinSeqRef      = useRef(pinSeq);
  const isMicActiveRef = useRef(false);
  const audioCtxRef    = useRef(null);
  const analyserRef    = useRef(null);
  const rafRef         = useRef(null);
  const micStreamRef   = useRef(null);
  const deviceRef      = useRef(null);
  const cmdQueueRef    = useRef(Promise.resolve());
  const reconnTimerRef = useRef(null);
  const customCharRef  = useRef(null);
  const diagServerRef  = useRef(null);
  const protocolRef    = useRef('auto');
  const isPoweredOnRef = useRef(true);
  const chaseTimerRef  = useRef(null);
  const chasePhaseRef  = useRef(0);
  const chaseModeRef   = useRef(null);
  const chaseSpeedRef  = useRef(3);
  const isCamActiveRef = useRef(false);
  const camStreamRef   = useRef(null);
  const camRafRef      = useRef(null);
  const camVideoRef    = useRef(null);   // hidden <video> element
  const camCanvasRef   = useRef(null);   // hidden <canvas> for pixel sampling

  useEffect(() => { charRef.current = characteristic; },       [characteristic]);
  useEffect(() => { brightnessRef.current = brightness; },     [brightness]);
  useEffect(() => { colorRef.current = color; },               [color]);
  useEffect(() => { pinSeqRef.current = pinSeq; },             [pinSeq]);
  useEffect(() => { protocolRef.current = protocol; },         [protocol]);
  useEffect(() => { isPoweredOnRef.current = isPoweredOn; },   [isPoweredOn]);
  useEffect(() => { chaseModeRef.current  = chaseMode;  }, [chaseMode]);
  useEffect(() => { chaseSpeedRef.current = chaseSpeed; }, [chaseSpeed]);

  // ── BLE ──────────────────────────────────────────────────────────────────

  /** Core connect logic — shared by manual connect and auto-reconnect. */
  const connectDevice = useCallback(async (bleDevice) => {
    const server = await connectGATT(bleDevice);
    diagServerRef.current = server;

    let char;

    // If user already picked a characteristic via diagnostic scan, re-resolve it
    if (customCharRef.current) {
      try {
        const svc = await server.getPrimaryService(customCharRef.current.serviceUuid);
        char = await svc.getCharacteristic(customCharRef.current.uuid);
      } catch { char = null; }
    }

    // Fall back to known service map
    if (!char) {
      const resolved = await resolveCharacteristic(server);
      char = resolved.char;
    }

    // ALWAYS derive protocol from the actual characteristic UUID — this is the
    // single source of truth and fixes the bug where custom-char path skipped detection
    const detectedProto = protoFromCharUUID(char.uuid);
    protocolRef.current = detectedProto;
    setProtocol(detectedProto);

    charRef.current   = char;
    deviceRef.current = bleDevice;
    setDevice(bleDevice);
    setCharacteristic(char);
    setIsConnected(true);
    setConnStatus('connected');
    setBleError('');
    setIsPoweredOn(true);
    // Persist device ID for future auto-reconnect
    try { localStorage.setItem(LAST_DEVICE_KEY, bleDevice.id); } catch {}

    bleDevice.addEventListener('gattserverdisconnected', () => {
      charRef.current = null;
      setIsConnected(false);
      setCharacteristic(null);
      setConnStatus('lost');
      stopMic();
      // Auto-reconnect — retry after 1 s, 3 s, 6 s
      let attempt = 0;
      const tryReconnect = async () => {
        if (!deviceRef.current) return;
        attempt++;
        setIsReconnecting(true);
        try {
          await connectDevice(deviceRef.current);
          setIsReconnecting(false);
        } catch {
          if (attempt < 3) {
            reconnTimerRef.current = setTimeout(tryReconnect, 1000 * (attempt * 2));
          } else {
            setIsReconnecting(false);
            setDevice(null);
            deviceRef.current = null;
          }
        }
      };
      reconnTimerRef.current = setTimeout(tryReconnect, 1000);
    });
  }, []); // eslint-disable-line

  /** Manual scan — uses targeted filters for faster device discovery. */
  const connect = async () => {
    setBleError('');
    setIsConnecting(true);
    setConnStatus('scanning');
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    try {
      let bleDevice;
      try {
        // Targeted filters: browser only shows matching devices → list is short → user picks fast
        bleDevice = await navigator.bluetooth.requestDevice(buildRequestOptions());
      } catch (filterErr) {
        if (filterErr.name === 'NotFoundError') throw filterErr; // user cancelled
        // Browser may not support all filters (e.g. older Chrome on some Android) → fall back
        bleDevice = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ALL_SERVICES,
        });
      }
      setConnStatus('connecting');
      await connectDevice(bleDevice);
      setDrawerOpen(false);
    } catch (err) {
      setConnStatus('idle');
      if (err.name === 'NotFoundError') {
        // User dismissed picker — no error shown
      } else if (err.name === 'SecurityError') {
        setBleError('Bluetooth blocked — allow it in browser/OS settings.');
      } else if (err.message?.includes('No matching')) {
        setBleError('Connected but no matching service UUID. Your device may use a non-standard protocol. Try power-cycling the strip and reconnecting.');
      } else if (err.message?.includes('timeout') || err.message?.includes('GATT timeout')) {
        setBleError('Connection timed out. Move closer and try again.');
      } else if (err.message?.includes('GATT')) {
        setBleError('GATT error — power cycle your LED strip and try again.');
      } else {
        setBleError(`Could not connect: ${err.message}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  /** Try to silently reconnect to the last used device on page load. */
  useEffect(() => {
    if (!bleSupported) return;
    // Restore custom char if user previously picked one via diagnostic
    try {
      const svc = localStorage.getItem('lumina_custom_svc');
      const chr = localStorage.getItem('lumina_custom_chr');
      // Only restore if it's the fff3 char we now handle natively
      if (svc && chr) customCharRef.current = { serviceUuid: svc, uuid: chr };
    } catch {}
    const tryAutoConnect = async () => {
      try {
        const devices = await navigator.bluetooth.getDevices?.();
        if (!devices?.length) return;
        const lastId = localStorage.getItem(LAST_DEVICE_KEY);
        const target = lastId ? devices.find(d => d.id === lastId) : devices[0];
        if (!target) return;
        setIsReconnecting(true);
        setConnStatus('connecting');
        await connectDevice(target);
        setIsReconnecting(false);
      } catch {
        setIsReconnecting(false);
        setConnStatus('idle');
      }
    };
    // Small delay so React finishes initial render first
    const t = setTimeout(tryAutoConnect, 800);
    return () => clearTimeout(t);
  }, [bleSupported, connectDevice]);

  const disconnect = () => {
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    deviceRef.current = null;
    setIsReconnecting(false);
    if (device?.gatt?.connected) device.gatt.disconnect();
    // Clear persisted ID so we don't auto-reconnect next time
    try { localStorage.removeItem(LAST_DEVICE_KEY); } catch {}
  };

  // ── Diagnostic scan — discover ALL services/characteristics ──────────────

  /** Scans the device and lists every service + characteristic it exposes. */
  const runDiagnostic = async () => {
    setDiagScanning(true);
    setDiagServices([]);
    setBleError('');
    try {
      let bleDevice;
      try {
        // Must declare ALL_SERVICES in optionalServices — Web Bluetooth won't
        // let you access ANY service that wasn't declared at request time
        bleDevice = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ALL_SERVICES,
        });
      } catch (e) {
        if (e.name === 'NotFoundError') { setDiagScanning(false); return; }
        throw e;
      }

      const server = await connectGATT(bleDevice);
      diagServerRef.current = server;
      deviceRef.current     = bleDevice;
      setDevice(bleDevice);

      // getPrimaryServices() only returns services that were in optionalServices
      let allServices = [];
      try { allServices = await server.getPrimaryServices(); } catch {}

      const result = [];
      for (const svc of allServices) {
        let chars = [];
        try { chars = await svc.getCharacteristics(); } catch {}
        const charInfos = chars.map(c => ({
          uuid:     c.uuid,
          props:    Object.entries(c.properties).filter(([,v])=>v).map(([k])=>k).join(', '),
          writable: c.properties.write || c.properties.writeWithoutResponse,
          charObj:  c,
        }));
        result.push({ svcUuid: svc.uuid, chars: charInfos });
      }

      if (result.length === 0) {
        // Device connected but its service UUID isn't in our list.
        // Show UUID copy instructions.
        setBleError('UNKNOWN_UUID');
      }

      setDiagServices(result);
      setDiagMode(true);
      setDiagScanning(false);

      bleDevice.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false); charRef.current = null;
      });

    } catch (err) {
      setDiagScanning(false);
      setBleError(`Scan failed: ${err.message}`);
    }
  };

  /** User taps a characteristic — use it as the write target. */
  const selectCustomChar = (svcUuid, charInfo) => {
    customCharRef.current = { serviceUuid: svcUuid, uuid: charInfo.uuid };
    charRef.current = charInfo.charObj;
    setCustomChar({ svcUuid, uuid: charInfo.uuid });
    setCharacteristic(charInfo.charObj);
    setIsConnected(true);
    setConnStatus('connected');
    setBleError('');
    setDiagMode(false);
    setDrawerOpen(false);
    // Persist
    try {
      localStorage.setItem(LAST_DEVICE_KEY, device?.id || '');
      localStorage.setItem('lumina_custom_svc', svcUuid);
      localStorage.setItem('lumina_custom_chr', charInfo.uuid);
    } catch {}
  };

  // ── Command — routes through correct protocol, queued ────────────────────

  const writeRaw = useCallback(async (data) => {
    const char = charRef.current;
    if (!char) return;
    try {
      if (char.properties?.writeWithoutResponse) {
        await char.writeValueWithoutResponse(data);
      } else {
        await char.writeValue(data);
      }
    } catch {}
  }, []);

  // mode = undefined/null  → static color
  // mode = number (0x00–0x17 for 7E, 0x25–0x38 for 0x56) → effect
  const sendCommand = useCallback((r, g, b, mode) => {
    cmdQueueRef.current = cmdQueueRef.current.then(async () => {
      const char = charRef.current;
      if (!char) return;
      const proto = protocolRef.current;
      let data;
      if (proto === '7e') {
        const effectMode = (mode !== undefined && mode !== null) ? mode : null;
        data = build7E(r, g, b, effectMode);
      } else {
        const f = brightnessRef.current / 100;
        const remap = PIN_SEQUENCES[pinSeqRef.current] || PIN_SEQUENCES.RGB;
        const [p1, p2, p3] = remap(Math.round(r*f), Math.round(g*f), Math.round(b*f));
        data = build0x56(p1, p2, p3, mode ?? 0x00);
      }
      try {
        if (char.properties?.writeWithoutResponse) {
          await char.writeValueWithoutResponse(data);
        } else {
          await char.writeValue(data);
        }
      } catch {}
    });
  }, []);

  // Dedicated brightness packet for 7E (works on any tab)
  const sendBrightness7E = useCallback((pct) => {
    if (protocolRef.current !== '7e') return;
    cmdQueueRef.current = cmdQueueRef.current.then(() => writeRaw(build7E_brightness(pct)));
  }, [writeRaw]);

  // ── Color sync ───────────────────────────────────────────────────────────
  // Fires whenever color or brightness changes (all tabs except mic-active)
  useEffect(() => {
    if (!isConnected || isMicActive || !isPoweredOn) return;
    const t = setTimeout(() => {
      if (protocolRef.current === '7e') {
        // Always send brightness first for 7E, then color (only on static tab)
        sendBrightness7E(brightness);
        if (activeTab !== 'fx') sendCommand(color.r, color.g, color.b, null);
      } else {
        if (activeTab !== 'fx') sendCommand(color.r, color.g, color.b);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [color, brightness, isConnected, isMicActive, activeTab, isPoweredOn, sendCommand, sendBrightness7E]);

  // ── Power on / off ───────────────────────────────────────────────────────
  const togglePower = useCallback(() => {
    if (!charRef.current) return;
    const proto    = protocolRef.current;
    const nowOn    = isPoweredOnRef.current;   // read from ref — never stale
    if (nowOn) {
      isPoweredOnRef.current = false;
      setIsPoweredOn(false);
      stopMic();
      if (proto === '7e') {
        cmdQueueRef.current = cmdQueueRef.current.then(() => writeRaw(build7E_power(false)));
      } else {
        sendCommand(0, 0, 0, 0x00);
      }
    } else {
      isPoweredOnRef.current = true;
      setIsPoweredOn(true);
      if (proto === '7e') {
        cmdQueueRef.current = cmdQueueRef.current
          .then(() => writeRaw(build7E_power(true)))
          .then(() => writeRaw(build7E_brightness(brightnessRef.current)))
          .then(() => writeRaw(build7E(colorRef.current.r, colorRef.current.g, colorRef.current.b, null)));
      } else {
        sendCommand(colorRef.current.r, colorRef.current.g, colorRef.current.b);
      }
    }
  }, [sendCommand, writeRaw]);

  // ── FX mode select ───────────────────────────────────────────────────────

  const handleModeSelect = (m) => {
    stopChase();
    setActiveDynamic(m.id);
    if (m.staticColor) {
      setColor(m.staticColor);
      if (protocolRef.current === '7e') sendBrightness7E(brightnessRef.current);
      sendCommand(m.staticColor.r, m.staticColor.g, m.staticColor.b, null);
    } else {
      const code = protocolRef.current === '7e'
        ? (m.code7e ?? m.code56)
        : (m.code56 ?? m.code7e);
      sendCommand(0, 0, 0, code);
    }
  };

  // ── Microphone ───────────────────────────────────────────────────────────

  const processAudio = useCallback(() => {
    if (!isMicActiveRef.current || !analyserRef.current) return;
    const arr = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(arr);
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += arr[i];
    const avg = sum / 8;
    if (avg > 30) {
      const { r, g, b } = colorRef.current;
      const k = Math.min(avg / 200, 1);
      sendCommand(Math.round(r*k), Math.round(g*k), Math.round(b*k));
    }
    rafRef.current = requestAnimationFrame(processAudio);
  }, [sendCommand]);

  const toggleMic = async () => {
    if (isMicActiveRef.current) { stopMic(); return; }
    stopCam(); // stop camera if running
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      micStreamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an  = ctx.createAnalyser(); an.fftSize = 256;
      src.connect(an); analyserRef.current = an;
      isMicActiveRef.current = true; setIsMicActive(true);
      processAudio();
    } catch { setBleError('Microphone access denied.'); }
  };

  const stopMic = () => {
    isMicActiveRef.current = false; setIsMicActive(false);
    if (rafRef.current)       cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current)  audioCtxRef.current.close();
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    analyserRef.current = null; audioCtxRef.current = null;
  };

  // ── Camera sync ──────────────────────────────────────────────────────────

  const SAMPLE_W = 16; // sample at 16×9 — tiny but enough for dominant color
  const SAMPLE_H = 9;
  const CAM_INTERVAL = 100; // ms between BLE writes (~10 Hz, safe for BLE)

  const processCamFrame = useCallback(() => {
    if (!isCamActiveRef.current) return;
    const video  = camVideoRef.current;
    const canvas = camCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      camRafRef.current = requestAnimationFrame(processCamFrame);
      return;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

    // Average every pixel for dominant color
    let rSum = 0, gSum = 0, bSum = 0;
    const total = SAMPLE_W * SAMPLE_H;
    for (let i = 0; i < data.length; i += 4) {
      rSum += data[i]; gSum += data[i+1]; bSum += data[i+2];
    }
    const r = Math.round(rSum / total);
    const g = Math.round(gSum / total);
    const b = Math.round(bSum / total);

    setCamColor({ r, g, b });

    // Scale by brightness
    const f = brightnessRef.current / 100;
    if (protocolRef.current === '7e') {
      writeRaw(build7E(Math.round(r*f), Math.round(g*f), Math.round(b*f), null));
    } else {
      const remap = PIN_SEQUENCES[pinSeqRef.current] || PIN_SEQUENCES.RGB;
      const [p1,p2,p3] = remap(Math.round(r*f), Math.round(g*f), Math.round(b*f));
      writeRaw(build0x56(p1, p2, p3, 0x00));
    }

    camRafRef.current = requestAnimationFrame(processCamFrame);
  }, [writeRaw]);

  // Throttled wrapper so we don't flood BLE faster than CAM_INTERVAL
  const startCamLoop = useCallback(() => {
    let last = 0;
    const tick = (ts) => {
      if (!isCamActiveRef.current) return;
      if (ts - last >= CAM_INTERVAL) {
        last = ts;
        processCamFrame();
      }
      camRafRef.current = requestAnimationFrame(tick);
    };
    camRafRef.current = requestAnimationFrame(tick);
  }, [processCamFrame]);

  const stopCam = useCallback(() => {
    isCamActiveRef.current = false;
    setIsCamActive(false);
    if (camRafRef.current) cancelAnimationFrame(camRafRef.current);
    if (camStreamRef.current) camStreamRef.current.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
  }, []);

  const toggleCam = async () => {
    if (isCamActiveRef.current) { stopCam(); return; }
    setCamError('');
    try {
      // Stop anything else running
      stopMic(); stopChase(); setActiveDynamic(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // rear camera faces the TV
          width:  { ideal: 320 },
          height: { ideal: 180 },
        },
        audio: false,
      });
      camStreamRef.current = stream;
      // Attach to hidden video element
      const video = camVideoRef.current;
      video.srcObject = stream;
      video.play();
      isCamActiveRef.current = true;
      setIsCamActive(true);
      // Wait one frame for video to be ready
      video.onloadedmetadata = () => startCamLoop();
    } catch (err) {
      if (err.name === 'NotAllowedError') setCamError('Camera permission denied. Allow camera access and try again.');
      else if (err.name === 'NotFoundError') setCamError('No camera found on this device.');
      else setCamError(`Camera error: ${err.message}`);
    }
  };

  // Stop cam on disconnect
  useEffect(() => { if (!isConnected) stopCam(); }, [isConnected, stopCam]);

  // ── Chase / Trail (software-driven) ──────────────────────────────────────

  // HSV → RGB  (h: 0–360, s/v: 0–1)
  const hsvToRgb = (h, s, v) => {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r=0,g=0,b=0;
    if      (h < 60)  { r=c; g=x; }
    else if (h < 120) { r=x; g=c; }
    else if (h < 180) { g=c; b=x; }
    else if (h < 240) { g=x; b=c; }
    else if (h < 300) { r=x; b=c; }
    else              { r=c; b=x; }
    return { r:Math.round((r+m)*255), g:Math.round((g+m)*255), b:Math.round((b+m)*255) };
  };

  const stopChase = useCallback(() => {
    if (chaseTimerRef.current) { clearInterval(chaseTimerRef.current); chaseTimerRef.current = null; }
    chaseModeRef.current = null;
    setChaseMode(null);
  }, []);

  const startChase = useCallback((mode) => {
    // Stop any existing chase / mic / fx
    stopChase();
    stopMic();
    setActiveDynamic(null);

    chaseModeRef.current = mode;
    setChaseMode(mode);
    chasePhaseRef.current = 0;

    // Tick every 80 ms — fast enough for smooth animation, safe for BLE
    const TICK = 80;
    const TWO_PI = Math.PI * 2;

    chaseTimerRef.current = setInterval(() => {
      if (!charRef.current) return;
      const phase = chasePhaseRef.current;
      const m = chaseModeRef.current;
      const bri = brightnessRef.current;

      if (m === 'pulse') {
        // Trailing comet: instant bright spike → slow exponential decay → repeat
        // phase 0→2π maps to one cycle. Attack is the first ~5% (spike), rest is decay tail.
        const inc = 0.08 + chaseSpeedRef.current * 0.07;
        const norm = phase / TWO_PI;               // 0→1 within a cycle

        let k;
        if (norm < 0.05) {
          k = norm / 0.05;                          // sharp linear rise to peak (0→1 in 5%)
        } else {
          const decayPos = (norm - 0.05) / 0.95;   // 0→1 across the remaining 95%
          k = Math.exp(-decayPos * 5);              // exponential decay (comet tail)
        }

        const { r, g, b } = colorRef.current;
        if (protocolRef.current === '7e') {
          writeRaw(build7E_brightness(Math.round(k * bri)));
          writeRaw(build7E(r, g, b, null));
        } else {
          const f = (k * bri) / 100;
          const remap = PIN_SEQUENCES[pinSeqRef.current] || PIN_SEQUENCES.RGB;
          const [p1,p2,p3] = remap(Math.round(r*f), Math.round(g*f), Math.round(b*f));
          writeRaw(build0x56(p1, p2, p3, 0x00));
        }
        chasePhaseRef.current = (phase + inc) % TWO_PI;

      } else if (m === 'rainbow') {
        const inc = 0.03 + chaseSpeedRef.current * 0.04;  // 0.07–0.23 rad/tick
        const hue = (phase / TWO_PI) * 360;
        const { r, g, b } = hsvToRgb(hue, 1, bri / 100);
        if (protocolRef.current === '7e') {
          writeRaw(build7E(r, g, b, null));
        } else {
          writeRaw(build0x56(r, g, b, 0x00));
        }
        chasePhaseRef.current = (phase + inc) % TWO_PI;

      } else if (m === 'twinkle') {
        const inc = 0.15 + chaseSpeedRef.current * 0.1;
        const spike = Math.random() > 0.4 ? Math.random() : (Math.sin(phase) + 1) / 4;
        const { r, g, b } = colorRef.current;
        if (protocolRef.current === '7e') {
          writeRaw(build7E_brightness(Math.round(spike * bri)));
          writeRaw(build7E(r, g, b, null));
        } else {
          const f = (spike * bri) / 100;
          const remap = PIN_SEQUENCES[pinSeqRef.current] || PIN_SEQUENCES.RGB;
          const [p1,p2,p3] = remap(Math.round(r*f), Math.round(g*f), Math.round(b*f));
          writeRaw(build0x56(p1, p2, p3, 0x00));
        }
        chasePhaseRef.current = (phase + inc) % TWO_PI;
      }
    }, TICK);
  }, [stopChase, writeRaw]);

  // Stop chase when disconnected
  useEffect(() => { if (!isConnected) stopChase(); }, [isConnected, stopChase]);

  // ── Scheduler ────────────────────────────────────────────────────────────

  const addSchedule = () => setSchedules(prev => [...prev, {
    id: Math.random().toString(36).substr(2,9), ...schedInput, enabled:true
  }]);

  const toggleSchedule = (id) =>
    setSchedules(prev => prev.map(s => s.id===id ? {...s, enabled:!s.enabled} : s));

  const toggleDay = (d) => {
    const days = schedInput.days.includes(d)
      ? schedInput.days.filter(x => x!==d)
      : [...schedInput.days, d];
    setSchedInput({...schedInput, days});
  };

  useEffect(() => {
    const id = setInterval(() => {
      const now  = new Date();
      const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const dow  = now.getDay();
      schedules.forEach(s => {
        if (!s.enabled || !s.days.includes(dow)) return;
        if (s.onTime  === hhmm) sendCommand(colorRef.current.r, colorRef.current.g, colorRef.current.b);
        if (s.offTime === hhmm) sendCommand(0,0,0);
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [schedules, sendCommand]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const toHex  = ({r,g,b}) => `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  const fromHex = h => ({ r:parseInt(h.slice(1,3),16), g:parseInt(h.slice(3,5),16), b:parseInt(h.slice(5,7),16) });

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen text-slate-100 flex flex-col font-sans overflow-x-hidden"
      style={{ background:'linear-gradient(135deg,#020014 0%,#05001f 40%,#000d1a 100%)', backgroundAttachment:'fixed' }}>

      {/* Grid + glows */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        backgroundImage:'linear-gradient(rgba(0,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,255,0.025) 1px,transparent 1px)',
        backgroundSize:'40px 40px' }}/>
      <div className="fixed top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full pointer-events-none z-0"
        style={{ background:'radial-gradient(circle,rgba(138,0,255,0.07) 0%,transparent 70%)' }}/>
      <div className="fixed bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full pointer-events-none z-0"
        style={{ background:'radial-gradient(circle,rgba(0,255,200,0.05) 0%,transparent 70%)' }}/>

      {/* ════════════════════════════════════════
          RIGHT-EDGE BLE DRAWER
      ════════════════════════════════════════ */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)}/>}
      <div className="fixed top-0 right-0 h-full z-50"
        style={{ transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)', transition:'transform 0.3s cubic-bezier(0.4,0,0.2,1)' }}>

        {/* Pull tab */}
        <button onClick={() => setDrawerOpen(o => !o)}
          className="absolute -left-10 top-1/2 -translate-y-1/2 w-10 h-20 flex items-center justify-center rounded-l-2xl"
          style={{ background:'rgba(0,20,50,0.97)', border:'1px solid rgba(0,255,255,0.15)', borderRight:'none',
            boxShadow: isConnected ? '-2px 0 20px rgba(0,255,150,0.2)' : '-2px 0 16px rgba(0,200,255,0.1)' }}>
          {drawerOpen
            ? <ChevronRight className="w-4 h-4 text-cyan-400"/>
            : <div className="flex flex-col items-center gap-1.5">
                <Bluetooth className={`w-4 h-4 ${isConnected ? 'text-green-400' : 'text-cyan-400'}`}/>
                {isConnected && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>}
              </div>
          }
        </button>

        {/* Drawer body */}
        <div className="w-72 h-full overflow-y-auto flex flex-col p-5 gap-4"
          style={{ background:'rgba(2,0,25,0.99)', borderLeft:'1px solid rgba(0,255,255,0.12)',
            boxShadow:'-20px 0 60px rgba(0,100,255,0.12)' }}>
          <div className="flex items-center justify-between pt-2">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-cyan-400">Bluetooth</h2>
              <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-0.5">Device Manager</p>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="p-1.5 text-slate-600 hover:text-white transition-colors">
              <X className="w-4 h-4"/>
            </button>
          </div>

          {/* Status */}
          <NeonCard className="p-4"
            style={{ border: isConnected ? '1px solid rgba(0,255,150,0.2)' : isReconnecting ? '1px solid rgba(255,200,0,0.2)' : '1px solid rgba(0,255,255,0.08)',
              background: isConnected ? 'rgba(0,40,25,0.6)' : isReconnecting ? 'rgba(30,20,0,0.6)' : 'rgba(0,15,35,0.7)' }}>
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                isConnected ? 'bg-green-400' : isReconnecting ? 'bg-yellow-400 animate-pulse' : connStatus === 'lost' ? 'bg-red-500' : 'bg-slate-700'
              }`} style={isConnected ? { boxShadow:'0 0 10px rgba(74,222,128,0.7)' } : isReconnecting ? { boxShadow:'0 0 10px rgba(250,204,21,0.6)' } : {}}/>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {isConnected ? 'Connected' : isReconnecting ? 'Reconnecting…' : connStatus === 'scanning' ? 'Scanning…' : connStatus === 'lost' ? 'Signal lost' : 'Disconnected'}
                </p>
                {isConnected && device && (
                  <p className="text-xs font-bold text-green-300 truncate mt-0.5">{device.name || 'Unknown Device'}</p>
                )}
                {isReconnecting && (
                  <p className="text-[9px] text-yellow-400 mt-0.5">Attempting to restore connection…</p>
                )}
              </div>
              {isConnected && (
                <button onClick={disconnect} className="text-[9px] font-black uppercase text-red-400 hover:text-red-300 transition-colors">Cut</button>
              )}
            </div>
          </NeonCard>

          {bleError && bleError !== 'UNKNOWN_UUID' && (
            <div className="flex gap-2 p-3 rounded-xl"
              style={{ background:'rgba(255,50,50,0.08)', border:'1px solid rgba(255,50,50,0.2)' }}>
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{bleError}</p>
            </div>
          )}
          {!bleSupported && (
            <div className="p-3 rounded-xl" style={{ background:'rgba(255,180,0,0.08)', border:'1px solid rgba(255,180,0,0.2)' }}>
              <p className="text-[10px] text-amber-300">Web Bluetooth requires <strong>Chrome</strong> or <strong>Edge</strong>.</p>
            </div>
          )}
          {bleSupported && (
            <button onClick={isConnected ? disconnect : connect} disabled={isConnecting || isReconnecting}
              className="w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
              style={isConnected
                ? { background:'rgba(255,50,50,0.1)', border:'1px solid rgba(255,50,50,0.3)', color:'#f87171' }
                : { background:'rgba(0,255,255,0.1)', border:'1px solid rgba(0,255,255,0.3)', color:'#67e8f9',
                    boxShadow:'0 0 20px rgba(0,255,255,0.08)' }}>
              {isConnecting
                ? <><RefreshCcw className="w-3.5 h-3.5 animate-spin"/>
                    {connStatus === 'scanning' ? 'Scanning…' : 'Connecting…'}</>
                : isReconnecting
                  ? <><RefreshCcw className="w-3.5 h-3.5 animate-spin"/>Reconnecting…</>
                  : isConnected
                    ? <><BluetoothOff className="w-3.5 h-3.5"/>Disconnect</>
                    : <><Bluetooth className="w-3.5 h-3.5"/>Scan For Device</>}
            </button>
          )}

          {/* Compatible */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-700 mb-2">Compatible With</p>
            <div className="flex flex-wrap gap-1.5">
              {['ELK-BLED','Triones','Magic Home','SP110E','MELK'].map(n => (
                <span key={n} className="text-[8px] font-black px-2 py-1 rounded-lg tracking-tighter uppercase"
                  style={{ background:'rgba(0,255,255,0.05)', border:'1px solid rgba(0,255,255,0.1)', color:'rgba(0,255,255,0.4)' }}>
                  {n}
                </span>
              ))}
            </div>
          </div>

          {/* ── Diagnostic Scanner ── */}
          <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(255,150,0,0.15)' }}>
            <button onClick={() => setDiagMode(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 transition-all"
              style={{ background: diagMode ? 'rgba(40,20,0,0.8)' : 'rgba(20,10,0,0.5)' }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background:'rgba(255,150,0,0.8)', boxShadow:'0 0 6px rgba(255,150,0,0.5)' }}/>
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color:'rgba(255,180,50,0.8)' }}>
                  Device Diagnostic
                </span>
              </div>
              {diagMode ? <ChevronUp className="w-3.5 h-3.5 text-orange-500"/> : <ChevronDown className="w-3.5 h-3.5 text-orange-500"/>}
            </button>

            {diagMode && (
              <div className="p-4 space-y-3" style={{ background:'rgba(10,5,0,0.6)' }}>
                {bleError === 'UNKNOWN_UUID' ? (
                  <div className="p-4 rounded-xl space-y-3" style={{ background:'rgba(255,100,0,0.08)', border:'1px solid rgba(255,100,0,0.25)' }}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">UUID Not in Database</p>
                    <p className="text-[9px] text-orange-200/70 leading-relaxed">
                      Your device connected but uses a service UUID we don't have. To find it:
                    </p>
                    <div className="space-y-1.5">
                      {[
                        '1. On a desktop Chrome, go to chrome://bluetooth-internals',
                        '2. Click "Devices" → find your strip → click Inspect',
                        '3. Look for a service with a writable characteristic',
                        '4. Copy both the Service UUID and Characteristic UUID',
                        '5. Share them here and I\'ll add permanent support',
                      ].map((s,i) => (
                        <p key={i} className="text-[9px] font-mono" style={{ color:'rgba(255,180,100,0.7)' }}>{s}</p>
                      ))}
                    </div>
                    <p className="text-[9px] text-orange-300/50 leading-relaxed pt-1 border-t" style={{ borderColor:'rgba(255,100,0,0.15)' }}>
                      Alternatively install <strong className="text-orange-300">nRF Connect</strong> (Android/iOS) — connect your strip and screenshot the GATT services. That will show the exact UUIDs.
                    </p>
                  </div>
                ) : (
                  <p className="text-[9px] text-orange-300/60 leading-relaxed">
                    If "no service found" — use this to discover your device's real UUIDs. Tap any <span className="text-green-400">writable</span> characteristic to use it.
                  </p>
                )}

                {customChar && (
                  <div className="p-3 rounded-xl" style={{ background:'rgba(0,255,100,0.06)', border:'1px solid rgba(0,255,100,0.2)' }}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-green-400 mb-1">Custom char active</p>
                    <p className="text-[8px] font-mono text-green-300 break-all">{customChar.uuid}</p>
                    <button onClick={() => { setCustomChar(null); customCharRef.current = null; try { localStorage.removeItem('lumina_custom_svc'); localStorage.removeItem('lumina_custom_chr'); } catch {} }}
                      className="mt-2 text-[8px] font-black uppercase text-red-400 hover:text-red-300 transition-colors">
                      Clear custom char
                    </button>
                  </div>
                )}

                <button onClick={runDiagnostic} disabled={diagScanning}
                  className="w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background:'rgba(255,150,0,0.1)', border:'1px solid rgba(255,150,0,0.3)', color:'#fb923c' }}>
                  {diagScanning
                    ? <><RefreshCcw className="w-3 h-3 animate-spin"/>Scanning…</>
                    : <>Scan All Services</>}
                </button>

                {diagServices.length > 0 && (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {diagServices.map((svc, si) => (
                      <div key={si} className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(255,150,0,0.1)' }}>
                        <div className="px-3 py-2" style={{ background:'rgba(30,15,0,0.8)' }}>
                          <p className="text-[8px] font-black uppercase text-orange-400 tracking-wider">Service</p>
                          <p className="text-[9px] font-mono text-orange-200/70 break-all mt-0.5">{svc.svcUuid}</p>
                        </div>
                        <div className="divide-y" style={{ borderColor:'rgba(255,150,0,0.06)' }}>
                          {svc.chars.map((c, ci) => (
                            <button key={ci} onClick={() => c.writable && selectCustomChar(svc.svcUuid, c)}
                              className="w-full px-3 py-2.5 text-left transition-all"
                              style={c.writable
                                ? { background:'rgba(0,0,0,0)', cursor:'pointer' }
                                : { background:'rgba(0,0,0,0)', cursor:'default', opacity:0.4 }}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[8px] font-mono break-all"
                                    style={{ color: c.writable ? '#86efac' : '#64748b' }}>
                                    {c.uuid}
                                  </p>
                                  <p className="text-[7px] mt-0.5" style={{ color: c.writable ? 'rgba(134,239,172,0.6)' : 'rgba(100,116,139,0.5)' }}>
                                    {c.props || 'no properties'}
                                  </p>
                                </div>
                                {c.writable && (
                                  <span className="text-[7px] font-black uppercase px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                                    style={{ background:'rgba(0,255,100,0.1)', border:'1px solid rgba(0,255,100,0.2)', color:'#4ade80' }}>
                                    USE
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-auto pt-4 border-t" style={{ borderColor:'rgba(0,255,255,0.06)' }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color:'rgba(0,255,255,0.3)' }}>Android Users</p>
            <p className="text-[9px] text-slate-700 leading-relaxed">
              Enable <strong className="text-slate-500">Location (Nearby Devices)</strong> permission in Android Settings → Apps → Chrome/Edge → Permissions. Required for BLE scanning. Lumina never collects GPS data.
            </p>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          PIN SEQUENCE DRAWER (left side)
      ════════════════════════════════════════ */}
      {pinDrawerOpen && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setPinDrawerOpen(false)}/>}
      <div className="fixed top-0 left-0 h-full z-50"
        style={{ transform: pinDrawerOpen ? 'translateX(0)' : 'translateX(-100%)', transition:'transform 0.3s cubic-bezier(0.4,0,0.2,1)' }}>

        {/* Pull tab */}
        <button onClick={() => setPinDrawerOpen(o => !o)}
          className="absolute -right-10 top-1/2 -translate-y-1/2 w-10 h-20 flex items-center justify-center rounded-r-2xl"
          style={{ background:'rgba(0,20,50,0.97)', border:'1px solid rgba(138,0,255,0.2)', borderLeft:'none',
            boxShadow:'2px 0 16px rgba(138,0,255,0.15)' }}>
          <div className="flex flex-col items-center gap-1.5">
            <Settings className="w-4 h-4 text-purple-400"/>
            <span className="text-[7px] font-black text-purple-400 uppercase tracking-tighter">{pinSeq}</span>
          </div>
        </button>

        {/* Drawer body */}
        <div className="w-64 h-full overflow-y-auto flex flex-col p-5 gap-5"
          style={{ background:'rgba(5,0,25,0.99)', borderRight:'1px solid rgba(138,0,255,0.15)',
            boxShadow:'20px 0 60px rgba(80,0,200,0.1)' }}>
          <div className="flex items-center justify-between pt-2">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-purple-400">Pin Order</h2>
              <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-0.5">LED Wire Sequence</p>
            </div>
            <button onClick={() => setPinDrawerOpen(false)} className="p-1.5 text-slate-600 hover:text-white transition-colors">
              <X className="w-4 h-4"/>
            </button>
          </div>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            Select the physical RGB wire order your LED strip uses. Wrong order causes shifted colors (e.g. red shows as green).
          </p>

          {/* Current preview */}
          <div className="p-4 rounded-2xl space-y-2" style={{ background:'rgba(138,0,255,0.06)', border:'1px solid rgba(138,0,255,0.15)' }}>
            <p className="text-[9px] font-black uppercase tracking-widest text-purple-400">Current: {pinSeq}</p>
            <div className="flex gap-2">
              {(PIN_SEQUENCES[pinSeq] || PIN_SEQUENCES.RGB)(255,255,255).map((_, idx) => {
                const labels = pinSeq.split('');
                const colMap = { R:'#ff4444', G:'#44ff88', B:'#4488ff' };
                return (
                  <div key={idx} className="flex-1 h-8 rounded-lg flex items-center justify-center text-xs font-black"
                    style={{ background: colMap[labels[idx]] + '33', border:`1px solid ${colMap[labels[idx]]}55`, color: colMap[labels[idx]] }}>
                    {labels[idx]}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sequence picker */}
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(PIN_SEQUENCES).map(seq => (
              <button key={seq} onClick={() => setPinSeq(seq)}
                className="py-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-95"
                style={pinSeq === seq
                  ? { background:'rgba(138,0,255,0.2)', border:'1px solid rgba(138,0,255,0.5)', color:'#d8b4fe',
                      boxShadow:'0 0 15px rgba(138,0,255,0.2)' }
                  : { background:'rgba(0,10,25,0.6)', border:'1px solid rgba(138,0,255,0.1)', color:'#64748b' }}>
                {seq}
              </button>
            ))}
          </div>

          <NeonCard className="p-4" style={{ border:'1px solid rgba(138,0,255,0.1)' }}>
            <p className="text-[9px] font-black uppercase tracking-widest text-purple-400 mb-2">Common Strips</p>
            <div className="space-y-1.5">
              {[
                { label:'WS2812B / NeoPixel', seq:'GRB' },
                { label:'SK6812 / APA102',    seq:'RGB' },
                { label:'Generic 5050 RGB',   seq:'RGB' },
                { label:'Some ELK-BLED',      seq:'GRB' },
              ].map(item => (
                <button key={item.label} onClick={() => setPinSeq(item.seq)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all hover:bg-purple-900/20"
                  style={{ border:'1px solid rgba(138,0,255,0.07)' }}>
                  <span className="text-[9px] text-slate-400 text-left">{item.label}</span>
                  <span className="text-[9px] font-black text-purple-400">{item.seq}</span>
                </button>
              ))}
            </div>
          </NeonCard>

          {/* Protocol override */}
          <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(255,180,0,0.15)' }}>
            <div className="px-4 py-3" style={{ background:'rgba(30,15,0,0.7)' }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color:'rgba(255,180,0,0.8)' }}>
                Command Protocol
              </p>
              <p className="text-[8px] text-slate-600 mt-0.5">
                Auto-detected: <span className="font-black" style={{ color: protocol === '7e' ? '#fbbf24' : '#34d399' }}>
                  {protocol === 'auto' ? 'not connected' : protocol === '7e' ? '7E (your device)' : '0x56'}
                </span>
              </p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2" style={{ background:'rgba(10,5,0,0.5)' }}>
              {[
                { id:'auto', label:'Auto',  desc:'Let app decide' },
                { id:'7e',   label:'7E',    desc:'fff0/fff3 strips' },
                { id:'0x56', label:'0x56',  desc:'ffd5/ffe5 strips' },
              ].map(p => (
                <button key={p.id} onClick={() => { setProtocol(p.id); protocolRef.current = p.id; }}
                  className="p-2.5 rounded-xl text-left transition-all active:scale-95"
                  style={protocol === p.id
                    ? { background:'rgba(255,180,0,0.15)', border:'1px solid rgba(255,180,0,0.4)', boxShadow:'0 0 10px rgba(255,180,0,0.1)' }
                    : { background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,180,0,0.07)' }}>
                  <p className="text-[10px] font-black" style={{ color: protocol === p.id ? '#fbbf24' : '#64748b' }}>{p.label}</p>
                  <p className="text-[8px] mt-0.5" style={{ color:'rgba(100,116,139,0.7)' }}>{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          HEADER
      ════════════════════════════════════════ */}
      <header className="relative z-10 px-5 py-4 flex justify-between items-center sticky top-0"
        style={{ background:'rgba(2,0,20,0.9)', borderBottom:'1px solid rgba(0,255,255,0.07)', backdropFilter:'blur(20px)' }}>
        <div>
          <h1 className="text-lg font-black tracking-tighter bg-gradient-to-tr from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent italic">
            LUMINA WEB
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600 mt-0.5">BLE LED Controller</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Pin sequence quick indicator */}
          <button onClick={() => setPinDrawerOpen(true)}
            className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
            style={{ background:'rgba(138,0,255,0.08)', border:'1px solid rgba(138,0,255,0.2)', color:'#c084fc' }}>
            <Settings className="w-3 h-3"/>
            <span className="text-[9px] font-black">{pinSeq}</span>
          </button>

          {/* Protocol badge — only show when connected */}
          {isConnected && (
            <div className="px-2 py-1 rounded-lg"
              style={{ background: protocol === '7e' ? 'rgba(255,180,0,0.08)' : 'rgba(0,255,200,0.06)',
                border: protocol === '7e' ? '1px solid rgba(255,180,0,0.2)' : '1px solid rgba(0,255,200,0.15)' }}>
              <span className="text-[8px] font-black uppercase tracking-widest"
                style={{ color: protocol === '7e' ? '#fbbf24' : '#34d399' }}>
                {protocol === '7e' ? '7E' : '56'}
              </span>
            </div>
          )}

          {/* Mic toggle */}
          <button onClick={toggleMic} disabled={!isConnected} title={isMicActive ? 'Stop mic sync' : 'Start mic sync'}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
            style={isMicActive
              ? { background:'rgba(236,72,153,0.2)', border:'1px solid rgba(236,72,153,0.5)', boxShadow:'0 0 15px rgba(236,72,153,0.3)' }
              : { background:'rgba(0,15,35,0.8)', border:'1px solid rgba(0,255,255,0.1)' }}>
            {isMicActive ? <Mic className="w-4 h-4 text-pink-400"/> : <MicOff className="w-4 h-4 text-slate-500"/>}
          </button>

          {/* Camera sync toggle */}
          <button onClick={toggleCam} disabled={!isConnected} title={isCamActive ? 'Stop camera sync' : 'Start TV camera sync'}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
            style={isCamActive
              ? { background:'rgba(34,197,94,0.2)', border:'1px solid rgba(34,197,94,0.5)', boxShadow:'0 0 15px rgba(34,197,94,0.3)' }
              : { background:'rgba(0,15,35,0.8)', border:'1px solid rgba(0,255,255,0.1)' }}>
            {isCamActive ? <Camera className="w-4 h-4 text-green-400"/> : <CameraOff className="w-4 h-4 text-slate-500"/>}
          </button>

          {/* BLE */}
          <button onClick={() => setDrawerOpen(true)}
            className="px-3 py-2 rounded-full text-xs font-bold flex items-center gap-2 transition-all"
            style={isConnected
              ? { background:'rgba(0,255,150,0.1)', border:'1px solid rgba(0,255,150,0.3)', color:'#4ade80', boxShadow:'0 0 12px rgba(0,255,150,0.08)' }
              : isReconnecting
                ? { background:'rgba(255,200,0,0.08)', border:'1px solid rgba(255,200,0,0.25)', color:'#fbbf24' }
                : { background:'rgba(0,255,255,0.08)', border:'1px solid rgba(0,255,255,0.2)', color:'#67e8f9' }}>
            {isReconnecting
              ? <RefreshCcw className="w-3.5 h-3.5 animate-spin"/>
              : <Bluetooth className="w-3.5 h-3.5"/>}
            {isConnected ? 'Connected' : isReconnecting ? 'Reconnecting' : 'Connect'}
          </button>
        </div>
      </header>

      {/* ════════════════════════════════════════
          MAIN
      ════════════════════════════════════════ */}
      <main className="relative z-10 flex-1 max-w-lg mx-auto w-full p-4 space-y-4 pb-28">

        {/* Mic active banner */}
        {isMicActive && (
          <div className="flex items-center justify-between px-4 py-3 rounded-2xl"
            style={{ background:'rgba(236,72,153,0.1)', border:'1px solid rgba(236,72,153,0.25)', boxShadow:'0 0 20px rgba(236,72,153,0.07)' }}>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" style={{ boxShadow:'0 0 8px rgba(236,72,153,0.8)' }}/>
              <span className="text-[10px] font-black uppercase tracking-widest text-pink-300">Mic Sync Active</span>
            </div>
            <button onClick={stopMic} className="text-[9px] font-black uppercase tracking-widest text-pink-400 hover:text-pink-200 transition-colors">Stop</button>
          </div>
        )}

        {/* Camera sync active banner */}
        {isCamActive && (
          <div className="rounded-2xl overflow-hidden"
            style={{ border:'1px solid rgba(34,197,94,0.3)', boxShadow:'0 0 20px rgba(34,197,94,0.07)' }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ background:'rgba(0,30,15,0.8)' }}>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow:'0 0 8px rgba(34,197,94,0.8)' }}/>
                <Camera className="w-3.5 h-3.5 text-green-400"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-green-300">TV Sync Active</span>
              </div>
              <button onClick={stopCam} className="text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors">Stop</button>
            </div>
            {/* Live color preview swatch */}
            <div className="flex items-center gap-3 px-4 pb-3 pt-1"
              style={{ background:'rgba(0,20,10,0.6)' }}>
              <div className="w-8 h-8 rounded-xl flex-shrink-0 transition-colors duration-100"
                style={{ backgroundColor:`rgb(${camColor.r},${camColor.g},${camColor.b})`,
                  boxShadow:`0 0 12px rgba(${camColor.r},${camColor.g},${camColor.b},0.5)` }}/>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-green-400/60">Detected color</p>
                <p className="text-[10px] font-mono text-green-300">
                  rgb({camColor.r}, {camColor.g}, {camColor.b})
                </p>
              </div>
              <p className="ml-auto text-[8px] text-slate-600 leading-relaxed text-right">
                Point rear<br/>camera at TV
              </p>
            </div>
          </div>
        )}

        {/* Camera error */}
        {camError && (
          <div className="flex gap-2 p-3 rounded-xl"
            style={{ background:'rgba(255,50,50,0.08)', border:'1px solid rgba(255,50,50,0.2)' }}>
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5"/>
            <p className="text-[10px] text-red-300 leading-relaxed">{camError}</p>
          </div>
        )}

        {/* Hidden video + canvas for camera color sampling */}
        <video ref={camVideoRef} playsInline muted
          style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}/>
        <canvas ref={camCanvasRef} width={16} height={9}
          style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}/>

        {/* Power + Brightness */}
        <NeonCard className="p-5 space-y-4"
          style={isPoweredOn
            ? { border:'1px solid rgba(0,255,255,0.08)' }
            : { border:'1px solid rgba(255,50,50,0.15)', background:'rgba(20,0,0,0.5)' }}>
          <div className="flex items-center justify-between">
            {/* Power button */}
            <button
              onClick={togglePower}
              disabled={!isConnected}
              className="flex items-center gap-3 transition-all active:scale-95 disabled:opacity-30"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all"
                style={isPoweredOn
                  ? { background:'rgba(0,255,150,0.12)', border:'1px solid rgba(0,255,150,0.4)',
                      boxShadow:'0 0 20px rgba(0,255,150,0.2), inset 0 0 10px rgba(0,255,150,0.05)' }
                  : { background:'rgba(255,50,50,0.1)', border:'1px solid rgba(255,50,50,0.35)',
                      boxShadow:'0 0 20px rgba(255,50,50,0.15)' }}>
                <Power className={`w-5 h-5 ${isPoweredOn ? 'text-green-400' : 'text-red-400'}`}/>
              </div>
              <div className="text-left">
                <p className="text-xs font-black uppercase tracking-widest"
                  style={{ color: isPoweredOn ? '#4ade80' : '#f87171' }}>
                  {isPoweredOn ? 'On' : 'Off'}
                </p>
                <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-0.5">
                  {isPoweredOn ? 'Tap to turn off' : 'Tap to turn on'}
                </p>
              </div>
            </button>

            {/* Brightness value */}
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-yellow-400"/>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Brightness</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg text-cyan-300"
                style={{ background:'rgba(0,255,255,0.06)', border:'1px solid rgba(0,255,255,0.1)' }}>
                {brightness}%
              </span>
            </div>
          </div>

          {/* Brightness slider — dimmed when off */}
          <div style={{ opacity: isPoweredOn ? 1 : 0.3, transition:'opacity 0.3s', pointerEvents: isPoweredOn ? 'auto' : 'none' }}>
            <input type="range" min="1" max="100" value={brightness}
              onChange={e => setBrightness(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor:'#22d3ee', background:'rgba(0,255,255,0.08)' }}/>
          </div>
        </NeonCard>

        {/* Tabs */}
        <div className="flex p-1 rounded-2xl gap-1"
          style={{ background:'rgba(0,10,30,0.7)', border:'1px solid rgba(0,255,255,0.07)' }}>
          {[
            { id:'static',    icon:<div className="w-3 h-3 rounded-full bg-gradient-to-tr from-cyan-400 to-purple-500"/>, label:'Color'    },
            { id:'fx',        icon:<Zap className="w-3.5 h-3.5 text-yellow-400"/>,    label:'FX'       },
            { id:'scheduler', icon:<Calendar className="w-3.5 h-3.5 text-cyan-400"/>, label:'Schedule' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl transition-all text-slate-500 hover:text-slate-300"
              style={activeTab === tab.id ? {
                background:'rgba(0,255,255,0.08)', color:'white',
                border:'1px solid rgba(0,255,255,0.15)', boxShadow:'0 0 12px rgba(0,255,255,0.08)'
              } : {}}>
              {tab.icon}
              <span className="text-[9px] font-black uppercase tracking-tighter">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Color tab ── */}
        {activeTab === 'static' && (
          <div className="space-y-4">
            {/* Preview */}
            <div className="h-14 rounded-2xl transition-all duration-150"
              style={{ backgroundColor:`rgb(${color.r},${color.g},${color.b})`,
                border:'1px solid rgba(255,255,255,0.1)',
                boxShadow:`0 0 30px rgba(${color.r},${color.g},${color.b},0.3)` }}/>
            {/* Presets */}
            <div className="grid grid-cols-4 gap-3">
              {PRESET_COLORS.map((c,i) => (
                <button key={i} onClick={() => setColor(c)}
                  style={{ backgroundColor:`rgb(${c.r},${c.g},${c.b})` }}
                  className={`aspect-square rounded-2xl transition-transform active:scale-90 border-4 ${
                    color.r===c.r&&color.g===c.g&&color.b===c.b ? 'border-white scale-110 shadow-lg' : 'border-transparent'
                  }`}/>
              ))}
            </div>
            {/* Custom */}
            <NeonCard className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Custom</p>
                <p className="text-[10px] font-mono text-cyan-400 mt-0.5">{toHex(color).toUpperCase()}</p>
              </div>
              <input type="color" value={toHex(color)} onChange={e => setColor(fromHex(e.target.value))}
                className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-none outline-none scale-125 hover:scale-150 transition-transform"/>
            </NeonCard>
          </div>
        )}

        {/* ── FX tab ── */}
        {activeTab === 'fx' && (
          <div className="space-y-2">

            {/* ── Software Chase Effects ── */}
            <NeonCard className="p-4 space-y-3"
              style={{ border: chaseMode ? '1px solid rgba(180,100,255,0.35)' : '1px solid rgba(180,100,255,0.12)',
                background: chaseMode ? 'rgba(30,0,50,0.7)' : 'rgba(0,15,35,0.7)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full"
                    style={{ background: chaseMode ? '#d946ef' : 'rgba(180,100,255,0.4)',
                      boxShadow: chaseMode ? '0 0 8px #d946ef' : 'none',
                      animation: chaseMode ? 'pulse 1s infinite' : 'none' }}/>
                  <span className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: chaseMode ? '#e879f9' : 'rgba(180,100,255,0.7)' }}>
                    Chase / Trail
                  </span>
                  {chaseMode && (
                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded"
                      style={{ background:'rgba(217,70,239,0.15)', border:'1px solid rgba(217,70,239,0.3)', color:'#e879f9' }}>
                      Active
                    </span>
                  )}
                </div>
                {chaseMode && (
                  <button onClick={stopChase}
                    className="text-[9px] font-black uppercase tracking-widest transition-colors"
                    style={{ color:'rgba(248,113,113,0.8)' }}>Stop</button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { id:'pulse',   label:'Comet',   desc:'Tail & fade',   icon:'◉',  color:'rgba(0,200,255,0.8)'   },
                  { id:'rainbow', label:'Rainbow',  desc:'Full spectrum',  icon:'◈',  color:'rgba(255,150,0,0.8)'   },
                  { id:'twinkle', label:'Twinkle',  desc:'Sparkle burst',  icon:'✦',  color:'rgba(220,100,255,0.8)' },
                ].map(e => (
                  <button key={e.id}
                    onClick={() => chaseMode === e.id ? stopChase() : startChase(e.id)}
                    disabled={!isConnected}
                    className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl transition-all active:scale-95 disabled:opacity-30"
                    style={chaseMode === e.id
                      ? { background:`rgba(${e.id==='pulse'?'0,200,255':e.id==='rainbow'?'255,150,0':'220,100,255'},0.12)`,
                          border:`1px solid ${e.color}`,
                          boxShadow:`0 0 16px ${e.color.replace('0.8','0.2')}` }
                      : { background:'rgba(0,10,25,0.6)', border:'1px solid rgba(180,100,255,0.1)' }}>
                    <span className="text-xl leading-none" style={{ color: chaseMode === e.id ? e.color : 'rgba(180,100,255,0.5)' }}>
                      {e.icon}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wide"
                      style={{ color: chaseMode === e.id ? e.color : '#64748b' }}>
                      {e.label}
                    </span>
                    <span className="text-[8px]" style={{ color:'rgba(100,116,139,0.6)' }}>
                      {e.desc}
                    </span>
                  </button>
                ))}
              </div>

              {/* Speed slider — only shown when chase is active */}
              {chaseMode && (
                <div className="space-y-1.5 pt-1 border-t" style={{ borderColor:'rgba(180,100,255,0.1)' }}>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black uppercase tracking-widest" style={{ color:'rgba(180,100,255,0.6)' }}>Speed</span>
                    <span className="text-[9px] font-mono" style={{ color:'rgba(180,100,255,0.5)' }}>
                      {['','Slow','','Medium','','Fast'][chaseSpeed] || chaseSpeed}
                    </span>
                  </div>
                  <input type="range" min="1" max="5" value={chaseSpeed}
                    onChange={e => setChaseSpeed(parseInt(e.target.value))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor:'#d946ef', background:'rgba(180,100,255,0.08)' }}/>
                </div>
              )}
            </NeonCard>

            {/* Active mode indicator */}
            {activeDynamic && !chaseMode && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background:'rgba(0,255,255,0.05)', border:'1px solid rgba(0,255,255,0.15)' }}>
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ boxShadow:'0 0 8px rgba(0,255,255,0.8)' }}/>
                <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300">
                  {MODE_GROUPS.flatMap(g => g.modes).find(m => m.id === activeDynamic)?.name ?? activeDynamic}
                </span>
              </div>
            )}
            {MODE_GROUPS.map(group => (
              <GroupSection key={group.label} group={group} activeDynamic={activeDynamic} onSelect={handleModeSelect}/>
            ))}
          </div>
        )}

        {/* ── Scheduler tab ── */}
        {activeTab === 'scheduler' && (
          <div className="space-y-4">
            <NeonCard className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-cyan-400"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">New Schedule</span>
              </div>
              {/* Time pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Power className="w-3 h-3 text-green-400"/>
                    <span className="text-[9px] font-black uppercase tracking-widest text-green-400">Turn On</span>
                  </div>
                  <input type="time" value={schedInput.onTime}
                    onChange={e => setSchedInput({...schedInput, onTime:e.target.value})}
                    className="w-full p-3 rounded-xl text-center text-sm font-black outline-none text-green-300"
                    style={{ background:'rgba(0,255,100,0.06)', border:'1px solid rgba(0,255,100,0.2)', colorScheme:'dark' }}/>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Power className="w-3 h-3 text-red-400"/>
                    <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Turn Off</span>
                  </div>
                  <input type="time" value={schedInput.offTime}
                    onChange={e => setSchedInput({...schedInput, offTime:e.target.value})}
                    className="w-full p-3 rounded-xl text-center text-sm font-black outline-none text-red-300"
                    style={{ background:'rgba(255,50,50,0.06)', border:'1px solid rgba(255,50,50,0.2)', colorScheme:'dark' }}/>
                </div>
              </div>
              {/* Days */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2">Repeat Days</p>
                <div className="flex gap-1">
                  {DAYS.map((d,i) => (
                    <button key={d} onClick={() => toggleDay(i)}
                      className="flex-1 py-2 rounded-xl text-[9px] font-black uppercase transition-all"
                      style={schedInput.days.includes(i)
                        ? { background:'rgba(0,255,255,0.15)', border:'1px solid rgba(0,255,255,0.3)', color:'#67e8f9' }
                        : { background:'rgba(0,10,25,0.6)', border:'1px solid rgba(0,255,255,0.05)', color:'#475569' }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={addSchedule} disabled={!isConnected}
                className="w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-30"
                style={{ background:'rgba(0,255,255,0.1)', border:'1px solid rgba(0,255,255,0.25)', color:'#67e8f9',
                  boxShadow:'0 0 20px rgba(0,255,255,0.05)' }}>
                + Add Schedule
              </button>
            </NeonCard>

            {schedules.length === 0 ? (
              <div className="py-10 text-center rounded-2xl" style={{ border:'1px dashed rgba(0,255,255,0.08)' }}>
                <Calendar className="w-6 h-6 text-slate-800 mx-auto mb-2"/>
                <p className="text-[10px] text-slate-700 uppercase font-black tracking-widest">No schedules yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map(s => (
                  <NeonCard key={s.id} className="p-4"
                    style={{ border: s.enabled ? '1px solid rgba(0,255,255,0.12)' : '1px solid rgba(0,255,255,0.04)', opacity: s.enabled ? 1 : 0.45 }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-xs font-black text-green-400">
                            <Power className="w-3 h-3"/>{s.onTime}
                          </span>
                          <span className="text-slate-700">→</span>
                          <span className="flex items-center gap-1 text-xs font-black text-red-400">
                            <Power className="w-3 h-3"/>{s.offTime}
                          </span>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {DAYS.map((d,i) => (
                            <span key={d} className="text-[8px] font-black px-1.5 py-0.5 rounded"
                              style={s.days.includes(i)
                                ? { background:'rgba(0,255,255,0.12)', color:'#67e8f9' }
                                : { color:'#334155' }}>
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <button onClick={() => toggleSchedule(s.id)} className="transition-colors">
                          {s.enabled ? <CheckCircle className="w-4 h-4 text-cyan-400"/> : <Circle className="w-4 h-4 text-slate-700"/>}
                        </button>
                        <button onClick={() => setSchedules(prev => prev.filter(x => x.id!==s.id))}
                          className="text-slate-700 hover:text-red-400 transition-colors">
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    </div>
                  </NeonCard>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom bar when disconnected or reconnecting */}
      {(!isConnected) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-5 py-3 rounded-full"
          style={{ background:'rgba(2,0,25,0.97)', border:`1px solid ${isReconnecting ? 'rgba(255,200,0,0.2)' : 'rgba(0,255,255,0.15)'}`,
            backdropFilter:'blur(20px)', boxShadow:'0 0 40px rgba(0,100,255,0.15), 0 20px 40px rgba(0,0,0,0.5)' }}>
          {isReconnecting
            ? <>
                <RefreshCcw className="w-3 h-3 text-yellow-400 animate-spin"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Reconnecting…</span>
              </>
            : <>
                <div className="w-2 h-2 rounded-full bg-slate-600"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">No device</span>
                <button onClick={() => setDrawerOpen(true)}
                  className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center gap-2"
                  style={{ background:'rgba(0,255,255,0.12)', border:'1px solid rgba(0,255,255,0.25)', color:'#67e8f9',
                    boxShadow:'0 0 15px rgba(0,255,255,0.1)' }}>
                  <Bluetooth className="w-3 h-3"/> Connect →
                </button>
              </>
          }
        </div>
      )}
      <div className="h-24"/>
    </div>
  );
}
