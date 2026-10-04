"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { usePaymentEvents } from "@/hooks/use-transactions";

type Task = {
  id: string;
  title: string;
  description: string;
  reward_usdc: number | string;
  status: string;
  created_at: string;
};

function OrbitalDiagram() {
  return (
    <svg className="orbit-svg" viewBox="0 0 720 480" role="img" aria-label="A mission route through task intake, verification, Arc settlement, and a worker">
      <defs>
        <pattern id="orbitTicks" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M4 0v3" stroke="#b9b8b6" strokeWidth="1" />
        </pattern>
      </defs>
      <g fill="none" stroke="#dedddb" strokeWidth="1">
        {[54, 92, 130, 168, 206, 244, 282, 320, 358, 396].map((r) => <circle key={r} cx="350" cy="214" r={r} />)}
      </g>
      <circle cx="350" cy="214" r="206" fill="none" stroke="url(#orbitTicks)" strokeWidth="12" />
      <path d="M126 332 C82 278 111 165 204 129" fill="none" stroke="#202020" strokeWidth="2" />
      <path d="M204 129 C271 83 357 91 408 105 S517 148 557 184" fill="none" stroke="#e87513" strokeWidth="2.5" strokeDasharray="9 8" />
      <path d="M557 184 C609 223 608 292 577 332" fill="none" stroke="#b7b6b4" strokeWidth="2" strokeDasharray="2 7" />
      <circle cx="126" cy="332" r="7" fill="#202020" />
      <circle cx="204" cy="129" r="7" fill="#202020" />
      <circle cx="408" cy="105" r="15" fill="#f4f3f1" stroke="#e87513" strokeWidth="2" />
      <circle cx="408" cy="105" r="7" fill="#e87513" />
      <circle cx="557" cy="184" r="7" fill="#f4f3f1" stroke="#202020" strokeWidth="2" />
      <circle cx="577" cy="332" r="7" fill="#f4f3f1" stroke="#202020" strokeWidth="2" />
      <g className="orbit-labels" fill="#777674" fontFamily="monospace" fontSize="9" letterSpacing="1.2">
        <text x="63" y="358">TASK INTAKE</text><text x="178" y="111">VERIFY</text>
        <text x="384" y="75">ARC</text><text x="553" y="168">WORKER</text>
        <text x="333" y="219">ARC / 5042002</text>
      </g>
      <g fill="#aaa9a7" fontFamily="monospace" fontSize="8">
        <text x="35" y="30">ROUTE / 01</text><text x="620" y="30">LIVE NETWORK</text>
        <text x="625" y="448">N 37° 48′ 12″</text>
      </g>
    </svg>
  );
}

