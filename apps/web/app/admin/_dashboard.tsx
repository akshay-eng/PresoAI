"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

const AdminWorldMap = dynamic(() => import("./_world-map"), {
  ssr: false,
  loading: () => <div className="h-[360px] grid place-items-center text-xs text-muted-foreground">Loading map…</div>,
});
import {
  Activity, Users, FileText, Download, Cpu, Zap, LogOut,
  TrendingUp, Coins, Wallet, Loader2, Search, Globe, Monitor,
  Eye, ExternalLink,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const ease = [0.22, 1, 0.36, 1] as const;

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#ec4899"];

type Overview = {
  users: {
    total: number; new7d: number; new30d: number;
    withOwnKeys: number; couponRedeemed: number; free: number;
    active: { dau: number; wau: number; mau: number };
  };
  projects: { total: number; last30d: number };
  presentations: { total: number; last30d: number };
  downloads: { total: number; last30d: number };
  jobs: { total: number; byStatus: Record<string, number> };
  tokens: {
    total: number; input: number; output: number; generations: number; estimatedCostUsd: number;
    bySource: Array<{ source: string; generations: number; tokens: number; cost: number }>;
  };
  find: { sourceFiles: number; slidesIndexed: number };
};

type Timeseries = {
  days: string[];
  signups: Array<{ day: string; count: number }>;
  projects: Array<{ day: string; count: number }>;
  presentations: Array<{ day: string; count: number }>;
  downloads: Array<{ day: string; count: number }>;
  tokens: Array<{ day: string; tokens: number; cost: number }>;
  dailyActiveUsers: Array<{ day: string; count: number }>;
  providers: Array<{ provider: string; generations: number; tokens: number; cost: number }>;
  models: Array<{ model: string; generations: number; tokens: number }>;
};

type Traffic = {
  days: string[];
  series: Array<{ day: string; views: number; visitors: number }>;
  totalViews: number;
  totalUniqueVisitors: number;
  countries: Array<{ country: string; count: number }>;
  pages: Array<{ path: string; count: number }>;
  devices: Array<{ device: string; count: number }>;
  browsers: Array<{ ua: string; count: number }>;
  referrers: Array<{ referrer: string; count: number }>;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  providerCount: number;
  projects: number;
  presentations: number;
  downloads: number;
  jobs: number;
  tokens: number;
  cost: number;
  lastActive: string | null;
  createdAt: string;
  models: string[];
};

export function AdminDashboard() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [userSort, setUserSort] = useState<string>("tokens");
  const [userFilter, setUserFilter] = useState("");

  const overview = useQuery<Overview>({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const r = await fetch("/api/admin/analytics/overview");
      if (!r.ok) throw new Error("Failed to load overview");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const timeseries = useQuery<Timeseries>({
    queryKey: ["admin-timeseries", days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/timeseries?days=${days}`);
      if (!r.ok) throw new Error("Failed to load timeseries");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const traffic = useQuery<Traffic>({
    queryKey: ["admin-traffic", days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/traffic?days=${days}`);
      if (!r.ok) throw new Error("Failed to load traffic");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const users = useQuery<{ items: UserRow[]; total: number }>({
    queryKey: ["admin-users", userSort],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/users?sortBy=${userSort}&limit=200`);
      if (!r.ok) throw new Error("Failed to load users");
      return r.json();
    },
  });

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  const ov = overview.data;
  const filteredUsers = (users.data?.items || []).filter((u) => {
    if (!userFilter) return true;
    const f = userFilter.toLowerCase();
    return u.email.toLowerCase().includes(f) || (u.name || "").toLowerCase().includes(f);
  });

  return (
    <div className="min-h-screen bg-muted/10">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto h-14 flex items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-primary/15 grid place-items-center">
              <Activity className="h-3.5 w-3.5 text-primary" />
            </div>
            <h1 className="text-sm font-semibold">Admin · Analytics</h1>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
              {ov?.users.total ?? "—"} users
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="text-xs h-8 rounded-md border border-border bg-card px-2"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
            </select>
            <Button variant="ghost" size="sm" onClick={logout} className="h-8 text-xs gap-1.5">
              <LogOut className="h-3 w-3" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="max-w-7xl mx-auto px-6 py-6 space-y-6"
      >
        {/* KPI cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard icon={Users} label="Total users" value={ov?.users.total} sub={ov ? `+${ov.users.new30d} in 30d` : undefined} />
          <KpiCard icon={Activity} label="MAU" value={ov?.users.active.mau} sub={ov ? `${ov.users.active.dau} today` : undefined} />
          <KpiCard icon={FileText} label="Projects" value={ov?.projects.total} sub={ov ? `+${ov.projects.last30d} in 30d` : undefined} />
          <KpiCard icon={TrendingUp} label="Presentations" value={ov?.presentations.total} sub={ov ? `+${ov.presentations.last30d} in 30d` : undefined} />
          <KpiCard icon={Download} label="Downloads" value={ov?.downloads.total} sub={ov ? `+${ov.downloads.last30d} in 30d` : undefined} />
          <KpiCard icon={Coins} label="Tokens" value={ov ? formatBig(ov.tokens.total) : undefined} sub={ov ? `$${ov.tokens.estimatedCostUsd.toFixed(2)}` : undefined} />
        </section>

        {/* Plan mix + activity */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-5 col-span-1">
            <Header icon={Wallet} title="Plan mix" subtitle="By user count" />
            {ov ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Free", value: ov.users.free, color: COLORS[0] },
                      { name: "Own keys", value: ov.users.withOwnKeys, color: COLORS[1] },
                      { name: "Coupon", value: ov.users.couponRedeemed, color: COLORS[2] },
                    ]}
                    cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value"
                  >
                    {[COLORS[0], COLORS[1], COLORS[2]].map((c, i) => <Cell key={i} fill={c} />)}
                  </Pie>
                  <Tooltip wrapperStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-[180px]" />}
          </div>
          <div className="rounded-xl border border-border bg-card p-5 col-span-1 md:col-span-2">
            <Header icon={Activity} title="Daily active users" subtitle={`Last ${days} days · distinct users with a job`} />
            {timeseries.data ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={timeseries.data.dailyActiveUsers} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={shortDay} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="count" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-[180px]" />}
          </div>
        </section>

        {/* Activity time series */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChartCard
            title="Presentations generated"
            subtitle={`Daily output · last ${days} days`}
            icon={TrendingUp}
            data={timeseries.data?.presentations}
            color={COLORS[1]}
            kind="bar"
            xKey="day" yKey="count"
          />
          <ChartCard
            title="Downloads"
            subtitle={`PPTX exports · last ${days} days`}
            icon={Download}
            data={timeseries.data?.downloads}
            color={COLORS[2]}
            kind="bar"
            xKey="day" yKey="count"
          />
          <ChartCard
            title="New signups"
            subtitle={`User registrations · last ${days} days`}
            icon={Users}
            data={timeseries.data?.signups}
            color={COLORS[3]}
            kind="line"
            xKey="day" yKey="count"
          />
          <ChartCard
            title="Projects created"
            subtitle={`Project records · last ${days} days`}
            icon={FileText}
            data={timeseries.data?.projects}
            color={COLORS[4]}
            kind="line"
            xKey="day" yKey="count"
          />
        </section>

        {/* Tokens + provider mix */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-5 md:col-span-2">
            <Header icon={Zap} title="Tokens used" subtitle={`Daily aggregate · last ${days} days`} />
            {timeseries.data ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeseries.data.tokens} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={shortDay} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatBig(v)} />
                  <Tooltip wrapperStyle={{ fontSize: 11 }} formatter={(v) => formatBig(Number(v))} />
                  <Area type="monotone" dataKey="tokens" stroke={COLORS[5]} fill={COLORS[5]} fillOpacity={0.25} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-[220px]" />}
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <Header icon={Cpu} title="Tokens by provider" subtitle={`Last ${days} days`} />
            {timeseries.data && timeseries.data.providers.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={timeseries.data.providers}
                    cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}
                    dataKey="tokens" nameKey="provider"
                  >
                    {timeseries.data.providers.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip wrapperStyle={{ fontSize: 11 }} formatter={(v) => formatBig(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground py-8 text-center">No data yet</p>
            )}
          </div>
        </section>

        {/* Top models */}
        <section className="rounded-xl border border-border bg-card p-5">
          <Header icon={Cpu} title="Top models" subtitle={`Tokens consumed · last ${days} days`} />
          {timeseries.data && timeseries.data.models.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(220, timeseries.data.models.length * 26)}>
              <BarChart data={timeseries.data.models} layout="vertical" margin={{ top: 5, right: 16, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatBig(v)} />
                <YAxis dataKey="model" type="category" tick={{ fontSize: 10 }} width={170} interval={0} />
                <Tooltip wrapperStyle={{ fontSize: 11 }} formatter={(v) => formatBig(Number(v))} />
                <Bar dataKey="tokens" fill={COLORS[6]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground py-8 text-center">No model usage yet</p>
          )}
        </section>

        {/* Traffic */}
        <section className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard icon={Eye} label="Page views" value={traffic.data ? traffic.data.totalViews : undefined} sub={`Last ${days} days`} />
            <KpiCard icon={Users} label="Unique visitors" value={traffic.data ? traffic.data.totalUniqueVisitors : undefined} sub={`Last ${days} days · approx`} />
            <KpiCard
              icon={Globe}
              label="Countries"
              value={traffic.data ? traffic.data.countries.filter((c) => c.country !== "Unknown").length : undefined}
              sub="With at least 1 visit"
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <Header icon={Eye} title="Page views & visitors" subtitle={`Daily traffic · last ${days} days`} />
            {traffic.data ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={traffic.data.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={shortDay} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip wrapperStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="views" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.2} name="Views" />
                  <Area type="monotone" dataKey="visitors" stroke={COLORS[1]} fill={COLORS[1]} fillOpacity={0.15} name="Visitors" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-[220px]" />}
          </div>

          {/* World map */}
          <div className="rounded-xl border border-border bg-card p-5">
            <Header icon={Globe} title="Where visitors are coming from" subtitle="Choropleth by country, last selected window" />
            {traffic.data ? (
              <AdminWorldMap countries={traffic.data.countries} />
            ) : (
              <Skeleton className="h-[360px]" />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Top countries — precise ranking next to the map */}
            <div className="rounded-xl border border-border bg-card p-5">
              <Header icon={Globe} title="Top countries" subtitle="Visits by visitor country" />
              {traffic.data && traffic.data.countries.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(200, traffic.data.countries.length * 22)}>
                  <BarChart data={traffic.data.countries.slice(0, 12)} layout="vertical" margin={{ top: 5, right: 16, left: 30, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="country" type="category" tick={{ fontSize: 10 }} width={50} interval={0} tickFormatter={(c: string) => countryLabel(c)} />
                    <Tooltip wrapperStyle={{ fontSize: 11 }} formatter={(v) => formatBig(Number(v))} />
                    <Bar dataKey="count" fill={COLORS[2]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">No traffic data yet</p>
              )}
            </div>

            {/* Top pages */}
            <div className="rounded-xl border border-border bg-card p-5">
              <Header icon={FileText} title="Top pages" subtitle="Most-visited paths" />
              {traffic.data && traffic.data.pages.length > 0 ? (
                <ul className="text-xs divide-y divide-border/40 max-h-[280px] overflow-y-auto">
                  {traffic.data.pages.map((p) => (
                    <li key={p.path} className="flex items-center justify-between py-1.5">
                      <span className="font-mono truncate pr-2" title={p.path}>{p.path}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{p.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">No page data yet</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Devices */}
            <div className="rounded-xl border border-border bg-card p-5">
              <Header icon={Monitor} title="Devices" subtitle={`Last ${days} days`} />
              {traffic.data && traffic.data.devices.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={traffic.data.devices}
                      cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}
                      dataKey="count" nameKey="device"
                    >
                      {traffic.data.devices.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip wrapperStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-xs text-muted-foreground py-8 text-center">—</p>}
            </div>

            {/* Browsers */}
            <div className="rounded-xl border border-border bg-card p-5">
              <Header icon={Cpu} title="Browser / OS" subtitle="Top combos" />
              {traffic.data && traffic.data.browsers.length > 0 ? (
                <ul className="text-xs divide-y divide-border/40 max-h-[180px] overflow-y-auto">
                  {traffic.data.browsers.map((b) => (
                    <li key={b.ua} className="flex items-center justify-between py-1.5">
                      <span className="truncate pr-2">{b.ua}</span>
                      <span className="text-muted-foreground tabular-nums">{b.count}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground py-8 text-center">—</p>}
            </div>

            {/* Referrers */}
            <div className="rounded-xl border border-border bg-card p-5">
              <Header icon={ExternalLink} title="Referrers" subtitle="Where visitors came from" />
              {traffic.data && traffic.data.referrers.length > 0 ? (
                <ul className="text-xs divide-y divide-border/40 max-h-[180px] overflow-y-auto">
                  {traffic.data.referrers.map((r) => (
                    <li key={r.referrer} className="flex items-center justify-between py-1.5">
                      <span className="truncate pr-2">{r.referrer}</span>
                      <span className="text-muted-foreground tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground py-8 text-center">—</p>}
            </div>
          </div>
        </section>

        {/* Find feature */}
        <section className="rounded-xl border border-border bg-card p-5">
          <Header icon={Search} title="Find feature" subtitle="Slide-level semantic search" />
          {ov ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Source files" value={ov.find.sourceFiles} />
              <Stat label="Slides indexed" value={ov.find.slidesIndexed} />
              <Stat label="Avg slides / file" value={ov.find.sourceFiles > 0 ? (ov.find.slidesIndexed / ov.find.sourceFiles).toFixed(1) : "—"} />
              <Stat label="Coupon-redeemed" value={ov.users.couponRedeemed} />
            </div>
          ) : <Skeleton className="h-20" />}
        </section>

        {/* Users table */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between gap-3">
            <Header icon={Users} title="Users" subtitle={`${users.data?.total ?? 0} total — sorted by ${userSort}`} compact />
            <div className="flex items-center gap-2">
              <select
                value={userSort}
                onChange={(e) => setUserSort(e.target.value)}
                className="text-xs h-8 rounded-md border border-border bg-card px-2"
              >
                <option value="tokens">Most tokens</option>
                <option value="presentations">Most presentations</option>
                <option value="projects">Most projects</option>
                <option value="downloads">Most downloads</option>
                <option value="lastActive">Recently active</option>
                <option value="createdAt">Newest</option>
              </select>
              <Input
                placeholder="Filter by email or name"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="h-8 text-xs w-56"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">User</th>
                  <th className="text-left px-4 py-2 font-medium">Plan</th>
                  <th className="text-right px-4 py-2 font-medium">Projects</th>
                  <th className="text-right px-4 py-2 font-medium">Presentations</th>
                  <th className="text-right px-4 py-2 font-medium">Downloads</th>
                  <th className="text-right px-4 py-2 font-medium">Tokens</th>
                  <th className="text-right px-4 py-2 font-medium">Cost</th>
                  <th className="text-left px-4 py-2 font-medium">Models</th>
                  <th className="text-left px-4 py-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {users.isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
                ) : filteredUsers.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">No users match filter.</td></tr>
                ) : filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <p className="font-medium">{u.name || "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-4 py-2">
                      <PlanPill plan={u.plan} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.projects}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.presentations}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.downloads}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBig(u.tokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">${u.cost.toFixed(4)}</td>
                    <td className="px-4 py-2 max-w-xs">
                      <div className="flex flex-wrap gap-1">
                        {u.models.slice(0, 3).map((m) => (
                          <span key={m} className="text-[9.5px] bg-muted px-1.5 py-0.5 rounded font-mono">{m}</span>
                        ))}
                        {u.models.length > 3 && <span className="text-[9.5px] text-muted-foreground">+{u.models.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </motion.main>
    </div>
  );
}

// ─── Small components ────────────────────────────────────────────────────

function Header({ icon: Icon, title, subtitle, compact = false }: {
  icon: React.ElementType; title: string; subtitle?: string; compact?: boolean;
}) {
  return (
    <div className={compact ? "flex items-center gap-2" : "mb-3"}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {subtitle && <p className={`text-[10px] text-muted-foreground ${compact ? "ml-2" : "mt-0.5"}`}>{subtitle}</p>}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: number | string | undefined; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold tabular-nums mt-1">
        {value ?? <Skeleton className="h-6 w-16 inline-block" />}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ChartCard({
  title, subtitle, icon, data, color, kind, xKey, yKey,
}: {
  title: string; subtitle: string; icon: React.ElementType;
  data: Array<Record<string, unknown>> | undefined;
  color: string; kind: "bar" | "line"; xKey: string; yKey: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Header icon={icon} title={title} subtitle={subtitle} />
      {data ? (
        <ResponsiveContainer width="100%" height={180}>
          {kind === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} tickFormatter={shortDay} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey={yKey} fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} tickFormatter={shortDay} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      ) : <Skeleton className="h-[180px]" />}
    </div>
  );
}

function PlanPill({ plan }: { plan: string }) {
  if (plan.startsWith("coupon:")) {
    return (
      <span className="text-[10px] rounded-full px-2 py-0.5 bg-violet-500/15 text-violet-600 dark:text-violet-400 font-medium">
        {plan.replace("coupon:", "🎟 ")}
      </span>
    );
  }
  if (plan === "own_keys") {
    return (
      <span className="text-[10px] rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium">
        own keys
      </span>
    );
  }
  return (
    <span className="text-[10px] rounded-full px-2 py-0.5 bg-muted text-muted-foreground font-medium">
      free
    </span>
  );
}

function shortDay(d: string): string {
  return d.slice(5); // MM-DD
}

function formatBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ISO 3166-1 alpha-2 → flag emoji + label fallback. We just render code+flag.
function countryLabel(code: string): string {
  if (!code || code === "Unknown" || code.length !== 2) return code || "??";
  const A = 0x1f1e6;
  const flag = String.fromCodePoint(
    A + code.toUpperCase().charCodeAt(0) - 65,
    A + code.toUpperCase().charCodeAt(1) - 65,
  );
  return `${flag} ${code.toUpperCase()}`;
}
