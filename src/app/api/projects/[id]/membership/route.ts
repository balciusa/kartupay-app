import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ active: false }, { status: 401, headers: noStoreHeaders })

  const { id: projectId } = await params
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('left_at', null)
    .limit(1)

  if (error) return NextResponse.json({ active: false }, { status: 503, headers: noStoreHeaders })
  if (!data?.length) return NextResponse.json({ active: false }, { status: 403, headers: noStoreHeaders })
  return NextResponse.json({ active: true }, { headers: noStoreHeaders })
}
