import { getConfiguredPublicBaseUrl } from './radio-url.js';

export function getPublicBaseUrl() {
    const base = getConfiguredPublicBaseUrl();
    if (base) return base.replace(/\/$/, '');
    const port = Number(process.env.RADIO_PORT || process.env.PORT || 3920);
    return `http://127.0.0.1:${port}`;
}

export function getServiceLinks() {
    const base = getPublicBaseUrl();
    return {
        base,
        pair: `${base}/pair`,
        admin: `${base}/admin`,
        radio: `${base}/radio`,
        watch: `${base}/watch`,
        health: `${base}/health`
    };
}

/** Banner lengkap di logs — mirip oracle-deploy.sh */
export function printStartupBanner(context = 'startup') {
    const links = getServiceLinks();
    const isPublic = /^https:\/\//i.test(links.base);

    console.log('');
    console.log('\x1b[35m╔══════════════════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[35m║\x1b[0m  \x1b[1mLUXXBOT — LINK PENTING\x1b[0m                                          \x1b[35m║\x1b[0m');
    console.log('\x1b[35m╠══════════════════════════════════════════════════════════════╣\x1b[0m');
    console.log(`\x1b[35m║\x1b[0m  \x1b[33m📱 PAIR WA (buka di laptop)\x1b[0m                                   \x1b[35m║\x1b[0m`);
    console.log(`\x1b[35m║\x1b[0m  \x1b[32m${links.pair}\x1b[0m`);
    console.log('\x1b[35m║\x1b[0m                                                              \x1b[35m║\x1b[0m');
    console.log(`\x1b[35m║\x1b[0m  \x1b[36m🔐 Admin\x1b[0m    ${links.admin}`);
    console.log(`\x1b[35m║\x1b[0m  \x1b[36m📻 Radio\x1b[0m    ${links.radio}`);
    console.log(`\x1b[35m║\x1b[0m  \x1b[36m🎬 Watch\x1b[0m    ${links.watch}`);
    console.log(`\x1b[35m║\x1b[0m  \x1b[36m💚 Health\x1b[0m   ${links.health}`);
    console.log('\x1b[35m╠══════════════════════════════════════════════════════════════╣\x1b[0m');
    if (context === 'qr') {
        console.log('\x1b[35m║\x1b[0m  QR baru — refresh halaman pair di laptop lalu scan HP   \x1b[35m║\x1b[0m');
    } else {
        console.log('\x1b[35m║\x1b[0m  1) Copy link PAIR WA → buka di browser laptop           \x1b[35m║\x1b[0m');
        console.log('\x1b[35m║\x1b[0m  2) Tunggu QR muncul → scan pakai WhatsApp di HP         \x1b[35m║\x1b[0m');
    }
    if (!isPublic) {
        console.log('\x1b[35m║\x1b[0m  \x1b[33m⚠ Set RADIO_PUBLIC_URL / Railway domain untuk link publik\x1b[0m  \x1b[35m║\x1b[0m');
    }
    console.log('\x1b[35m╚══════════════════════════════════════════════════════════════╝\x1b[0m');
    console.log('');
}