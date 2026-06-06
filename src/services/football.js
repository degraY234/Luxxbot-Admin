import axios from 'axios';

const SPORTSDB = 'https://www.thesportsdb.com/api/v1/json/3';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';

function formatDateId(d) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function formatMatchTime(isoOrDate, timeStr) {
    if (isoOrDate) {
        try {
            const d = new Date(isoOrDate);
            if (!Number.isNaN(d.getTime())) {
                return d.toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (_) { /* fallthrough */ }
    }
    if (timeStr) return `${timeStr} WIB`.replace(/:00$/, '');
    return '-';
}

function formatStatusBadge(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('full time') || s === 'ft' || s.includes('final')) return '🏁 Selesai';
    if (s.includes('live') || s.includes("'")) return '🔴 Live';
    if (s.includes('scheduled') || s.includes('pre')) return '🕐 Belum main';
    return `📌 ${status || '—'}`;
}

function formatSportsDbEvent(ev) {
    const waktu = formatMatchTime(ev.strTimestamp || `${ev.dateEvent}T${ev.strTime || '00:00:00'}`, ev.strTimeLocal || ev.strTime);
    const skor =
        ev.intHomeScore != null && ev.intAwayScore != null
            ? ` (${ev.intHomeScore} - ${ev.intAwayScore})`
            : '';
    return (
        `📅 ${waktu}\n` +
        `🏟️ ${ev.strLeague || 'Sepak Bola'}\n` +
        `⚽ ${ev.strHomeTeam} vs ${ev.strAwayTeam}${skor}\n` +
        `${ev.strVenue ? `📍 ${ev.strVenue}\n` : ''}` +
        `━━━━━━━━━━━━━━━━━━━━━━━`
    );
}

async function fetchSportsDbDay(dateStr) {
    const { data } = await axios.get(`${SPORTSDB}/eventsday.php`, {
        params: { d: dateStr, s: 'Soccer' },
        timeout: 12000
    });
    return Array.isArray(data?.events) ? data.events : [];
}

async function fetchFromSportsDb() {
    const now = new Date();
    const today = formatDateId(now);
    const tomorrow = formatDateId(addDays(now, 1));

    const [todayEvents, tomorrowEvents] = await Promise.all([
        fetchSportsDbDay(today),
        fetchSportsDbDay(tomorrow)
    ]);

    const seen = new Set();
    const merged = [];
    for (const ev of [...todayEvents, ...tomorrowEvents]) {
        const key = ev.idEvent || `${ev.strHomeTeam}-${ev.strAwayTeam}-${ev.dateEvent}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(ev);
    }

    if (!merged.length) throw new Error('TheSportsDB kosong');

    let text = '⚽ *JADWAL SEPAK BOLA*\n';
    text += `_Hari ini & besok (WIB)_\n\n`;

    const todayList = merged.filter((e) => e.dateEvent === today).slice(0, 8);
    const tomorrowList = merged.filter((e) => e.dateEvent === tomorrow).slice(0, 6);

    if (todayList.length) {
        text += `📆 *HARI INI (${today})*\n\n`;
        todayList.forEach((ev) => { text += `${formatSportsDbEvent(ev)}\n`; });
        text += '\n';
    }
    if (tomorrowList.length) {
        text += `📆 *BESOK (${tomorrow})*\n\n`;
        tomorrowList.forEach((ev) => { text += `${formatSportsDbEvent(ev)}\n`; });
    }
    if (!todayList.length && !tomorrowList.length) {
        merged.slice(0, 10).forEach((ev) => { text += `${formatSportsDbEvent(ev)}\n`; });
    }

    return text.trim();
}

function parseEspnEvent(event) {
    const comp = event.competitions?.[0];
    if (!comp) return null;

    const teams = comp.competitors || [];
    const home = teams.find((t) => t.homeAway === 'home');
    const away = teams.find((t) => t.homeAway === 'away');
    if (!home || !away) return null;

    const status = comp.status?.type?.description || comp.status?.type?.shortDetail || '';
    const league = event.season?.slug?.replace(/-/g, ' ') || event.name || 'Soccer';

    return {
        waktu: formatMatchTime(comp.date || event.date),
        liga: league.replace(/^\d{4}\s*/, '').trim() || 'International',
        home: home.team?.displayName || home.team?.name || 'Home',
        away: away.team?.displayName || away.team?.name || 'Away',
        skorHome: home.score ?? '-',
        skorAway: away.score ?? '-',
        venue: comp.venue?.fullName || '',
        status
    };
}

async function fetchFromEspn() {
    const { data } = await axios.get(ESPN_SCOREBOARD, {
        timeout: 12000,
        headers: { 'User-Agent': 'LuxxBot/3.1' }
    });

    const events = (data?.events || [])
        .map(parseEspnEvent)
        .filter(Boolean)
        .slice(0, 12);

    if (!events.length) throw new Error('ESPN kosong');

    let text = '⚽ *JADWAL & HASIL BOLA*\n';
    text += `_Update ESPN · zona WIB_\n\n`;

    events.forEach((m) => {
        const skor = m.status?.toLowerCase().includes('scheduled')
            ? ''
            : ` (${m.skorHome} - ${m.skorAway})`;
        text +=
            `📅 ${m.waktu}\n` +
            `🏆 ${m.liga}\n` +
            `⚽ ${m.home} vs ${m.away}${skor}\n` +
            `${formatStatusBadge(m.status)}\n` +
            `${m.venue ? `📍 ${m.venue}\n` : ''}` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    });

    return text.trim();
}

async function fetchFromFootballData(apiKey) {
    const { data } = await axios.get('https://api.football-data.org/v4/matches', {
        headers: { 'X-Auth-Token': apiKey },
        params: { status: 'SCHEDULED,LIVE,IN_PLAY,PAUSED,FINISHED', limit: 15 },
        timeout: 12000
    });

    const matches = (data?.matches || []).slice(0, 12);
    if (!matches.length) throw new Error('football-data kosong');

    let text = '⚽ *JADWAL SEPAK BOLA*\n';
    text += '\n';

    matches.forEach((match) => {
        const date = formatMatchTime(match.utcDate);
        const score =
            match.score?.fullTime?.home != null
                ? ` (${match.score.fullTime.home} - ${match.score.fullTime.away})`
                : '';
        text +=
            `📅 ${date}\n` +
            `🏟️ ${match.competition?.name || ''}\n` +
            `⚽ ${match.homeTeam?.name || 'TBD'} vs ${match.awayTeam?.name || 'TBD'}${score}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    });

    return text.trim();
}

/**
 * Ambil jadwal bola — multi sumber, tanpa wajib API key.
 * @param {string} [query] opsional: nama liga/negara untuk filter ESPN (belum dipakai penuh)
 */
export async function fetchFootballSchedule(query = '') {
    const apiKey = process.env.FOOTBALL_API_KEY?.trim();

    if (apiKey) {
        try {
            return { text: await fetchFromFootballData(apiKey), source: 'football-data.org' };
        } catch (e) {
            console.log('football-data skip:', e.message);
        }
    }

    try {
        return { text: await fetchFromEspn(), source: 'ESPN' };
    } catch (e) {
        console.log('ESPN football skip:', e.message);
    }

    try {
        return { text: await fetchFromSportsDb(), source: 'TheSportsDB' };
    } catch (e) {
        console.log('TheSportsDB football skip:', e.message);
        throw new Error('Gagal ambil jadwal bola. Coba lagi beberapa menit.');
    }
}