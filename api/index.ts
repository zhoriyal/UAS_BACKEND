import type { Request, Response } from 'express';
import app, { dbReady } from '../src/app';

export default async function handler(req: Request, res: Response) {
  await dbReady;
  return app(req, res);
}
