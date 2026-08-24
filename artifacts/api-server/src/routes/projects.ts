import { Router, type IRouter } from "express";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import multer from "multer";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  callsheetProjectsTable,
  callsheetScenesTable,
  db,
  type CallsheetProject,
  type CallsheetScene,
} from "@workspace/db";
import { readPrivateScreenplay, savePrivateScreenplay } from "../lib/privateObjectStorage";
import { buildShootingSchedule, type RiskFlag, type ShootingSchedule } from "../lib/scheduling";

type Elements = Record<string, string[]>;
const BREAKDOWN_CATEGORIES = [
  "cast",
  "background",
  "props",
  "wardrobe",
  "vehicles",
  "stunts",
  "special_effects",
  "visual_effects",
  "animals",
  "set_dressing",
  "makeup_hair",
  "sound_music",
];
type Scene = {
  id: number;
  number: number;
  intExt: string;
  location: string;
  timeOfDay: string;
  pageEighths: number;
  synopsis: string;
  rawText: string;
  elements: Elements;
};

type Project = {
  id: number;
  title: string;
  filename: string | null;
  status: "draft" | "processing" | "ready" | "failed";
  sceneCount: number;
  progress: number;
  errorMessage: string | null;
  updatedAt: string;
};

const sampleScenes: Scene[] = [
  {
    id: 1,
    number: 1,
    intExt: "INT",
    location: "DINER",
    timeOfDay: "NIGHT",
    pageEighths: 6,
    synopsis: "Mara waits in a nearly empty diner as a storm builds outside.",
    rawText: "INT. THE BLUEBIRD DINER - NIGHT\n\nRain needles the windows. MARA, 32, watches the door while a jukebox plays low.",
    elements: {
      cast: ["MARA"],
      background: ["2 diner patrons", "WAITRESS"],
      props: ["coffee mug", "jukebox", "cell phone"],
      wardrobe: ["Mara's raincoat"],
      vehicles: [],
      stunts: [],
      special_effects: ["rain on windows"],
      visual_effects: [],
      animals: [],
      set_dressing: ["diner booths", "neon sign"],
      makeup_hair: [],
      sound_music: ["jukebox source music"],
    },
  },
  {
    id: 2,
    number: 2,
    intExt: "EXT",
    location: "ROOFTOP",
    timeOfDay: "NIGHT",
    pageEighths: 5,
    synopsis: "Mara confronts Elias on the roof and demands the missing drive.",
    rawText: "EXT. ROOFTOP - NIGHT\n\nMara steps onto the roof. ELIAS waits beside a black sedan, the drive in his hand.",
    elements: {
      cast: ["MARA", "ELIAS"],
      background: [],
      props: ["data drive", "flashlight"],
      wardrobe: ["Elias's tailored suit"],
      vehicles: ["black sedan"],
      stunts: ["Mara climbs fire escape"],
      special_effects: [],
      visual_effects: ["city skyline extension"],
      animals: [],
      set_dressing: ["water tower", "HVAC units"],
      makeup_hair: [],
      sound_music: ["distant sirens"],
    },
  },
  {
    id: 3,
    number: 3,
    intExt: "INT/EXT",
    location: "SEDAN",
    timeOfDay: "CONTINUOUS",
    pageEighths: 7,
    synopsis: "The pair race through the city while Elias reveals who is hunting them.",
    rawText: "INT./EXT. BLACK SEDAN - CONTINUOUS\n\nThe sedan tears away from the curb. Mara drives as Elias checks the rear window.",
    elements: {
      cast: ["MARA", "ELIAS"],
      background: ["passing pedestrians"],
      props: ["data drive", "dashboard phone"],
      wardrobe: [],
      vehicles: ["black sedan"],
      stunts: ["high-speed driving"],
      special_effects: [],
      visual_effects: ["driving plates", "traffic replacement"],
      animals: [],
      set_dressing: ["car interior"],
      makeup_hair: [],
      sound_music: ["engine source sound"],
    },
  },
  {
    id: 4,
    number: 4,
    intExt: "INT",
    location: "SAFEHOUSE",
    timeOfDay: "DAWN",
    pageEighths: 8,
    synopsis: "At dawn, Mara opens the drive and finds a photograph of her sister.",
    rawText: "INT. SAFEHOUSE - DAWN\n\nA bare room. Mara plugs in the drive. A photograph blooms on the monitor: her sister, alive.",
    elements: {
      cast: ["MARA"],
      background: [],
      props: ["laptop", "data drive", "photograph"],
      wardrobe: ["Mara's damp clothes"],
      vehicles: [],
      stunts: [],
      special_effects: [],
      visual_effects: ["monitor image"],
      animals: [],
      set_dressing: ["bare room", "folding table"],
      makeup_hair: ["tired eyes"],
      sound_music: ["computer startup tone"],
    },
  },
];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const pendingScheduleGenerations = new Map<number, Promise<ShootingSchedule>>();

