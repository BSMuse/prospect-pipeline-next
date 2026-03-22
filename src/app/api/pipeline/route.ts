import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, runState } from '@/lib/pipeline/runner';

// GET /api/pipeline — return current run state (for polling)
export async function GET() {
  return NextResponse.json(runState);
}

// POST /api/pipeline — start a new run
export async function POST(req: NextRequest) {
  const { category, city } = await req.json();

  if (!category || !city) {
    return NextResponse.json({ error: 'category and city are required' }, { status: 400 });
  }
  if (runState.status === 'running') {
    return NextResponse.json({ error: 'Pipeline already running' }, { status: 409 });
  }

  // Fire and forget — UI polls for updates
  runPipeline(category, city).catch(console.error);

  return NextResponse.json({ ok: true, message: 'Pipeline started' });
}
