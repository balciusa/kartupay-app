import { createSupabaseServerClient } from '@/lib/supabaseClient'
import { createDemoProject } from './actions'

export default async function Home() {
  const supabase = createSupabaseServerClient()
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, total_cents, min_participants, deadline_at, status')
    .order('created_at', { ascending: false })

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <form action={createDemoProject}>
          <button className="px-3 py-1.5 rounded bg-black text-white hover:opacity-90">
            Create demo project
          </button>
        </form>
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
          projects!.map(p => (
            <a key={p.id} href={`/project/${p.id}`} className="rounded-xl border p-4 hover:bg-black/5 transition">
              <div className="font-medium">{p.title}</div>
              <div className="text-sm opacity-80">
                Total: €{(p.total_cents/100).toFixed(2)} · Min: {p.min_participants}
              </div>
              <div className="text-xs opacity-60">Deadline: {new Date(p.deadline_at as any).toLocaleString()}</div>
              <div className="text-xs uppercase tracking-wide opacity-60">{p.status}</div>
            </a>
          ))
        )}
      </div>
    </main>
  )
}
