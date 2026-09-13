import { revalidatePath } from 'next/cache'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import SetPasswordForm from '@/app/settings/SetPasswordForm'
import { Button } from '@/components/ui/button'
import type { ProjectFinanceMode } from '@/lib/projectFinance'

async function updateDisplayName(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  const displayName = (formData.get('display_name') as string)?.trim() || null

  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('users')
    .update({ display_name: displayName })
    .eq('id', uid)

  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

async function addLink(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Sign in required')

  const type = (formData.get('ptype') as string) as 'revolut' | 'swedbank' | 'iban'
  const label = (formData.get('plabel') as string) || null
  const value = (formData.get('pvalue') as string) || ''
  if (!value) return

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('user_payment_options')
    .select('id')
    .eq('user_id', uid)
    .order('priority', { ascending: true })
  if (existingErr) throw existingErr

  const hasExisting = (existing?.length ?? 0) > 0
  const shouldBeDefault = !hasExisting
  const priority = shouldBeDefault ? 0 : (existing?.length ?? 0) + 1

  const { error } = await supabaseAdmin
    .from('user_payment_options')
    .insert({
      user_id: uid,
      type,
      label,
      value,
      priority,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) throw error

  revalidatePath(`/project/${projectId}`)
}

async function removeLink(projectId: string, id: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Sign in required')
  const { error } = await supabaseAdmin.from('user_payment_options').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

async function setDefaultLink(projectId: string, id: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Sign in required')

  const { data: links, error } = await supabaseAdmin
    .from('user_payment_options')
    .select('id, priority')
    .eq('user_id', uid)
    .order('priority', { ascending: true })
  if (error) throw error
  if (!links?.some(l => l.id === id)) return

  const reorderedIds = [id, ...(links ?? []).filter(l => l.id !== id).map(l => l.id)]
  const updates = reorderedIds.map((linkId, idx) =>
    supabaseAdmin
      .from('user_payment_options')
      .update({ priority: idx })
      .eq('id', linkId)
      .eq('user_id', uid)
  )

  const results = await Promise.all(updates)
  const failed = results.find(r => 'error' in r && r.error)
  if (failed && 'error' in failed && failed.error) throw failed.error
  revalidatePath(`/project/${projectId}`)
}

export async function ProfileTab({ projectId, financeMode = 'managed' }: { projectId: string; financeMode?: ProjectFinanceMode }) {
  const uid = await getCurrentUserId()
  if (!uid) {
    return <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Please sign in to manage your profile.</div>
  }

  const supabase = await getSupabaseServer()
  const { data: me } = await supabase
    .from('users')
    .select('display_name, email')
    .eq('id', uid)
    .single()

  const { data: links } = financeMode === 'managed'
    ? await supabaseAdmin
        .from('user_payment_options')
        .select('*')
        .eq('user_id', uid)
        .order('priority', { ascending: true })
    : { data: [] }

  return (
    <div className="space-y-6">
      <section className="surface-card p-4 space-y-3">
        <h2 className="text-lg font-medium">Profile</h2>
        <form action={updateDisplayName.bind(null, projectId)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            name="display_name"
            defaultValue={me?.display_name ?? ''}
            placeholder="Your display name"
            className="control-input sm:max-w-sm"
          />
          <Button className="rounded-full" size="sm">Save</Button>
        </form>
        <p className="text-xs text-muted-foreground">
          This name is shown to other project participants. If empty, others see a masked email prefix or your short
          code.
        </p>
      </section>

      {financeMode === 'managed' && <section className="surface-card p-4 space-y-3">
        <h2 className="text-lg font-medium">Payment links</h2>
        <form action={addLink.bind(null, projectId)} className="grid items-center gap-2 md:grid-cols-4">
          <select name="ptype" className="control-select md:col-span-1">
            <option value="revolut">Revolut</option>
            <option value="swedbank">Swedbank</option>
            <option value="iban">IBAN</option>
          </select>
          <select name="plabel" className="control-select md:col-span-1">
            <option value="Payment Link">Payment Link</option>
            <option value="IBAN">IBAN</option>
          </select>
          <input name="pvalue" placeholder="URL or IBAN" className="control-input md:col-span-2" />
          <Button className="rounded-full md:col-span-4" size="sm">Add payment link</Button>
        </form>

        <div className="space-y-2">
          {(links ?? []).length === 0 && <div className="empty-state p-4">No links yet.</div>}
          {(links ?? []).map(link => {
            const bank = link.type === 'revolut' ? 'Revolut' : link.type === 'swedbank' ? 'Swedbank' : 'IBAN'
            const paymentType = link.label ?? (link.type === 'iban' ? 'IBAN' : 'Payment Link')
            const isDefault = links?.[0]?.id === link.id

            return (
              <div key={link.id} className="rounded-lg border bg-background px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm text-slate-800">
                    <span className="font-semibold">{bank}</span> - {paymentType} - {link.value}
                    {isDefault && (
                      <span className="ml-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isDefault && (
                      <form action={setDefaultLink.bind(null, projectId, link.id)}>
                        <Button size="sm" variant="outline">Set default</Button>
                      </form>
                    )}
                    <form action={removeLink.bind(null, projectId, link.id)}>
                      <Button size="sm" variant="outline">Delete</Button>
                    </form>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>}

      <section className="surface-card p-4">
        <SetPasswordForm />
      </section>
    </div>
  )
}
