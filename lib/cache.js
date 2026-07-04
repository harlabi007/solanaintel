const NodeCache = require('node-cache');

// Default TTL: 30 seconds for live data, longer for heavy queries
const cache = new NodeCache({ stdTTL: 30, checkperiod: 10 });

module.exports = cache;
