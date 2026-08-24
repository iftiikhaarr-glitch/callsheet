import { Film, FolderOpen, Grid2X2, Plus, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';

type AppShellProps = {
  children: ReactNode;
  projectTitle?: string;
};

export function AppShell({ children, projectTitle }: AppShellProps) {
  const [location] = useLocation();
  const inWorkspace = location.startsWith('/project/');

  return (
    <div className="callsheet-noise min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-[74px] items-center border-b border-sidebar-border px-6">
          <Link href="/" className="flex items-center gap-3" data-testid="link-home-logo">
            <span className="flex h-8 w-8 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
              <Film size={17} strokeWidth={2.5} />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">Callsheet</span>
          </Link>
        </div>
        <div className="px-3 py-6">
          <p className="tracking-caps px-3 text-[10px] font-semibold text-sidebar-foreground/45">Workspace</p>
          <nav className="mt-3 space-y-1">
            <Link
              href="/"
              data-testid="link-projects"
              className={`flex items-center gap-3 px-3 py-2.5 text-[13px] font-semibold transition-colors ${!inWorkspace ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`}
            >
              <Grid2X2 size={16} />
              Projects
            </Link>
            {inWorkspace && (
              <div className="mt-2 border-l border-sidebar-primary/40 py-1 pl-4">
                <p className="truncate pr-4 font-mono-ui text-[10px] uppercase tracking-wider text-sidebar-primary/90">{projectTitle || 'Current project'}</p>
                <p className="mt-1 text-[11px] text-sidebar-foreground/45">Scene breakdown</p>
              </div>
            )}
          </nav>
        </div>
        <div className="mt-auto border-t border-sidebar-border p-4">
          <div className="flex w-full items-center gap-3 px-2 py-2 text-left text-[12px] text-sidebar-foreground/40" data-testid="text-settings">
            <Settings2 size={15} />
            Workspace settings
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-sidebar-border pt-4">
            <span className="flex h-7 w-7 items-center justify-center bg-sidebar-primary text-[10px] font-bold text-sidebar-primary-foreground">AD</span>
            <div>
              <p className="text-[11px] font-bold">Alex Duarte</p>
              <p className="font-mono-ui text-[9px] text-sidebar-foreground/45">1st AD · offline</p>
            </div>
          </div>
        </div>
      </aside>
      <div className="md:pl-[238px]">
        <header className="flex h-[58px] items-center justify-between border-b border-border bg-card/80 px-5 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2" data-testid="link-mobile-logo">
            <span className="flex h-7 w-7 items-center justify-center bg-primary text-primary-foreground"><Film size={15} /></span>
            <span className="font-display font-bold">Callsheet</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground" data-testid="link-mobile-projects">
            <FolderOpen size={14} /> Projects
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}

export function NewProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} data-testid="button-new-project" className="inline-flex items-center gap-2 bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground transition-all hover:-translate-y-px hover:bg-primary/90 active:translate-y-0">
      <Plus size={15} /> New project
    </button>
  );
}