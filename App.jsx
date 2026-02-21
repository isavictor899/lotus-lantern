import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bluetooth, BluetoothOff, Zap, Sun, Play,
  Trash2, RefreshCcw, AlertCircle, Mic, MicOff,
  ChevronRight, X, Power, Calendar, CheckCircle,
  Circle, Settings, ChevronDown, ChevronUp
} from 'lucide-react';

// ─── BLE CONFIG ───────────────────────────────────────────────────────────────
const PRIMARY_SERVICE  = '0000ffd5-0000-1000-8000-00805f9b34fb';
const PRIMARY_CHAR     = '0000ffd9-0000-1000-8000-00805f9b34fb';
const FALLBACK_SERVICE = '0000ffe5-0000-1000-8000-00805f9b34fb';
const FALLBACK_CHAR    = '0000ffe9-0000-1000-8000-00805f9b34fb';

// Known LED controller name prefixes — pre-filters scan list for faster discovery
const BLE_NAME_PREFIXES = [
  'ELK','LED','Triones','Magic','SP1','MELK','QHM','HM','BLE','iLC',
  'ZJ','Lamp','Light','Strip','RGB','LEDBLE','RGBW','MagicLight',
];

const ALL_SERVICES       = [PRIMARY_SERVICE, FALLBACK_SERVICE];
const SERVICE_MAP        = [
  { svc: PRIMARY_SERVICE,  chr: PRIMARY_CHAR  },
  { svc: FALLBACK_SERVICE, chr: FALLBACK_CHAR },
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
  for (const { svc, chr } of SERVICE_MAP) {
    try {
      const service = await server.getPrimaryService(svc);
      return await service.getCharacteristic(chr);
    } catch { /* try next */ }
  }
  throw new Error('No matching BLE service on this device.');
}

function buildRequestOptions() {
  return {
    filters: [
      { services: [PRIMARY_SERVICE]  },
      { services: [FALLBACK_SERVICE] },
      ...BLE_NAME_PREFIXES.map(p => ({ namePrefix: p })),
    ],
    optionalServices: ALL_SERVICES,
  };
}

// ─── PIN SEQUENCES ────────────────────────────────────────────────────────────
// Maps logical (r,g,b) to the physical wire order your strip expects
const PIN_SEQUENCES = {
  RGB: (r,g,b) => [r,g,b],
  RBG: (r,g,b) => [r,b,g],
  GRB: (r,g,b) => [g,r,b],
  GBR: (r,g,b) => [g,b,r],
  BRG: (r,g,b) => [b,r,g],
  BGR: (r,g,b) => [b,g,r],
};

