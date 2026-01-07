'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'

export async function updateDisplayName(formData: FormData) {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  const displayName = (formData.get('display_name') as string)?.trim() || null

  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('users')
    .update({ display_name: displayName })
    .eq('id', uid)

  if (error) throw error
  revalidatePath('/settings')
}
