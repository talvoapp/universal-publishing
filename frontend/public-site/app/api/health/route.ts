/**
 * Health check endpoint for Docker healthcheck.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'public-site',
    timestamp: new Date().toISOString(),
  });
}