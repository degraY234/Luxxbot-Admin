import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const PLUGIN_DIR = path.resolve('./plugins');
const commandRegistry = new Map();
const hooks = {
    startup: [],
    message: []
};

export function registerPluginCommand({ command, aliases = [], title, description, handler, showInMenu = false }) {
    if (!command || typeof handler !== 'function') return;
    const key = command.toLowerCase();
    if (commandRegistry.has(key)) {
        console.warn(`Plugin command ignored, already registered: ${key}`);
        return;
    }
    const entry = { command: key, aliases: aliases.map((a) => a.toLowerCase()), title: title || key, description: description || '', handler, showInMenu };
    commandRegistry.set(key, entry);
    for (const alias of entry.aliases) {
        if (!commandRegistry.has(alias)) {
            commandRegistry.set(alias, entry);
        }
    }
}

export function registerPluginHook(event, callback) {
    if (!hooks[event] || typeof callback !== 'function') return;
    hooks[event].push(callback);
}

export function getPluginCommand(command) {
    return commandRegistry.get(command.toLowerCase()) || null;
}

export function getMenuPluginButtons(maxButtons = 3) {
    return [...new Set([...commandRegistry.values()])]
        .filter((cmd) => cmd.showInMenu)
        .slice(0, maxButtons)
        .map((cmd) => ({ buttonId: `!${cmd.command}`, buttonText: { displayText: cmd.title }, type: 1 }));
}

export async function dispatchHook(event, data) {
    const listeners = hooks[event] || [];
    for (const listener of listeners) {
        try {
            await listener(data);
        } catch (err) {
            console.error(`Plugin hook error [${event}]:`, err?.message || err);
        }
    }
}

export async function initPlugins() {
    if (!fs.existsSync(PLUGIN_DIR)) {
        fs.mkdirSync(PLUGIN_DIR, { recursive: true });
        return;
    }
    if (hooks._initialized) return;
    hooks._initialized = true;

    const entries = fs.readdirSync(PLUGIN_DIR).filter((name) => name.endsWith('.js'));
    for (const fileName of entries) {
        const pluginPath = path.join(PLUGIN_DIR, fileName);
        try {
            const pluginUrl = pathToFileURL(pluginPath).href;
            const module = await import(pluginUrl);
            if (typeof module.register === 'function') {
                await module.register({ registerPluginCommand, registerPluginHook });
                console.log(`✅ Plugin loaded: ${fileName}`);
            } else {
                console.warn(`Plugin file missing register(): ${fileName}`);
            }
        } catch (err) {
            console.error(`❌ Plugin load failed: ${fileName}`, err?.message || err);
        }
    }
}

export function getLoadedPluginCommands() {
    return [...new Set([...commandRegistry.values()])];
}
