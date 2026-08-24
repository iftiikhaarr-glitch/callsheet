import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';

export default function NotFound() {
  return (
    <AppShell>
      <main className="paper-grid flex min-h-[calc(100dvh-58px)] items-center justify-center px-5 md:min-h-[100dvh]">
        <div className="w-full max-w-md border border-border bg-card p-7 md:p-9" data-testid="error-not-found">
          <div className="flex items-center gap-3 text-accent"><AlertCircle size={22} /><span className="font-mono-ui text-[10px] uppercase tracking-widest">Signal lost / 404</span></div>
          <h1 className="mt-5 font-display text-3xl font-bold tracking-tight">That page is off the call sheet.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">The address does not point to an active production workspace.</p>
          <Link href="/" data-testid="link-not-found-home" className="mt-7 inline-flex bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90">Return to projects</Link>
        </div>
      </main>
    </AppShell>
  );
}
