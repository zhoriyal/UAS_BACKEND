/**
 * Aturan kekuatan password:
 * Minimal 6 karakter
 */

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password wajib diisi' };
  }

  if (password.length < 6) {
    return { valid: false, message: 'Password minimal terdiri dari 6 karakter' };
  }

  return { valid: true };
}

module.exports = {
  validatePasswordStrength,
};