function RoutePanel({ kind }: { kind: "contours" | "settlement" | "network" }) {
  if (kind === "settlement") return <svg viewBox="0 0 360 150" aria-hidden="true"><path d="M20 35h95l90 82h135M20 75h320M20 115h105l85-80h130" fill="none" stroke="#777674" strokeWidth="1.5"/><path d="M20 75h320" fill="none" stroke="#e87513" strokeWidth="2"/><g fill="#202020"><circle cx="87" cy="35" r="5"/><circle cx="263" cy="117" r="5"/></g><g fill="#f4f3f1" stroke="#e87513" strokeWidth="2"><circle cx="151" cy="75" r="7"/><circle cx="250" cy="75" r="7"/></g><circle cx="250" cy="75" r="3" fill="#e87513"/></svg>;
  if (kind === "network") return <svg viewBox="0 0 360 150" aria-hidden="true"><g fill="none" stroke="#d8d7d5">{[35,56,77,98,119,140].map((r)=><ellipse key={r} cx="180" cy="75" rx={r*1.25} ry={r*.55} transform="rotate(-18 180 75)" />)}</g><path d="M49 111c59-75 106-93 160-37 36 37 67 34 106-3" fill="none" stroke="#e87513" strokeWidth="2"/><circle cx="209" cy="74" r="8" fill="#e87513"/><circle cx="209" cy="74" r="15" fill="none" stroke="#e87513"/></svg>;
  return <svg viewBox="0 0 360 150" aria-hidden="true"><g fill="none" stroke="#d8d7d5">{Array.from({length:8},(_,i)=><path key={i} d={`M-10 ${18+i*18} C75 ${-4+i*15} 90 ${145-i*12} 170 ${68+i*2} S270 ${20+i*8} 375 ${50+i*12}`} />)}</g><path d="M36 147C68 92 93 44 151 54s67 71 108 59 34-39 71-42" fill="none" stroke="#e87513" strokeWidth="2"/><circle cx="259" cy="113" r="5" fill="#e87513"/></svg>;
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const { events } = usePaymentEvents();

  useEffect(() => {
    let active = true;
    fetch("/api/tasks")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { tasks?: Task[] }) => { if (active) setTasks(data.tasks ?? []); })
      .catch(() => { if (active) setTasks([]); })
      .finally(() => { if (active) setTasksLoading(false); });
    return () => { active = false; };
  }, []);

  const settledToday = useMemo(() => events.filter((event) => new Date(event.created_at).toDateString() === new Date().toDateString()).reduce((total, event) => total + Number(event.amount_usdc || 0), 0), [events]);
  const latestTasks = tasks.slice(0, 4);

  return (
    <main className="doit-shell">
      <header className="doit-nav">
        <Link href="/" className="brand">DO-IT<span className="brand-period">.</span></Link>
        <nav aria-label="Main navigation">
          <a href="#missions">Missions</a><a href="#network">Navigation</a><Link href="/payments">Payments</Link><a href="#agents">Agents</a>
        </nav>
        <div className="nav-right"><span className="network-online"><i />Arc Testnet online</span><Link className="wallet-link" href="/dashboard">Open dashboard <ArrowUpRight size={14}/></Link></div>
      </header>

      <section className="hero">
        <p className="eyebrow"><span /> AUTONOMOUS TASK NETWORK <span className="eyebrow-code">ARC / 5042002</span></p>
        <h1><span>Autonomous work.</span><span className="hero-muted">On course.</span></h1>
        <p className="hero-copy">Tasks become missions. Agents execute them.<br className="desktop-break"/> Verified work triggers automatic USDC settlement on Arc.</p>
        <div className="hero-actions"><Link href="/create-task" className="button-dark">Create task <ArrowUpRight size={15}/></Link><a href="#missions" className="text-action">Browse missions <span>→</span></a></div>
      </section>

      <section className="overview-grid" aria-label="Network overview">
        <article className="orbit-card" id="network">
          <div className="orbit-meta"><span className="eyebrow">NETWORK / ROUTE MAP</span><span className="eyebrow mono">01 — 04</span></div>
          <OrbitalDiagram />
          <div className="mission-caption"><div><span className="eyebrow">FEATURED ROUTE</span><h2>Task <span className="mono">84291</span></h2></div><p><i /> In transit <span>·</span> Task, Verification, Arc, Worker <span>·</span> <b className="mono">0.004 USDC</b></p></div>
        </article>
        <aside className="metrics-column">
          <article className="settled-panel"><span className="eyebrow">SETTLED TODAY <span className="live-dot" /></span><p className="settled-amount">{settledToday.toFixed(2)}<small>USDC</small></p><span className="settled-note">Recorded payments · Arc Testnet</span></article>
          <article className="metrics-panel">
            <div className="metric-row"><span>Open missions</span><strong>{tasksLoading ? "—" : String(tasks.length).padStart(2, "0")}</strong></div>
            <div className="metric-row" id="agents"><span>Agents in flight</span><strong>—</strong></div>
            <div className="metric-row"><span>Payments in transit</span><strong>—</strong></div>
            <p className="metrics-footnote">Live counts appear as network-wide agent and task-payment feeds become available.</p>
          </article>
        </aside>
      </section>

      <section className="route-grid" aria-label="How missions move through the network">
        <article className="route-card"><div className="route-graphic"><RoutePanel kind="contours"/></div><div className="route-copy"><span className="eyebrow">01 / NAVIGATION</span><h3>Mission trajectories</h3><p>Open work is routed toward an available worker.</p></div></article>
        <article className="route-card route-dark"><div className="route-graphic"><RoutePanel kind="settlement"/></div><div className="route-copy"><span className="eyebrow">02 / SETTLEMENT</span><h3>One verified route</h3><p>Task <span className="mono">→</span> Verify <span className="mono">→</span> Arc <span className="mono">→</span> Worker</p></div></article>
        <article className="route-card"><div className="route-graphic"><RoutePanel kind="network"/></div><div className="route-copy"><span className="eyebrow">03 / NETWORK</span><h3>Agents in motion</h3><p>Work advances through a shared task network.</p></div></article>
      </section>

      <section className="missions-section" id="missions">
        <div className="section-heading"><div><span className="eyebrow">OPEN WORK / ARC TESTNET</span><h2>Missions</h2></div><a href="#missions" className="text-action">View all <span>→</span></a></div>
        {latestTasks.length ? <div className="mission-table"><div className="table-head"><span>MISSION</span><span>TYPE</span><span>REWARD</span><span>STATUS</span></div>{latestTasks.map((task,index)=><Link className="mission-row" href={`/tasks/${task.id}`} key={task.id}><span className="mission-id mono">#{task.id.slice(0,8).toUpperCase()}</span><span className="mission-title">{task.title}</span><span className="reward mono">{Number(task.reward_usdc).toFixed(3)} USDC</span><span className="status-open"><i/> Open <span className="row-arrow">↗</span></span></Link>)}</div> : <div className="empty-missions"><span className="mono">{tasksLoading ? "SYNCING TASK FEED…" : "NO OPEN MISSIONS"}</span><p>{tasksLoading ? "Connecting to the task network." : "New tasks will appear here when they are posted."}</p><Link href="/create-task">Launch a mission <span>→</span></Link></div>}
      </section>

      <section className="closing-panel"><div><span className="eyebrow">DO-IT / MISSION CONTROL</span><h2>Ready for a<br/>new mission.</h2><p>Launch work into the network and let autonomous workers execute it.</p><Link href="/create-task" className="button-light">Create task <ArrowUpRight size={15}/></Link></div><div className="event-log"><span>NETWORK LOG / LIVE FEED</span><p><b>01</b> Mission routes to verification</p><p><b>02</b> Work checked against task criteria</p><p><b>03</b> USDC settlement on Arc</p><p className="log-current"><b>04</b> Awaiting next mission<span className="cursor-dot"/></p></div></section>
      <footer className="doit-footer"><span>DO-IT · Autonomous task marketplace</span><span className="mono">USDC&nbsp; · &nbsp;ARC TESTNET&nbsp; · &nbsp;CHAIN 5042002</span></footer>
    </main>
  );
}
