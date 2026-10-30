const analytics = {
    commandUsage: new Map(),
    dailyStats: {},
    errors: [],
    startTime: Date.now()
};

export function trackCommand(command, userId, chatId, isGroup) {
    const key = command.toLowerCase();
    const entry = analytics.commandUsage.get(key) || { count: 0, users: new Set(), lastUsed: null };
    entry.count++;
    entry.lastUsed = new Date().toISOString();
    entry.users.add(userId);
    analytics.commandUsage.set(key, entry);

    const day = new Date().toISOString().slice(0, 10);
    if (!analytics.dailyStats[day]) analytics.dailyStats[day] = { commands: 0, users: new Set(), errors: 0 };
    analytics.dailyStats[day].commands++;
    analytics.dailyStats[day].users.add(userId);
}

export function trackError(tag, error, context = {}) {
    analytics.errors.push({
        time: new Date().toISOString(),
        tag,
        message: error?.message || String(error),
        stack: error?.stack ? String(error.stack).slice(0, 1000) : null,
        context
    });
    if (analytics.errors.length > 500) analytics.errors.shift();
}

export function getAnalytics() {
    const topCommands = [...analytics.commandUsage.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([cmd, data]) => ({
            command: cmd,
            count: data.count,
            uniqueUsers: data.users.size,
            lastUsed: data.lastUsed
        }));

    const today = new Date().toISOString().slice(0, 10);
    const todayStats = analytics.dailyStats[today] || { commands: 0, users: new Set(), errors: 0 };

    return {
        uptime: Math.floor((Date.now() - analytics.startTime) / 1000),
        totalCommands: [...analytics.commandUsage.values()].reduce((s, e) => s + e.count, 0),
        todayCommands: todayStats.commands,
        todayUniqueUsers: todayStats.users.size,
        topCommands,
        recentErrors: analytics.errors.slice(-20),
        totalErrors: analytics.errors.length
    };
}

export function resetAnalytics() {
    analytics.commandUsage.clear();
    analytics.dailyStats = {};
    analytics.errors = [];
    analytics.startTime = Date.now();
}
