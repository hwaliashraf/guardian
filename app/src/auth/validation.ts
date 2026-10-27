const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAIRING_CODE_RE = /^\d{6}$/;

export function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Email is required';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

export function validatePairingCode(code: string): string | null {
  if (!code.trim()) return 'Pairing code is required';
  if (!PAIRING_CODE_RE.test(code.trim())) return 'Pairing code must be 6 digits';
  return null;
}
