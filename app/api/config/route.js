import { NextResponse } from 'next/server';
import openrouterLib from '@/src/openrouter.cjs';

export async function GET() {
  const { config } = openrouterLib;
  return NextResponse.json({
    model: config.model,
    categories: config.categories,
    currency: config.currency,
    region: config.region,
    hasKey: !!process.env.OPENROUTER_API_KEY,
  });
}
