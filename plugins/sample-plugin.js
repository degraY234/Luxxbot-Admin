export async function register(api) {
    api.registerPluginCommand({
        command: 'hello',
        title: 'Hello',
        description: 'Balas halo dari plugin.',
        showInMenu: true,
        handler: async ({ sock, from, msg }) => {
            await sock.sendMessage(from, { text: '👋 Hai! Ini pesan dari plugin sample.' }, { quoted: msg });
        }
    });
}
