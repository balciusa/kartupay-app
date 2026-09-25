import LoginForm from './LoginForm'
import { getSafeProjectReturnPath } from '@/lib/projectInvite'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>
}) {
  const { redirect } = await searchParams
  const redirectPath = getSafeProjectReturnPath(redirect)

  return (
    <main className="mx-auto max-w-md py-6 md:py-8">
      <section className="surface-card p-6 md:p-7">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="text-sm text-muted-foreground">Access your projects and payment coordination tools.</p>
        </div>
        <div className="mt-5">
          <LoginForm redirectPath={redirectPath} />
        </div>
      </section>
    </main>
  )
}
