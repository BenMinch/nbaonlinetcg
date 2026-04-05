import { simulateGame } from './simulator.js';

// --- STATE MANAGEMENT ---
let db = [];
let coins = parseInt(localStorage.getItem('nbaCoins')) || 2000; 
let collection = JSON.parse(localStorage.getItem('nbaCollection')) || [];
let roster = JSON.parse(localStorage.getItem('nbaRoster')) || [];

const PACK_COST = 100;
const CARDS_PER_PACK = 15;

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
    
    const rosterList = document.getElementById('starting-five-list');
    rosterList.innerHTML = roster.map(p => `<li>${p.player} <span style="font-size: 0.8em; opacity: 0.8;">(${p.Rarity || 'C'})</span></li>`).join('');
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

    const pool = db.filter(p => p.Rarity === pulledRarity);
    if (pool.length === 0) return db[Math.floor(Math.random() * db.length)];
    return pool[Math.floor(Math.random() * pool.length)];
}

document.getElementById('open-pack-btn').addEventListener('click', () => {
    if (coins < PACK_COST) return alert("Not enough coins! Go win some games.");
    
    coins -= PACK_COST;
    const display = document.getElementById('new-cards-display');
    display.innerHTML = '';
    
    for(let i=0; i < CARDS_PER_PACK; i++) {
        const pulledPlayer = pullCard();
        collection.push(pulledPlayer);
        
        const safeRarity = pulledPlayer.Rarity || 'C';
        display.innerHTML += `
            <div class="card rarity-${safeRarity}">
                <span class="rarity-badge badge-${safeRarity}">${safeRarity}</span><br>
                <strong>${pulledPlayer.player}</strong><br>
                ${pulledPlayer.pos || 'SF'}<br>
                PPG: ${pulledPlayer.PPG || 0}
            </div>`;
    }
    
    saveState();
    renderCollection();
});

// --- ROSTER BUILDER ---
function renderCollection() {
    const grid = document.getElementById('collection-grid');
    grid.innerHTML = '';
    
    // Display only unique cards to prevent UI clutter
    const uniqueCards = [...new Map(collection.map(item => [item.player, item])).values()];
    
    // Sort by rarity roughly (LR first, C last) for better visual organization
    const rarityOrder = { 'LR': 7, 'UR': 6, 'SSR': 5, 'SR': 4, 'R': 3, 'UC': 2, 'C': 1 };
    uniqueCards.sort((a, b) => (rarityOrder[b.Rarity||'C'] || 0) - (rarityOrder[a.Rarity||'C'] || 0));
    
    uniqueCards.forEach(p => {
        const div = document.createElement('div');
        const safeRarity = p.Rarity || 'C';
        
        div.className = `card rarity-${safeRarity} ${roster.find(r => r.player === p.player) ? 'selected' : ''}`;
        div.innerHTML = `
            <span class="rarity-badge badge-${safeRarity}">${safeRarity}</span><br>
            <strong>${p.player}</strong><br>
            ${p.pos || 'SF'}<br>
            PPG: ${p.PPG || 0}`;
        
        div.onclick = () => {
            if (roster.find(r => r.player === p.player)) {
                roster = roster.filter(r => r.player !== p.player);
            } else {
                if (roster.length >= 5) return alert("Roster full! Remove someone first.");
                roster.push(p);
            }
            saveState();
            renderCollection();
        };
        grid.appendChild(div);
    });
}

// --- SIMULATION & CPU MATCHMAKING ---
function getCPUOpponent(difficulty) {
    let pool;
    if (difficulty === 'pro') pool = db.slice(0, 30);
    else if (difficulty === 'hard') pool = db.slice(30, 100);
    else if (difficulty === 'medium') pool = db.slice(100, 250);
    else pool = db.slice(250);

    let cpuTeam = [];
    for(let i=0; i<5; i++) cpuTeam.push(pool[Math.floor(Math.random() * pool.length)]);
    return cpuTeam;
}

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

    resultHTML += `<h4>Your Box Score</h4><pre>${results.team1.boxScore.map(p => `${p.player.padEnd(20)} | PTS: ${p.pts.toString().padStart(2)} | FG: ${p.fg}`).join('\n')}</pre>`;
    document.getElementById('game-results').innerHTML = resultHTML;
}

document.querySelectorAll('.sim-cpu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (roster.length !== 5) return alert("You need exactly 5 players to play!");
        
        const difficulty = e.target.getAttribute('data-diff');
        const cpuTeam = getCPUOpponent(difficulty);
        const rewards = { 'easy': 100, 'medium': 200, 'hard': 300, 'pro': 500 };
        
        const results = simulateGame("Your Team", roster, `CPU (${difficulty.toUpperCase()})`, cpuTeam);
        processGameResult(results, rewards[difficulty]);
    });
});

// --- ASYNC PVP MATCHMAKING (Mock) ---
document.getElementById('sim-pvp-btn').addEventListener('click', () => {
    if (roster.length !== 5) return alert("You need exactly 5 players to play PvP!");
    
    // In a real app, you would fetch this from Firebase/Supabase
    // For now, we simulate a random "Opponent" by grabbing 5 high-tier randoms
    let mockOpponentTeam = [];
    for(let i=0; i<5; i++) mockOpponentTeam.push(db[Math.floor(Math.random() * 80)]);
    
    const results = simulateGame("Your Team", roster, "Rival Player", mockOpponentTeam);
    processGameResult(results, 500); // 500 coins for a PvP win
});

init();