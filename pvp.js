// pvp.js — Async PvP Module
// Uses Supabase as a free shared backend so teams persist across devices/users.
//
// SETUP (one-time, takes ~3 minutes):
// 1. Go to https://supabase.com and create a free account + new project
// 2. In your project, open the SQL Editor and run this query to create the table:
//
//    create table pvp_teams (
//      id uuid primary key default gen_random_uuid(),
//      team_name text not null,
//      owner_name text not null,
//      players jsonb not null,
//      wins integer default 0,
//      losses integer default 0,
//      submitted_at timestamptz default now()
//    );
//    -- Allow anyone to read and insert (public leaderboard style)
//    alter table pvp_teams enable row level security;
//    create policy "Anyone can read" on pvp_teams for select using (true);
//    create policy "Anyone can insert" on pvp_teams for insert with check (true);
//    create policy "Anyone can update wins/losses" on pvp_teams for update using (true);
//
// 3. Go to Project Settings > API and copy:
//    - "Project URL"  → paste as SUPABASE_URL below
//    - "anon public"  → paste as SUPABASE_ANON_KEY below

const SUPABASE_URL      = 'https://hvkyemupqatsupfgwjah.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2a3llbXVwcWF0c3VwZmd3amFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjQ5MzEsImV4cCI6MjA5MTAwMDkzMX0.EvGNPBqHqs81xQTHrUL1SrrMxdGRxCf2bitRV7uuDkE';

const HEADERS = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Prefer':        'return=representation'
};

// ── API HELPERS ──────────────────────────────────────────────────────────────

// Fetch all submitted PvP teams, newest first
export async function fetchPvpTeams() {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pvp_teams?order=submitted_at.desc&limit=50`,
        { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`Failed to fetch teams: ${res.statusText}`);
    return await res.json();
}

// Submit a new defensive team to the shared pool
export async function submitPvpTeam(teamName, ownerName, players) {
    // Only store the fields needed for simulation — no bloat
    const slim = players.map(p => ({
        player:       p.player,
        pos:          p.pos || 'SF',
        PPG:          p.PPG,
        Rarity:       p.Rarity,
        x2p_percent:  p.x2p_percent,
        x3p_percent:  p.x3p_percent,
        ft_percent:   p.ft_percent,
        STL_per_game: p.STL_per_game,
        BLK_per_game: p.BLK_per_game,
        TOV_per_game: p.TOV_per_game,
        REB_per_game: p.REB_per_game || p.TRB,
        FGA:          p.FGA,
        FTA:          p.FTA,
    }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/pvp_teams`, {
        method:  'POST',
        headers: HEADERS,
        body:    JSON.stringify({ team_name: teamName, owner_name: ownerName, players: slim })
    });
    if (!res.ok) throw new Error(`Failed to submit team: ${res.statusText}`);
    return await res.json();
}

// Record a win/loss after a PvP match against a specific team
export async function recordPvpResult(teamId, didWin) {
    // Use Supabase's RPC or a direct PATCH. We do a read-then-write here
    // since anon RLS policies don't support atomic increments without an RPC.
    const getRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pvp_teams?id=eq.${teamId}&select=wins,losses`,
        { headers: HEADERS }
    );
    const [current] = await getRes.json();
    if (!current) return;

    const patch = didWin
        ? { losses: (current.losses || 0) + 1 }  // opponent loses
        : { wins:   (current.wins   || 0) + 1 };  // opponent wins (you lost)

    await fetch(`${SUPABASE_URL}/rest/v1/pvp_teams?id=eq.${teamId}`, {
        method:  'PATCH',
        headers: HEADERS,
        body:    JSON.stringify(patch)
    });
}