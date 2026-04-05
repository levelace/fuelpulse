/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Activity, 
  AlertTriangle, 
  ArrowRight, 
  BarChart3, 
  CheckCircle2, 
  ChevronRight, 
  Clock, 
  Cpu, 
  Database, 
  ExternalLink, 
  Ghost, 
  Globe, 
  Layers, 
  LayoutDashboard, 
  LogOut, 
  Plus, 
  RefreshCcw, 
  Search, 
  ShieldAlert,
  ShieldCheck, 
  Terminal, 
  Zap,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { formatDistanceToNow } from "date-fns";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

// Types
interface StoreLeak {
  id: string;
  store_url: string;
  leak_type: "LATENCY" | "API_ERROR" | "UI_BLOCK";
  severity: number;
  impact_ms: number;
  captured_at: string;
  details?: string;
}

interface Store {
  id: string;
  url: string;
  name: string;
  owner_uid: string;
  last_scan_at?: string;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  public state: { hasError: boolean };
  public props: { children: React.ReactNode };

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
    this.props = props;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
          <div className="terminal-card p-8 max-w-md w-full space-y-6 text-center border-rose-500/50">
            <ShieldAlert className="w-16 h-16 text-rose-500 mx-auto animate-pulse" />
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-zinc-100">CRITICAL_SYSTEM_FAILURE</h1>
              <p className="text-sm text-zinc-500 font-mono">The engine encountered an unrecoverable error in the main thread.</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-md font-mono text-xs transition-all"
            >
              REBOOT_SYSTEM
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [leaks, setLeaks] = useState<StoreLeak[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [newStoreUrl, setNewStoreUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"dashboard" | "leaks" | "stores" | "bloat">("dashboard");
  const [auditResults, setAuditResults] = useState<any>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);

  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [isBootstrapped, setIsBootstrapped] = useState<boolean | null>(null);

  useEffect(() => {
    // Check session via backend
    const checkSession = async () => {
      try {
        const [sessionRes, statusRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/auth/status")
        ]);
        
        if (!sessionRes.ok || !statusRes.ok) {
          throw new Error(`Session check failed: ${sessionRes.status} / ${statusRes.status}`);
        }

        const sessionContentType = sessionRes.headers.get("content-type");
        const statusContentType = statusRes.headers.get("content-type");

        if (sessionContentType?.includes("application/json") && statusContentType?.includes("application/json")) {
          const sessionData = await sessionRes.json();
          const statusData = await statusRes.json();
          setUser(sessionData.user);
          setIsBootstrapped(statusData.bootstrapped);
        } else {
          console.error("Non-JSON response during session check");
        }
      } catch (err) {
        console.error("Session check failed:", err);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [storesRes, leaksRes] = await Promise.all([
        fetch("/api/stores"),
        fetch("/api/leaks")
      ]);
      
      if (storesRes.status === 401 || leaksRes.status === 401) {
        setUser(null);
        return;
      }

      if (!storesRes.ok || !leaksRes.ok) {
        const storesErr = !storesRes.ok ? await storesRes.text() : "";
        const leaksErr = !leaksRes.ok ? await leaksRes.text() : "";
        throw new Error(`Stores: ${storesRes.status} ${storesErr.substring(0, 50)}, Leaks: ${leaksRes.status} ${leaksErr.substring(0, 50)}`);
      }

      const storesContentType = storesRes.headers.get("content-type");
      const leaksContentType = leaksRes.headers.get("content-type");

      if (!storesContentType?.includes("application/json") || !leaksContentType?.includes("application/json")) {
        throw new Error("Server returned non-JSON response. Check if API routes are correctly configured.");
      }

      const storesData = await storesRes.json();
      const leaksData = await leaksRes.json();
      if (Array.isArray(storesData)) setStores(storesData);
      if (Array.isArray(leaksData)) setLeaks(leaksData);
    } catch (err: any) {
      console.error("Failed to fetch data:", err.message || err);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll every 10s for "real-time" feel
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-20));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const endpoint = isBootstrapped ? "/api/auth/login" : "/api/auth/bootstrap";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey, secretKey })
      });
      const data = await res.json();
      
      if (data.success) {
        if (!isBootstrapped) {
          // If we just bootstrapped, now login
          const loginRes = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessKey, secretKey })
          });
          const loginData = await loginRes.json();
          if (loginData.success) {
            setUser(loginData.user);
            setIsBootstrapped(true);
          }
        } else {
          setUser(data.user);
        }
      } else {
        setAuthError(data.error || "Authentication failed");
      }
    } catch (error) {
      setAuthError("Network error");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  const handleAddStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newStoreUrl) return;

    let sanitizedUrl = newStoreUrl.trim();
    if (!sanitizedUrl.startsWith("http")) {
      sanitizedUrl = `https://${sanitizedUrl}`;
    }
    
    let name = sanitizedUrl.replace(/^https?:\/\//, "").split(".")[0];
    if (name === "www") {
      name = sanitizedUrl.replace(/^https?:\/\/(www\.)?/, "").split(".")[0];
    }

    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: sanitizedUrl,
          name: name || "New Store"
        })
      });
      if (res.status === 401) {
        setUser(null);
        return;
      }

      if (res.ok) {
        setNewStoreUrl("");
        addLog(`New store added: ${sanitizedUrl}`);
        fetchData();
      } else {
        const err = await res.json();
        addLog(`ERROR: ${err.error}`);
      }
    } catch (error) {
      console.error("Failed to add store", error);
      addLog(`ERROR: Network failure adding store.`);
    }
  };

  const runSimulation = async (storeUrl: string) => {
    if (isSimulating) return;
    setIsSimulating(true);
    addLog(`Ghost Shopper initiated for ${storeUrl}...`);
    
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeUrl })
      });
      
      const result = await response.json();
      
      if (result.success) {
        addLog(`Simulation complete. ATC Latency: ${result.metrics.atcLatency}ms`);
        if (result.leak) {
          addLog(`CRITICAL: ${result.leak.leak_type} detected! Severity: ${result.leak.severity}`);
          // The backend could also handle logging leaks automatically if desired
        } else {
          addLog(`SUCCESS: No leaks detected.`);
        }
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (error) {
      addLog(`ERROR: Network failure during simulation.`);
    } finally {
      setIsSimulating(false);
    }
  };

  const runAppAudit = async (storeUrl: string) => {
    if (isAuditing) return;
    setIsAuditing(true);
    setActiveTab("bloat");
    addLog(`App Bloat Audit initiated for ${storeUrl}...`);
    
    try {
      const response = await fetch("/api/audit-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeUrl })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setAuditResults(result.metrics);
        addLog(`Audit complete. Found ${result.metrics.thirdPartyCount} third-party scripts.`);
      } else {
        addLog(`ERROR: ${result.error}`);
      }
    } catch (error) {
      addLog(`ERROR: Network failure during audit.`);
    } finally {
      setIsAuditing(false);
    }
  };

  const totalImpact = leaks.reduce((acc, leak) => acc + (leak.impact_ms * 0.05), 0); // Mock revenue at risk calculation

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <RefreshCcw className="w-8 h-8 text-emerald-500" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-mono">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-lg shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className={`p-2 rounded-lg ${!isBootstrapped ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
              <Activity className={`w-8 h-8 ${!isBootstrapped ? 'text-amber-500' : 'text-emerald-500'}`} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
                {!isBootstrapped ? 'SYSTEM INITIALIZATION' : 'FUELERATE PULSE'}
              </h1>
              <p className="text-xs text-zinc-500">
                {!isBootstrapped ? 'CREATE MASTER ADMIN' : 'SECURE MONITORING ENGINE'}
              </p>
            </div>
          </div>

          {!isBootstrapped && (
            <div className="mb-8 p-4 bg-amber-500/5 border border-amber-500/20 rounded text-[11px] text-amber-200/70 leading-relaxed">
              <div className="flex items-center gap-2 mb-2 text-amber-500 font-bold uppercase tracking-wider">
                <ShieldAlert className="w-3 h-3" />
                First-Time Setup Detected
              </div>
              Define your master credentials below. These will be hashed and stored in your private database. This screen will never appear again.
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Access Key</label>
              <div className="relative">
                <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                <input 
                  type="text" 
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-10 py-3 text-zinc-100 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="Enter access key..."
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Secret Key</label>
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                <input 
                  type="password" 
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-10 py-3 text-zinc-100 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {authError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded text-rose-500 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {authError}
              </div>
            )}

            <button 
              type="submit"
              className={`w-full text-white font-bold py-3 rounded transition-colors flex items-center justify-center gap-2 ${
                !isBootstrapped ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {!isBootstrapped ? 'INITIALIZE MASTER ACCOUNT' : 'INITIALIZE SESSION'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
              Zero-Trust Architecture • Encrypted Session
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Top Bar */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Zap className="w-6 h-6 text-emerald-500" />
          <span className="font-bold tracking-tighter text-lg">FUELERATE PULSE <span className="text-zinc-600 text-sm font-mono ml-2">v1.0.0-MVP</span></span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-full group cursor-help">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs font-bold text-rose-500 uppercase tracking-wider font-mono">
              REV_AT_RISK: ${totalImpact.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-emerald-500 group-hover:border-emerald-500/50 transition-colors">
              {user.role === 'admin' ? 'AD' : 'US'}
            </div>
            <button onClick={handleLogout} className="text-zinc-500 hover:text-rose-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-800 p-4 hidden lg:flex flex-col gap-2">
          <SidebarItem 
            icon={<LayoutDashboard className="w-4 h-4" />} 
            label="Dashboard" 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")} 
          />
          <SidebarItem 
            icon={<Activity className="w-4 h-4" />} 
            label="Leak Feed" 
            active={activeTab === "leaks"} 
            onClick={() => setActiveTab("leaks")} 
          />
          <SidebarItem 
            icon={<Globe className="w-4 h-4" />} 
            label="Managed Stores" 
            active={activeTab === "stores"} 
            onClick={() => setActiveTab("stores")} 
          />
          <SidebarItem 
            icon={<Layers className="w-4 h-4" />} 
            label="App Bloat" 
            active={activeTab === "bloat"} 
            onClick={() => setActiveTab("bloat")} 
          />
          
          <div className="mt-auto pt-4 border-t border-zinc-800 space-y-4">
            <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
                <Database className="w-3 h-3" />
                SYSTEM STATUS
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-zinc-300 font-mono">ENGINE_ONLINE</span>
              </div>
              <div className="mt-2 text-[10px] text-zinc-600 font-mono">
                UPTIME: 142:31:05
              </div>
            </div>

            <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
                <Cpu className="w-3 h-3" />
                WORKER LOAD
              </div>
              <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "24%" }}
                  className="bg-emerald-500 h-full"
                />
              </div>
              <div className="mt-1 text-[10px] text-zinc-600 font-mono text-right">
                24% UTILIZED
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                  label="Active Monitors" 
                  value={stores.length.toString()} 
                  icon={<Globe className="w-5 h-5 text-blue-400" />} 
                />
                <StatCard 
                  label="Critical Leaks" 
                  value={leaks.filter(l => l.severity >= 4).length.toString()} 
                  icon={<AlertTriangle className="w-5 h-5 text-rose-400" />} 
                  trend="up"
                />
                <StatCard 
                  label="Avg. ATC Latency" 
                  value={`${leaks.length > 0 ? Math.round(leaks.reduce((a, b) => a + b.impact_ms, 0) / leaks.length) : 0}ms`} 
                  icon={<Zap className="w-5 h-5 text-emerald-400" />} 
                  trend="down"
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Latency Pulse Chart */}
                <div className="terminal-card flex flex-col h-[400px]">
                  <div className="terminal-header">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      <span>LATENCY_PULSE_STREAM</span>
                    </div>
                  </div>
                  <div className="terminal-content flex-1 p-4 bg-black/20">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={leaks.slice(0, 20).reverse().map(l => ({ 
                        time: new Date(l.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
                        ms: l.impact_ms 
                      }))}>
                        <defs>
                          <linearGradient id="colorMs" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis 
                          dataKey="time" 
                          stroke="#52525b" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                        />
                        <YAxis 
                          stroke="#52525b" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                          tickFormatter={(val) => `${val}ms`}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '4px' }}
                          itemStyle={{ color: '#10b981', fontSize: '12px' }}
                          labelStyle={{ color: '#52525b', fontSize: '10px', marginBottom: '4px' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="ms" 
                          stroke="#10b981" 
                          fillOpacity={1} 
                          fill="url(#colorMs)" 
                          strokeWidth={2}
                          animationDuration={1000}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Real-time Feed */}
                <div className="terminal-card flex flex-col h-[400px]">
                  <div className="terminal-header">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      <span>GHOST_SHOPPER_LOG</span>
                    </div>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-zinc-700" />
                      <div className="w-2 h-2 rounded-full bg-zinc-700" />
                      <div className="w-2 h-2 rounded-full bg-zinc-700" />
                    </div>
                  </div>
                  <div className="terminal-content flex-1 overflow-y-auto font-mono text-xs space-y-1 bg-black/40">
                    {logs.length === 0 && <div className="text-zinc-600 italic">Waiting for process initiation...</div>}
                    {logs.map((log, i) => (
                      <div key={i} className={cn(
                        log.includes("CRITICAL") ? "text-rose-400" : 
                        log.includes("SUCCESS") ? "text-emerald-400" : "text-zinc-400"
                      )}>
                        {log}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>

                {/* Recent Leaks */}
                <div className="terminal-card flex flex-col h-[400px]">
                  <div className="terminal-header">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      <span>RECENT_LEAKS</span>
                    </div>
                    <button 
                      onClick={() => setActiveTab("leaks")}
                      className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                    >
                      VIEW ALL <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="terminal-content flex-1 overflow-y-auto p-0">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-800/30 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 font-medium text-zinc-500">STORE</th>
                          <th className="px-4 py-2 font-medium text-zinc-500">TYPE</th>
                          <th className="px-4 py-2 font-medium text-zinc-500">IMPACT</th>
                          <th className="px-4 py-2 font-medium text-zinc-500">TIME</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {leaks.slice(0, 10).map((leak) => (
                          <tr key={leak.id} className="hover:bg-zinc-800/20 transition-colors">
                            <td className="px-4 py-3 font-medium">{leak.store_url.replace("https://", "").split("/")[0]}</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                                leak.leak_type === "LATENCY" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                              )}>
                                {leak.leak_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-zinc-400">{leak.impact_ms}ms</td>
                            <td className="px-4 py-3 text-zinc-500">{formatDistanceToNow(new Date(leak.captured_at), { addSuffix: true })}</td>
                          </tr>
                        ))}
                        {leaks.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-zinc-600 italic">No leaks detected yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Store Quick Actions */}
              <div className="terminal-card">
                <div className="terminal-header">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    <span>ACTIVE_MONITORS</span>
                  </div>
                </div>
                <div className="terminal-content grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {stores.map((store) => (
                    <div key={store.id} className="p-4 bg-zinc-800/30 border border-zinc-800 rounded-lg flex items-center justify-between group">
                      <div className="space-y-1">
                        <div className="font-bold text-sm">{store.name}</div>
                        <div className="text-xs text-zinc-500 truncate w-40">{store.url}</div>
                      </div>
                      <button 
                        onClick={() => runSimulation(store.url)}
                        disabled={isSimulating}
                        className="p-2 bg-emerald-500/10 text-emerald-500 rounded-md hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                      >
                        <Zap className={cn("w-4 h-4", isSimulating && "animate-pulse")} />
                      </button>
                    </div>
                  ))}
                  <form onSubmit={handleAddStore} className="p-4 border border-dashed border-zinc-700 rounded-lg flex items-center gap-3 bg-zinc-900/20 hover:border-emerald-500/30 focus-within:border-emerald-500/50 transition-all group/form">
                    <Globe className="w-3 h-3 text-zinc-600 group-focus-within/form:text-emerald-500 transition-colors" />
                    <input 
                      type="text" 
                      placeholder="store.myshopify.com" 
                      className="bg-transparent border-none outline-none text-xs flex-1 text-zinc-300 placeholder:text-zinc-600"
                      value={newStoreUrl}
                      onChange={(e) => setNewStoreUrl(e.target.value)}
                    />
                    <button type="submit" className="text-zinc-500 hover:text-emerald-500 transition-colors group">
                      <Plus className="w-4 h-4 transition-transform group-hover:scale-110 group-active:scale-90" />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {activeTab === "leaks" && (
            <div className="terminal-card">
              <div className="terminal-header">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  <span>FULL_LEAK_FEED</span>
                </div>
              </div>
              <div className="terminal-content p-0">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-800/30">
                    <tr>
                      <th className="px-6 py-4 font-medium text-zinc-500">STORE</th>
                      <th className="px-6 py-4 font-medium text-zinc-500">LEAK TYPE</th>
                      <th className="px-6 py-4 font-medium text-zinc-500">SEVERITY</th>
                      <th className="px-6 py-4 font-medium text-zinc-500">IMPACT</th>
                      <th className="px-6 py-4 font-medium text-zinc-500">DETAILS</th>
                      <th className="px-6 py-4 font-medium text-zinc-500">TIMESTAMP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {leaks.map((leak) => (
                      <tr key={leak.id} className="hover:bg-zinc-800/20 transition-colors">
                        <td className="px-6 py-4 font-medium">{leak.store_url}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-1 rounded text-xs font-bold",
                            leak.leak_type === "LATENCY" ? "text-amber-400 bg-amber-400/10" : "text-rose-400 bg-rose-400/10"
                          )}>
                            {leak.leak_type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map(s => (
                              <div key={s} className={cn("w-2 h-2 rounded-full", s <= leak.severity ? "bg-rose-500" : "bg-zinc-800")} />
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-zinc-300">{leak.impact_ms}ms</td>
                        <td className="px-6 py-4 text-zinc-500 max-w-xs truncate">{leak.details}</td>
                        <td className="px-6 py-4 text-zinc-500">{new Date(leak.captured_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "bloat" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight">App Bloat Auditor</h2>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <ShieldCheck className="w-4 h-4" />
                  SRI VERIFIED
                </div>
              </div>

              {!auditResults && !isAuditing && (
                <div className="terminal-card p-12 text-center space-y-4">
                  <Layers className="w-12 h-12 text-zinc-700 mx-auto" />
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold">No Audit Data</h3>
                    <p className="text-zinc-500 max-w-md mx-auto">Select a store from the Managed Stores tab to run a deep-scan of third-party script bloat and conversion taxes.</p>
                  </div>
                </div>
              )}

              {isAuditing && (
                <div className="terminal-card p-12 text-center space-y-6">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <Search className="w-12 h-12 text-emerald-500 mx-auto" />
                  </motion.div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold">Scanning Store Assets...</h3>
                    <p className="text-zinc-500">Mapping ScriptTags, Theme Assets, and LCP Impact.</p>
                  </div>
                </div>
              )}

              {auditResults && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="terminal-card">
                      <div className="terminal-header">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4" />
                          <span>IDENTIFIED_THIRD_PARTY_APPS</span>
                        </div>
                      </div>
                      <div className="terminal-content p-0">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-zinc-800/30">
                            <tr>
                              <th className="px-4 py-3 font-medium text-zinc-500">APP NAME</th>
                              <th className="px-4 py-3 font-medium text-zinc-500">LATENCY TAX</th>
                              <th className="px-4 py-3 font-medium text-zinc-500">STATUS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800">
                            {auditResults.identifiedApps.map((app: any, i: number) => (
                              <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
                                <td className="px-4 py-3 font-medium">{app.name}</td>
                                <td className="px-4 py-3 text-rose-400">+{app.latencyTax}ms</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1 text-emerald-500">
                                    <ShieldCheck className="w-3 h-3" />
                                    <span className="text-[10px] font-bold">SRI_OK</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="terminal-card p-6 space-y-4 border-emerald-500/20 bg-emerald-500/5">
                      <h3 className="text-xs font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        Audit Summary
                      </h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                          <span className="text-sm text-zinc-400">Total Scripts</span>
                          <span className="text-2xl font-bold font-mono">{auditResults.totalScripts}</span>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-sm text-zinc-400">3rd Party Apps</span>
                          <span className="text-2xl font-bold text-amber-400 font-mono">{auditResults.thirdPartyCount}</span>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-sm text-zinc-400">LCP Impact</span>
                          <span className="text-2xl font-bold text-rose-400 font-mono">{Math.round(auditResults.lcp)}ms</span>
                        </div>
                      </div>
                      <div className="pt-4 border-t border-zinc-800">
                        <div className="text-[10px] text-zinc-500 mb-2 uppercase tracking-tighter">Estimated Revenue Leak / Session</div>
                        <div className="text-2xl font-bold text-rose-500 font-mono">-${(auditResults.thirdPartyCount * 12.5).toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="terminal-card p-6 bg-emerald-500/5 border-emerald-500/20">
                      <div className="flex items-center gap-2 text-emerald-500 mb-2">
                        <ShieldCheck className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Security Audit</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        All identified scripts are using Subresource Integrity (SRI) hashes. No "Risk Leaks" detected in the current theme layer.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "stores" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight">Managed Stores</h2>
                <button className="flex items-center gap-2 bg-emerald-500 text-zinc-950 px-4 py-2 rounded-lg font-bold text-sm hover:bg-emerald-400 transition-colors">
                  <Plus className="w-4 h-4" /> ADD NEW STORE
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {stores.map(store => (
                  <div key={store.id} className="terminal-card">
                    <div className="terminal-header">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        <span>{store.name.toUpperCase()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-[10px] text-zinc-500 uppercase">Monitoring Active</span>
                      </div>
                    </div>
                    <div className="terminal-content space-y-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Endpoint:</span>
                        <a href={store.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline flex items-center gap-1">
                          {store.url} <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Last Scan:</span>
                        <span className="text-zinc-300">24 mins ago</span>
                      </div>
                      <div className="pt-4 flex gap-2">
                        <button 
                          onClick={() => runSimulation(store.url)}
                          disabled={isSimulating}
                          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 py-2 rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-2"
                        >
                          <Zap className={cn("w-3 h-3", isSimulating && "animate-pulse")} /> TRIGGER GHOST SHOP
                        </button>
                        <button 
                          onClick={() => runAppAudit(store.url)}
                          disabled={isAuditing}
                          className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-md transition-colors disabled:opacity-50"
                        >
                          <Layers className={cn("w-4 h-4", isAuditing && "animate-spin")} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
        active 
          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" 
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ label, value, icon, trend }: { label: string, value: string, icon: React.ReactNode, trend?: 'up' | 'down' }) {
  return (
    <div className="terminal-card p-6 space-y-4 relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
        <div className="p-2 bg-zinc-900 rounded-md border border-zinc-800 group-hover:border-emerald-500/30 transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tracking-tighter font-mono">{value}</div>
        {trend && (
          <div className={cn(
            "text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1",
            trend === 'up' ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"
          )}>
            {trend === 'up' ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
            {trend === 'up' ? "+12%" : "-4%"}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
        <Clock className="w-3 h-3" />
        UPDATED REAL-TIME
      </div>
    </div>
  );
}
