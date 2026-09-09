import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-2xl font-black text-white shadow-pop">
            io
          </div>
          <h1 className="text-2xl font-bold tracking-tight">InfluenceOS</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your influencer marketing command center</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Demo access · <span className="font-medium text-foreground">admin@influenceos.app</span> ·{' '}
          <span className="font-medium text-foreground">Password123!</span>
        </p>
      </div>
    </div>
  );
}
