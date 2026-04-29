import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, X, Copy, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

export default function DebuggerConsole() {
  const [logs, setLogs] = useState<{ type: string, message: string, time: string }[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 10, y: 10 });
  const [isVisible, setIsVisible] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isDebugUrl = window.location.search.includes('debugger') || window.location.pathname.includes('debugger') || localStorage.getItem('debugger_enabled') === 'true';
    if (window.location.search.includes('debugger=true')) {
      localStorage.setItem('debugger_enabled', 'true');
    } else if (window.location.search.includes('debugger=false')) {
      localStorage.removeItem('debugger_enabled');
    }
    
    if (!isDebugUrl) return;
    setIsVisible(true);

    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;

    const addLog = (type: string, args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
      setLogs(prev => [...prev, { type, message: msg, time: new Date().toISOString() }]);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SW_LOG') {
        addLog('info', ['[SW]', event.data.message]);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleMessage);

    console.log = (...args) => { addLog('log', args); originalConsoleLog(...args); };
    console.error = (...args) => { addLog('error', args); originalConsoleError(...args); };
    console.warn = (...args) => { addLog('warn', args); originalConsoleWarn(...args); };
    console.info = (...args) => { addLog('info', args); originalConsoleInfo(...args); };

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, isOpen]);

  if (!isVisible) return null;

  return (
    <>
      <motion.div
        drag
        dragMomentum={false}
        initial={{ x: position.x, y: position.y }}
        className="fixed z-[9999] bg-black/80 backdrop-blur-md rounded-full shadow-2xl border border-white/20 p-3 cursor-pointer"
        onClick={() => setIsOpen(true)}
      >
        <Terminal size={24} className="text-green-500" />
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-0 z-[10000] bg-black/95 text-white flex flex-col font-mono text-xs"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/20 bg-black">
              <div className="flex items-center gap-2">
                <Terminal size={20} className="text-green-500" />
                <h2 className="text-sm font-bold">Debugger Console</h2>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n'));
                    alert('Copied to clipboard');
                  }}
                  className="flex items-center gap-1 text-blue-400 active:scale-95"
                >
                  <Copy size={16} /> Copy
                </button>
                <button
                  onClick={() => setLogs([])}
                  className="flex items-center gap-1 text-red-400 active:scale-95"
                >
                  <Trash2 size={16} /> Clear
                </button>
                <button onClick={() => setIsOpen(false)} className="text-white/60 active:scale-95">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {logs.map((log, i) => (
                <div key={i} className={cn(
                  "p-2 rounded font-mono break-words whitespace-pre-wrap",
                  log.type === 'error' ? "bg-red-500/20 text-red-300" :
                  log.type === 'warn' ? "bg-yellow-500/20 text-yellow-300" : "bg-white/5 text-white/90"
                )}>
                  <span className="opacity-50 text-[10px] block mb-1">{log.time}</span>
                  {log.message}
                </div>
              ))}
              {logs.length === 0 && <div className="text-white/40 italic">No logs yet...</div>}
              <div ref={endRef} />
            </div>
            
            <div className="p-2 border-t border-white/10 flex justify-end">
              <button 
                  onClick={() => {
                    const request = indexedDB.open('SWLogsDB', 1);
                    request.onsuccess = (e: any) => {
                      const db = e.target.result;
                      if (!db.objectStoreNames.contains('logs')) return;
                      const tx = db.transaction('logs', 'readonly');
                      const store = tx.objectStore('logs');
                      const req = store.getAll();
                      req.onsuccess = () => {
                        const idbLogs = req.result.map((r: any) => ({
                          type: 'info',
                          message: r.message,
                          time: r.time,
                        }));
                        setLogs(prev => [...prev, ...idbLogs].sort((a,b) => new Date(a.time).getTime() - new Date(b.time).getTime()));
                      };
                    };
                  }}
                  className="text-xs font-bold text-white/50 hover:text-white px-3 py-1 rounded bg-white/5"
                >
                  Load IDB Logs
                </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
