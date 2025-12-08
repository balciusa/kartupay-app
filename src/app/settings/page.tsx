import { getCurrentUserId } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { revalidatePath } from 'next/cache'

async function addLink(formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Sign in required')

  const type = (formData.get('ptype') as string) as 'revolut'|'swedbank'|'iban'
  const label = (formData.get('plabel') as string) || null
  const value = (formData.get('pvalue') as string) || ''
  const priority = Number(formData.get('ppriority') ?? 1)
  if (!value) return

  const { error } = await supabaseAdmin.from('user_payment_options').insert({
    user_id: uid, type, label, value, priority, is_active: true
  })
  if (error) throw error
  revalidatePath('/settings')
}

async function toggleActive(id: string, next: boolean) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Sign in required')
  const { error } = await supabaseAdmin.from('user_payment_options').update({ is_active: next }).eq('id', id).eq('user_id', uid)
  if (error) throw error
  revalidatePath('/settings')
}

async function removeLink(id: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Sign in required')
  const { error } = await supabaseAdmin.from('user_payment_options').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
  revalidatePath('/settings')
}

export default async function SettingsPage() {
  const uid = await getCurrentUserId()
  if (!uid) return <main className="p-6 max-w-3xl mx-auto">Please sign in.</main>

  const { data: links } = await supabaseAdmin
    .from('user_payment_options')
    .select('*')
    .eq('user_id', uid)
    .order('priority', { ascending: true })

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">User Settings</h1>

      <section className="border rounded-xl p-4 space-y-3">
        <h2 className="text-lg font-medium">Payment links</h2>
        <form action={addLink} className="grid md:grid-cols-5 gap-2">
          <select name="ptype" className="border rounded px-2 py-1">
            <option value="revolut">Revolut</option>
            <option value="swedbank">Swedbank</option>
            <option value="iban">IBAN</option>
          </select>
          <input name="plabel" placeholder="Label" className="border rounded px-2 py-1" />
          <input name="pvalue" placeholder="URL or IBAN" className="border rounded px-2 py-1 md:col-span-2" />
          <input name="ppriority" type="number" defaultValue={1} className="border rounded px-2 py-1" />
          <button className="px-3 py-1.5 rounded bg-black text-white md:col-span-5">Add</button>
        </form>

        <div className="space-y-2">
          {(links ?? []).length === 0 && <div className="text-sm opacity-60">No links yet.</div>}
          {(links ?? []).map(link => (
            <div key={link.id} className="flex items-center justify-between border rounded p-2">
              <div className="text-sm">
                <b>{link.label ?? link.type}</b> - {link.value}
                <span className="ml-2 text-xs opacity-60">p{link.priority}</span>
              </div>
              <div className="flex items-center gap-2">
                <form action={async () => { 'use server'; await toggleActive(link.id, !link.is_active) }}>
                  <button className="px-2 py-1 rounded border">{link.is_active ? 'Deactivate' : 'Activate'}</button>
                </form>
                <form action={async () => { 'use server'; await removeLink(link.id) }}>
                  <button className="px-2 py-1 rounded border">Delete</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
