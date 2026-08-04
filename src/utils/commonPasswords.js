const fs = require('fs');
const path = require('path');

const LIST_PATH = path.join(__dirname, '../data/common-passwords.txt');
let commonPasswordsSet = new Set();
let blocklistLoaded = false;

try {
  const fileContent = fs.readFileSync(LIST_PATH, 'utf-8');
  commonPasswordsSet = new Set(
    fileContent
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0)
  );
  blocklistLoaded = true;
  console.log(`[Security] Loaded ${commonPasswordsSet.size} common passwords into blocklist.`);
} catch (error) {
  console.error('[Security Warning] Could not load common-passwords.txt:', error.message);
}

if (!blocklistLoaded && process.env.NODE_ENV === 'production') {
  throw new Error('[Security] common-passwords.txt failed to load — refusing to start in production.');
}

const isCommonPassword = (password) => {
  if (!password) return false;
  return commonPasswordsSet.has(String(password).trim().toLowerCase());
};

module.exports = { isCommonPassword, isBlocklistLoaded: () => blocklistLoaded };