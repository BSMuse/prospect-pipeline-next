import { NextResponse } from 'next/server';
import { CATEGORY_GROUPS } from '@/lib/pipeline/places';

export async function GET() {
  return NextResponse.json(CATEGORY_GROUPS);
}
