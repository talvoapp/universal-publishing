/**
 * Quota controller — read-only status.
 */

import type { Request, Response } from 'express';
import { getCurrentUser } from '@/middleware/auth.middleware';
import * as quotaService from '@/services/quota.service';

export async function get(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const status = await quotaService.getQuotaStatus({
    userId: user.id,
    role: user.role,
  });
  res.status(200).json(status);
}