// ─── LIGHTING MODES ───────────────────────────────────────────────────────────
const MODE_GROUPS = [
  {
    label: 'Static Colors',
    color: 'rgba(0,255,255,0.6)',
    modes: [
      { id:'static_red',     name:'Static Red',     code:null, staticColor:{r:255,g:0,b:0}    },
      { id:'static_green',   name:'Static Green',   code:null, staticColor:{r:0,g:255,b:0}    },
      { id:'static_blue',    name:'Static Blue',    code:null, staticColor:{r:0,g:0,b:255}     },
      { id:'static_white',   name:'Static White',   code:null, staticColor:{r:255,g:255,b:255} },
      { id:'static_yellow',  name:'Static Yellow',  code:null, staticColor:{r:255,g:255,b:0}   },
      { id:'static_cyan',    name:'Static Cyan',    code:null, staticColor:{r:0,g:255,b:255}   },
      { id:'static_purple',  name:'Static Purple',  code:null, staticColor:{r:160,g:32,b:240}  },
      { id:'static_orange',  name:'Static Orange',  code:null, staticColor:{r:255,g:100,b:0}   },
      { id:'static_pink',    name:'Static Pink',    code:null, staticColor:{r:255,g:20,b:147}  },
    ]
  },
  {
    label: 'Gradual Change',
    color: 'rgba(100,200,255,0.6)',
    modes: [
      { id:'grad_7',     name:'7-Color Gradual',    code:0x25 },
      { id:'grad_3',     name:'3-Color Gradual (R→G→B)', code:0x2d },
      { id:'grad_red',   name:'Red Gradual',        code:0x26 },
      { id:'grad_green', name:'Green Gradual',      code:0x27 },
      { id:'grad_blue',  name:'Blue Gradual',       code:0x28 },
      { id:'grad_yellow',name:'Yellow Gradual',     code:0x29 },
      { id:'grad_cyan',  name:'Cyan Gradual',       code:0x2a },
      { id:'grad_purple',name:'Purple Gradual',     code:0x2b },
      { id:'grad_white', name:'White Gradual',      code:0x2c },
    ]
  },
  {
    label: 'Crossfade',
    color: 'rgba(150,100,255,0.6)',
    modes: [
      { id:'cross_7',    name:'7-Color Crossfade',  code:0x25 },
      { id:'cross_rg',   name:'Red ↔ Green',        code:0x2d },
      { id:'cross_rb',   name:'Red ↔ Blue',         code:0x2e },
      { id:'cross_gb',   name:'Green ↔ Blue',       code:0x2f },
      { id:'cross_3',    name:'3-Color Crossfade',  code:0x2d },
    ]
  },
  {
    label: 'Jump / Flash',
    color: 'rgba(255,200,0,0.6)',
    modes: [
      { id:'jump_7',     name:'7-Color Jump',       code:0x38 },
      { id:'flash_7',    name:'7-Color Flash',      code:0x30 },
      { id:'flash_red',  name:'Red Flash',          code:0x31 },
      { id:'flash_green',name:'Green Flash',        code:0x32 },
      { id:'flash_blue', name:'Blue Flash',         code:0x33 },
      { id:'flash_yellow',name:'Yellow Flash',      code:0x34 },
      { id:'flash_cyan', name:'Cyan Flash',         code:0x35 },
      { id:'flash_purple',name:'Purple Flash',      code:0x36 },
      { id:'flash_white',name:'White Flash',        code:0x37 },
    ]
  },
  {
    label: 'Strobe',
    color: 'rgba(255,50,100,0.6)',
    modes: [
      { id:'strobe_7',     name:'7-Color Strobe',   code:0x30 },
      { id:'strobe_red',   name:'Red Strobe',       code:0x31 },
      { id:'strobe_green', name:'Green Strobe',     code:0x32 },
      { id:'strobe_blue',  name:'Blue Strobe',      code:0x33 },
      { id:'strobe_yellow',name:'Yellow Strobe',    code:0x34 },
      { id:'strobe_cyan',  name:'Cyan Strobe',      code:0x35 },
      { id:'strobe_purple',name:'Purple Strobe',    code:0x36 },
      { id:'strobe_white', name:'White Strobe',     code:0x37 },
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

  // Light
  const [color, setColor]               = useState({ r:0, g:200, b:255 });
  const [brightness, setBrightness]     = useState(100);
  const [activeTab, setActiveTab]       = useState('static');
  const [activeDynamic, setActiveDynamic] = useState(null);

  // Pin sequence
  const [pinSeq, setPinSeq]             = useState('RGB');
  const [pinDrawerOpen, setPinDrawerOpen] = useState(false);

  // Mic
  const [isMicActive, setIsMicActive]   = useState(false);

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
  const deviceRef      = useRef(null);       // for auto-reconnect closure
  const cmdQueueRef    = useRef(Promise.resolve()); // serialises all BLE writes
  const reconnTimerRef = useRef(null);

  useEffect(() => { charRef.current = characteristic; },   [characteristic]);
  useEffect(() => { brightnessRef.current = brightness; }, [brightness]);
  useEffect(() => { colorRef.current = color; },           [color]);
  useEffect(() => { pinSeqRef.current = pinSeq; },         [pinSeq]);

  // ── BLE ──────────────────────────────────────────────────────────────────

  /** Core connect logic — shared by manual connect and auto-reconnect. */
  const connectDevice = useCallback(async (bleDevice) => {
    const server = await connectGATT(bleDevice);
    const char   = await resolveCharacteristic(server);
    charRef.current   = char;
    deviceRef.current = bleDevice;
    setDevice(bleDevice);
    setCharacteristic(char);
    setIsConnected(true);
    setConnStatus('connected');
    setBleError('');
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
        setBleError('Device connected but no LED service found. Check pin sequence.');
      } else if (err.message?.includes('timeout')) {
        setBleError('Connection timed out. Move closer and try again.');
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

  // ── Command — queued + writeValueWithoutResponse for speed ───────────────

  const sendCommand = useCallback((r, g, b, mode = 0x00) => {
    // Enqueue: each write waits for the previous one to finish so GATT
    // never throws "operation already in progress"
    cmdQueueRef.current = cmdQueueRef.current.then(async () => {
      const char = charRef.current;
      if (!char) return;
      const f = brightnessRef.current / 100;
      const remap = PIN_SEQUENCES[pinSeqRef.current] || PIN_SEQUENCES.RGB;
      const [p1, p2, p3] = remap(Math.round(r*f), Math.round(g*f), Math.round(b*f));
      const data = new Uint8Array([0x56, p1, p2, p3, mode, 0xf0, 0xaa]);
      try {
        // writeValueWithoutResponse skips ACK round-trip → ~3× faster on most controllers
        if (char.properties?.writeWithoutResponse) {
          await char.writeValueWithoutResponse(data);
        } else {
          await char.writeValue(data);
        }
      } catch { /* swallow GATT busy / disconnected errors */ }
    });
  }, []);

  // ── Color sync ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected || isMicActive || activeTab === 'fx') return;
    const t = setTimeout(() => sendCommand(color.r, color.g, color.b), 50);
    return () => clearTimeout(t);
  }, [color, brightness, isConnected, isMicActive, activeTab, sendCommand]);

  // ── FX mode select ───────────────────────────────────────────────────────

  const handleModeSelect = (m) => {
    setActiveDynamic(m.id);
    if (m.staticColor) {
      setColor(m.staticColor);
      sendCommand(m.staticColor.r, m.staticColor.g, m.staticColor.b, 0x00);
    } else {
      sendCommand(0, 0, 0, m.code);
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

          {bleError && (
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

          {/* Mic toggle */}
          <button onClick={toggleMic} disabled={!isConnected} title={isMicActive ? 'Stop mic sync' : 'Start mic sync'}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
            style={isMicActive
              ? { background:'rgba(236,72,153,0.2)', border:'1px solid rgba(236,72,153,0.5)', boxShadow:'0 0 15px rgba(236,72,153,0.3)' }
              : { background:'rgba(0,15,35,0.8)', border:'1px solid rgba(0,255,255,0.1)' }}>
            {isMicActive ? <Mic className="w-4 h-4 text-pink-400"/> : <MicOff className="w-4 h-4 text-slate-500"/>}
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

        {/* Brightness */}
        <NeonCard className="p-5 space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Sun className="w-3.5 h-3.5 text-yellow-400"/>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Brightness</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg text-cyan-300"
              style={{ background:'rgba(0,255,255,0.06)', border:'1px solid rgba(0,255,255,0.1)' }}>
              {brightness}%
            </span>
          </div>
          <input type="range" min="1" max="100" value={brightness}
            onChange={e => setBrightness(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
            style={{ accentColor:'#22d3ee', background:'rgba(0,255,255,0.08)' }}/>
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
            {/* Active mode indicator */}
            {activeDynamic && (
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
