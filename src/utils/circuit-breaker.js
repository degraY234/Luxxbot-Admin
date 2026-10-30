const states = new Map();

export class CircuitBreaker {
    constructor(name, opts = {}) {
        this.name = name;
        this.threshold = opts.threshold || 3;
        this.resetMs = opts.resetMs || 30000;
        this.fails = 0;
        this.state = 'closed';
        this.lastFail = 0;
    }

    async call(fn, ...args) {
        if (this.state === 'open') {
            if (Date.now() - this.lastFail > this.resetMs) {
                this.state = 'half';
            } else {
                throw new Error(`Circuit ${this.name} open`);
            }
        }
        try {
            const result = await fn(...args);
            this.fails = 0;
            this.state = 'closed';
            return result;
        } catch (e) {
            this.fails++;
            this.lastFail = Date.now();
            if (this.fails >= this.threshold) {
                this.state = 'open';
                console.warn(`🔌 Circuit ${this.name} OPEN (${this.fails} fails)`);
            }
            throw e;
        }
    }

    getStatus() {
        return {
            name: this.name,
            state: this.state,
            fails: this.fails,
            lastFail: this.lastFail ? new Date(this.lastFail).toISOString() : null
        };
    }
}

export function getCircuitStatuses() {
    const result = {};
    for (const [name, cb] of states) {
        result[name] = cb.getStatus();
    }
    return result;
}

export function createCircuit(name, opts) {
    const cb = new CircuitBreaker(name, opts);
    states.set(name, cb);
    return cb;
}
