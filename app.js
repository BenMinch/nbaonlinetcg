import { simulateGame } from './simulator.js';

// --- STATE MANAGEMENT ---
let db = [];
let coins = parseInt(localStorage.getItem('nbaCoins')) || 2000; 
let collection = JSON.parse(localStorage.getItem('nbaCollection')) || [];
let roster = JSON.parse(localStorage.getItem('nbaRoster')) || [];

const PACK_COST = 100;
const CARDS_PER_PACK = 7;

const RARITY_RATES = {
    'C': 50.0,
    'UC': 25.0,
    'R': 15.0,
    'SR': 7.0,
    'SSR': 2.0,
    'UR': 0.9,
    'LR': 0.1
};

// --- INITIALIZATION ---
async function init() {
    try {
        const res = await fetch('players.json');
        db = await res.json();
        
        // Sort DB roughly by overall quality to help segment CPU difficulties
        db.sort((a, b) => (parseFloat(b.PPG||0) + parseFloat(b.STL_per_game||0)) - (parseFloat(a.PPG||0) + parseFloat(a.STL_per_game||0)));

        updateUI();
        renderCollection();
    } catch (error) {
        console.error("Failed to load players.json. Ensure it is in the root directory.", error);
        document.getElementById('game-results').innerHTML = `<p style="color:red;">Error loading database: ${error.message}</p>`;
    }
}

function saveState() {
    localStorage.setItem('nbaCoins', coins);
    localStorage.setItem('nbaCollection', JSON.stringify(collection));
    localStorage.setItem('nbaRoster', JSON.stringify(roster));
    updateUI();
}

function updateUI() {
    document.getElementById('coin-balance').innerText = coins;
    document.getElementById('collection-count').innerText = collection.length;
    
    const rosterContainer = document.getElementById('starting-five-list');
    const requiredPositions = ['PG', 'SG', 'SF', 'PF', 'C'];
    
    rosterContainer.innerHTML = requiredPositions.map(pos => {
        const playerInSlot = roster.find(p => (p.pos || 'SF') === pos);
        
        if (playerInSlot) {
            return `
                <div class="slot filled">
                    <span class="pos-label">${pos}</span>
                    ${playerInSlot.player}<br>
                    <span style="font-size: 0.8em; opacity: 0.8;">(${playerInSlot.Rarity || 'C'})</span>
                </div>`;
        } else {
            return `
                <div class="slot empty">
                    <span class="pos-label">${pos}</span>
                    <em>Empty</em>
                </div>`;
        }
    }).join('');
}

// --- NAVIGATION ---
document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
        document.getElementById(e.target.id.replace('nav-', 'view-')).style.display = 'block';
    });
});

// --- PACK OPENING LOGIC ---
function pullCard() {
    let roll = Math.random() * 100;
    let cumulative = 0;
    let pulledRarity = 'C';

    for (const [rarity, rate] of Object.entries(RARITY_RATES)) {
        cumulative += rate;
        if (roll <= cumulative) {
            pulledRarity = rarity;
            break;
        }
    }

    // Build a pool of cards at this rarity that the player does NOT already own.
    // Falls back to the full rarity pool if they own everything at that tier,
    // and further falls back to any unowned card if the DB is tiny.
    const owned = new Set(collection.map(p => p.player));
    let pool = db.filter(p => p.Rarity === pulledRarity && !owned.has(p.player));
    if (pool.length === 0) pool = db.filter(p => !owned.has(p.player));
    if (pool.length === 0) return null; // Player owns every card in the DB

    return pool[Math.floor(Math.random() * pool.length)];
}

document.getElementById('open-pack-btn').addEventListener('click', () => {
    if (coins < PACK_COST) return alert("Not enough coins! Go win some games.");

    coins -= PACK_COST;
    const display = document.getElementById('new-cards-display');
    display.innerHTML = '';

    let newCardsThisPack = 0;
    let coinsRefunded = 0;

    for (let i = 0; i < CARDS_PER_PACK; i++) {
        const pulledPlayer = pullCard();

        // null means the player owns every card — refund the slot cost and skip
        if (!pulledPlayer) {
            const slotRefund = Math.round(PACK_COST / CARDS_PER_PACK);
            coinsRefunded += slotRefund;
            display.innerHTML += `
                <div class="card rarity-C" style="opacity:0.4;text-align:center;">
                    <em>Collection Complete!</em><br>
                    <span style="font-size:0.8em;">+${slotRefund} 🪙 refunded</span>
                </div>`;
            continue;
        }

        // Safe to add — guaranteed unique at this point
        collection.push(pulledPlayer);
        newCardsThisPack++;

        const safeRarity = pulledPlayer.Rarity || 'C';
        display.innerHTML += `
            <div class="card rarity-${safeRarity}">
                <span class="rarity-badge badge-${safeRarity}">${safeRarity}</span><br>
                <strong>${pulledPlayer.player}</strong><br>
                ${pulledPlayer.pos || 'SF'}<br>
                PPG: ${pulledPlayer.PPG || 0}
            </div>`;
    }

    // Apply any refunds for completed collection slots
    if (coinsRefunded > 0) coins += coinsRefunded;

    saveState();
    renderCollection();
});

