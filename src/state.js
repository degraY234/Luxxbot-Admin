export const state = {
    isSelfMode: false,
    isSleeping: false,
    antiLink: false,
    isProcessingQueue: false
};

export const cooldowns = new Map();
export const userAIContext = new Map();
export const imageCache = new Map();
export const aiQueue = [];