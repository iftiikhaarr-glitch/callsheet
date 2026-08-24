import { Router, type IRouter } from "express";

type Elements = Record<string, string[]>;
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
  status: "draft" | "processing" | "ready";
  sceneCount: number;
  progress: number;
  updatedAt: string;
};

const categories = [
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

const projects: Project[] = [
  {
    id: 1,
    title: "The Last Signal",
    filename: "the-last-signal.pdf",
    status: "ready",
    sceneCount: sampleScenes.length,
    progress: 100,
    updatedAt: new Date().toISOString(),
  },
];

function detail(project: Project) {
  const roles = new Map<string, number>();
  sampleScenes.forEach((scene) =>
    (scene.elements.cast ?? []).forEach((role) => roles.set(role, (roles.get(role) ?? 0) + 1)),
  );
  const flagged = sampleScenes
    .filter((scene) => ["stunts", "visual_effects", "animals", "vehicles"].some((key) => (scene.elements[key] ?? []).length))
    .map((scene) => `Scene ${scene.number} · ${scene.location}`);
  return {
    ...project,
    scenes: sampleScenes,
    summary: {
      totalScenes: sampleScenes.length,
      totalEighths: sampleScenes.reduce((sum, scene) => sum + scene.pageEighths, 0),
      uniqueLocations: new Set(sampleScenes.map((scene) => scene.location)).size,
      uniqueRoles: roles.size,
      cast: [...roles.entries()].map(([name, sceneCount]) => ({ name, sceneCount })),
      flagged,
    },
  };
}

const router: IRouter = Router();

router.get("/projects", (_req, res) => res.json(projects));
router.post("/projects", (req, res) => {
  const project: Project = {
    id: projects.length + 1,
    title: typeof req.body?.title === "string" ? req.body.title : "Untitled screenplay",
    filename: typeof req.body?.filename === "string" ? req.body.filename : null,
    status: "draft",
    sceneCount: 0,
    progress: 0,
    updatedAt: new Date().toISOString(),
  };
  projects.push(project);
  res.status(201).json(project);
});
router.get("/projects/:projectId", (req, res) => {
  const project = projects.find((item) => item.id === Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(detail(project));
});
router.patch("/projects/:projectId", (req, res) => {
  const project = projects.find((item) => item.id === Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (typeof req.body?.title === "string") project.title = req.body.title;
  if (req.body?.status === "draft" || req.body?.status === "processing" || req.body?.status === "ready") project.status = req.body.status;
  project.updatedAt = new Date().toISOString();
  return res.json(project);
});
router.post("/projects/:projectId/sample", (req, res) => {
  const project = projects.find((item) => item.id === Number(req.params.projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });
  project.status = "ready";
  project.sceneCount = sampleScenes.length;
  project.progress = 100;
  project.filename = "the-last-signal-sample.pdf";
  return res.status(202).json(project);
});
router.patch("/projects/:projectId/scenes/:sceneId", (req, res) => {
  const scene = sampleScenes.find((item) => item.id === Number(req.params.sceneId));
  if (!scene) return res.status(404).json({ error: "Scene not found" });
  if (typeof req.body?.synopsis === "string") scene.synopsis = req.body.synopsis;
  if (req.body?.elements && typeof req.body.elements === "object") scene.elements = { ...scene.elements, ...req.body.elements };
  return res.json(scene);
});

export default router;