class ScheduleChangedDuringAnalysisError extends Error {}

function asProject(project: CallsheetProject): Project {
  return {
    id: project.id,
    title: project.title,
    filename: project.filename,
    status: ["draft", "processing", "ready", "failed"].includes(project.status)
      ? project.status as Project["status"]
      : "failed",
    sceneCount: project.sceneCount,
    progress: project.progress,
    errorMessage: project.errorMessage,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function asScene(scene: CallsheetScene): Scene {
  return {
    id: scene.id,
    number: scene.number,
    intExt: scene.intExt,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    pageEighths: scene.pageEighths,
    synopsis: scene.synopsis,
    rawText: scene.rawText,
    elements: scene.elements,
  };
}

async function findProject(projectId: number) {
  const [project] = await db.select().from(callsheetProjectsTable).where(eq(callsheetProjectsTable.id, projectId));
  return project;
}

async function detail(project: CallsheetProject) {
  const scenes = (await db
    .select()
    .from(callsheetScenesTable)
    .where(eq(callsheetScenesTable.projectId, project.id))
    .orderBy(asc(callsheetScenesTable.number)))
    .map(asScene);
  const roles = new Map<string, number>();
  scenes.forEach((scene) =>
    (scene.elements.cast ?? []).forEach((role) => roles.set(role, (roles.get(role) ?? 0) + 1)),
  );
  const flagged = scenes
    .filter((scene) => ["stunts", "visual_effects", "animals", "vehicles"].some((key) => (scene.elements[key] ?? []).length))
    .map((scene) => `Scene ${scene.number} · ${scene.location}`);
  return {
    ...asProject(project),
    scenes,
    summary: {
      totalScenes: scenes.length,
      totalEighths: scenes.reduce((sum, scene) => sum + scene.pageEighths, 0),
      uniqueLocations: new Set(scenes.map((scene) => scene.location)).size,
      uniqueRoles: roles.size,
      cast: [...roles.entries()].map(([name, sceneCount]) => ({ name, sceneCount })),
      flagged,
    },
  };
}

async function replaceScenes(projectId: number, scenes: Scene[]) {
  await db.delete(callsheetScenesTable).where(eq(callsheetScenesTable.projectId, projectId));
  if (!scenes.length) return;
  await db.insert(callsheetScenesTable).values(scenes.map((scene) => ({
    projectId,
    number: scene.number,
    intExt: scene.intExt,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    pageEighths: scene.pageEighths,
    synopsis: scene.synopsis,
    rawText: scene.rawText,
    elements: scene.elements,
  })));
  await db.update(callsheetProjectsTable).set({ schedule: null, scheduleError: null }).where(eq(callsheetProjectsTable.id, projectId));
}

async function runGeminiBreakdown(file: { buffer: Buffer; originalname: string }): Promise<Scene[]> {
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "callsheet-breakdown-"));
  const tempPath = path.join(tempDir, safeName);
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const workerPath = path.resolve(workspaceRoot, "artifacts/api-server/breakdown_worker.py");
  const pythonPath = path.resolve(workspaceRoot, ".pythonlibs/bin/python");
  await writeFile(tempPath, file.buffer);
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const worker: ChildProcessWithoutNullStreams = spawn(pythonPath, [workerPath, tempPath], { env: process.env });
      let stdout = "";
      let stderr = "";
      worker.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      worker.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      worker.on("error", reject);
      worker.on("close", (code: number | null) => {
        if (code === 0) return resolve(stdout);
        const output = stderr || stdout;
        try {
          const result = JSON.parse(output) as { error?: string };
          if (result.error) return reject(new Error(result.error));
        } catch {
          // Preserve non-JSON worker output below.
        }
        return reject(new Error(output || `Gemini worker exited with code ${code}`));
      });
    });
    const result = JSON.parse(output) as { scenes?: Scene[]; error?: string };
    if (result.error || !result.scenes?.length) throw new Error(result.error || "Gemini returned no screenplay scenes.");
    return result.scenes;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runGeminiScheduleRationale(schedule: Omit<ShootingSchedule, "rationale">) {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const workerPath = path.resolve(workspaceRoot, "artifacts/api-server/breakdown_worker.py");
  const pythonPath = path.resolve(workspaceRoot, ".pythonlibs/bin/python");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "callsheet-schedule-"));
  const tempPath = path.join(tempDir, "schedule.json");
  await writeFile(tempPath, JSON.stringify(schedule));
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const worker: ChildProcessWithoutNullStreams = spawn(pythonPath, [workerPath, "--schedule-rationale", tempPath], { env: process.env });
      let stdout = "";
      let stderr = "";
      worker.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      worker.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      worker.on("error", reject);
      worker.on("close", (code: number | null) => {
        if (code === 0) return resolve(stdout);
        try {
          const result = JSON.parse(stderr || stdout) as { error?: string };
          if (result.error) return reject(new Error(result.error));
        } catch {
          // Preserve raw worker output below.
        }
        return reject(new Error(stderr || stdout || `Gemini rationale worker exited with code ${code}`));
      });
    });
    const result = JSON.parse(output) as { rationale?: string; error?: string };
    if (result.error || !result.rationale) throw new Error(result.error || "Gemini returned no schedule rationale.");
    return result.rationale;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runGeminiScheduleRisk(schedule: Omit<ShootingSchedule, "rationale">, scenes: Scene[]): Promise<RiskFlag[]> {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const workerPath = path.resolve(workspaceRoot, "artifacts/api-server/breakdown_worker.py");
  const pythonPath = path.resolve(workspaceRoot, ".pythonlibs/bin/python");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "callsheet-risk-"));
  const tempPath = path.join(tempDir, "risk-input.json");
  await writeFile(tempPath, JSON.stringify({ schedule, scenes }));
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const worker: ChildProcessWithoutNullStreams = spawn(pythonPath, [workerPath, "--schedule-risk", tempPath], { env: process.env });
      let stdout = "";
      let stderr = "";
      worker.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      worker.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      worker.on("error", reject);
      worker.on("close", (code: number | null) => {
        if (code === 0) return resolve(stdout);
        try {
          const result = JSON.parse(stderr || stdout) as { error?: string };
          if (result.error) return reject(new Error(result.error));
        } catch {
          // Preserve raw worker output below.
        }
        return reject(new Error(stderr || stdout || `Gemini risk worker exited with code ${code}`));
      });
    });
    const result = JSON.parse(output) as { riskFlags?: RiskFlag[]; error?: string };
    if (result.error) throw new Error(result.error);
    return Array.isArray(result.riskFlags) ? result.riskFlags : [];
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildReportPdf(data: { project: Project; scenes: Scene[]; schedule: ShootingSchedule }) {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const workerPath = path.resolve(workspaceRoot, "artifacts/api-server/breakdown_worker.py");
  const pythonPath = path.resolve(workspaceRoot, ".pythonlibs/bin/python");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "callsheet-report-"));
  const tempPath = path.join(tempDir, "report-input.json");
  const outputPath = path.join(tempDir, "report.pdf");
  await writeFile(tempPath, JSON.stringify(data));
  try {
    await new Promise<void>((resolve, reject) => {
      const worker: ChildProcessWithoutNullStreams = spawn(pythonPath, [workerPath, "--export-pdf", tempPath, outputPath], { env: process.env });
      let stderr = "";
      worker.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      worker.on("error", reject);
      worker.on("close", (code: number | null) => code === 0
        ? resolve()
        : reject(new Error(stderr || `PDF report worker exited with code ${code}`)));
    });
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, "\"\"")}"`;
}

