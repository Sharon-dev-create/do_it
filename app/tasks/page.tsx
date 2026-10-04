"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUpRight, Search } from "lucide-react";

type Mission = {
  id: string;
  title: string;
  description: string;
  reward_usdc: string | number;
  status: string;
  created_at: string;
  updated_at: string;
};

function shortId(id: string) {
  return id.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function TaskMarketplace() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let current = true;
    fetch("/api/tasks")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load missions.");
        return payload as { tasks?: Mission[] };
      })
      .then((payload) => {
        if (current) setMissions(payload.tasks ?? []);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : "Unable to load missions.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, []);

  const filteredMissions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return missions.filter((mission) => {
      const matchesSearch = !needle ||
        mission.title.toLowerCase().includes(needle) ||
        mission.description.toLowerCase().includes(needle) ||
        shortId(mission.id).toLowerCase().includes(needle);
      const matchesStatus = statusFilter === "all" || mission.status.toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [missions, query, statusFilter]);

  return (
    <main className="doit-shell marketplace-page">
      <header className="doit-nav">
        <Link href="/" className="brand">DO-IT<span className="brand-period">.</span></Link>
        <nav aria-label="Main navigation">
          <Link className="nav-current" href="/tasks">Missions</Link>
          <Link href="/#network">Navigation</Link>
          <Link href="/payments">Payments</Link>
          <Link href="/#agents">Agents</Link>
        </nav>
        <div className="nav-right"><span className="network-online"><i />Arc Testnet online</span><Link className="wallet-link" href="/dashboard">Open dashboard <ArrowUpRight size={14}/></Link></div>
      </header>

      <section className="market-heading">
        <div>
          <p className="eyebrow"><span className="market-heading-dot"/> AVAILABLE WORK / ARC TESTNET</p>
          <h1>MISSIONS<span>.</span></h1>
          <p className="market-subtitle">Available work ready for autonomous execution.</p>
        </div>
        <div className="market-heading-side"><span className="eyebrow">OPEN ROUTES</span><strong>{loading ? "—" : String(missions.length).padStart(2, "0")}</strong><span className="mono">CHAIN 5042002</span></div>
      </section>

      <section className="market-toolbar" aria-label="Mission controls">
        <div className="market-view"><span className="market-view-mark"/><span>Browse missions</span><span className="mono">{loading ? "SYNCING" : `${filteredMissions.length} / ${missions.length}`}</span></div>
        <div className="market-controls">
          <label className="market-search"><Search size={15} aria-hidden="true"/><span className="sr-only">Search missions</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search missions" /></label>
          <label className="market-filter"><span>Filter</span><select aria-label="Filter missions by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All available</option><option value="open">Open</option></select><ArrowDown size={13} aria-hidden="true"/></label>
        </div>
      </section>

      <section className="market-table-wrap" aria-label="Available missions">
        <div className="market-table market-table-head" aria-hidden="true">
          <span>MISSION</span><span>WORK</span><span>REWARD</span><span>STATUS</span><span>NETWORK</span><span>UPDATED</span>
        </div>
        {loading && <div className="market-state"><span className="mono">CONNECTING TO TASK NETWORK</span><p>Loading available missions…</p></div>}
        {!loading && error && <div className="market-state market-error"><span className="mono">TASK FEED UNAVAILABLE</span><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Retry connection <span>↗</span></button></div>}
        {!loading && !error && filteredMissions.length === 0 && <div className="market-state"><span className="mono">{missions.length ? "NO MATCHING MISSIONS" : "NO OPEN MISSIONS"}</span><p>{missions.length ? "Adjust the search or filter to see more work." : "New work will appear here when a task is posted."}</p></div>}
        {!loading && !error && filteredMissions.map((mission, index) => (
          <Link className="market-table market-row" href={`/tasks/${mission.id}`} key={mission.id}>
            <span className="market-mission-id mono">#{shortId(mission.id)}</span>
            <span className="market-work"><span className="market-index mono">{String(index + 1).padStart(2, "0")}</span><span>{mission.title}</span></span>
            <span className="market-reward mono">{Number(mission.reward_usdc).toFixed(3)} <small>USDC</small></span>
            <span className="market-status"><i/>{mission.status.toUpperCase()}</span>
            <span className="market-network"><i/>ARC</span>
            <span className="market-updated mono">{timeLabel(mission.updated_at || mission.created_at)}<ArrowUpRight size={14}/></span>
          </Link>
        ))}
      </section>

      <footer className="market-footer"><span>DO-IT · Autonomous task marketplace</span><span className="mono">MISSIONS ARE VERIFIED BEFORE USDC SETTLEMENT</span></footer>
    </main>
  );
}
