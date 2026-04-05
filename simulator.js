// simulator.js
const pos_3pt_ratio = { 'PG': 0.40, 'SG': 0.45, 'SF': 0.35, 'PF': 0.20, 'C': 0.05 };
const pos_avg_2p = { 'PG': 0.46, 'SG': 0.47, 'SF': 0.48, 'PF': 0.50, 'C': 0.53 };

function randomNormal(mean, stdDev) {
    let u1 = Math.random(), u2 = Math.random();
    let randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + stdDev * randStdNormal;
}

function randomBinomial(n, p) {
    let successes = 0;
    for (let i = 0; i < n; i++) if (Math.random() < p) successes++;
    return successes;
}

export function simulateGame(team1Name, team1Data, team2Name, team2Data) {
    function getTeamDefModifier(team) {
        let stlBlk = team.reduce((sum, p) => sum + (parseFloat(p.STL_per_game || 0) + parseFloat(p.BLK_per_game || 0)), 0);
        return Math.max(0.85, 1 - (stlBlk * 0.006));
    }

    let t1DefMod = getTeamDefModifier(team1Data);
    let t2DefMod = getTeamDefModifier(team2Data);

    function simulateOffense(team, oppDefMod) {
        let totalPpg = team.reduce((sum, p) => sum + parseFloat(p.PPG || 0), 0);
        let score = 0;
        let boxScore = [];
        let teamFga = Math.round(randomNormal(90, 4));
        
        team.forEach(player => {
            let pos = player.pos || 'SF';
            let shotShare = totalPpg > 0 ? (parseFloat(player.PPG || 0) / totalPpg) : 0.2;
            let playerFga = Math.round(teamFga * shotShare);
            
            let ratio3pt = pos_3pt_ratio[pos] || 0.3;
            let attempts3 = Math.round(playerFga * ratio3pt);
            let attempts2 = playerFga - attempts3;
            
            let pct3 = parseFloat(player.x3p_percent);
            if (isNaN(pct3) || pct3 === 0) { pct3 = 0; attempts2 += attempts3; attempts3 = 0; }
            
            let pct2 = parseFloat(player.x2p_percent);
            if (isNaN(pct2)) pct2 = pos_avg_2p[pos] || 0.48;
            
            let makes3 = attempts3 > 0 ? randomBinomial(attempts3, pct3 * oppDefMod) : 0;
            let makes2 = attempts2 > 0 ? randomBinomial(attempts2, pct2 * oppDefMod) : 0;
            
            let fta = Math.round(playerFga * 0.25);
            let pctFt = parseFloat(player.ft_percent) || 0.70;
            let ftm = fta > 0 ? randomBinomial(fta, pctFt) : 0;
            
            let pts = (makes3 * 3) + (makes2 * 2) + ftm;
            score += pts;
            
            boxScore.push({
                player: player.player, pos: pos, pts: pts,
                fg: `${makes2+makes3}-${playerFga}`, fg3: `${makes3}-${attempts3}`, ft: `${ftm}-${fta}`
            });
        });
        return { score, boxScore };
    }

    let t1Result = simulateOffense(team1Data, t2DefMod);
    let t2Result = simulateOffense(team2Data, t1DefMod);

    while (t1Result.score === t2Result.score) {
        t1Result.score += Math.floor(Math.random() * 12) + 4; 
        t2Result.score += Math.floor(Math.random() * 12) + 4;
    }

    return {
        team1: { name: team1Name, score: t1Result.score, boxScore: t1Result.boxScore },
        team2: { name: team2Name, score: t2Result.score, boxScore: t2Result.boxScore }
    };
}