// --- ROSTER BUILDER ---
function renderCollection() {
    const grid = document.getElementById('collection-grid');
    grid.innerHTML = '';

    // collection is guaranteed unique at the source (pullCard enforces this),
    // so no deduplication needed here — just sort and render.
    const rarityOrder = { 'LR': 7, 'UR': 6, 'SSR': 5, 'SR': 4, 'R': 3, 'UC': 2, 'C': 1 };
    const sorted = [...collection].sort((a, b) => (rarityOrder[b.Rarity||'C'] || 0) - (rarityOrder[a.Rarity||'C'] || 0));

    sorted.forEach(p => {
        const div = document.createElement('div');
        const safeRarity = p.Rarity || 'C';
        
        div.className = `card rarity-${safeRarity} ${roster.find(r => r.player === p.player) ? 'selected' : ''}`;
        div.innerHTML = `
            <span class="rarity-badge badge-${safeRarity}">${safeRarity}</span><br>
            <strong>${p.player}</strong><br>
            ${p.pos || 'SF'}<br>
            PPG: ${p.PPG || 0}`;
        
        div.onclick = () => {
            const existingPlayerIndex = roster.findIndex(r => r.player === p.player);
            const cardPosition = p.pos || 'SF';

            if (existingPlayerIndex > -1) {
                roster.splice(existingPlayerIndex, 1);
            } else {
                const isPositionFilled = roster.some(r => (r.pos || 'SF') === cardPosition);
                
                if (isPositionFilled) {
                    return alert(`You already have a ${cardPosition} in your starting lineup! Remove them first.`);
                }
                
                roster.push(p);
            }
            
            saveState();
            renderCollection();
        };
        grid.appendChild(div);
    });
}

