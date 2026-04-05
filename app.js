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
    
    // Draw the 5 explicit positional slots
    rosterContainer.innerHTML = requiredPositions.map(pos => {
        // Find if we have a player in the roster for this specific position
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
            const existingPlayerIndex = roster.findIndex(r => r.player === p.player);
            const cardPosition = p.pos || 'SF'; // Default to SF if the database is missing a position

            if (existingPlayerIndex > -1) {
                // If they are already in the roster, clicking removes them
                roster.splice(existingPlayerIndex, 1);
            } else {
                // Check if we already have a player at this position
                const isPositionFilled = roster.some(r => (r.pos || 'SF') === cardPosition);
                
                if (isPositionFilled) {
                    return alert(`You already have a ${cardPosition} in your starting lineup! Remove them first.`);
                }
                
                // Safe to add
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
    if (pool.length === 0) pool = db; // Failsafe just in case you haven't assigned this rarity yet
    let selection = [];
    for(let i=0; i<count; i++) {
        selection.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return selection;
}
function getCPUOpponent(difficulty) {
    // New Rarity-based matchmaking rules
    if (difficulty === 'easy') return getPlayersByRarity('UC', 5);
    if (difficulty === 'medium') return getPlayersByRarity('SR', 5);
    if (difficulty === 'hard') {
        return [...getPlayersByRarity('SSR', 4), ...getPlayersByRarity('LR', 1)];
    }
    if (difficulty === 'pro') {
        return [...getPlayersByRarity('UR', 3), ...getPlayersByRarity('LR', 2)];
    }
    return getPlayersByRarity('C', 5); // Fallback
}
let pendingReward = 0;

// The 30-second Game Animator
function animateGame(results, rewardAmount) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById('view-live-game').style.display = 'block';
    
    document.getElementById('post-game-panel').style.display = 'none';
    document.getElementById('live-t1-name').innerText = results.team1.name;
    document.getElementById('live-t2-name').innerText = results.team2.name;
    
    pendingReward = rewardAmount;

    let ticks = 0;
    const maxTicks = 300; 
    
    // Track the currently displayed scores
    let currentT1Score = 0;
    let currentT2Score = 0;
    
    const interval = setInterval(() => {
        ticks++;
        let timePercent = ticks / maxTicks;

        // Calculate where the score SHOULD be right now based on time
        let expectedT1 = Math.floor(results.team1.score * timePercent);
        let expectedT2 = Math.floor(results.team2.score * timePercent);

        // Only update if the expected score is at least 1, 2, or 3 points higher 
        // than the current score (mimicking real basketball shots)
        if (expectedT1 - currentT1Score >= 2 || (expectedT1 > currentT1Score && Math.random() > 0.8)) {
            currentT1Score = expectedT1;
        }
        if (expectedT2 - currentT2Score >= 2 || (expectedT2 > currentT2Score && Math.random() > 0.8)) {
            currentT2Score = expectedT2;
        }

        // Force the final correct score on the very last tick
        if (ticks >= maxTicks) {
            currentT1Score = results.team1.score;
            currentT2Score = results.team2.score;
        }

        document.getElementById('live-t1-score').innerText = currentT1Score;
        document.getElementById('live-t2-score').innerText = currentT2Score;

        let gameSecondsLeft = Math.max(0, 2880 - Math.floor(2880 * timePercent));
        let mins = Math.floor((gameSecondsLeft % 720) / 60);
        let secs = gameSecondsLeft % 60;
        document.getElementById('live-time').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        let qtr = 4 - Math.floor(gameSecondsLeft / 720);
        if (qtr === 5) qtr = 4;
        document.getElementById('live-quarter').innerText = ["1ST QTR", "2ND QTR", "HALF", "3RD QTR", "4TH QTR"][qtr];

        const renderLiveRoster = (teamBox) => {
            return teamBox.map(p => {
                // Ensure box score stats only increment upwards smoothly without jitter
                let currentPts = Math.floor(p.pts * timePercent);
                let fgParts = p.fg.split('-');
                let currentFGM = Math.floor(parseInt(fgParts[0]) * timePercent);
                let currentFGA = Math.floor(parseInt(fgParts[1]) * timePercent);
                
                return `<li>
                    <div><strong>${p.player}</strong> <span style="font-size:0.8rem; color:#888;">(${p.pos})</span></div>
                    <div style="text-align: right;">
                        <span class="live-stat-pts">${currentPts} PTS</span><br>
                        <span style="font-size:0.8rem; color:#666;">FG: ${currentFGM}-${currentFGA}</span>
                    </div>
                </li>`;
            }).join('');
        };

        document.getElementById('live-t1-roster').innerHTML = renderLiveRoster(results.team1.boxScore);
        document.getElementById('live-t2-roster').innerHTML = renderLiveRoster(results.team2.boxScore);

        if (ticks >= maxTicks) {
            clearInterval(interval);
            
            const msgObj = document.getElementById('post-game-message');
            if (results.team1.score > results.team2.score) {
                msgObj.innerText = `YOU WIN! Earned ${pendingReward} 🪙`;
                msgObj.style.color = "green";
                coins += pendingReward;
                saveState();
            } else {
                msgObj.innerText = `YOU LOSE! No coins earned.`;
                msgObj.style.color = "red";
            }
            
            document.getElementById('post-game-panel').style.display = 'block';
        }
    }, 100);
}

// Button Listeners for CPU match
document.querySelectorAll('.sim-cpu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (roster.length !== 5) return alert("You need exactly 5 players to play!");
        
        const difficulty = e.target.getAttribute('data-diff');
        const cpuTeam = getCPUOpponent(difficulty);
        const rewards = { 'easy': 100, 'medium': 200, 'hard': 300, 'pro': 500 };
        
        // 1. Calculate the math instantly behind the scenes
        const results = simulateGame("Your Team", roster, `CPU (${difficulty.toUpperCase()})`, cpuTeam);
        
        // 2. Play out the theater
        animateGame(results, rewards[difficulty]);
    });
});

// Post-Game Return Button
document.getElementById('claim-rewards-btn').addEventListener('click', () => {
    document.getElementById('view-live-game').style.display = 'none';
    document.getElementById('view-play').style.display = 'block'; // Return to menu
});
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