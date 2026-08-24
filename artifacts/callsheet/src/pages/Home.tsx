import { useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { FileText, Play, Upload, ArrowUpRight, MoreHorizontal, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useCreateProject, useDeleteProject, useListProjects, useLoadSampleProject } from '@workspace/api-client-react';
import { getListProjectsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project } from '@workspace/api-client-react';
import { AppShell, NewProjectButton } from '@/components/AppShell';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function StatusPill({ status }: { status: Project['status'] }) {
  const labels = { ready: 'Ready', processing: 'Processing', draft: 'Draft', failed: 'Failed' };
  return <span data-testid={`status-project-${status}`} className={`inline-flex items-center gap-1.5 px-2 py-1 font-mono-ui text-[10px] font-medium uppercase tracking-wide ${status === 'ready' ? 'bg-[hsl(var(--chart-2)/.12)] text-[hsl(var(--chart-2))]' : status === 'processing' ? 'bg-[hsl(var(--accent)/.18)] text-[hsl(28_68%_35%)]' : status === 'failed' ? 'bg-[hsl(var(--destructive)/.1)] text-destructive' : 'bg-secondary text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'ready' ? 'bg-[hsl(var(--chart-2))]' : status === 'processing' ? 'bg-accent' : status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground/55'}`} />{labels[status]}</span>;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: projects, isLoading, isError, refetch } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const loadSample = useLoadSampleProject();
  const fileInput = useRef<HTMLInputElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeMenu, setActiveMenu] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const sortedProjects = useMemo(() => [...(projects || [])].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)), [projects]);
  const isBusy = createProject.isPending || loadSample.isPending || deleteProject.isPending || isUploading;

  const create = (sample = false) => {
    setUploadError(null);
    const projectTitle = title.trim() || (sample ? 'The Last Signal' : selectedFile?.name.replace(/\.[^/.]+$/, '') || 'Untitled screenplay');
    createProject.mutate({ data: { title: projectTitle, filename: selectedFile?.name || (sample ? 'the-last-signal.fdx' : null) } }, {
      onSuccess: async (project) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        if (sample) {
          loadSample.mutate({ projectId: project.id }, { onSuccess: () => setLocation(`/project/${project.id}`) });
        } else if (selectedFile) {
          setIsUploading(true);
          try {
            const body = new FormData();
            body.append('file', selectedFile);
            const response = await fetch(`/api/projects/${project.id}/process`, { method: 'POST', body });
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error(result.error || 'Screenplay processing failed.');
            await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            setLocation(`/project/${project.id}`);
          } catch (error) {
            setUploadError(error instanceof Error ? error.message : 'Screenplay processing failed.');
            await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            setLocation(`/project/${project.id}`);
          } finally {
            setIsUploading(false);
          }
        } else {
          setLocation(`/project/${project.id}`);
        }
      },
    });
  };

  const removeProject = (project: Project) => {
    const confirmed = window.confirm(`Delete "${project.title}"?\n\nThis permanently removes the project and all of its scenes.`);
    if (!confirmed) {
      setActiveMenu(null);
      return;
    }
    setUploadError(null);
    deleteProject.mutate({ projectId: project.id }, {
      onSuccess: async () => {
        setActiveMenu(null);
        await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      },
      onError: (error) => {
        setActiveMenu(null);
        setUploadError(error instanceof Error ? error.message : 'That project could not be deleted.');
      },
    });
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-12">
        <div className="animate-rise-in flex flex-col justify-between gap-6 border-b border-border pb-8 md:flex-row md:items-end">
          <div>
            <p className="tracking-caps font-mono-ui text-[10px] font-medium text-[hsl(var(--chart-2))]">Production control / 01</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-foreground md:text-5xl">Your projects<span className="text-accent">.</span></h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Break down the page. See the day. Keep the set moving.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => create(true)} disabled={isBusy} data-testid="button-load-sample-header" className="inline-flex items-center gap-2 border border-border bg-card px-3.5 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"><Play size={14} /> {loadSample.isPending ? 'Loading sample…' : 'Try sample'}</button>
            <NewProjectButton onClick={() => setShowCreate(true)} />
          </div>
        </div>

        {isLoading && <ProjectSkeleton />}
        {isError && <ErrorBlock onRetry={() => refetch()} />}
        {!isLoading && !isError && sortedProjects.length === 0 && (
          <section className="paper-grid animate-rise-in delay-1 mt-8 flex min-h-[340px] flex-col items-center justify-center border border-dashed border-border bg-card px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center border border-border bg-background text-muted-foreground"><FileText size={20} /></div>
            <h2 className="mt-5 font-display text-xl font-bold">Start with a screenplay</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Upload a script or load a sample breakdown to see your scenes in production order.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={() => setShowCreate(true)} data-testid="button-empty-upload" className="inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"><Upload size={14} /> Upload screenplay</button>
              <button onClick={() => create(true)} disabled={isBusy} data-testid="button-load-sample-empty" className="inline-flex items-center gap-2 border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground hover:bg-secondary disabled:opacity-50"><Play size={14} /> {loadSample.isPending ? 'Loading sample…' : 'Try sample script'}</button>
            </div>
          </section>
        )}
        {!isLoading && !isError && sortedProjects.length > 0 && (
          <section className="mt-8 animate-rise-in delay-1">
            <div className="mb-3 flex items-center justify-between">
              <p className="tracking-caps font-mono-ui text-[10px] font-medium text-muted-foreground">Recent breakdowns <span className="text-foreground">/ {sortedProjects.length}</span></p>
              <span className="font-mono-ui text-[10px] text-muted-foreground">Sorted by last touched</span>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {sortedProjects.map((project, index) => (
                <div key={project.id} data-testid={`row-project-${project.id}`} className="group relative flex flex-col gap-4 py-5 transition-colors hover:bg-card/70 md:flex-row md:items-center md:gap-8">
                  <div className="flex min-w-0 flex-1 items-center gap-4 pl-1">
                    <span className="font-mono-ui text-[11px] text-muted-foreground/65">{String(index + 1).padStart(2, '0')}</span>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-secondary text-[hsl(var(--chart-2))]"><FileText size={18} /></div>
                    <div className="min-w-0">
                      <Link href={`/project/${project.id}`} data-testid={`link-project-${project.id}`} className="block truncate font-display text-base font-bold hover:text-[hsl(var(--chart-2))]">{project.title}</Link>
                      <p className="mt-1 truncate font-mono-ui text-[10px] text-muted-foreground">{project.filename || 'No source file'} <span className="mx-1 text-border">·</span> updated {formatDate(project.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-7 pl-10 md:pl-0">
                    <div className="min-w-[70px]"><p className="font-mono-ui text-[10px] text-muted-foreground">SCENES</p><p className="mt-1 font-display text-lg font-bold">{project.sceneCount || '—'}</p></div>
                    <div className="w-28"><p className="font-mono-ui text-[10px] text-muted-foreground">PROGRESS</p><div className="mt-2 h-1 bg-secondary"><div className="h-1 bg-accent transition-all" style={{ width: `${Math.min(100, project.progress || 0)}%` }} /></div></div>
                    <StatusPill status={project.status} />
                    <button onClick={() => setActiveMenu(activeMenu === project.id ? null : project.id)} data-testid={`button-project-menu-${project.id}`} className="ml-auto p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><MoreHorizontal size={17} /></button>
                  </div>
                  {activeMenu === project.id && <div className="absolute right-0 top-14 z-10 min-w-44 border border-border bg-popover p-1 shadow-lg"><Link href={`/project/${project.id}`} onClick={() => setActiveMenu(null)} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-secondary" data-testid={`menu-open-project-${project.id}`}><ArrowUpRight size={13} /> Open breakdown</Link><button onClick={() => removeProject(project)} disabled={deleteProject.isPending} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-destructive hover:bg-[hsl(var(--destructive)/.08)] disabled:opacity-50" data-testid={`menu-delete-project-${project.id}`}><X size={13} /> Delete project</button></div>}
                </div>
              ))}
            </div>
          </section>
        )}
        {(createProject.isError || loadSample.isError || uploadError) && <div className="mt-5 border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] px-4 py-3 text-xs text-destructive" data-testid="error-project-mutation">{uploadError || 'That project could not be started. Check the source file and try again.'}</div>}
        <section className="mt-14 grid gap-4 border-t border-border pt-6 md:grid-cols-[1fr_auto] md:items-center">
          <p className="max-w-lg text-xs leading-5 text-muted-foreground">Callsheet turns a screenplay into a living stripboard: locations, time of day, cast, and every element your department needs to see.</p>
          <div className="flex items-center gap-2 font-mono-ui text-[10px] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-2))]" />System ready</div>
        </section>
      </main>
      {showCreate && <CreateDialog title={title} setTitle={setTitle} selectedFile={selectedFile} setSelectedFile={setSelectedFile} fileInput={fileInput} isUploading={isUploading} onClose={() => setShowCreate(false)} onCreate={() => { setShowCreate(false); create(false); }} />}
    </AppShell>
  );
}

function CreateDialog({ title, setTitle, selectedFile, setSelectedFile, fileInput, isUploading, onClose, onCreate }: { title: string; setTitle: (value: string) => void; selectedFile: File | null; setSelectedFile: (file: File | null) => void; fileInput: RefObject<HTMLInputElement | null>; isUploading: boolean; onClose: () => void; onCreate: () => void }) {
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-[hsl(var(--foreground)/.35)] p-5" role="dialog" aria-modal="true">
    <div className="animate-rise-in w-full max-w-lg border border-border bg-card p-6 shadow-2xl md:p-8">
      <div className="flex items-start justify-between"><div><p className="tracking-caps font-mono-ui text-[10px] text-[hsl(var(--chart-2))]">New breakdown</p><h2 className="mt-2 font-display text-2xl font-bold">Bring a script to set.</h2></div><button onClick={onClose} data-testid="button-close-create" className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button></div>
      <label className="mt-7 block text-xs font-bold">Project title<input value={title} onChange={(event) => setTitle(event.target.value)} data-testid="input-project-title" placeholder="e.g. The Last Signal" className="mt-2 w-full border border-input bg-background px-3 py-3 text-sm outline-none transition-colors focus:border-accent" /></label>
      <input ref={fileInput} type="file" accept=".fdx,.pdf,.txt,.docx" className="hidden" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} data-testid="input-screenplay-file" />
      <button onClick={() => fileInput.current?.click()} data-testid="button-choose-file" className="mt-5 flex w-full items-center gap-3 border border-dashed border-input bg-background px-4 py-4 text-left hover:border-[hsl(var(--chart-2))]"><span className="flex h-9 w-9 items-center justify-center bg-secondary text-[hsl(var(--chart-2))]"><Upload size={16} /></span><span><strong className="block text-xs">{selectedFile ? selectedFile.name : 'Choose screenplay file'}</strong><small className="mt-1 block text-[11px] text-muted-foreground">FDX, PDF, DOCX or plain text</small></span></button>
      <div className="mt-7 flex justify-end gap-3"><button onClick={onClose} disabled={isUploading} data-testid="button-cancel-create" className="px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40">Cancel</button><button onClick={onCreate} disabled={isUploading || (!title.trim() && !selectedFile)} data-testid="button-create-project" className="bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{isUploading ? 'Analyzing screenplay…' : 'Create breakdown'}</button></div>
    </div>
  </div>;
}

function ProjectSkeleton() {
  return <div className="mt-8 space-y-4" data-testid="loading-projects"><div className="h-4 w-32 animate-pulse bg-secondary" /><div className="h-20 animate-pulse bg-card" /><div className="h-20 animate-pulse bg-card" /><div className="h-20 animate-pulse bg-card" /></div>;
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return <section className="mt-8 border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] p-6" data-testid="error-projects"><p className="font-display font-bold">Projects could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">Check the production server, then try again.</p><button onClick={onRetry} data-testid="button-retry-projects" className="mt-4 border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-secondary">Retry request</button></section>;
}