import { NextRequest, NextResponse } from 'next/server'
import { processDueProjectDateWork } from '@/lib/projectDateService'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processDueProjectDateWork()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[date-selection-reminders] Failed to process due work', error)
    return NextResponse.json({ ok: false, error: 'Date reminder processing failed' }, { status: 500 })
  }
}
