'use server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function createDemoProject() {
  const { error } = await supabaseAdmin.from('projects').insert({
    title: 'Beach House Weekend',
    description: 'Kartupay MVP demo project',
    currency: 'EUR',
    total_cents: 60000,
    min_participants: 3,
    created_by: null
  })
  if (error) throw error
  revalidatePath('/')
}
