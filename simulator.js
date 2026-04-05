// simulator.js — Enhanced NBA Realism Engine v2.0

// --- POSITION DEFAULTS ---
// Used as fallbacks when player-specific data is missing
const pos_3pt_ratio  = { 'PG': 0.40, 'SG': 0.45, 'SF': 0.35, 'PF': 0.20, 'C': 0.05 };
const pos_avg_2p     = { 'PG': 0.46, 'SG': 0.47, 'SF': 0.48, 'PF': 0.50, 'C': 0.53 };
const pos_fta_rate   = { 'PG': 0.22, 'SG': 0.20, 'SF': 0.23, 'PF': 0.28, 'C': 0.35 };
const pos_tov_rate   = { 'PG': 0.13, 'SG': 0.10, 'SF': 0.10, 'PF': 0.09, 'C': 0.10 };

// --- MATH UTILITIES ---
function randomNormal(mean, stdDev) {
    let u1 = Math.random(), u2 = Math.random();
    let z  = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + stdDev * z;
}

function randomBinomial(n, p) {
    let successes = 0;
    for (let i = 0; i < n; i++) if (Math.random() < p) successes++;
    return successes;
}

// Clamp a value between min and max
function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

// --- PACE ESTIMATION ---
// Approximates team pace (possessions/shots per game) from roster PPG totals.
// Higher-scoring rosters tend to play up-tempo.
// Range: ~80 (slow) to ~102 (very fast)
function estimatePace(team) {
    const totalPpg = team.reduce((s, p) => s + parseFloat(p.PPG || 0), 0);
    return clamp(Math.round(80 + (totalPpg - 55) * (22 / 65)), 80, 102);
}

// --- SPLIT DEFENSE MODIFIERS ---
// Separates rim protection (BLK → 2PT%) from perimeter pressure (STL → 3PT%).
// Modifier range: 0.84 (elite) → 1.00 (no defense).
function getTeamDefModifiers(team) {
    const blk = team.reduce((s, p) => s + parseFloat(p.BLK_per_game || 0), 0);
    const stl = team.reduce((s, p) => s + parseFloat(p.STL_per_game || 0), 0);
    return {
        mod2pt: clamp(1 - blk * 0.006, 0.84, 1.00),
        mod3pt: clamp(1 - stl * 0.007, 0.84, 1.00)
    };
}

// --- HOT/COLD GAME FORM ---
// Each player gets a random game-form multiplier once per simulation.
// Drawn from a normal distribution around 1.0; ~68% of players land within ±8%.
// Simulates off-nights, career games, and the natural variance of basketball.
function generateGameForm() {
    return clamp(randomNormal(1.0, 0.08), 0.75, 1.30);
}

// --- OVERTIME SIMULATION ---
// Simulates a single 5-minute OT period (~10 FGA per team, ~10–14 points each).
// Accepts an fgaOverride so the main simulateOffense can be reused safely.
function simulateOvertimePeriod(team, oppDefMods, totalPpg, fgaOverride) {
    return simulateOffense(team, oppDefMods, totalPpg, 0, fgaOverride);
}

