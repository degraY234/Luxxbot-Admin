import axios from 'axios';

function getWeatherApiKey() {
    return (
        process.env.WEATHER_API_KEY?.trim() ||
        process.env.WEATHERAPI_API_KEY?.trim() ||
        process.env.OPENWEATHER_API_KEY?.trim() ||
        ''
    );
}

function detectProvider() {
    if (process.env.WEATHER_API_KEY?.trim() || process.env.WEATHERAPI_API_KEY?.trim()) {
        return 'weatherapi';
    }
    if (process.env.OPENWEATHER_API_KEY?.trim()) return 'openweather';
    return 'wttr';
}

async function fetchWeatherApiCom(location, apiKey) {
    const { data } = await axios.get('https://api.weatherapi.com/v1/forecast.json', {
        params: { key: apiKey, q: location, days: 2, lang: 'id', aqi: 'yes', alerts: 'no' },
        timeout: 15000
    });
    const loc = data.location;
    const cur = data.current;
    const today = data.forecast?.forecastday?.[0];
    const tomorrow = data.forecast?.forecastday?.[1];
    const aq = cur.air_quality;

    const messages = [];

    messages.push(
        `🌤️ *CUACA LIVE — ${loc.name}*\n` +
        `📍 ${loc.region || ''} · ${loc.country}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🌡️ *Sekarang:* ${cur.temp_c}°C (terasa ${cur.feelslike_c}°C)\n` +
        `☁️ *Kondisi:* ${cur.condition.text}\n` +
        `💧 Kelembapan ${cur.humidity}% · 💨 ${cur.wind_kph} km/jam ${cur.wind_dir}\n` +
        `🌧️ Curah ${cur.precip_mm} mm · 👁️ ${cur.vis_km} km\n` +
        `🕐 ${loc.localtime}`
    );

    if (today?.day) {
        const d = today.day;
        messages.push(
            `📅 *HARI INI — ${today.date}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌅 Min ${d.mintemp_c}°C · Max ${d.maxtemp_c}°C\n` +
            `🌧️ Peluang hujan ${d.daily_chance_of_rain}%\n` +
            `🌅 Terbit ${today.astro?.sunrise || '-'} · Terbenam ${today.astro?.sunset || '-'}\n` +
            `🌙 ${today.astro?.moon_phase || ''}`
        );
    }

    if (tomorrow?.day) {
        const d = tomorrow.day;
        messages.push(
            `📆 *BESOK — ${tomorrow.date}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌡️ Min ${d.mintemp_c}°C · Max ${d.maxtemp_c}°C\n` +
            `☁️ ${tomorrow.day?.condition?.text || '—'}\n` +
            `🌧️ Hujan ${d.daily_chance_of_rain}%`
        );
    }

    if (aq) {
        messages.push(
            `🍃 *KUALITAS UDARA*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `PM2.5: ${aq.pm2_5 ?? '-'} · PM10: ${aq.pm10 ?? '-'}\n` +
            `_Indeks dari WeatherAPI_`
        );
    }

    messages.push(`_Sumber: WeatherAPI.com · LuxxBot_`);
    return messages;
}

async function fetchOpenWeather(location, apiKey) {
    const { data } = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: { q: location, units: 'metric', lang: 'id', appid: apiKey },
        timeout: 15000
    });
    const messages = [
        `🌤️ *CUACA — ${data.name}, ${data.sys?.country || ''}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🌡️ ${data.main.temp}°C (terasa ${data.main.feels_like}°C)\n` +
        `☁️ ${data.weather?.[0]?.description}\n` +
        `💧 ${data.main.humidity}% · 💨 ${data.wind?.speed} m/s\n` +
        `🌅 Matahari: ${new Date(data.sys.sunrise * 1000).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WITA`,
        `📊 *DETAIL TEKNIS*\n` +
        `Tekanan ${data.main.pressure} hPa · Awan ${data.clouds?.all}%\n` +
        `_Sumber: OpenWeatherMap_`
    ];
    return messages;
}

/** Fallback gratis tanpa API key — wttr.in */
async function fetchWttr(location) {
    const q = encodeURIComponent(location.replace(/\s+/g, '+'));
    const { data } = await axios.get(`https://wttr.in/${q}`, {
        params: { format: 'j1' },
        timeout: 20000,
        headers: { 'User-Agent': 'LuxxBot/3.0', Accept: 'application/json' }
    });

    const cur = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    const city = area?.areaName?.[0]?.value || location;
    const region = area?.region?.[0]?.value || '';
    const country = area?.country?.[0]?.value || '';
    const today = data.weather?.[0];
    const tomorrow = data.weather?.[1];

    const messages = [];

    messages.push(
        `🌤️ *CUACA — ${city}*\n` +
        `📍 ${region} ${country}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🌡️ *Sekarang:* ${cur?.temp_C}°C (terasa ${cur?.FeelsLikeC}°C)\n` +
        `☁️ ${cur?.weatherDesc?.[0]?.value || cur?.lang_id?.[0]?.value || '—'}\n` +
        `💧 ${cur?.humidity}% · 💨 ${cur?.windspeedKmph} km/jam ${cur?.winddir16Point || ''}\n` +
        `🌧️ ${cur?.precipMM} mm · 👁️ ${cur?.visibility} km\n` +
        `🕐 ${cur?.observation_time || 'baru saja'}`
    );

    if (today) {
        messages.push(
            `📅 *HARI INI*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌅 Min ${today.mintempC}°C · Max ${today.maxtempC}°C\n` +
            `☀️ Terbit ${today.astronomy?.[0]?.sunrise} · 🌇 ${today.astronomy?.[0]?.sunset}\n` +
            `🌧️ Hujan ${today.hourly?.[4]?.chanceofrain || '?'}% (perkiraan)`
        );
    }

    if (tomorrow) {
        messages.push(
            `📆 *BESOK*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌡️ Min ${tomorrow.mintempC}°C · Max ${tomorrow.maxtempC}°C\n` +
            `☁️ ${tomorrow.hourly?.[4]?.weatherDesc?.[0]?.value || '—'}`
        );
    }

    messages.push(
        `💡 *Tips LuxxBot*\n` +
        `Bawa payung kalau peluang hujan tinggi ☔\n` +
        `_Sumber: wttr.in (gratis)_`
    );

    return messages;
}

/**
 * @returns {Promise<string[]>} beberapa pesan WA
 */
export async function getWeatherMessages(location) {
    const apiKey = getWeatherApiKey();
    const provider = apiKey ? detectProvider() : 'wttr';

    try {
        if (provider === 'weatherapi') {
            return await fetchWeatherApiCom(location, apiKey);
        }
        if (provider === 'openweather') {
            return await fetchOpenWeather(location, apiKey);
        }
        return await fetchWttr(location);
    } catch (primaryErr) {
        console.log('Cuaca primary fail:', primaryErr.message, '→ wttr fallback');
        try {
            return await fetchWttr(location);
        } catch (fallbackErr) {
            fallbackErr.message = fallbackErr.message || primaryErr.message;
            throw fallbackErr;
        }
    }
}

/** @deprecated use getWeatherMessages */
export async function getWeatherReport(location) {
    const msgs = await getWeatherMessages(location);
    return msgs.join('\n\n');
}