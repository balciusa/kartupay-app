import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabaseClient'
import { NewProjectModal } from '@/components/Home/NewProjectModal'

export default async function Home() {
  const supabase = createSupabaseServerClient()
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, total_cents, min_participants, status, canceled_at')
    .order('created_at', { ascending: false })

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <NewProjectModal />
      </div>

      {error && <div className="text-red-600">DB error: {error.message}</div>}

      <div className="grid gap-3">
        {(projects ?? []).length === 0 ? (
          <div className="rounded-xl border p-4">
            <div className="font-medium">No projects yet</div>
            <div className="text-sm opacity-70">
              Click <b>Create demo project</b> to add one automatically.
            </div>
          </div>
        ) : (
          projects!.map(p => {
            const isCanceled = p.status === 'canceled' || !!p.canceled_at
            return (
              <Link key={p.id} href={`/project/${p.id}`} className="rounded-xl border p-4 hover:bg-black/5 transition space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{p.title}</div>
                  {isCanceled && (
                    <span className="text-[11px] rounded-full bg-red-100 text-red-800 px-2 py-0.5 border border-red-200">
                      Canceled
                    </span>
                  )}
                </div>
                <div className="text-sm opacity-80">
                  Total: €{(p.total_cents/100).toFixed(2)} · Min: {p.min_participants}
                </div>
                {isCanceled ? (
                  <div className="text-xs text-red-700">
                    Canceled on {new Date(p.canceled_at as any).toLocaleString()}
                  </div>
                ) : (
                  <div className="text-xs uppercase tracking-wide opacity-60">{p.status}</div>
                )}
              </Link>
            )
          })
        )}
      </div>
    </main>
  )
}
