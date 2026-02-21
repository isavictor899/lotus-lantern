import React, { useState, useEffect, useRef } from 'react';
import { Bluetooth, BluetoothOff, Zap, Music, Sun, Clock, MapPin, Play, Trash2, RefreshCcw, Info } from 'lucide-react';

// Common Bluetooth UUIDs for Lotus Lantern style controllers
const SERVICE_UUID = '0000ffd5-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffd9-0000-1000-8000-00805f9b34fb';

const App = () => {
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [color, setColor] = useState({ r: 255, g: 0, b: 0 });
  const [brightness, setBrightness] = useState(100);
  const [activeTab, setActiveTab] = useState('static'); // static, dynamic, music, timer
  const [isMusicActive, setIsMusicActive] = useState(false);
  
  // Timer State
  const [timers, setTimers] = useState([]);
  const [timerInput, setTimerInput] = useState({ minutes: 5, action: 'off' });

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  // --- Bluetooth Logic ---

  const connect = async () => {
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
      });
    } catch (error) {
      console.error("Connection failed:", error);
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
      // Silent catch for frequency limit
    }
  };

  // --- Timer Logic ---

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

  const removeTimer = (id) => {
    setTimers(timers.filter(t => t.id !== id));
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      timers.forEach(timer => {
        if (now >= timer.targetTime) {
          if (timer.action === 'off') {
            sendCommand(0, 0, 0); // Power off (All zero)
          } else {
            sendCommand(color.r, color.g, color.b); // Power on
          }
          removeTimer(timer.id);
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timers, color]);

  // --- Dynamic Effects ---

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

  // --- Music Sync ---

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
      console.error("Audio access denied", err);
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
    if (avg > 50) {
       sendCommand(color.r, color.g, color.b, Math.min(avg, 255));
    }
    animationFrameRef.current = requestAnimationFrame(processAudio);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isConnected && !isMusicActive && activeTab !== 'timer') {
        sendCommand(color.r, color.g, color.b);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [color, brightness, isConnected, isMusicActive]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-500/30">
      {/* Header */}
      <header className="p-6 flex justify-between items-center border-b border-white/10 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div>
          <h1 className="text-2xl font-black tracking-tighter bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            LUMINA WEB
          </h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <MapPin className="w-3 h-3 text-slate-500" />
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">BLE + Location Ready</p>
          </div>
        </div>
        
        <button 
          onClick={isConnected ? () => device.gatt.disconnect() : connect}
          className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 font-medium text-sm ${
            isConnected 
            ? 'bg-green-500/20 text-green-400 border border-green-500/50' 
            : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20'
          }`}
        >
          {isConnected ? <Bluetooth className="w-4 h-4" /> : <BluetoothOff className="w-4 h-4" />}
          {isConnected ? 'Connected' : 'Connect'}
        </button>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full p-6 space-y-8 pb-32">
        
        {/* Brightness Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Brightness</h2>
            </div>
            <span className="text-xs font-mono">{brightness}%</span>
          </div>
          <input 
            type="range" 
            min="1" max="100" 
            value={brightness}
            onChange={(e) => setBrightness(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
        </section>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-4 bg-slate-900 rounded-2xl p-1 shadow-inner border border-white/5">
          {['static', 'dynamic', 'music', 'timer'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2.5 rounded-xl text-xs font-medium transition-all flex flex-col items-center gap-1 ${
                activeTab === tab ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'static' && <div className="w-1 h-1 rounded-full bg-current" />}
              {tab === 'dynamic' && <Zap className="w-3 h-3" />}
              {tab === 'music' && <Music className="w-3 h-3" />}
              {tab === 'timer' && <Clock className="w-3 h-3" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="min-h-[350px]">
          {activeTab === 'static' && (
            <div className="grid grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {[
                { r: 255, g: 0, b: 0, name: 'Red' }, { r: 0, g: 255, b: 0, name: 'Green' },
                { r: 0, g: 0, b: 255, name: 'Blue' }, { r: 255, g: 255, b: 255, name: 'White' },
                { r: 255, g: 165, b: 0, name: 'Orange' }, { r: 255, g: 255, b: 0, name: 'Yellow' },
                { r: 0, g: 255, b: 255, name: 'Cyan' }, { r: 128, g: 0, b: 128, name: 'Purple' },
              ].map((c) => (
                <button
                  key={c.name}
                  onClick={() => setColor({ r: c.r, g: c.g, b: c.b })}
                  style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                  className={`aspect-square rounded-2xl shadow-xl transition-all active:scale-90 border-4 ${
                    color.r === c.r && color.g === c.g && color.b === c.b ? 'border-white scale-110' : 'border-transparent'
                  }`}
                />
              ))}
              <div className="col-span-4 mt-6 p-4 bg-slate-900/50 rounded-2xl border border-white/5">
                 <label className="text-[10px] text-slate-500 mb-3 block uppercase tracking-widest font-bold">Custom Color</label>
                 <div className="flex gap-4">
                    <input 
                      type="color" 
                      className="w-14 h-14 rounded-xl bg-transparent border-none cursor-pointer"
                      onChange={(e) => {
                        const hex = e.target.value;
                        setColor({ 
                          r: parseInt(hex.slice(1,3), 16), 
                          g: parseInt(hex.slice(3,5), 16), 
                          b: parseInt(hex.slice(5,7), 16) 
                        });
                      }}
                    />
                    <div className="flex-1 flex flex-col justify-center">
                      <span className="text-sm font-mono text-white">HEX {`#${color.r.toString(16)}${color.g.toString(16)}${color.b.toString(16)}`.toUpperCase()}</span>
                      <span className="text-xs text-slate-500">Tap to select from wheel</span>
                    </div>
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'dynamic' && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {['rainbow', 'flash', 'strobe', 'pulse_red'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDynamicMode(mode)}
                  className="w-full p-4 bg-slate-900 hover:bg-slate-800 rounded-2xl flex items-center justify-between border border-white/5 transition-all group"
                >
                  <span className="font-medium text-slate-300 capitalize">{mode.replace('_', ' ')}</span>
                  <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg group-hover:scale-110 transition-transform">
                    <Play className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'music' && (
            <div className="flex flex-col items-center justify-center h-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className={`p-10 rounded-full transition-all duration-700 ${isMusicActive ? 'bg-pink-500 shadow-[0_0_60px_rgba(236,72,153,0.4)] scale-110' : 'bg-slate-900 border border-white/10'}`}>
                <Music className={`w-14 h-14 ${isMusicActive ? 'text-white' : 'text-slate-600'}`} />
              </div>
              <div className="text-center px-8">
                <h3 className="text-lg font-bold">Sound Reactive</h3>
                <p className="text-sm text-slate-500 mt-2">BPM-based frequency analysis. Ensure your browser mic is enabled.</p>
              </div>
              <button
                onClick={startMusicSync}
                className={`w-full py-4 rounded-2xl font-bold transition-all ${
                  isMusicActive ? 'bg-white text-slate-900' : 'bg-pink-600 text-white'
                }`}
              >
                {isMusicActive ? 'Disable Sync' : 'Enable Music Mode'}
              </button>
            </div>
          )}

          {activeTab === 'timer' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-900 p-6 rounded-3xl border border-white/5 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-purple-400">Schedule Task</h3>
                
                <div className="flex gap-4 items-center">
                  <input 
                    type="number" 
                    value={timerInput.minutes}
                    onChange={(e) => setTimerInput({...timerInput, minutes: parseInt(e.target.value) || 0})}
                    className="flex-1 bg-slate-950 border border-white/10 rounded-xl p-3 text-center text-xl font-bold"
                  />
                  <span className="text-slate-500 font-medium">Minutes</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setTimerInput({...timerInput, action: 'on'})}
                    className={`p-3 rounded-xl text-sm font-bold border transition-all ${timerInput.action === 'on' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-slate-950 border-white/10 text-slate-500'}`}
                  >
                    Auto ON
                  </button>
                  <button 
                    onClick={() => setTimerInput({...timerInput, action: 'off'})}
                    className={`p-3 rounded-xl text-sm font-bold border transition-all ${timerInput.action === 'off' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-slate-950 border-white/10 text-slate-500'}`}
                  >
                    Auto OFF
                  </button>
                </div>

                <button 
                  onClick={addTimer}
                  className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-purple-900/20"
                >
                  Start Timer
                </button>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Active Timers</h4>
                {timers.length === 0 && (
                  <div className="py-8 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
                    <p className="text-xs text-slate-600 italic">No timers running</p>
                  </div>
                )}
                {timers.map(t => (
                  <div key={t.id} className="bg-slate-900/50 p-4 rounded-2xl flex items-center justify-between border border-white/5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${t.action === 'on' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
                        <span className="text-sm font-bold">Turn {t.action.toUpperCase()}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        In approx. {Math.ceil((t.targetTime - Date.now()) / 60000)}m
                      </p>
                    </div>
                    <button onClick={() => removeTimer(t.id)} className="p-2 text-slate-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Location Info Box */}
        <section className="bg-blue-500/5 rounded-2xl p-4 border border-blue-500/10 flex gap-3">
          <Info className="w-5 h-5 text-blue-400 shrink-0" />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-blue-300">Why Location Matters</h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Like Lotus Lantern, this web app requires your device's Bluetooth to scan for lights. On Android and some browsers, Bluetooth scanning is technically grouped under "Location Services." We don't track your actual GPS coordinates.
            </p>
          </div>
        </section>
      </main>

      {/* Connection Guard */}
      {!isConnected && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[60] flex items-center justify-center p-8 text-center">
          <div className="max-w-xs space-y-6 animate-in zoom-in-95 duration-500">
            <div className="relative inline-block p-6 bg-slate-900 rounded-[2.5rem] border border-white/10 shadow-2xl">
              <div className="absolute inset-0 bg-purple-500/20 blur-2xl rounded-full" />
              <Bluetooth className="w-14 h-14 text-purple-400 mx-auto animate-pulse relative z-10" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">Lights Disconnected</h2>
              <p className="text-slate-400 text-sm mt-3 leading-relaxed">
                Turn on your Bluetooth and ensure your LED strip is powered on to begin.
              </p>
            </div>
            <button 
              onClick={connect}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-2xl font-black text-white shadow-xl shadow-purple-900/30 transition-all active:scale-95"
            >
              Scan & Link Now
            </button>
            <div className="pt-4 flex items-center justify-center gap-4 opacity-30 grayscale">
              <span className="text-[9px] font-bold border border-white px-2 py-0.5 rounded">ELK-BLED</span>
              <span className="text-[9px] font-bold border border-white px-2 py-0.5 rounded">TRIONES</span>
              <span className="text-[9px] font-bold border border-white px-2 py-0.5 rounded">RGB-LED</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;