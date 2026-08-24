import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check, ChevronRight, FileWarning, Layers3, MapPin, PanelLeft, RefreshCw, Save, Search, Tag, Users } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetProjectQueryKey, useGetProject, useUpdateProject, useUpdateScene } from '@workspace/api-client-react';
import type { Scene } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';

type ViewFilter = 'all' | 'INT.' | 'EXT.';

function pct(value: number) {
  return `${Math.max(0, Math.min(100, value || 0))}%`;
}

function Stat({ label, value, icon, accent = false }: { label: string; value: string | number; icon: ReactNode; accent?: boolean }) {
  return <div className={`border-l-2 px-4 py-1 ${accent ? 'border-accent' : 'border-border'}`}><div className="flex items-center gap-2 font-mono-ui text-[9px] font-medium uppercase tracking-[.14em] text-muted-foreground">{icon}{label}</div><p className="mt-2 font-display text-2xl font-bold tracking-tight">{value}</p></div>;
}

function SceneSkeleton() {
  return <div className="space-y-2 p-4" data-testid="loading-project-detail">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-14 animate-pulse bg-secondary" />)}</div>;
}

export default function Workspace() {
  const params = useParams<{ id?: string }>();
  const projectId = Number(params.id);
  const queryClient = useQueryClient();
  const { data: project, isLoading, isError, refetch } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: Number.isFinite(projectId) } });
  const updateProject = useUpdateProject();
  const updateScene = useUpdateScene();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [showRaw, setShowRaw] = useState(false);
  const [draftSynopsis, setDraftSynopsis] = useState('');
  const [draftElements, setDraftElements] = useState<Record<string, string[]>>({});
  const [newElement, setNewElement] = useState('');
  const [saved, setSaved] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  const scenes = project?.scenes || [];

  useEffect(() => {
    if (project?.status !== 'processing') return;
    const interval = window.setInterval(() => { void refetch(); }, 1500);
    return () => window.clearInterval(interval);
  }, [project?.status, refetch]);

  const locations = useMemo(() => Array.from(new Set(scenes.map((scene) => scene.location))).sort(), [scenes]);
  const filteredScenes = useMemo(() => scenes.filter((scene) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [scene.location, scene.synopsis, scene.number.toString()].some((field) => field.toLowerCase().includes(needle));
    const matchesType = viewFilter === 'all' || scene.intExt.toUpperCase().startsWith(viewFilter);
    const matchesLocation = locationFilter === 'all' || scene.location === locationFilter;
    return matchesSearch && matchesType && matchesLocation;
  }), [scenes, search, viewFilter, locationFilter]);
  const selectedScene = scenes.find((scene) => scene.id === selectedId) || filteredScenes[0] || scenes[0];

  useEffect(() => {
    if (selectedScene) {
      setSelectedId(selectedScene.id);
      setDraftSynopsis(selectedScene.synopsis);
      setDraftElements(selectedScene.elements || {});
      setShowRaw(false);
      setSaved(false);
    }
  }, [selectedScene?.id]); // initialize only when the selected record changes

  const saveScene = () => {
    if (!selectedScene) return;
    updateScene.mutate({ projectId, sceneId: selectedScene.id, data: { synopsis: draftSynopsis, elements: draftElements } }, {
      onSuccess: () => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2200);
      },
    });
  };

  const selectScene = (scene: Scene) => {
    setSelectedId(scene.id);
    setDraftSynopsis(scene.synopsis);
    setDraftElements(scene.elements || {});
    setSaved(false);
  };

  const addElement = () => {
    const value = newElement.trim();
    if (!value) return;
    setDraftElements((current) => ({ ...current, General: [...(current.General || []), value] }));
    setNewElement('');
  };

  const removeElement = (category: string, index: number) => {
    setDraftElements((current) => ({ ...current, [category]: current[category].filter((_, itemIndex) => itemIndex !== index) }));
  };

  const startRename = () => {
    setTitleDraft(project?.title || '');
    setRenaming(true);
  };

  const saveTitle = () => {
    if (!titleDraft.trim() || !project) return;
    updateProject.mutate({ projectId, data: { title: titleDraft.trim() } }, { onSuccess: (updated) => { queryClient.setQueryData(getGetProjectQueryKey(projectId), (current: typeof project | undefined) => current ? { ...current, title: updated.title } : current); setRenaming(false); } });
  };

  const reprocessSavedScreenplay = async () => {
    if (!project) return;
    setIsReprocessing(true);
    setReprocessError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/process`, { method: 'POST' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Saved screenplay processing failed.');
      await queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      await refetch();
    } catch (error) {
      setReprocessError(error instanceof Error ? error.message : 'Saved screenplay processing failed.');
    } finally {
      setIsReprocessing(false);
    }
  };

  return (
    <AppShell projectTitle={project?.title}>
      <main className="min-h-[calc(100dvh-58px)] bg-background md:min-h-[100dvh]">
        <div className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-6 md:px-10 md:py-8">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-mono-ui text-[10px] text-muted-foreground"><Link href="/" className="hover:text-foreground" data-testid="link-back-projects">Projects</Link><ChevronRight size={12} /><span className="text-[hsl(var(--chart-2))]">Breakdown</span></div>
                <div className="mt-3 flex items-center gap-3">
                  {renaming ? <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveTitle()} autoFocus data-testid="input-edit-project-title" className="w-full max-w-md border-b-2 border-accent bg-transparent font-display text-3xl font-bold outline-none md:text-4xl" /> : <h1 data-testid="text-project-title" className="truncate font-display text-3xl font-bold tracking-[-0.04em] md:text-4xl">{project?.title || 'Loading breakdown'}</h1>}
                  {project && !renaming && <button onClick={startRename} data-testid="button-rename-project" className="shrink-0 border-b border-transparent font-mono-ui text-[9px] uppercase tracking-wider text-muted-foreground hover:border-accent hover:text-foreground">Rename</button>}
                  {renaming && <button onClick={saveTitle} data-testid="button-save-project-title" className="shrink-0 bg-accent px-2 py-1 font-mono-ui text-[9px] font-bold uppercase">Save</button>}
                </div>
                <p className="mt-2 font-mono-ui text-[10px] text-muted-foreground">{project?.filename || 'No source file'} <span className="mx-2 text-border">/</span> {project ? `${project.sceneCount} scenes` : 'Preparing workspace'}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32"><div className="mb-2 flex justify-between font-mono-ui text-[9px] uppercase text-muted-foreground"><span>Breakdown</span><span>{project?.progress || 0}%</span></div><div className="h-1 bg-secondary"><div className="h-1 bg-accent transition-all duration-500" style={{ width: pct(project?.progress || 0) }} /></div></div>
                <span data-testid="status-workspace" className={`border px-2 py-1 font-mono-ui text-[9px] uppercase tracking-wider ${project?.status === 'ready' ? 'border-[hsl(var(--chart-2)/.3)] text-[hsl(var(--chart-2))]' : project?.status === 'failed' ? 'border-[hsl(var(--destructive)/.4)] text-destructive' : 'border-accent/50 text-[hsl(28_68%_35%)]'}`}>{project?.status || 'loading'}</span>
              </div>
            </div>
            {isLoading ? <div className="h-16 animate-pulse bg-secondary" /> : project && <div className="border-t border-border pt-5">
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 md:max-w-3xl">
                <Stat label="Scenes" value={project.summary.totalScenes} icon={<Layers3 size={12} />} accent />
                <Stat label="Page eighths" value={project.summary.totalEighths} icon={<FileWarning size={12} />} />
                <Stat label="Locations" value={project.summary.uniqueLocations} icon={<MapPin size={12} />} />
                <Stat label="Roles" value={project.summary.uniqueRoles} icon={<Users size={12} />} />
              </div>
              {project.summary.flagged.length > 0 && <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4" data-testid="summary-flagged"><span className="flex items-center gap-1.5 font-mono-ui text-[9px] font-medium uppercase tracking-wider text-[hsl(var(--destructive))]"><AlertTriangle size={12} /> Needs review</span>{project.summary.flagged.map((item, index) => <span key={`${item}-${index}`} className="border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] px-2 py-1 text-[10px] text-muted-foreground">{item}</span>)}</div>}
            </div>}
          </div>
        </div>

        {isLoading && <div className="mx-auto max-w-[1600px] px-5 py-7 md:px-10"><SceneSkeleton /></div>}
        {isError && <div className="mx-auto max-w-[1600px] px-5 py-12 md:px-10"><div className="border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] p-7" data-testid="error-project-detail"><div className="flex items-center gap-3"><AlertTriangle size={19} className="text-destructive" /><h2 className="font-display text-lg font-bold">This breakdown is unavailable.</h2></div><p className="mt-2 text-sm text-muted-foreground">The project may still be processing or the request failed.</p><button onClick={() => refetch()} data-testid="button-retry-project-detail" className="mt-5 inline-flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-secondary"><RefreshCw size={13} /> Retry request</button></div></div>}
        {!isLoading && !isError && project && (
          <div className="mx-auto max-w-[1600px] px-5 py-6 md:px-10 md:py-8">
            <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div><p className="tracking-caps font-mono-ui text-[10px] font-medium text-muted-foreground">Scene index <span className="text-foreground">/ {filteredScenes.length} shown</span></p><p className="mt-1 text-xs text-muted-foreground">Select a scene to inspect and correct the AI breakdown.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-scene-search" placeholder="Find scene or location" className="h-9 w-52 border border-input bg-card pl-9 pr-3 text-xs outline-none focus:border-accent" /></label>
                <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} data-testid="select-location-filter" className="h-9 border border-input bg-card px-2 text-xs outline-none focus:border-accent"><option value="all">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select>
                <div className="flex h-9 border border-input bg-card p-0.5" role="group" aria-label="Scene type filter">{(['all', 'INT.', 'EXT.'] as ViewFilter[]).map((filter) => <button key={filter} onClick={() => setViewFilter(filter)} data-testid={`button-filter-${filter.toLowerCase().replace('.', '')}`} className={`px-2.5 font-mono-ui text-[9px] uppercase transition-colors ${viewFilter === filter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{filter === 'all' ? 'All' : filter}</button>)}</div>
              </div>
            </div>
            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,.85fr)]">
              <section className="min-w-0 border border-border bg-card" data-testid="scene-table">
                <div className="hidden grid-cols-[52px_72px_minmax(130px,1fr)_90px_70px_34px] gap-3 border-b border-border bg-secondary/50 px-4 py-2.5 font-mono-ui text-[9px] uppercase tracking-wider text-muted-foreground md:grid"><span>#</span><span>Set</span><span>Location</span><span>Time</span><span>Pages</span><span /></div>
                {filteredScenes.length === 0 && <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center" data-testid="empty-scenes"><div className="flex h-10 w-10 items-center justify-center bg-secondary text-muted-foreground"><Search size={17} /></div><p className="mt-4 font-display font-bold">No scenes match that filter.</p><button onClick={() => { setSearch(''); setLocationFilter('all'); setViewFilter('all'); }} data-testid="button-clear-scene-filters" className="mt-3 text-xs font-bold text-[hsl(var(--chart-2))] hover:underline">Clear filters</button></div>}
                <div className="divide-y divide-border">
                  {filteredScenes.map((scene) => <button key={scene.id} onClick={() => selectScene(scene)} data-testid={`row-scene-${scene.id}`} className={`grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/55 md:grid-cols-[52px_72px_minmax(130px,1fr)_90px_70px_34px] ${selectedScene?.id === scene.id ? 'border-l-2 border-accent bg-[hsl(var(--accent)/.09)] pl-[14px] md:pl-[14px]' : 'border-l-2 border-transparent'}`}>
                    <span className="font-mono-ui text-xs font-medium text-foreground">{String(scene.number).padStart(2, '0')}</span>
                    <span className={`hidden w-fit px-1.5 py-1 font-mono-ui text-[9px] font-bold uppercase md:inline-block ${scene.intExt.toUpperCase().startsWith('EXT') ? 'bg-[hsl(var(--chart-2)/.14)] text-[hsl(var(--chart-2))]' : 'bg-secondary text-muted-foreground'}`}>{scene.intExt}</span>
                    <span className="min-w-0"><strong className="block truncate text-xs font-bold md:text-[13px]">{scene.location}</strong><small className="mt-1 block truncate text-[10px] text-muted-foreground">{scene.synopsis || 'No synopsis yet'}</small></span>
                    <span className="hidden font-mono-ui text-[10px] text-muted-foreground md:block">{scene.timeOfDay}</span>
                    <span className="font-mono-ui text-[10px] text-muted-foreground">{scene.pageEighths}/8</span>
                    <ChevronRight size={14} className={`justify-self-end text-muted-foreground transition-transform ${selectedScene?.id === scene.id ? 'translate-x-0.5 text-accent' : ''}`} />
                  </button>)}
                </div>
              </section>
              <SceneDetail scene={selectedScene} draftSynopsis={draftSynopsis} setDraftSynopsis={setDraftSynopsis} draftElements={draftElements} newElement={newElement} setNewElement={setNewElement} addElement={addElement} removeElement={removeElement} saveScene={saveScene} showRaw={showRaw} setShowRaw={setShowRaw} isSaving={updateScene.isPending} saveError={updateScene.isError} saved={saved} />
            </div>
            {project.status === 'failed' && <div className="border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] px-4 py-4" data-testid="error-breakdown-worker"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-bold text-destructive"><AlertTriangle size={14} /> Screenplay processing failed</p><p className="mt-2 break-words font-mono-ui text-[11px] leading-5 text-muted-foreground">{reprocessError || project.errorMessage || 'No worker error was recorded.'}</p></div>{project.filename && <button onClick={reprocessSavedScreenplay} disabled={isReprocessing} data-testid="button-reprocess-screenplay" className="inline-flex shrink-0 items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-50"><RefreshCw size={13} className={isReprocessing ? 'animate-spin' : ''} />{isReprocessing ? 'Re-running…' : 'Re-run saved screenplay'}</button>}</div></div>}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function SceneDetail({ scene, draftSynopsis, setDraftSynopsis, draftElements, newElement, setNewElement, addElement, removeElement, saveScene, showRaw, setShowRaw, isSaving, saveError, saved }: { scene?: Scene; draftSynopsis: string; setDraftSynopsis: (value: string) => void; draftElements: Record<string, string[]>; newElement: string; setNewElement: (value: string) => void; addElement: () => void; removeElement: (category: string, index: number) => void; saveScene: () => void; showRaw: boolean; setShowRaw: (value: boolean) => void; isSaving: boolean; saveError: boolean; saved: boolean }) {
  if (!scene) return <aside className="flex min-h-[420px] items-center justify-center border border-dashed border-border bg-card p-8 text-center" data-testid="empty-scene-detail"><div><PanelLeft size={22} className="mx-auto text-muted-foreground" /><p className="mt-3 font-display font-bold">Select a scene</p><p className="mt-1 text-xs text-muted-foreground">Scene notes will appear here.</p></div></aside>;
  return <aside className="min-w-0 border border-border bg-card" data-testid={`scene-detail-${scene.id}`}>
    <div className="flex items-start justify-between border-b border-border bg-secondary/35 px-5 py-4"><div><div className="flex items-center gap-2"><span className="font-mono-ui text-[10px] text-accent">SCENE {String(scene.number).padStart(2, '0')}</span><span className="text-border">/</span><span className="font-mono-ui text-[10px] text-muted-foreground">{scene.intExt} · {scene.timeOfDay}</span></div><h2 className="mt-2 font-display text-xl font-bold">{scene.location}</h2></div><span className="border border-border bg-card px-2 py-1 font-mono-ui text-[10px] text-muted-foreground">{scene.pageEighths}/8 pgs</span></div>
    <div className="p-5">
      <label className="block"><span className="flex items-center gap-2 font-mono-ui text-[9px] font-medium uppercase tracking-wider text-muted-foreground"><Tag size={12} /> AI synopsis / editable</span><textarea value={draftSynopsis} onChange={(event) => setDraftSynopsis(event.target.value)} data-testid={`textarea-scene-synopsis-${scene.id}`} className="mt-2 min-h-[96px] w-full resize-y border border-input bg-background p-3 text-xs leading-5 outline-none transition-colors focus:border-accent" /></label>
      <div className="mt-6"><div className="flex items-center justify-between"><span className="flex items-center gap-2 font-mono-ui text-[9px] font-medium uppercase tracking-wider text-muted-foreground"><Layers3 size={12} /> Elements</span><span className="font-mono-ui text-[9px] text-muted-foreground">{Object.values(draftElements).flat().length} tagged</span></div>
        <div className="mt-3 space-y-3">{Object.entries(draftElements).filter(([, values]) => values.length).map(([category, values]) => <div key={category}><p className="mb-1.5 text-[10px] font-bold text-muted-foreground">{category}</p><div className="flex flex-wrap gap-1.5">{values.map((value, index) => <span key={`${category}-${value}-${index}`} data-testid={`tag-element-${scene.id}-${index}`} className="group inline-flex items-center gap-1 border border-border bg-background px-2 py-1 font-mono-ui text-[10px] text-foreground">{value}<button onClick={() => removeElement(category, index)} data-testid={`button-remove-element-${scene.id}-${index}`} className="ml-1 text-muted-foreground hover:text-destructive">×</button></span>)}</div></div>)}</div>
        <div className="mt-4 flex gap-2"><input value={newElement} onChange={(event) => setNewElement(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addElement()} data-testid={`input-add-element-${scene.id}`} placeholder="Add element tag…" className="min-w-0 flex-1 border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-accent" /><button onClick={addElement} data-testid={`button-add-element-${scene.id}`} className="border border-border bg-secondary px-3 text-xs font-bold hover:bg-secondary/70">Add</button></div>
      </div>
      <div className="mt-6 border-t border-border pt-4"><button onClick={() => setShowRaw(!showRaw)} data-testid={`button-toggle-raw-${scene.id}`} className="flex w-full items-center justify-between text-left font-mono-ui text-[9px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"><span>Source script text</span><ChevronRight size={14} className={`transition-transform ${showRaw ? 'rotate-90' : ''}`} /></button>{showRaw && <pre data-testid={`text-raw-scene-${scene.id}`} className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap border-l-2 border-accent bg-background p-3 font-mono-ui text-[10px] leading-5 text-muted-foreground">{scene.rawText || 'No source text available.'}</pre>}</div>
      <div className="mt-6 flex items-center justify-between gap-3"><span className="text-[10px] text-muted-foreground">{saved ? <span className="flex items-center gap-1.5 text-[hsl(var(--chart-2))]"><Check size={13} /> Saved to breakdown</span> : saveError ? <span className="text-destructive">Save failed. Try again.</span> : 'Changes are saved to this scene.'}</span><button onClick={saveScene} disabled={isSaving} data-testid={`button-save-scene-${scene.id}`} className="inline-flex items-center gap-2 bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50">{isSaving ? 'Saving…' : <><Save size={13} /> Save scene</>}</button></div>
    </div>
  </aside>;
}