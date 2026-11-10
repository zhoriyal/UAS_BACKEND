import 'express';

export interface AuthUser {
  id: number;
  nama: string;
  role: string;
  accountType?: 'USER' | 'ADMIN';
  username?: string;
  email?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
