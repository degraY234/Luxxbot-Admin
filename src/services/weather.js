import axios from 'axios';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const UA = 'LuxxBot/3.1';

/** WMO Weather interpretation codes (Open-Meteo) */
const WMO_LABELS = {
    0: 'Cerah ☀️',
    1: 'Cerah berawan 🌤️',
    2: 'Berawan sebagian ⛅',
    3: 'Berawan ☁️',
    45: 'Berkabut 🌫️',
    48: 'Kabut tebal 🌫️',
    51: 'Gerimis ringan 🌦️',
    53: 'Gerimis sedang 🌦️',
    55: 'Gerimis lebat 🌧️',
    56: 'Gerimis beku ringan',
    57: 'Gerimis beku lebat',
    61: 'Hujan ringan 🌧️',
    63: 'Hujan sedang 🌧️',
    65: 'Hujan lebat ⛈️',
    66: 'Hujan beku ringan',
    67: 'Hujan beku lebat',
    71: 'Salju ringan ❄️',
    73: 'Salju sedang ❄️',
    75: 'Salju lebat ❄️',
    77: 'Butiran salju',
    80: 'Hujan lokal ringan 🌦️',
    81: 'Hujan lokal sedang 🌧️',
    82: 'Hujan lokal lebat ⛈️',
    85: 'Hujan salju ringan',
    86: 'Hujan salju lebat',
    95: 'Badai petir ⛈️',
    96: 'Badai petir + hujan es',
    99: 'Badai petir + hujan es lebat'
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━';

function wmoLabel(code) {
    return WMO_LABELS[Number(code)] || `Kode cuaca ${code}`;
}

function windCompass(deg) {
    if (deg == null || Number.isNaN(deg)) return '-';
    const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
    return dirs[Math.round(deg / 45) % 8];
}

function fmtNum(n, digits = 1) {
    if (n == null || Number.isNaN(n)) return '-';
    return Number(n).toFixed(digits);
}

function fmtTime(iso, tz) {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: tz || undefined
        });
    } catch {
        return iso.slice(11, 16);
    }
}

function fmtDate(iso, tz) {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: tz || undefined
        });
    } catch {
        return iso.slice(0, 10);
    }
}

function fmtDateShort(iso, tz) {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleDateString('id-ID', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: tz || undefined
        });
    } catch {
        return iso.slice(0, 10);
    }
}

function uvLabel(uv) {
    const v = Number(uv);
    if (Number.isNaN(v)) return '-';
    if (v <= 2) return `${fmtNum(v, 1)} (Rendah 🟢)`;
    if (v <= 5) return `${fmtNum(v, 1)} (Sedang 🟡)`;
    if (v <= 7) return `${fmtNum(v, 1)} (Tinggi 🟠)`;
    if (v <= 10) return `${fmtNum(v, 1)} (Sangat tinggi 🔴)`;
    return `${fmtNum(v, 1)} (Ekstrem ⚫)`;
}

