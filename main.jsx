import React, { useState, useEffect, useRef } from 'react';
import { 
  Bluetooth, 
  BluetoothOff, 
  Zap, 
  Music, 
  Sun, 
  Clock, 
  MapPin, 
  Play, 
  Trash2, 
  RefreshCcw, 
  Info
} from 'lucide-react';

/**
 * LUMINA WEB - ADVANCED BLE CONTROLLER
 * Target UUIDs for generic Bluetooth RGB controllers:
 * Service: 0000ffd5-0000-1000-8000-00805f9b34fb
 * Characteristic: 0000ffd9-0000-1000-8000-00805f9b34fb
 */

const SERVICE_UUID = '0000ffd5-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffd9-0000-1000-8000-00805f9b34fb';

// Inline SVG for the Activity icon since it's sometimes missing from standard lucide sets
const Activity = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

const App = () => {
  // --- Connection State ---
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // --- Light Control State ---
  const [color, setColor] = useState({ r: 255, g: 0, b: 0 });
  const [brightness, setBrightness] = useState(100);
  const [activeTab, setActiveTab] = useState('static'); // static, dynamic, music, timer
  const [isMusicActive, setIsMusicActive] = useState(false);
  
  // --- Timer State ---
  const [timers, setTimers] = useState([]);
  const [timerInput, setTimerInput] = useState({ minutes: 5, action: 'off' });

  // --- Refs for Audio processing ---
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  // --- BLUETOOTH CORE LOGIC ---

  const connect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const bleDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ELK' },
          { namePrefix: 'LED' },
          { namePrefix: 'Triones' },
          { services: [SERVICE_UUID] }
        ],
        optionalServices: [SERVICE_UUID]
      });

      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const char = await service.getCharacteristic(CHARACTERISTIC_UUID);

      setDevice(bleDevice);
      setCharacteristic(char);
      setIsConnected(true);

      bleDevice.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        setCharacteristic(null);
        setDevice(null);
        stopMusicSync();
      });
    } catch (error) {
      console.error("BLE Connection Error:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    if (device && device.gatt.connected) {
      device.gatt.disconnect();
    }
  };

  const sendCommand = async (r, g, b, mode = 0x00) => {
    if (!characteristic) return;
    
    const factor = brightness / 100;
    const finalR = Math.round(r * factor);
    const finalG = Math.round(g * factor);
    const finalB = Math.round(b * factor);

    const data = new Uint8Array([0x56, finalR, finalG, finalB, mode, 0xf0, 0xaa]);
    
    try {
      await characteristic.writeValue(data);
    } catch (e) {
      // Catch GATT rate-limit errors
    }
  };

  // --- DYNAMIC MODES ---

  const setDynamicMode = (modeId) => {
    const modes = {
      'rainbow': 0x25,
      'pulse_red': 0x26,
      'pulse_green': 0x27,
      'pulse_blue': 0x28,
      'flash': 0x30,
      'strobe': 0x33
    };
    sendCommand(0, 0, 0, modes[modeId] || 0x25);
  };

  // --- MUSIC SYNC LOGIC ---

  const startMusicSync = async () => {
    if (isMusicActive) {
      stopMusicSync();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      setIsMusicActive(true);
      processAudio();
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopMusicSync = () => {
    setIsMusicActive(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
  };

  const processAudio = () => {
    if (!isMusicActive || !analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += dataArray[i];
    const avg = sum / 10;
    
    if (avg > 45) {
      sendCommand(color.r, color.g, color.b, Math.min(avg, 255));
    }
    animationFrameRef.current = requestAnimationFrame(processAudio);
  };

  // --- TIMER MANAGEMENT ---

  const addTimer = () => {
    const targetTime = Date.now() + (timerInput.minutes * 60000);
    const newTimer = {
      id: Math.random().toString(36).substr(2, 9),
      targetTime,
      action: timerInput.action,
      totalMinutes: timerInput.minutes
    };
    setTimers([...timers, newTimer]);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTimers(prev => {
        const remaining = prev.filter(t => {
          if (now >= t.targetTime) {
            if (t.action === 'off') sendCommand(0, 0, 0); 
            else sendCommand(color.r, color.g, color.b);
            return false;
          }
          return true;
        });
        return remaining;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [color]);

  useEffect(() => {
    if (isConnected && !isMusicActive && activeTab !== 'timer') {
      const handler = setTimeout(() => {
        sendCommand(color.r, color.g, color.b);
      }, 50);
      return () => clearTimeout(handler);
    }
  }, [color, brightness, isConnected, isMusicActive, activeTab]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      <header className="p-5 flex justify-between items-center bg-slate-900/40 backdrop-blur-2xl border-b border-white/5 sticky top-0 z-50">
        <div className="flex flex-col">
          <h1 className="text-xl font-black tracking-tighter bg-gradient-to-tr from-cyan-400 via-indigo-500 to-purple-500 bg-clip-text text-transparent italic uppercase">
            Lumina
          </h1>
          <div className="flex items-center gap-1 opacity-50">
            <Activity className="w-2.5 h-2.5 text-cyan-400" />
            <span className="text-[9px] font-bold uppercase tracking-widest">Web BLE Protocol</span>
          </div>
        </div>
        
        <button 
          onClick={isConnected ? disconnect : connect}
          disabled={isConnecting}
          className={`px-5 py-2 rounded-full text-xs font-bold transition-all duration-300 flex items-center gap-2 ${
            isConnected 
            ? 'bg-green-500/10 text-green-400 border border-green-500/30' 
            : 'bg-white text-slate-950 hover:bg-slate-200 active:scale-95 shadow-lg shadow-white/5'
          }`}
        >
          {isConnecting ? (
            <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
          ) : isConnected ? (
            <Bluetooth className="w-3.5 h-3.5" />
          ) : (
            <BluetoothOff className="w-3.5 h-3.5" />
          )}
          {isConnecting ? 'Linking...' : isConnected ? 'Online' : 'Scan'}
        </button>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full p-6 space-y-10">
        <section className="bg-slate-900/50 p-6 rounded-[2.5rem] border border-white/5 space-y-5 shadow-2xl">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-yellow-400" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Intensity</span>
            </div>
            <span className="text-xs font-mono bg-white/5 px-2 py-1 rounded text-white">{brightness}%</span>
          </div>
          <input 
            type="range" min="1" max="100" 
            value={brightness}
            onChange={(e) => setBrightness(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-white"
          />
        </section>

        <nav className="flex bg-slate-900/80 p-1.5 rounded-3xl border border-white/5 shadow-2xl backdrop-blur-md">
          {[
            { id: 'static', icon: <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-cyan-400 to-indigo-500" />, label: 'Static' },
            { id: 'dynamic', icon: <Zap className="w-3.5 h-3.5 text-yellow-400" />, label: 'FX' },
            { id: 'music', icon: <Music className="w-3.5 h-3.5 text-pink-400" />, label: 'Vibe' },
            { id: 'timer', icon: <Clock className="w-3.5 h-3.5 text-indigo-400" />, label: 'Timer' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-all ${
                activeTab === tab.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.icon}
              <span className="text-[9px] font-black uppercase tracking-tighter">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="min-h-[420px]">
          {activeTab === 'static' && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8">
              <div className="grid grid-cols-4 gap-4">
                {[
                  { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 255 },
                  { r: 255, g: 100, b: 0 }, { r: 255, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }, { r: 160, g: 32, b: 240 },
                  { r: 255, g: 20, b: 147 }, { r: 0, g: 255, b: 127 }, { r: 75, g: 0, b: 130 }, { r: 255, g: 69, b: 0 }
                ].map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setColor({ r: c.r, g: c.g, b: c.b })}
                    style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                    className={`aspect-square rounded-[1.5rem] transition-all active:scale-90 border-4 ${
                      color.r === c.r && color.g === c.g && color.b === c.b ? 'border-white scale-110 shadow-lg shadow-white/20' : 'border-transparent shadow-md'
                    }`}
                  />
                ))}
              </div>
              <div className="p-6 bg-slate-900/50 rounded-[2.5rem] border border-white/5 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Hex Selector</span>
                  <span className="text-[11px] font-mono text-indigo-400 mt-1 uppercase font-bold">
                    #{color.r.toString(16).padStart(2,'0')}{color.g.toString(16).padStart(2,'0')}{color.b.toString(16).padStart(2,'0')}
                  </span>
                </div>
                <input 
                  type="color"
                  className="w-16 h-16 rounded-full cursor-pointer bg-transparent border-none outline-none"
                  onChange={(e) => {
                    const h = e.target.value;
                    setColor({ 
                      r: parseInt(h.slice(1,3), 16), 
                      g: parseInt(h.slice(3,5), 16), 
                      b: parseInt(h.slice(5,7), 16) 
                    });
                  }}
                  value={`#${color.r.toString(16).padStart(2,'0')}${color.g.toString(16).padStart(2,'0')}${color.b.toString(16).padStart(2,'0')}`}
                />
              </div>
            </div>
          )}

          {activeTab === 'dynamic' && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-8 duration-500">
              {[
                { id: 'rainbow', name: 'Infinite Spectrum' },
                { id: 'flash', name: 'Hyper Flash' },
                { id: 'strobe', name: 'Pulse Strobe' },
                { id: 'pulse_red', name: 'Vital Breath' }
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setDynamicMode(m.id)}
                  className="w-full p-6 bg-slate-900/50 hover:bg-slate-800/80 rounded-[2rem] flex items-center justify-between border border-white/5 transition-all group active:scale-95"
                >
                  <span className="font-black text-slate-200 tracking-tight uppercase text-xs">{m.name}</span>
                  <div className="p-2.5 bg-white/5 rounded-full group-hover:bg-cyan-500 group-hover:text-black transition-all">
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'music' && (
            <div className="flex flex-col items-center justify-center h-full py-10 space-y-12 animate-in zoom-in-95 duration-500">
              <div className="relative">
                <div className={`absolute inset-[-30px] rounded-full blur-[50px] transition-all duration-700 ${isMusicActive ? 'bg-indigo-500/40 opacity-100' : 'bg-transparent opacity-0'}`} />
                <div className={`w-40 h-40 rounded-full flex items-center justify-center border-4 transition-all duration-500 ${isMusicActive ? 'border-indigo-400 bg-indigo-500/20 shadow-xl' : 'border-white/10 bg-white/5'}`}>
                  <Music className={`w-16 h-16 ${isMusicActive ? 'text-white' : 'text-slate-800'}`} />
                </div>
              </div>
              <button
                onClick={startMusicSync}
                className={`w-full py-5 rounded-[2.5rem] font-black text-xs tracking-[0.3em] uppercase transition-all ${
                  isMusicActive ? 'bg-white text-slate-950 shadow-2xl' : 'bg-indigo-600 text-white shadow-xl'
                }`}
              >
                {isMusicActive ? 'Mute Sync' : 'Sync Microphone'}
              </button>
            </div>
          )}

          {activeTab === 'timer' && (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-500">
              <div className="bg-slate-900/50 p-8 rounded-[3rem] border border-white/5 space-y-8">
                <input 
                  type="number" value={timerInput.minutes}
                  onChange={(e) => setTimerInput({...timerInput, minutes: parseInt(e.target.value) || 0})}
                  className="w-full bg-black/40 rounded-[2rem] p-6 text-center text-5xl font-black border border-white/5 outline-none"
                />
                <div className="flex gap-3">
                  <button onClick={() => setTimerInput({...timerInput, action: 'on'})} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest ${timerInput.action === 'on' ? 'bg-green-500 text-slate-950 shadow-lg' : 'bg-white/5 text-slate-600'}`}>Power</button>
                  <button onClick={() => setTimerInput({...timerInput, action: 'off'})} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest ${timerInput.action === 'off' ? 'bg-red-500 text-slate-950 shadow-lg' : 'bg-white/5 text-slate-600'}`}>Sleep</button>
                </div>
                <button onClick={addTimer} className="w-full py-5 bg-white text-slate-950 rounded-[2.5rem] font-black uppercase text-xs tracking-[0.3em] shadow-2xl">Enable Task</button>
              </div>
              <div className="space-y-4">
                {timers.map(t => (
                  <div key={t.id} className="bg-slate-900/50 p-6 rounded-[2rem] flex items-center justify-between border border-white/5 transition-all">
                    <div className="flex items-center gap-5">
                      <div className={`w-3 h-3 rounded-full ${t.action === 'on' ? 'bg-green-400' : 'bg-red-500'}`} />
                      <p className="text-[11px] font-black uppercase tracking-widest">Execute {t.action} in {Math.ceil((t.targetTime - Date.now()) / 60000)}m</p>
                    </div>
                    <button onClick={() => setTimers(timers.filter(tm => tm.id !== t.id))} className="text-slate-600 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="bg-indigo-500/5 rounded-[2.5rem] p-6 border border-indigo-500/10 flex gap-4">
          <Info className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            Web Bluetooth requires Location Permissions on Android. Lumina communicates locally; no position data is collected.
          </p>
        </footer>
      </main>

      {!isConnected && (
        <div className="fixed inset-0 bg-[#020617]/98 backdrop-blur-3xl z-[60] flex items-center justify-center p-8 text-center animate-in fade-in duration-700">
          <div className="max-w-xs space-y-12">
            <div className="relative z-10 p-12 bg-slate-900 rounded-[4rem] border border-white/10 shadow-3xl mx-auto inline-block">
              <Bluetooth className={`w-20 h-20 ${isConnecting ? 'text-cyan-400 animate-pulse' : 'text-white'}`} />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-black tracking-tighter uppercase leading-none">Offline</h2>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em]">Connect via Bluetooth to begin</p>
            </div>
            <button 
              onClick={connect} 
              disabled={isConnecting} 
              className="w-full py-6 bg-white text-slate-950 rounded-[2.5rem] font-black uppercase text-[11px] tracking-[0.3em] shadow-2xl"
            >
              {isConnecting ? 'Searching...' : 'Scan For Strip'}
            </button>
          </div>
        </div>
      )}
      <div className="h-28" />
    </div>
  );
};

export default App;
