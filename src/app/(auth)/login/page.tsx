import LoginForm from './LoginForm'

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md py-6 md:py-8">
      <section className="surface-card p-6 md:p-7">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="text-sm text-muted-foreground">Access your projects and payment coordination tools.</p>
        </div>
        <div className="mt-5">
          <LoginForm />
        </div>
      </section>
    </main>
  )
}
