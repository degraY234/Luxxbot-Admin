/** Status koneksi WhatsApp — untuk health check & debug */
export const waStatus = {
    connection: 'init',
    lastOpen: 0,
    lastClose: 0,
    lastError: null,
    handlersReady: false,
    reconnects: 0
};

export function setWaConnection(connection, extra = {}) {
    waStatus.connection = connection || 'unknown';
    if (connection === 'open') {
        waStatus.lastOpen = Date.now();
        waStatus.lastError = null;
    }
    if (connection === 'close') {
        waStatus.lastClose = Date.now();
        waStatus.handlersReady = false;
        if (extra.error) waStatus.lastError = String(extra.error).slice(0, 200);
        if (extra.reconnect) waStatus.reconnects += 1;
    }
    Object.assign(waStatus, extra);
}

export function setWaHandlersReady(ready = true) {
    waStatus.handlersReady = ready;
}

export function getWaHealth() {
    const up = waStatus.connection === 'open';
    return {
        connected: up,
        connection: waStatus.connection,
        handlersReady: waStatus.handlersReady,
        lastOpen: waStatus.lastOpen || null,
        lastClose: waStatus.lastClose || null,
        reconnects: waStatus.reconnects,
        lastError: waStatus.lastError
    };
}