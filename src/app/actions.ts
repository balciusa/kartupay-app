'use server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function createDemoProject() {
  const deadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabaseAdmin.from('projects').insert({
    title: 'Beach House Weekend',
    description: 'Kartupay MVP demo project',
    currency: 'EUR',
    total_cents: 60000,
    min_participants: 3,
    deadline_at: deadline,
    created_by: null
  })
  if (error) throw error
  revalidatePath('/')
}