// --- CORE OFFENSE ENGINE ---
// fgaOverride: if provided, uses this exact FGA count (for OT periods).
function simulateOffense(team, oppDefMods, myTotalPpg, fgaShift, fgaOverride = null) {
    let score    = 0;
    let boxScore = [];

    // Possessions: use pace estimate, apply shift, clamp to realistic range.
    const pace    = estimatePace(team);
    const baseFga = fgaOverride !== null
        ? fgaOverride
        : Math.round(randomNormal(pace, 3));
    const teamFga = clamp(Math.round(baseFga + fgaShift), 60, 115);

    team.forEach(player => {
        const pos = player.pos || 'SF';

        // --- GAME FORM (hot/cold factor for this player this game) ---
        const gameForm = generateGameForm();

        // --- SHOT SHARE ---
        const shotShare = myTotalPpg > 0
            ? (parseFloat(player.PPG || 0) / myTotalPpg)
            : 0.20;
        const rawFga = Math.round(teamFga * shotShare);

        // --- TURNOVERS ---
        // Estimate per-player TOV rate from their stats if available,
        // otherwise fall back to positional average.
        const playerFga_stat = parseFloat(player.FGA || 0);
        const playerTov_stat = parseFloat(player.TOV_per_game || 0);
        const tovRate = (playerFga_stat > 0 && playerTov_stat > 0)
            ? clamp(playerTov_stat / playerFga_stat, 0.04, 0.25)
            : (pos_tov_rate[pos] || 0.10);
        const tovsThisGame   = Math.round(rawFga * tovRate);
        const effectiveFga   = Math.max(0, rawFga - tovsThisGame);

        // --- SHOT SPLITS (3PT vs 2PT) ---
        const ratio3pt  = pos_3pt_ratio[pos] || 0.30;
        let attempts3   = Math.round(effectiveFga * ratio3pt);
        let attempts2   = effectiveFga - attempts3;

        // --- SHOOTING PERCENTAGES ---
        let pct3 = parseFloat(player.x3p_percent);
        if (isNaN(pct3) || pct3 === 0) {
            // Player doesn't shoot 3s — redirect all to 2PT
            pct3 = 0;
            attempts2 += attempts3;
            attempts3 = 0;
        }

        let pct2 = parseFloat(player.x2p_percent);
        if (isNaN(pct2)) pct2 = pos_avg_2p[pos] || 0.48;

        // Apply hot/cold form to base percentages before defense
        pct3 = clamp(pct3 * gameForm, 0.10, 0.60);
        pct2 = clamp(pct2 * gameForm, 0.25, 0.72);

        // --- APPLY SPLIT DEFENSE ---
        // 2PT% suppressed by rim protectors (BLK), 3PT% by perimeter defenders (STL)
        const finalPct3 = pct3 * oppDefMods.mod3pt;
        const finalPct2 = pct2 * oppDefMods.mod2pt;

        // --- SHOT OUTCOMES (binomial per-shot rolls) ---
        const makes3 = attempts3 > 0 ? randomBinomial(attempts3, finalPct3) : 0;
        const makes2 = attempts2 > 0 ? randomBinomial(attempts2, finalPct2) : 0;

        // --- FREE THROWS ---
        // FTA rate from real data if possible, else positional average
        const ftaRate = (playerFga_stat > 0 && parseFloat(player.FTA || 0) > 0)
            ? clamp(parseFloat(player.FTA) / playerFga_stat, 0.08, 0.60)
            : (pos_fta_rate[pos] || 0.25);
        const fta  = Math.round(effectiveFga * ftaRate);
        const pctFt = clamp(parseFloat(player.ft_percent) || 0.72, 0.40, 1.00);
        const ftm  = fta > 0 ? randomBinomial(fta, pctFt) : 0;

        // --- ASSISTS (tracked for box score richness) ---
        // ~58% of made field goals in the NBA are assisted
        const totalFgm = makes2 + makes3;
        const ast = Math.round(totalFgm * randomNormal(0.58, 0.08));

        // --- REBOUNDS (rough per-player share, drives extra possessions) ---
        // Used downstream to inform the FGA shift logic if extended later
        const rebPerGame = parseFloat(player.REB_per_game || player.TRB || 0);

        // --- FOUL-OUT / FOUL TROUBLE (rare edge case) ---
        // If a player would draw an unusually high FTA this game, there's a small
        // chance they foul out and lose ~30% of their would-be production.
        let fouledOut = false;
        if (fta >= 10 && Math.random() < 0.07) {
            fouledOut = true;
        }

        // --- FINAL POINTS ---
        let pts = fouledOut
            ? Math.floor(((makes3 * 3) + (makes2 * 2) + ftm) * 0.70)
            : (makes3 * 3) + (makes2 * 2) + ftm;

        score += pts;

        boxScore.push({
            player:    player.player,
            pos,
            pts,
            fg:        `${makes2 + makes3}-${effectiveFga}`,
            fg3:       `${makes3}-${attempts3}`,
            ft:        `${ftm}-${fta}`,
            ast:       clamp(ast, 0, makes2 + makes3),
            tov:       tovsThisGame,
            reb:       Math.round(rebPerGame * randomNormal(1.0, 0.25)),
            gameForm:  Math.round(gameForm * 100) / 100,
            fouledOut
        });
    });

    return { score, boxScore };
}