// --- SIMULATION & CPU MATCHMAKING ---
function getPlayersByRarity(rarity, count) {
    let pool = db.filter(p => p.Rarity === rarity);
    if (pool.length === 0) pool = db;
    let selection = [];
    for(let i=0; i<count; i++) {
        selection.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return selection;
}

function getCPUOpponent(difficulty) {
    if (difficulty === 'easy') return getPlayersByRarity('UC', 5);
    if (difficulty === 'medium') return getPlayersByRarity('SR', 5);
    if (difficulty === 'hard') {
        return [...getPlayersByRarity('SSR', 4), ...getPlayersByRarity('LR', 1)];
    }
    if (difficulty === 'pro') {
        return [...getPlayersByRarity('UR', 3), ...getPlayersByRarity('LR', 2)];
    }
    return getPlayersByRarity('C', 5);
}

let pendingReward = 0;

// =============================================================================
// ANIMATE GAME — Realistic quarter-by-quarter scoreboard with discrete events
// =============================================================================
function animateGame(results, rewardAmount) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById('view-live-game').style.display = 'block';
    document.getElementById('post-game-panel').style.display = 'none';
    document.getElementById('live-t1-name').innerText = results.team1.name;
    document.getElementById('live-t2-name').innerText = results.team2.name;

    pendingReward = rewardAmount;

    // ── QUARTER BREAKDOWN ENGINE ─────────────────────────────────────────────
    // Split each team's final score into realistic per-quarter totals.
    // OT periods get ~35% the weight of a full quarter.
    function splitIntoQuarters(totalScore, numPeriods) {
        let weights = [];
        for (let i = 0; i < numPeriods; i++) {
            const isOT = i >= 4;
            weights.push(Math.max(0.3, (Math.random() * 0.6) + (isOT ? 0.2 : 0.7)));
        }
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let periods = weights.map(w => Math.round((w / totalWeight) * totalScore));

        // Fix rounding drift so sum exactly equals totalScore
        const drift = totalScore - periods.reduce((a, b) => a + b, 0);
        periods[periods.length - 1] += drift;
        return periods;
    }

    // ── SCORING EVENT BUILDER ────────────────────────────────────────────────
    // Convert each quarter's point total into discrete scoring plays
    // (2PT, 3PT, and-1s, FTs) that fire at random moments within that quarter.
    function buildScoringEvents(quarterScores) {
        let events = [];
        const totalTicks = 2880; // 48 min × 60 sec

        quarterScores.forEach((qScore, qIdx) => {
            const qStart = qIdx * 720;
            const qEnd   = qStart + 720;
            let remaining = qScore;

            while (remaining > 0) {
                let roll = Math.random();
                let pts, type;
                if (remaining >= 3 && roll < 0.28)      { pts = 3; type = '3PT';  }
                else if (remaining >= 3 && roll < 0.35) { pts = 3; type = 'AND1'; }
                else if (remaining >= 2 && roll < 0.90) { pts = 2; type = '2PT';  }
                else if (remaining >= 1)                 { pts = 1; type = 'FT';   }
                else break;

                pts = Math.min(pts, remaining);
                const tick = Math.floor(qStart + Math.random() * (qEnd - qStart));
                events.push({ tick, points: pts, type, quarter: qIdx + 1 });
                remaining -= pts;
            }
        });

        events.sort((a, b) => a.tick - b.tick);
        return events;
    }

    // ── SETUP ────────────────────────────────────────────────────────────────
    const numPeriods = 4 + (results.overtimePeriods || 0);

    const t1Quarters = splitIntoQuarters(results.team1.score, numPeriods);
    const t2Quarters = splitIntoQuarters(results.team2.score, numPeriods);

    const t1Events = buildScoringEvents(t1Quarters);
    const t2Events = buildScoringEvents(t2Quarters);

    // Running per-quarter score totals (updated live)
    const t1QtrRunning = new Array(numPeriods).fill(0);
    const t2QtrRunning = new Array(numPeriods).fill(0);

    // ── PLAYER STAT TIMELINE ─────────────────────────────────────────────────
    // Each player gets a "hot quarter" where more of their stats land,
    // creating natural star performances rather than linear growth.
    function buildPlayerTimeline(boxScore) {
        return boxScore.map(player => {
            const hotQtr = Math.floor(Math.random() * 4);
            const qWeights = [0, 1, 2, 3].map(q => {
                let w = 0.2 + Math.random() * 0.15;
                if (q === hotQtr) w += 0.25;
                return w;
            });
            const wSum = qWeights.reduce((a, b) => a + b, 0);
            const qNorm = qWeights.map(w => w / wSum);

            // Cumulative % of stats completed after each quarter
            const cumPct = qNorm.reduce((acc, w, i) => {
                acc.push((acc[i - 1] || 0) + w);
                return acc;
            }, []);

            return { ...player, cumPct };
        });
    }

    const t1Timeline = buildPlayerTimeline(results.team1.boxScore);
    const t2Timeline = buildPlayerTimeline(results.team2.boxScore);

    // ── MOMENTUM / RUN DETECTION ─────────────────────────────────────────────
    let recentEvents = [];
    let runBannerTimeout = null;

    function checkForRun(team, pts) {
        recentEvents.push({ team, pts });
        if (recentEvents.length > 12) recentEvents.shift();

        const window = recentEvents.slice(-8);
        const t1Run = window.filter(e => e.team === 't1').reduce((s, e) => s + e.pts, 0);
        const t2Run = window.filter(e => e.team === 't2').reduce((s, e) => s + e.pts, 0);

        let runMsg = null;
        if (t1Run >= 8 && t2Run === 0)  runMsg = `🔥 ${results.team1.name} on a ${t1Run}-0 RUN!`;
        if (t2Run >= 8 && t1Run === 0)  runMsg = `🔥 ${results.team2.name} on a ${t2Run}-0 RUN!`;
        if (t1Run >= 10 && t2Run > 0)   runMsg = `💥 ${results.team1.name} on a ${t1Run}-${t2Run} RUN!`;
        if (t2Run >= 10 && t1Run > 0)   runMsg = `💥 ${results.team2.name} on a ${t2Run}-${t1Run} RUN!`;

        if (runMsg) flashBanner(runMsg);
    }

    function flashBanner(msg) {
        let banner = document.getElementById('run-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'run-banner';
            banner.style.cssText = `
                position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
                background: #ff6b00; color: #fff; font-weight: 900; font-size: 1rem;
                padding: 8px 20px; border-radius: 6px; z-index: 9999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                transition: opacity 0.5s;
                pointer-events: none;
            `;
            document.body.appendChild(banner);
        }
        banner.innerText = msg;
        banner.style.opacity = '1';
        clearTimeout(runBannerTimeout);
        runBannerTimeout = setTimeout(() => { banner.style.opacity = '0'; }, 2800);
    }

    // ── TICK → EVENT INDEX MAPPING ───────────────────────────────────────────
    const GAME_SECONDS = 2880;
    const TICK_MS      = 100;
    const TOTAL_TICKS  = 300;

    function mapEventToTick(event) {
        return Math.floor((event.tick / GAME_SECONDS) * TOTAL_TICKS);
    }

    const t1EventQueue = {};
    const t2EventQueue = {};
    t1Events.forEach(e => {
        const t = mapEventToTick(e);
        if (!t1EventQueue[t]) t1EventQueue[t] = [];
        t1EventQueue[t].push(e);
    });
    t2Events.forEach(e => {
        const t = mapEventToTick(e);
        if (!t2EventQueue[t]) t2EventQueue[t] = [];
        t2EventQueue[t].push(e);
    });

    // ── QUARTER SCORELINE RENDERER ───────────────────────────────────────────
    function renderQuarterScoreline() {
        const el = document.getElementById('live-quarter-line');
        if (!el) return;

        const labels = ['Q1', 'Q2', 'Q3', 'Q4'];
        for (let i = 4; i < numPeriods; i++) labels.push(`OT${i - 3}`);

        const gameSecElapsed = Math.floor((ticks / TOTAL_TICKS) * GAME_SECONDS);
        const currentQtr = Math.min(numPeriods - 1, Math.floor(gameSecElapsed / 720));

        const el1 = results.team1.name.split(' ').pop();
        const el2 = results.team2.name.split(' ').pop();

        el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.78rem;text-align:center;">
            <tr style="color:#888;">
                <th style="text-align:left;padding:2px 4px;">Team</th>
                ${labels.map((l, i) => `<th style="padding:2px 6px;${i === currentQtr ? 'color:#ff6b00;' : ''}">${l}</th>`).join('')}
                <th style="padding:2px 6px;font-weight:900;">TOT</th>
            </tr>
            <tr>
                <td style="text-align:left;padding:2px 4px;font-weight:700;">${el1}</td>
                ${t1QtrRunning.map((s, i) => `<td style="padding:2px 6px;${i === currentQtr ? 'color:#ff6b00;font-weight:700;' : ''}">${i <= currentQtr ? s : '-'}</td>`).join('')}
                <td style="padding:2px 6px;font-weight:900;">${currentT1Score}</td>
            </tr>
            <tr>
                <td style="text-align:left;padding:2px 4px;font-weight:700;">${el2}</td>
                ${t2QtrRunning.map((s, i) => `<td style="padding:2px 6px;${i === currentQtr ? 'color:#ff6b00;font-weight:700;' : ''}">${i <= currentQtr ? s : '-'}</td>`).join('')}
                <td style="padding:2px 6px;font-weight:900;">${currentT2Score}</td>
            </tr>
        </table>`;
    }

    // ── LIVE BOX SCORE RENDERER ──────────────────────────────────────────────
    function renderLiveBoxScore(timeline, containerId, paceRatio) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const qtrIndex = Math.min(numPeriods - 1, Math.floor(paceRatio * numPeriods));

        el.innerHTML = timeline.map(player => {
            const pct     = player.cumPct[Math.min(qtrIndex, player.cumPct.length - 1)];
            const prevPct = qtrIndex > 0 ? player.cumPct[qtrIndex - 1] : 0;
            const qtrProgress = (paceRatio * numPeriods) - qtrIndex;
            const interpolated = prevPct + (pct - prevPct) * qtrProgress;
            const ratio = Math.max(0, Math.min(1, interpolated));

            const livePts = Math.floor(player.pts * ratio);
            const liveAst = Math.floor((player.ast || 0) * ratio);
            const liveReb = Math.floor((player.reb || 0) * ratio);
            const liveTov = Math.floor((player.tov || 0) * ratio);

            const fgParts  = player.fg.split('-');
            const liveFGM  = Math.floor(parseInt(fgParts[0] || 0) * ratio);
            const liveFGA  = Math.floor(parseInt(fgParts[1] || 0) * ratio);
            const fg3Parts = player.fg3.split('-');
            const live3M   = Math.floor(parseInt(fg3Parts[0] || 0) * ratio);
            const live3A   = Math.floor(parseInt(fg3Parts[1] || 0) * ratio);

            const isHot   = player.gameForm && player.gameForm >= 1.10;
            const isCold  = player.gameForm && player.gameForm <= 0.88;
            const formDot = isHot ? ' 🔥' : (isCold ? ' 🧊' : '');
            const fouledNote = player.fouledOut
                ? ' <span style="color:#e55;font-size:0.72rem;">FOULED OUT</span>'
                : '';

            return `<li style="
                display:flex;justify-content:space-between;align-items:flex-start;
                padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);gap:8px;
            ">
                <div style="flex:1;min-width:0;">
                    <strong style="font-size:0.88rem;color:#111;">${player.player}${formDot}</strong>${fouledNote}
                    <span style="font-size:0.74rem;color:#666;margin-left:4px;">${player.pos}</span><br>
                    <span style="font-size:0.74rem;color:#555;">
                        FG ${liveFGM}/${liveFGA} &nbsp;|&nbsp; 3P ${live3M}/${live3A}
                    </span>
                </div>
                <div style="text-align:right;white-space:nowrap;">
                    <span class="live-pts-val">${livePts}</span>
                    <span style="font-size:0.7rem;color:#555;"> PTS</span><br>
                    <span class="live-sub-stat" style="font-size:0.72rem;">
                        ${liveReb}R &nbsp;${liveAst}A &nbsp;${liveTov}TO
                    </span>
                </div>
            </li>`;
        }).join('');
    }

    // ── SCORE FLASH ANIMATION ────────────────────────────────────────────────
    function flashScore(elId) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.style.transition = 'color 0.1s, transform 0.1s';
        el.style.color = '#ff6b00';
        el.style.transform = 'scale(1.18)';
        setTimeout(() => {
            el.style.color = '';
            el.style.transform = '';
        }, 350);
    }

    // ── PLAYBACK STATE ───────────────────────────────────────────────────────
    let ticks          = 0;
    let currentT1Score = 0;
    let currentT2Score = 0;
    let lastT1Score    = 0;
    let lastT2Score    = 0;

    // ── MAIN TICK LOOP ───────────────────────────────────────────────────────
    const interval = setInterval(() => {
        ticks++;

        // Fire all scoring events that land on this tick
        (t1EventQueue[ticks] || []).forEach(e => {
            currentT1Score += e.points;
            const qtr = Math.min(e.quarter - 1, numPeriods - 1);
            t1QtrRunning[qtr] = (t1QtrRunning[qtr] || 0) + e.points;
            checkForRun('t1', e.points);
        });
        (t2EventQueue[ticks] || []).forEach(e => {
            currentT2Score += e.points;
            const qtr = Math.min(e.quarter - 1, numPeriods - 1);
            t2QtrRunning[qtr] = (t2QtrRunning[qtr] || 0) + e.points;
            checkForRun('t2', e.points);
        });

        // Flash score display on change
        if (currentT1Score !== lastT1Score) { flashScore('live-t1-score'); lastT1Score = currentT1Score; }
        if (currentT2Score !== lastT2Score) { flashScore('live-t2-score'); lastT2Score = currentT2Score; }

        // Force exact totals at final buzzer
        if (ticks >= TOTAL_TICKS) {
            currentT1Score = results.team1.score;
            currentT2Score = results.team2.score;
        }

        // Update scoreboard
        document.getElementById('live-t1-score').innerText = currentT1Score;
        document.getElementById('live-t2-score').innerText = currentT2Score;

        // Update game clock
        const timePercent     = ticks / TOTAL_TICKS;
        const gameSecondsLeft = Math.max(0, GAME_SECONDS - Math.floor(GAME_SECONDS * timePercent));
        const periodSeconds   = gameSecondsLeft % 720;
        const mins = Math.floor(periodSeconds / 60);
        const secs = periodSeconds % 60;
        document.getElementById('live-time').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;

        // Update quarter label
        const periodIndex   = numPeriods - 1 - Math.floor(gameSecondsLeft / 720);
        const clampedPeriod = Math.min(Math.max(periodIndex, 0), numPeriods - 1);
        const qtrLabels = ['1ST', '2ND', '3RD', '4TH'];
        for (let i = 4; i < numPeriods; i++) qtrLabels.push(`OT${i - 3}`);
        document.getElementById('live-quarter').innerText = `${qtrLabels[clampedPeriod]} QTR`;

        // Render quarter scoreline table
        renderQuarterScoreline();

        // Render live box scores
        renderLiveBoxScore(t1Timeline, 'live-t1-roster', timePercent);
        renderLiveBoxScore(t2Timeline, 'live-t2-roster', timePercent);

        // ── END GAME ─────────────────────────────────────────────────────────
        if (ticks >= TOTAL_TICKS) {
            clearInterval(interval);

            const msgObj = document.getElementById('post-game-message');
            if (results.team1.score > results.team2.score) {
                msgObj.innerText = `YOU WIN! Earned ${pendingReward} 🪙`;
                msgObj.style.color = 'green';
                coins += pendingReward;
                saveState();
            } else {
                msgObj.innerText = `YOU LOSE! No coins earned.`;
                msgObj.style.color = 'red';
            }

            if (results.overtimePeriods > 0) {
                flashBanner(`FINAL — ${results.overtimePeriods > 1 ? results.overtimePeriods + 'x ' : ''}OVERTIME!`);
            }

            document.getElementById('post-game-panel').style.display = 'block';
        }

    }, TICK_MS);
}

// --- CPU GAME BUTTON LISTENERS ---
// NOTE: Only one listener set is needed — the duplicate below has been removed.
document.querySelectorAll('.sim-cpu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (roster.length !== 5) return alert("You need exactly 5 players to play!");
        
        const difficulty = e.target.getAttribute('data-diff');
        const cpuTeam = getCPUOpponent(difficulty);
        const rewards = { 'easy': 100, 'medium': 200, 'hard': 300, 'pro': 500 };
        
        const results = simulateGame("Your Team", roster, `CPU (${difficulty.toUpperCase()})`, cpuTeam);
        animateGame(results, rewards[difficulty]);
    });
});

// --- POST-GAME RETURN BUTTON ---
document.getElementById('claim-rewards-btn').addEventListener('click', () => {
    document.getElementById('view-live-game').style.display = 'none';
    document.getElementById('view-play').style.display = 'block';
});

// --- PROCESS GAME RESULT (used by PvP fallback) ---
function processGameResult(results, rewardAmount) {
    let resultHTML = `<h3>FINAL SCORE</h3>
        <p>${results.team1.name}: ${results.team1.score}</p>
        <p>${results.team2.name}: ${results.team2.score}</p>`;

    if (results.team1.score > results.team2.score) {
        coins += rewardAmount;
        saveState();
        resultHTML += `<h3 style="color:green">YOU WIN! Earned ${rewardAmount} 🪙</h3>`;
    } else {
        resultHTML += `<h3 style="color:red">YOU LOSE! No coins earned.</h3>`;
    }

    resultHTML += `<h4>Your Box Score</h4><pre>${results.team1.boxScore.map(p =>
        `${p.player.padEnd(20)} | PTS: ${p.pts.toString().padStart(2)} | FG: ${p.fg} | REB: ${(p.reb||0)} | AST: ${(p.ast||0)} | TO: ${(p.tov||0)}`
    ).join('\n')}</pre>`;
    document.getElementById('game-results').innerHTML = resultHTML;
}

// --- PVP MATCHMAKING (Mock) ---
document.getElementById('sim-pvp-btn').addEventListener('click', () => {
    if (roster.length !== 5) return alert("You need exactly 5 players to play PvP!");
    
    let mockOpponentTeam = [];
    for(let i=0; i<5; i++) mockOpponentTeam.push(db[Math.floor(Math.random() * 80)]);
    
    const results = simulateGame("Your Team", roster, "Rival Player", mockOpponentTeam);

    // PvP uses the full animated scoreboard too
    animateGame(results, 500);
});

// --- ADD THIS TO YOUR HTML inside #view-live-game, between scoreboard and rosters:
// <div id="live-quarter-line" style="
//     padding: 8px 12px;
//     background: rgba(255,255,255,0.04);
//     border-radius: 6px;
//     margin: 8px 0;
//     color: #ccc;
// "></div>

init();