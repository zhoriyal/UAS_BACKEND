export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET wajib diatur di environment sebelum server dijalankan');
  }

  return secret;
}
