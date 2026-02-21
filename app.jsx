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
  Info, 
  Settings 
} from 'lucide-react';

/**
 * LUMINA WEB - ADVANCED BLE CONTROLLER
 * Target UUIDs for generic Bluetooth RGB controllers:
 * Service: 0000ffd5-0000-1000-8000-00805f9b34fb
 * Characteristic: 0000ffd9-0000-1000-8000-00805f9b34fb
 */

const SERVICE_UUID = '0000ffd5-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffd9-0000-1000-8000-00805f9b34fb';

export default function App() {
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
      // Catch GATT "in progress" errors
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
    for (let i = 0; i < 8; i++) sum += dataArray[i];
    const avg = sum / 8;
    if (avg > 40) {
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
    <div className="min-h-screen bg-[#050505] text-slate-100 flex flex-col font-sans overflow-x-hidden selection:bg-cyan-500/30">
      {/* Header */}
      <header className="p-5 flex justify-between items-center bg-black/40 backdrop-blur-xl border-b border-white/5 sticky top-0 z-50">
        <div className="flex flex-col">
          <h1 className="text-xl font-black tracking-tighter bg-gradient-to-tr from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent italic">
            LUMINA WEB
          </h1>
          <div className="flex items-center gap-1 opacity-50">
            <MapPin className="w-2.5 h-2.5 text-cyan-400" />
            <span className="text-[9px] font-bold uppercase tracking-widest">BLE Interface</span>
          </div>
        </div>
        
        <button 
          onClick={isConnected ? disconnect : connect}
          disabled={isConnecting}
          className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-300 flex items-center gap-2 ${
            isConnected 
            ? 'bg-green-500/10 text-green-400 border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]' 
            : 'bg-white text-black hover:bg-slate-200 shadow-lg shadow-white/10 active:scale-95'
          }`}
        >
          {isConnecting ? (
            <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
          ) : isConnected ? (
            <Bluetooth className="w-3.5 h-3.5" />
          ) : (
            <BluetoothOff className="w-3.5 h-3.5" />
          )}
          {isConnecting ? 'Linking...' : isConnected ? 'Connected' : 'Connect'}
        </button>
      </header>

      {/* Main UI */}
      <main className="flex-1 max-w-lg mx-auto w-full p-6 space-y-10">
        
        {/* Master Brightness */}
        <section className="bg-white/5 p-6 rounded-[2rem] border border-white/5 space-y-5 shadow-inner">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Brightness</span>
            </div>
            <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded text-white">{brightness}%</span>
          </div>
          <input 
            type="range" min="1" max="100" 
            value={brightness}
            onChange={(e) => setBrightness(parseInt(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
        </section>

        {/* Navigation Tabs */}
        <nav className="flex bg-white/5 p-1.5 rounded-2xl border border-white/5 shadow-2xl">
          {[
            { id: 'static', icon: <div className="w-3 h-3 rounded-full bg-gradient-to-tr from-blue-400 to-purple-500 shadow-[0_0_8px_rgba(96,165,250,0.5)]" />, label: 'Wheel' },
            { id: 'dynamic', icon: <Zap className="w-3.5 h-3.5 text-yellow-400" />, label: 'FX' },
            { id: 'music', icon: <Music className="w-3.5 h-3.5 text-pink-400" />, label: 'Music' },
            { id: 'timer', icon: <Clock className="w-3.5 h-3.5 text-cyan-400" />, label: 'Timer' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all ${
                activeTab === tab.id ? 'bg-white/10 text-white shadow-xl' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-bold uppercase tracking-tighter">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'static' && (
            <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 space-y-8">
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
                    className={`aspect-square rounded-2xl transition-transform active:scale-90 border-4 ${
                      color.r === c.r && color.g === c.g && color.b === c.b ? 'border-white scale-110 shadow-lg shadow-white/20' : 'border-transparent shadow-md shadow-black/40'
                    }`}
                  />
                ))}
              </div>
              <div className="p-6 bg-white/5 rounded-3xl border border-white/5 flex items-center justify-between group hover:border-white/20 transition-all">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Custom Selection</span>
                <input 
                  type="color"
                  className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-none outline-none scale-125 transition-transform hover:scale-150"
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
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-5 duration-500">
              {[
                { id: 'rainbow', name: 'Rainbow Cycle' },
                { id: 'flash', name: '7-Color Flash' },
                { id: 'strobe', name: 'Strobe White' },
                { id: 'pulse_red', name: 'Breathing Red' }
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setDynamicMode(m.id)}
                  className="w-full p-5 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-between border border-white/5 transition-all group"
                >
                  <span className="font-bold text-slate-200 tracking-tight">{m.name}</span>
                  <div className="p-2 bg-white/10 rounded-full group-hover:bg-cyan-400 group-hover:text-black transition-all">
                    <Play className="w-3.5 h-3.5" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'music' && (
            <div className="flex flex-col items-center justify-center h-full py-10 space-y-10 animate-in zoom-in-95 duration-500">
              <div className="relative group">
                <div className={`absolute inset-[-20px] rounded-full blur-3xl transition-all duration-700 ${isMusicActive ? 'bg-pink-500/30 scale-150 opacity-100' : 'bg-transparent opacity-0'}`} />
                <div className={`w-32 h-32 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${isMusicActive ? 'border-pink-500 bg-pink-500 shadow-xl' : 'border-white/10 bg-white/5'}`}>
                  <Music className={`w-12 h-12 ${isMusicActive ? 'text-white' : 'text-slate-700'}`} />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-black tracking-tight uppercase">Music Sync</h3>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-relaxed max-w-[200px] mx-auto">Microphone input controls light intensity</p>
              </div>
              <button
                onClick={startMusicSync}
                className={`w-full py-5 rounded-[2rem] font-black text-sm tracking-widest uppercase transition-all active:scale-95 ${
                  isMusicActive ? 'bg-white text-black' : 'bg-pink-600 text-white shadow-xl shadow-pink-900/20'
                }`}
              >
                {isMusicActive ? 'Stop Sync' : 'Activate Mic'}
              </button>
            </div>
          )}

          {activeTab === 'timer' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-500">
              <div className="bg-white/5 p-8 rounded-[2.5rem] border border-white/5 space-y-6 shadow-inner">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Duration</span>
                  <input 
                    type="number" value={timerInput.minutes}
                    onChange={(e) => setTimerInput({...timerInput, minutes: parseInt(e.target.value) || 0})}
                    className="w-full bg-black rounded-3xl p-5 text-center text-3xl font-black border border-white/5 outline-none focus:border-cyan-500/50 transition-all shadow-inner"
                  />
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Minutes</span>
                </div>
                
                <div className="flex gap-2">
                  <button onClick={() => setTimerInput({...timerInput, action: 'on'})} className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${timerInput.action === 'on' ? 'bg-green-500 text-black shadow-lg shadow-green-900/20' : 'bg-white/5 text-slate-600 border border-white/5'}`}>Auto On</button>
                  <button onClick={() => setTimerInput({...timerInput, action: 'off'})} className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${timerInput.action === 'off' ? 'bg-red-500 text-black shadow-lg shadow-red-900/20' : 'bg-white/5 text-slate-600 border border-white/5'}`}>Auto Off</button>
                </div>
                
                <button onClick={addTimer} className="w-full py-5 bg-white text-black rounded-[2rem] font-black uppercase text-xs tracking-widest shadow-2xl active:scale-95 transition-all">Start Timer</button>
              </div>
              
              <div className="space-y-4 px-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3 text-slate-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Active Tasks</span>
                </div>
                {timers.length === 0 && (
                  <div className="py-10 text-center bg-white/[0.02] border border-dashed border-white/5 rounded-3xl">
                    <p className="text-[10px] text-slate-700 uppercase font-black italic tracking-widest">No pending operations</p>
                  </div>
                )}
                {timers.map(t => (
                  <div key={t.id} className="bg-white/5 p-5 rounded-3xl flex items-center justify-between border border-white/5 group hover:border-white/20 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${t.action === 'on' ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`} />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest">Turn {t.action}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5 font-bold tracking-tighter uppercase">Approx. {Math.ceil((t.targetTime - Date.now()) / 60000)}m remaining</p>
                      </div>
                    </div>
                    <button onClick={() => setTimers(timers.filter(tm => tm.id !== t.id))} className="p-2 text-slate-500 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="bg-cyan-500/5 rounded-[2rem] p-6 border border-cyan-500/10 flex gap-4">
          <Info className="w-4 h-4 text-cyan-400 mt-1 shrink-0" />
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            Bluetooth scanning requires "Location Permissions" on Android devices. Lumina does not collect GPS data.
          </p>
        </footer>
      </main>

      {/* Connection Overlay */}
      {!isConnected && (
        <div className="fixed inset-0 bg-[#050505]/95 backdrop-blur-2xl z-[60] flex items-center justify-center p-8 text-center animate-in fade-in duration-700">
          <div className="max-w-xs space-y-10">
            <div className="relative group">
              <div className="absolute inset-0 bg-white/10 blur-[60px] rounded-full scale-125 group-hover:bg-cyan-500/20 transition-all duration-700" />
              <div className="relative z-10 p-10 bg-black rounded-[3.5rem] border border-white/10 shadow-3xl">
                <Bluetooth className={`w-16 h-16 ${isConnecting ? 'text-cyan-400 animate-pulse' : 'text-white'}`} />
              </div>
            </div>
            
            <div className="space-y-3">
              <h2 className="text-2xl font-black tracking-tight leading-tight uppercase">Hardware<br/>Disconnected</h2>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] leading-relaxed">
                Turn on Bluetooth and power up your strip to begin
              </p>
            </div>
            
            <button 
              onClick={connect} 
              disabled={isConnecting} 
              className="w-full py-5 bg-white text-black rounded-[2rem] font-black uppercase text-[10px] tracking-[0.2em] shadow-2xl active:scale-95 transition-all disabled:opacity-50"
            >
              {isConnecting ? 'Searching...' : 'Scan For Strip'}
            </button>
            
            <div className="flex items-center justify-center gap-6 opacity-20 pt-4">
              <span className="text-[8px] font-black border border-white px-2 py-1 rounded tracking-tighter uppercase">ELK-BLED</span>
              <span className="text-[8px] font-black border border-white px-2 py-1 rounded tracking-tighter uppercase">Triones</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Visual Spacing */}
      <div className="h-24" />
    </div>
  );
}