// --- MAIN EXPORT ---
export function simulateGame(team1Name, team1Data, team2Name, team2Data) {

    // --- PACE & TEMPO ---
    // Shared game pace is the average of both teams' tendencies,
    // with the faster team nudging the pace up slightly.
    const t1Pace = estimatePace(team1Data);
    const t2Pace = estimatePace(team2Data);
    const sharedPace = Math.round((t1Pace + t2Pace) / 2 + Math.abs(t1Pace - t2Pace) * 0.15);

    // --- PPG TOTALS (for shot-share weighting) ---
    const t1TotalPpg = team1Data.reduce((s, p) => s + parseFloat(p.PPG || 0), 0);
    const t2TotalPpg = team2Data.reduce((s, p) => s + parseFloat(p.PPG || 0), 0);

    // --- FGA SHIFT (possession advantage) ---
    // Better rebounding teams get extra shot opportunities.
    // Approximated here via PPG differential; every 10 PPG advantage ≈ 1.5 extra FGA.
    const ppgDiff  = t1TotalPpg - t2TotalPpg;
    const fgaShift = ppgDiff * 0.15;

    // --- SPLIT DEFENSE MODIFIERS ---
    const t1DefMods = getTeamDefModifiers(team1Data);
    const t2DefMods = getTeamDefModifiers(team2Data);

    // --- SIMULATE REGULATION ---
    let t1Result = simulateOffense(team1Data, t2DefMods, t1TotalPpg,  fgaShift);
    let t2Result = simulateOffense(team2Data, t1DefMods, t2TotalPpg, -fgaShift);

    // --- OVERTIME ---
    // Each OT is a proper mini-simulation (~10 FGA per team),
    // not a random number bolt-on.
    let overtimePeriods = 0;
    while (t1Result.score === t2Result.score) {
        overtimePeriods++;
        // Safety valve: after 4 OT periods, break the tie with a coin flip + 1 point
        if (overtimePeriods > 4) {
            if (Math.random() < 0.5) t1Result.score += 1;
            else t2Result.score += 1;
            break;
        }
        const ot1 = simulateOvertimePeriod(team1Data, t2DefMods, t1TotalPpg, 10);
        const ot2 = simulateOvertimePeriod(team2Data, t1DefMods, t2TotalPpg, 10);

        t1Result.score += ot1.score;
        t2Result.score += ot2.score;

        // Merge OT box scores into regulation totals
        ot1.boxScore.forEach((otP, i) => {
            if (t1Result.boxScore[i]) {
                t1Result.boxScore[i].pts += otP.pts;
                t1Result.boxScore[i].ast += otP.ast;
                t1Result.boxScore[i].tov += otP.tov;
                t1Result.boxScore[i].reb += otP.reb;
            }
        });
        ot2.boxScore.forEach((otP, i) => {
            if (t2Result.boxScore[i]) {
                t2Result.boxScore[i].pts += otP.pts;
                t2Result.boxScore[i].ast += otP.ast;
                t2Result.boxScore[i].tov += otP.tov;
                t2Result.boxScore[i].reb += otP.reb;
            }
        });
    }

    return {
        team1: {
            name:     team1Name,
            score:    t1Result.score,
            pace:     t1Pace,
            boxScore: t1Result.boxScore
        },
        team2: {
            name:     team2Name,
            score:    t2Result.score,
            pace:     t2Pace,
            boxScore: t2Result.boxScore
        },
        overtimePeriods
    };
}