function daylightHours(seconds) {
    if (seconds == null) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h} jam ${m} menit`;
}

function buildTips({ cur, today, hourly }) {
    const tips = [];
    const rain = today?.precipitation_probability_max ?? 0;
    const temp = cur?.temperature_2m;
    const feels = cur?.apparent_temperature;
    const uv = today?.uv_index_max;
    const wind = cur?.wind_speed_10m;
    const code = cur?.weather_code;

    if (rain >= 70) tips.push('☔ *Wajib payung* — peluang hujan tinggi hari ini.');
    else if (rain >= 40) tips.push('🌂 Siapkan payung — ada kemungkinan hujan.');
    else tips.push('☀️ Cuaca relatif kering — payung opsional.');

    if (temp != null) {
        if (temp >= 32) tips.push('🥵 Panas — minum banyak air, hindari aktivitas berat siang hari.');
        else if (temp <= 20) tips.push('🧥 Agak dingin — jaket tipis disarankan.');
        else if (temp <= 15) tips.push('🧣 Dingin — pakai jaket hangat.');
    }

    if (feels != null && temp != null && Math.abs(feels - temp) >= 3) {
        tips.push(`🌡️ Terasa ${fmtNum(feels)}°C (beda ${fmtNum(Math.abs(feels - temp))}° dari suhu aktual).`);
    }

    if (uv >= 8) tips.push('🧴 UV ekstrem — sunscreen & topi wajib kalau keluar lama.');
    else if (uv >= 6) tips.push('🕶️ UV tinggi — pakai sunscreen kalau aktivitas outdoor.');

    if (wind >= 40) tips.push('💨 Angin kencang — hati-hati naik motor / objek terbang.');

    if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(Number(code))) {
        tips.push('⛈️ Ada potensi hujan/badai — cek perkiraan per jam sebelum berangkat.');
    }

    const nextHours = hourly?.time?.slice(0, 6) || [];
    if (nextHours.length) {
        tips.push('🕐 Pantau update berkala — prakiraan bisa berubah seiring waktu.');
    }

    return tips;
}

function buildNarrative(cur, place) {
    const temp = cur?.temperature_2m;
    const code = cur?.weather_code;
    const isDay = cur?.is_day;

    let mood = `Di *${place.name}* saat ini `;
    if (isDay === 0) mood += 'malam hari ';
    mood += `cuacanya *${wmoLabel(code)}*`;
    if (temp != null) mood += ` dengan suhu sekitar *${fmtNum(temp)}°C*`;
    mood += '.';
    return mood;
}

async function geocodeLocation(query) {
    const { data } = await axios.get(GEO_URL, {
        params: {
            name: query,
            count: 8,
            language: 'id',
            format: 'json'
        },
        timeout: 15000,
        headers: { 'User-Agent': UA }
    });

    const results = data?.results || [];
    if (!results.length) {
        throw new Error(`Lokasi "${query}" tidak ditemukan. Coba nama kota/provinsi lebih spesifik.`);
    }

    const q = query.toLowerCase().trim();

    function scorePlace(place) {
        const name = (place.name || '').toLowerCase();
        let score = place.population || 0;
        if (place.country_code === 'ID') score += 5_000_000;
        if (name === q || name === `kota ${q}` || name === `kabupaten ${q}`) score += 3_000_000;
        else if (name.includes(q)) score += 800_000;
        if (String(place.feature_code || '').startsWith('PPLA')) score += 1_500_000;
        return score;
    }

    const ranked = [...results].sort((a, b) => scorePlace(b) - scorePlace(a));
    return ranked[0];
}

async function fetchOpenMeteo(lat, lon) {
    const { data } = await axios.get(FORECAST_URL, {
        params: {
            latitude: lat,
            longitude: lon,
            current: [
                'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
                'precipitation', 'rain', 'weather_code', 'cloud_cover',
                'pressure_msl', 'surface_pressure', 'wind_speed_10m',
                'wind_direction_10m', 'wind_gusts_10m', 'is_day'
            ].join(','),
            hourly: [
                'temperature_2m', 'precipitation_probability', 'precipitation',
                'rain', 'weather_code', 'relative_humidity_2m', 'wind_speed_10m'
            ].join(','),
            daily: [
                'weather_code', 'temperature_2m_max', 'temperature_2m_min',
                'apparent_temperature_max', 'apparent_temperature_min',
                'precipitation_sum', 'precipitation_probability_max', 'rain_sum',
                'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant',
                'sunrise', 'sunset', 'uv_index_max', 'daylight_duration', 'sunshine_duration'
            ].join(','),
            forecast_days: 7,
            timezone: 'auto',
            wind_speed_unit: 'kmh',
            precipitation_unit: 'mm'
        },
        timeout: 20000,
        headers: { 'User-Agent': UA }
    });
    return data;
}

function formatPlaceLabel(place) {
    const parts = [place.name];
    if (place.admin1) parts.push(place.admin1);
    if (place.country) parts.push(place.country);
    return parts.join(', ');
}

function buildHourlyBlock(hourly, tz) {
    if (!hourly?.time?.length) return '';
    const now = Date.now();
    const lines = [];
    let count = 0;

    for (let i = 0; i < hourly.time.length && count < 8; i++) {
        const t = new Date(hourly.time[i]).getTime();
        if (t < now - 30 * 60 * 1000) continue;
        const temp = hourly.temperature_2m?.[i];
        const rain = hourly.precipitation_probability?.[i];
        const code = hourly.weather_code?.[i];
        const precip = hourly.precipitation?.[i];
        lines.push(
            `├ ${fmtTime(hourly.time[i], tz)} · ${fmtNum(temp)}°C · ${wmoLabel(code).split(' ')[0]}` +
            ` · 🌧️${rain ?? '-'}% · ${fmtNum(precip, 1)}mm`
        );
        count++;
    }

    if (!lines.length) return '';
    return (
        `⏰ *PERKIRAAN PER JAM* (8 jam ke depan)\n` +
        `${DIVIDER}\n\n` +
        lines.join('\n')
    );
}

function buildDailyLine(daily, idx, tz, label) {
    return (
        `├ *${label}* (${fmtDateShort(daily.time[idx], tz)})\n` +
        `│  🌡️ ${fmtNum(daily.temperature_2m_min?.[idx])}° – ${fmtNum(daily.temperature_2m_max?.[idx])}°C\n` +
        `│  ${wmoLabel(daily.weather_code?.[idx])}\n` +
        `│  🌧️ ${daily.precipitation_probability_max?.[idx] ?? '-'}% · 💧 ${fmtNum(daily.precipitation_sum?.[idx], 1)} mm\n` +
        `│  💨 ${fmtNum(daily.wind_speed_10m_max?.[idx])} km/jam · UV ${uvLabel(daily.uv_index_max?.[idx])}`
    );
}

function buildWeeklyBlock(daily, tz) {
    if (!daily?.time?.length) return '';
    const lines = [];
    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
        const dayLabel = i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : fmtDateShort(daily.time[i], tz);
        lines.push(
            `├ ${dayLabel}: ${fmtNum(daily.temperature_2m_min?.[i])}–${fmtNum(daily.temperature_2m_max?.[i])}°C · ` +
            `${wmoLabel(daily.weather_code?.[i]).split(' ').slice(0, 2).join(' ')} · 🌧️${daily.precipitation_probability_max?.[i] ?? '-'}%`
        );
    }
    return (
        `📆 *PRAKIRAAN 7 HARI*\n` +
        `${DIVIDER}\n\n` +
        lines.join('\n')
    );
}

/**
 * @returns {Promise<string[]>}
 */
export async function getWeatherMessages(location) {
    const place = await geocodeLocation(location);
    const forecast = await fetchOpenMeteo(place.latitude, place.longitude);

    const cur = forecast.current;
    const daily = forecast.daily;
    const hourly = forecast.hourly;
    const tz = forecast.timezone;
    const placeLabel = formatPlaceLabel(place);
    const elev = forecast.elevation != null ? `${Math.round(forecast.elevation)} m dpl` : '-';
    const localNow = cur?.time ? fmtDate(cur.time, tz) + ' · ' + fmtTime(cur.time, tz) : '-';

    const todayIdx = 0;
    const tomorrowIdx = 1;

    const messages = [];

    messages.push(
        `🌏 *LAPORAN CUACA LENGKAP*\n` +
        `📍 *${placeLabel}*\n` +
        `🗺️ ${fmtNum(place.latitude, 4)}°, ${fmtNum(place.longitude, 4)}° · ⛰️ ${elev}\n` +
        `🕐 ${localNow} (${forecast.timezone_abbreviation || tz})\n` +
        `${DIVIDER}\n\n` +
        `${buildNarrative(cur, place)}\n\n` +
        `🌡️ *Suhu:* ${fmtNum(cur?.temperature_2m)}°C (terasa ${fmtNum(cur?.apparent_temperature)}°C)\n` +
        `☁️ *Kondisi:* ${wmoLabel(cur?.weather_code)}\n` +
        `💧 *Kelembapan:* ${cur?.relative_humidity_2m ?? '-'}%\n` +
        `🌧️ *Curah (jam ini):* ${fmtNum(cur?.precipitation, 1)} mm · Hujan ${fmtNum(cur?.rain, 1)} mm\n` +
        `☁️ *Tutupan awan:* ${cur?.cloud_cover ?? '-'}%\n` +
        `💨 *Angin:* ${fmtNum(cur?.wind_speed_10m)} km/jam ${windCompass(cur?.wind_direction_10m)}` +
        ` · hembusan ${fmtNum(cur?.wind_gusts_10m)} km/jam\n` +
        `🔽 *Tekanan:* ${fmtNum(cur?.pressure_msl, 0)} hPa (msl) · permukaan ${fmtNum(cur?.surface_pressure, 0)} hPa\n` +
        `🌓 *Waktu:* ${cur?.is_day ? 'Siang ☀️' : 'Malam 🌙'}`
    );

    if (daily?.time?.length) {
        messages.push(
            `📅 *HARI INI — ${fmtDate(daily.time[todayIdx], tz)}*\n` +
            `${DIVIDER}\n\n` +
            `🌡️ Min *${fmtNum(daily.temperature_2m_min?.[todayIdx])}°C* · Max *${fmtNum(daily.temperature_2m_max?.[todayIdx])}°C*\n` +
            `🤒 Terasa min ${fmtNum(daily.apparent_temperature_min?.[todayIdx])}°C · max ${fmtNum(daily.apparent_temperature_max?.[todayIdx])}°C\n` +
            `☁️ ${wmoLabel(daily.weather_code?.[todayIdx])}\n` +
            `🌧️ Peluang hujan *${daily.precipitation_probability_max?.[todayIdx] ?? '-'}%*\n` +
            `💧 Total curah ~${fmtNum(daily.precipitation_sum?.[todayIdx], 1)} mm (hujan ${fmtNum(daily.rain_sum?.[todayIdx], 1)} mm)\n` +
            `💨 Angin max ${fmtNum(daily.wind_speed_10m_max?.[todayIdx])} km/jam · hembusan ${fmtNum(daily.wind_gusts_10m_max?.[todayIdx])} km/jam ${windCompass(daily.wind_direction_10m_dominant?.[todayIdx])}\n` +
            `🌅 Terbit ${fmtTime(daily.sunrise?.[todayIdx], tz)} · Terbenam ${fmtTime(daily.sunset?.[todayIdx], tz)}\n` +
            `☀️ Durasi siang ${daylightHours(daily.daylight_duration?.[todayIdx])} · sinar matahari ${daylightHours(daily.sunshine_duration?.[todayIdx])}\n` +
            `🔆 UV Index: ${uvLabel(daily.uv_index_max?.[todayIdx])}`
        );
    }

    const hourlyBlock = buildHourlyBlock(hourly, tz);
    if (hourlyBlock) messages.push(hourlyBlock);

    if (daily?.time?.length > 1) {
        const extra = [];
        if (tomorrowIdx < daily.time.length) {
            extra.push(buildDailyLine(daily, tomorrowIdx, tz, 'BESOK'));
        }
        if (daily.time.length > 2) {
            extra.push(buildDailyLine(daily, 2, tz, 'LUSA'));
        }
        messages.push(
            `📆 *HARI BERIKUTNYA*\n` +
            `${DIVIDER}\n\n` +
            extra.join('\n\n')
        );
    }

    messages.push(buildWeeklyBlock(daily, tz));

    const tips = buildTips({
        cur,
        today: {
            precipitation_probability_max: daily?.precipitation_probability_max?.[0],
            uv_index_max: daily?.uv_index_max?.[0]
        },
        hourly
    });

    messages.push(
        `💡 *SARAN & CATATAN*\n` +
        `${DIVIDER}\n\n` +
        tips.map((t) => `• ${t}`).join('\n') +
        `\n\n🌸 _LuxxBot · Ketik \`!cuaca [kota]\` untuk lokasi lain_`
    );

    return messages;
}

/** @deprecated use getWeatherMessages */
export async function getWeatherReport(location) {
    const msgs = await getWeatherMessages(location);
    return msgs.join('\n\n');
}