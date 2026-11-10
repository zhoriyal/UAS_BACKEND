export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export function validatePasswordStrength(password: unknown): PasswordValidationResult {
  if (typeof password !== 'string' || password.length === 0) {
    return { valid: false, message: 'Password wajib diisi' };
  }

  if (password.length < 8) {
    return { valid: false, message: 'Password minimal terdiri dari 8 karakter' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password harus memiliki huruf besar' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password harus memiliki huruf kecil' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password harus memiliki angka' };
  }

  return { valid: true };
}
