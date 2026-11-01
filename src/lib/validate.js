/**
 * Helper validasi input backend
 */

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isValidEmail(email) {
  if (!isNonEmptyString(email)) return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.trim();
}

module.exports = {
  isNonEmptyString,
  isValidEmail,
  sanitizeString,
};

