"use client";

import { useHealth } from "@/lib/hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

/* ── Sparkline SVG ──────────────────────────────────────── */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

/* ── Metric Card ────────────────────────────────────────── */
function MetricCard({
  label,
  value,
  subtitle,
  color,
  sparkData,
  delay,
}: {
  label: string;
  value: string;
  subtitle: string;
  color: string;
  sparkData: number[];
  delay: string;
}) {
  return (
    <div
      className={`card-hover animate-fade-up ${delay} relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-sm`}
    >
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}40, transparent)` }} />
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="font-[family-name:var(--font-sora)] text-3xl font-bold leading-none tracking-tight" style={{ color }}>
            {value}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500">{subtitle}</div>
        </div>
        <Sparkline data={sparkData} color={color} />
      </div>
    </div>
  );
}

/* ── Pipeline Stage ─────────────────────────────────────── */
function PipelineStage({ name, status, latency, isLast }: { name: string; status: string; latency: string | null; isLast: boolean }) {
  const isActive = status === "running" || status === "healthy";
  const dotColor = isActive ? "bg-emerald-400" : status === "idle" ? "bg-zinc-600" : "bg-amber-400";
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`relative h-3 w-3 rounded-full ${dotColor} ${isActive ? "animate-pulse-dot" : ""}`}>
          {isActive && <div className={`absolute inset-0 rounded-full ${dotColor} opacity-30 animate-ping`} />}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gradient-to-b from-zinc-700 to-zinc-800/50" />}
      </div>
      <div className="flex-1 pb-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{name}</span>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-zinc-500">{latency ?? "—"}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-600">{status}</div>
      </div>
    </div>
  );
}

/* ── Activity Item ──────────────────────────────────────── */
function ActivityItem({ text, time, color }: { text: string; time: string; color: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.03] last:border-0">
      <div className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-zinc-300 leading-snug">{text}</div>
        <div className="font-[family-name:var(--font-mono)] text-[10px] text-zinc-600 mt-0.5">{time}</div>
      </div>
    </div>
  );
}

/* ── Nav Link ───────────────────────────────────────────── */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="group relative text-[13px] text-zinc-500 transition-colors hover:text-zinc-200">
      {children}
      <span className="absolute -bottom-1 left-0 h-px w-0 bg-zinc-400 transition-all duration-300 group-hover:w-full" />
    </a>
  );
}

/* ── Dashboard Content ──────────────────────────────────── */
function DashboardContent() {
  const { data: health, isLoading, error } = useHealth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-zinc-700 border-t-blue-500 animate-spin" />
          <span className="text-sm text-zinc-600 font-[family-name:var(--font-mono)]">initializing runtime…</span>
        </div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="text-center animate-fade-up">
          <div className="text-red-400/80 text-lg font-[family-name:var(--font-sora)] font-semibold">Connection Lost</div>
          <div className="text-zinc-600 text-sm mt-2">Ensure opencode-memory plugin is running</div>
        </div>
      </div>
    );
  }

  const stages = [
    { name: "Capture", status: health.pipelineStatus.capture, latency: "2m ago" },
    { name: "Extraction", status: health.pipelineStatus.extraction, latency: "15m ago" },
    { name: "Dream", status: health.pipelineStatus.dream, latency: "3h ago" },
    { name: "Governance", status: health.pipelineStatus.governance, latency: "10m ago" },
  ];

  return (
    <div className="relative min-h-screen bg-[#09090b] bg-dot-grid">
      <div className="fixed inset-0 bg-radial-glow pointer-events-none" />
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-white/[0.04] px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h1 className="font-[family-name:var(--font-sora)] text-xl font-bold tracking-tight text-zinc-100">MemoryOS</h1>
              <span className="text-[11px] font-medium text-zinc-600 tracking-wide">GOVERNANCE CONSOLE</span>
              <span className="font-[family-name:var(--font-mono)] text-[10px] text-zinc-700 ml-1">v0.6</span>
            </div>
            <div className="flex items-center gap-5">
              <nav className="flex items-center gap-4">
                <NavLink href="/memories">Explorer</NavLink>
                <NavLink href="/approval">Approval</NavLink>
                <NavLink href="/timeline">Timeline</NavLink>
                <NavLink href="/graph">Graph</NavLink>
                <NavLink href="/conflicts">Conflicts</NavLink>
                <NavLink href="/pipeline">Pipeline</NavLink>
                <NavLink href="/audit">Audit</NavLink>
                <NavLink href="/governance">Governance</NavLink>
              </nav>
              <div className="flex items-center gap-2 pl-4 border-l border-white/[0.06]">
                <div className="relative h-2 w-2">
                  <div className="absolute inset-0 rounded-full bg-emerald-400 animate-pulse-dot" />
                  <div className="absolute inset-0 rounded-full bg-emerald-400 opacity-30 animate-ping" />
                </div>
                <span className="text-[11px] font-medium text-emerald-400/80 tracking-wide">LIVE</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="px-8 py-8 max-w-[1400px]">
          <div className="grid grid-cols-4 gap-4 mb-8">
            <MetricCard label="Memories" value={health.memoryCount.toLocaleString()} subtitle="active memory units" color="#22c55e" sparkData={[3, 5, 4, 7, 6, 8, 9]} delay="delay-100" />
            <MetricCard label="Quality" value="96.2%" subtitle="memory intelligence score" color="#3b82f6" sparkData={[88, 90, 91, 93, 94, 95, 96]} delay="delay-200" />
            <MetricCard label="Conflicts" value="0" subtitle="open conflicts" color="#71717a" sparkData={[2, 1, 3, 1, 0, 0, 0]} delay="delay-300" />
            <MetricCard label="Risk Level" value="Low" subtitle="all clear" color="#22c55e" sparkData={[1, 1, 2, 1, 1, 1, 1]} delay="delay-400" />
          </div>

          <div className="grid grid-cols-5 gap-4">
            <div className="col-span-3 card-hover animate-fade-up delay-500 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-[family-name:var(--font-sora)] text-sm font-semibold text-zinc-300 tracking-wide">Pipeline Status</h2>
                <span className="font-[family-name:var(--font-mono)] text-[10px] text-zinc-600">4 stages</span>
              </div>
              <div className="grid grid-cols-2 gap-x-8">
                {stages.map((s, i) => (
                  <PipelineStage key={s.name} {...s} isLast={i === stages.length - 1} />
                ))}
              </div>
            </div>

            <div className="col-span-2 card-hover animate-fade-up delay-600 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-[family-name:var(--font-sora)] text-sm font-semibold text-zinc-300 tracking-wide">Recent Activity</h2>
                <span className="font-[family-name:var(--font-mono)] text-[10px] text-zinc-600">today</span>
              </div>
              <div>
                <ActivityItem text="Memory extracted from session #10293" time="2 min ago" color="bg-blue-400" />
                <ActivityItem text="Governance cycle completed — 3 actions" time="10 min ago" color="bg-emerald-400" />
                <ActivityItem text="Conflict resolved: React → Vue preference" time="25 min ago" color="bg-amber-400" />
                <ActivityItem text="Dream consolidation skipped (gate not met)" time="3 hours ago" color="bg-zinc-600" />
                <ActivityItem text="Proposal #233 approved by user" time="5 hours ago" color="bg-purple-400" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
    </QueryClientProvider>
  );
}