function buildBreakdownCsv(scenes: Scene[]) {
  const categories = [...new Set([
    ...BREAKDOWN_CATEGORIES,
    ...scenes.flatMap((scene) => Object.keys(scene.elements || {})),
  ])];
  const headers = ["Scene", "INT/EXT", "Location", "Time of day", "Page eighths", "Synopsis", ...categories.map((category) => category.replace(/_/g, " "))];
  const rows = scenes.map((scene) => [
    scene.number,
    scene.intExt,
    scene.location,
    scene.timeOfDay,
    scene.pageEighths,
    scene.synopsis,
    ...categories.map((category) => scene.elements?.[category] ?? []),
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function reportSchedule(project: CallsheetProject, scenes: Scene[]) {
  return project.schedule
    ? project.schedule as ShootingSchedule
    : {
      ...buildShootingSchedule(scenes),
      rationale: "This schedule was generated from the current breakdown for export.",
      riskFlags: [],
      riskError: null,
    };
}

async function attachRiskToSchedule(projectId: number, schedule: ShootingSchedule): Promise<ShootingSchedule> {
  const project = await findProject(projectId);
  if (!project) throw new Error("Project not found");
  const scenes = (await db.select().from(callsheetScenesTable).where(eq(callsheetScenesTable.projectId, project.id)).orderBy(asc(callsheetScenesTable.number))).map(asScene);
  const riskFlags = await runGeminiScheduleRisk(schedule, scenes);
  const updatedSchedule: ShootingSchedule = { ...schedule, riskFlags, riskError: null };
  const [saved] = await db.update(callsheetProjectsTable).set({
    schedule: updatedSchedule,
    scheduleError: null,
  }).where(and(
    eq(callsheetProjectsTable.id, project.id),
    eq(callsheetProjectsTable.updatedAt, project.updatedAt),
  )).returning({ id: callsheetProjectsTable.id });
  if (!saved) throw new ScheduleChangedDuringAnalysisError("The breakdown changed while production risks were being analyzed.");
  return updatedSchedule;
}

async function createScheduleFromLatestScenes(projectId: number): Promise<ShootingSchedule> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const project = await findProject(projectId);
    if (!project) throw new Error("Project not found");
    if (project.schedule) {
      const savedSchedule = project.schedule as ShootingSchedule;
      if (Array.isArray(savedSchedule.riskFlags) && !savedSchedule.riskError) return savedSchedule;
      try {
        return await attachRiskToSchedule(projectId, savedSchedule);
      } catch (error) {
        if (error instanceof ScheduleChangedDuringAnalysisError) continue;
        const riskError = error instanceof Error ? error.message : "Production risk analysis failed.";
        const failedSchedule = { ...savedSchedule, riskFlags: savedSchedule.riskFlags ?? [], riskError };
        const [saved] = await db.update(callsheetProjectsTable).set({ schedule: failedSchedule }).where(and(
          eq(callsheetProjectsTable.id, project.id),
          eq(callsheetProjectsTable.updatedAt, project.updatedAt),
        )).returning({ id: callsheetProjectsTable.id });
        if (saved) return failedSchedule;
      }
    }

    const sourceUpdatedAt = project.updatedAt;
    const scenes = (await db
      .select()
      .from(callsheetScenesTable)
      .where(eq(callsheetScenesTable.projectId, project.id))
      .orderBy(asc(callsheetScenesTable.number)))
      .map(asScene);
    if (!scenes.length) throw new Error("Add screenplay scenes before generating a shooting schedule.");

    const baseSchedule = buildShootingSchedule(scenes);
    const rationale = await runGeminiScheduleRationale(baseSchedule);
    let riskFlags: RiskFlag[] = [];
    let riskError: string | null = null;
    const scheduleWithoutRationale = { ...baseSchedule, rationale };
    try {
      riskFlags = await runGeminiScheduleRisk(scheduleWithoutRationale, scenes);
    } catch (error) {
      riskError = error instanceof Error ? error.message : "Production risk analysis failed.";
    }
    const schedule: ShootingSchedule = { ...scheduleWithoutRationale, riskFlags, riskError };
    const [saved] = await db.update(callsheetProjectsTable).set({
      schedule,
      scheduleError: null,
    }).where(and(
      eq(callsheetProjectsTable.id, project.id),
      eq(callsheetProjectsTable.updatedAt, sourceUpdatedAt),
    )).returning({ id: callsheetProjectsTable.id });
    if (saved) return schedule;
  }
  throw new Error("The breakdown changed while the schedule was generating. Please try again.");
}

const router: IRouter = Router();

router.get("/projects", async (_req, res) => {
  const projects = await db.select().from(callsheetProjectsTable).orderBy(desc(callsheetProjectsTable.updatedAt));
  return res.json(projects.map(asProject));
});
router.post("/projects", async (req, res) => {
  const [project] = await db.insert(callsheetProjectsTable).values({
    title: typeof req.body?.title === "string" ? req.body.title : "Untitled screenplay",
    filename: typeof req.body?.filename === "string" ? req.body.filename : null,
  }).returning();
  return res.status(201).json(asProject(project));
});
router.get("/projects/:projectId", async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(await detail(project));
});
router.patch("/projects/:projectId", async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const [updated] = await db.update(callsheetProjectsTable).set({
    title: typeof req.body?.title === "string" ? req.body.title : project.title,
  }).where(eq(callsheetProjectsTable.id, project.id)).returning();
  return res.json(asProject(updated));
});
router.delete("/projects/:projectId", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const [project] = await db.select({ id: callsheetProjectsTable.id }).from(callsheetProjectsTable).where(eq(callsheetProjectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  await db.delete(callsheetProjectsTable).where(eq(callsheetProjectsTable.id, projectId));
  return res.status(204).send();
});
router.post("/projects/:projectId/sample", async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  await replaceScenes(project.id, sampleScenes);
  const [updated] = await db.update(callsheetProjectsTable).set({
    status: "ready",
    sceneCount: sampleScenes.length,
    progress: 100,
    filename: "the-last-signal-sample.pdf",
    errorMessage: null,
  }).where(eq(callsheetProjectsTable.id, project.id)).returning();
  return res.status(202).json(asProject(updated));
});
router.post("/projects/:projectId/process", upload.single("file"), async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  let sourceObjectKey = project.sourceObjectKey;
  let filename = project.filename;
  try {
    if (req.file) {
      sourceObjectKey = await savePrivateScreenplay(req.file);
      filename = req.file.originalname;
    }
    if (!sourceObjectKey || !filename) {
      return res.status(400).json({ error: "Attach a PDF or text screenplay as file before starting a breakdown." });
    }

    await db.update(callsheetProjectsTable).set({
      sourceObjectKey,
      filename,
      status: "processing",
      progress: 8,
      errorMessage: null,
    }).where(eq(callsheetProjectsTable.id, project.id));

    const buffer = req.file?.buffer ?? await readPrivateScreenplay(sourceObjectKey);
    const scenes = await runGeminiBreakdown({ buffer, originalname: filename });
    await replaceScenes(project.id, scenes);
    const [updated] = await db.update(callsheetProjectsTable).set({
      status: "ready",
      progress: 100,
      sceneCount: scenes.length,
      errorMessage: null,
    }).where(eq(callsheetProjectsTable.id, project.id)).returning();
    return res.status(202).json(asProject(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini screenplay breakdown failed.";
    await db.update(callsheetProjectsTable).set({
      sourceObjectKey,
      filename,
      status: "failed",
      progress: 0,
      sceneCount: 0,
      errorMessage: message,
    }).where(eq(callsheetProjectsTable.id, project.id));
    req.log.error({ err: error }, "Gemini screenplay breakdown failed");
    return res.status(502).json({ error: message });
  }
});
router.post("/projects/:projectId/schedule", async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.schedule) {
    const savedSchedule = project.schedule as ShootingSchedule;
    if (Array.isArray(savedSchedule.riskFlags) && !savedSchedule.riskError) return res.status(201).json(savedSchedule);
  }

  const pending = pendingScheduleGenerations.get(project.id);
  if (pending) {
    try {
      return res.status(201).json(await pending);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shooting schedule generation failed.";
      return res.status(502).json({ error: message });
    }
  }

  const generation = createScheduleFromLatestScenes(project.id);
  pendingScheduleGenerations.set(project.id, generation);
  try {
    const schedule = await generation;
    return res.status(201).json(schedule);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shooting schedule generation failed.";
    await db.update(callsheetProjectsTable).set({ scheduleError: message }).where(eq(callsheetProjectsTable.id, project.id));
    req.log.error({ err: error }, "Shooting schedule generation failed");
    return res.status(502).json({ error: message });
  } finally {
    pendingScheduleGenerations.delete(project.id);
  }
});
router.get("/projects/:projectId/export/csv", async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const scenes = (await db
    .select()
    .from(callsheetScenesTable)
    .where(eq(callsheetScenesTable.projectId, project.id))
    .orderBy(asc(callsheetScenesTable.number)))
    .map(asScene);
  const filename = `${project.title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "callsheet"}_breakdown.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${buildBreakdownCsv(scenes)}`);
});
router.get("/projects/:projectId/export/pdf", async (req, res) => {
  const project = await findProject(Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    const scenes = (await db
      .select()
      .from(callsheetScenesTable)
      .where(eq(callsheetScenesTable.projectId, project.id))
      .orderBy(asc(callsheetScenesTable.number)))
      .map(asScene);
    const pdf = await buildReportPdf({
      project: asProject(project),
      scenes,
      schedule: reportSchedule(project, scenes),
    });
    const filename = `${project.title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "callsheet"}_breakdown.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(pdf);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF report generation failed.";
    req.log.error({ err: error }, "PDF report generation failed");
    return res.status(502).json({ error: message });
  }
});
router.patch("/projects/:projectId/scenes/:sceneId", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const sceneId = Number(req.params.sceneId);
  const [scene] = await db.select().from(callsheetScenesTable).where(and(
    eq(callsheetScenesTable.projectId, projectId),
    eq(callsheetScenesTable.id, sceneId),
  ));
  if (!scene) return res.status(404).json({ error: "Scene not found" });
  const [updated] = await db.update(callsheetScenesTable).set({
    synopsis: typeof req.body?.synopsis === "string" ? req.body.synopsis : scene.synopsis,
    elements: req.body?.elements && typeof req.body.elements === "object"
      ? { ...scene.elements, ...req.body.elements }
      : scene.elements,
  }).where(eq(callsheetScenesTable.id, scene.id)).returning();
  await db.update(callsheetProjectsTable).set({ schedule: null, scheduleError: null }).where(eq(callsheetProjectsTable.id, projectId));
  return res.json(asScene(updated));
});

export default router;