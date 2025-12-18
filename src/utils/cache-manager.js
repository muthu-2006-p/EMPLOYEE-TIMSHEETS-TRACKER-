const NodeCache = require('node-cache');
const crypto = require('crypto');

/**
 * Centralized cache manager for chatbot performance optimization
 * 
 * Cache Types:
 * 1. Response Cache: Full chatbot responses (5 min TTL)
 * 2. Tool Cache: Individual tool execution results (2 min TTL)
 * 3. Query Cache: Database query results (1 min TTL)
 */

// Initialize cache instances with different TTLs
const responseCache = new NodeCache({
    stdTTL: 300, // 5 minutes
    checkperiod: 60, // Check for expired keys every 60 seconds
    useClones: false, // Better performance, no deep cloning
    maxKeys: 1000 // Limit cache size
});

const toolCache = new NodeCache({
    stdTTL: 120, // 2 minutes
    checkperiod: 30,
    useClones: false,
    maxKeys: 500
});

const queryCache = new NodeCache({
    stdTTL: 60, // 1 minute
    checkperiod: 20,
    useClones: false,
    maxKeys: 200
});

// In-flight request tracker to prevent duplicate concurrent requests
const inFlightRequests = new Map();

/**
 * Generate cache key from user context and message
 */
function generateCacheKey(userId, message, context = {}) {
    const normalized = message.toLowerCase().trim();
    const contextStr = JSON.stringify(context);
    const hash = crypto.createHash('md5')
        .update(`${userId}:${normalized}:${contextStr}`)
        .digest('hex');
    return hash;
}

/**
 * Get cached chatbot response
 */
function getCachedResponse(userId, message, context = {}) {
    const key = generateCacheKey(userId, message, context);
    return responseCache.get(key);
}

/**
 * Set cached chatbot response
 */
function setCachedResponse(userId, message, response, context = {}) {
    const key = generateCacheKey(userId, message, context);
    return responseCache.set(key, response);
}

/**
 * Get cached tool result
 */
function getCachedToolResult(toolName, userId, params = {}) {
    const key = `tool:${toolName}:${userId}:${JSON.stringify(params)}`;
    return toolCache.get(key);
}

/**
 * Set cached tool result
 */
function setCachedToolResult(toolName, userId, result, params = {}) {
    const key = `tool:${toolName}:${userId}:${JSON.stringify(params)}`;
    return toolCache.set(key, result);
}

/**
 * Get cached query result
 */
function getCachedQuery(queryKey) {
    return queryCache.get(queryKey);
}

/**
 * Set cached query result
 */
function setCachedQuery(queryKey, result, ttl = undefined) {
    return queryCache.set(queryKey, result, ttl);
}

/**
 * Invalidate all caches for a specific user
 * Call this when user submits new data (timesheet, task, etc.)
 */
function invalidateUserCache(userId) {
    // Clear response cache entries for this user
    const responseKeys = responseCache.keys();
    let cleared = 0;

    responseKeys.forEach(key => {
        const data = responseCache.get(key);
        if (data && data.userId === userId) {
            responseCache.del(key);
            cleared++;
        }
    });

    // Clear tool cache for this user
    const toolKeys = toolCache.keys();
    toolKeys.forEach(key => {
        if (key.includes(`:${userId}:`)) {
            toolCache.del(key);
            cleared++;
        }
    });

    return cleared;
}

/**
 * Invalidate specific tool cache for a user
 */
function invalidateToolCache(toolName, userId) {
    const toolKeys = toolCache.keys();
    let cleared = 0;

    toolKeys.forEach(key => {
        if (key.startsWith(`tool:${toolName}:${userId}`)) {
            toolCache.del(key);
            cleared++;
        }
    });

    return cleared;
}

/**
 * Clear all caches (use for admin operations or testing)
 */
function clearAllCaches() {
    responseCache.flushAll();
    toolCache.flushAll();
    queryCache.flushAll();
    inFlightRequests.clear();
    return true;
}

/**
 * Get cache statistics
 */
function getCacheStats() {
    return {
        response: {
            keys: responseCache.keys().length,
            hits: responseCache.getStats().hits,
            misses: responseCache.getStats().misses,
            hitRate: (responseCache.getStats().hits / (responseCache.getStats().hits + responseCache.getStats().misses) * 100).toFixed(2) + '%'
        },
        tool: {
            keys: toolCache.keys().length,
            hits: toolCache.getStats().hits,
            misses: toolCache.getStats().misses,
            hitRate: (toolCache.getStats().hits / (toolCache.getStats().hits + toolCache.getStats().misses) * 100).toFixed(2) + '%'
        },
        query: {
            keys: queryCache.keys().length,
            hits: queryCache.getStats().hits,
            misses: queryCache.getStats().misses,
            hitRate: (queryCache.getStats().hits / (queryCache.getStats().hits + queryCache.getStats().misses) * 100).toFixed(2) + '%'
        },
        inFlight: inFlightRequests.size
    };
}

/**
 * Deduplicate concurrent requests
 * If same request is in-flight, return the existing promise
 */
async function deduplicateRequest(key, promiseFactory) {
    // Check if request is already in flight
    if (inFlightRequests.has(key)) {
        return inFlightRequests.get(key);
    }

    // Create new promise and track it
    const promise = promiseFactory();
    inFlightRequests.set(key, promise);

    try {
        const result = await promise;
        return result;
    } finally {
        // Remove from in-flight after completion (with small delay)
        setTimeout(() => {
            inFlightRequests.delete(key);
        }, 500);
    }
}

module.exports = {
    // Response cache
    getCachedResponse,
    setCachedResponse,

    // Tool cache
    getCachedToolResult,
    setCachedToolResult,
    invalidateToolCache,

    // Query cache
    getCachedQuery,
    setCachedQuery,

    // Invalidation
    invalidateUserCache,
    clearAllCaches,

    // Stats and deduplication
    getCacheStats,
    deduplicateRequest,
    generateCacheKey
};
