export const DAILY_TARGET_EIGHTHS = 40;

export type ScheduleSceneInput = {
  id: number;
  number: number;
  location: string;
  intExt: string;
  timeOfDay: string;
  pageEighths: number;
  synopsis: string;
  elements: Record<string, string[]>;
};

export type DayStatus = "Work" | "Hold" | "Travel" | "Off";

export type ScheduleScene = {
  id: number;
  number: number;
  intExt: string;
  timeOfDay: string;
  pageEighths: number;
  synopsis: string;
};

export type ScheduleDay = {
  dayNumber: number;
  weekday: string;
  location: string;
  intExt: string;
  timeOfDay: string;
  pageEighths: number;
  cast: string[];
  scenes: ScheduleScene[];
};

export type DayOutOfDaysRow = {
  castMember: string;
  statuses: DayStatus[];
};

export type ShootingSchedule = {
  targetEighths: number;
  totalDays: number;
  scriptOrderDays: number;
  daysSaved: number;
  rationale: string;
  days: ScheduleDay[];
  dayOutOfDays: DayOutOfDaysRow[];
};

type WorkGroup = {
  location: string;
  intExt: string;
  timeOfDay: string;
  scenes: ScheduleSceneInput[];
  pageEighths: number;
  cast: Set<string>;
};

function shootingWindow(timeOfDay: string) {
  const value = timeOfDay.toUpperCase();
  if (["DAY", "DAWN", "MORNING"].includes(value)) return "DAY";
  if (["NIGHT", "DUSK", "EVENING"].includes(value)) return "NIGHT";
  return value;
}

function sceneCast(scene: ScheduleSceneInput) {
  return scene.elements.cast ?? [];
}

function groupScenes(scenes: ScheduleSceneInput[]) {
  const groups = new Map<string, WorkGroup>();
  for (const scene of scenes) {
    const timeOfDay = shootingWindow(scene.timeOfDay);
    const key = [scene.location, scene.intExt, timeOfDay].join("|");
    const existing = groups.get(key) ?? {
      location: scene.location,
      intExt: scene.intExt,
      timeOfDay,
      scenes: [],
      pageEighths: 0,
      cast: new Set<string>(),
    };
    existing.scenes.push(scene);
    existing.pageEighths += scene.pageEighths;
    sceneCast(scene).forEach((member) => existing.cast.add(member));
    groups.set(key, existing);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    scenes: [...group.scenes].sort((a, b) => a.number - b.number),
  }));
}

function orderLocationBlocks(groups: WorkGroup[]) {
  const byLocation = new Map<string, WorkGroup[]>();
  groups.forEach((group) => {
    const entries = byLocation.get(group.location) ?? [];
    entries.push(group);
    byLocation.set(group.location, entries);
  });

  const blocks = [...byLocation.entries()].map(([location, locationGroups]) => ({
    location,
    groups: locationGroups.sort((a, b) =>
      a.intExt.localeCompare(b.intExt) || a.timeOfDay.localeCompare(b.timeOfDay) || a.scenes[0].number - b.scenes[0].number,
    ),
    cast: new Set(locationGroups.flatMap((group) => [...group.cast])),
    eighths: locationGroups.reduce((total, group) => total + group.pageEighths, 0),
  }));

  const ordered: typeof blocks = [];
  let recentCast = new Set<string>();
  while (blocks.length) {
    const ranked = blocks
      .map((block, index) => ({
        block,
        index,
        overlap: [...block.cast].filter((member) => recentCast.has(member)).length,
      }))
      .sort((a, b) =>
        b.overlap - a.overlap
        || b.block.eighths - a.block.eighths
        || a.block.location.localeCompare(b.block.location),
      );
    const next = ranked[0];
    ordered.push(next.block);
    recentCast = next.block.cast;
    blocks.splice(next.index, 1);
  }
  return ordered;
}

function packLocationGroups(blocks: ReturnType<typeof orderLocationBlocks>) {
  const days: Omit<ScheduleDay, "dayNumber" | "weekday">[] = [];
  for (const block of blocks) {
    for (const group of block.groups) {
      let current: Omit<ScheduleDay, "dayNumber" | "weekday"> | undefined;
      for (const scene of group.scenes) {
        if (!current || (current.pageEighths > 0 && current.pageEighths + scene.pageEighths > DAILY_TARGET_EIGHTHS)) {
          current = {
            location: group.location,
            intExt: group.intExt,
            timeOfDay: group.timeOfDay,
            pageEighths: 0,
            cast: [],
            scenes: [],
          };
          days.push(current);
        }
        current.scenes.push({
          id: scene.id,
          number: scene.number,
          intExt: scene.intExt,
          timeOfDay: scene.timeOfDay,
          pageEighths: scene.pageEighths,
          synopsis: scene.synopsis,
        });
        current.pageEighths += scene.pageEighths;
        current.cast = [...new Set([...current.cast, ...sceneCast(scene)])].sort();
      }
    }
  }
  return days;
}

function countScriptOrderDays(scenes: ScheduleSceneInput[]) {
  let dayCount = 0;
  let currentKey = "";
  let currentEighths = 0;
  for (const scene of [...scenes].sort((a, b) => a.number - b.number)) {
    const key = [scene.location, scene.intExt, shootingWindow(scene.timeOfDay)].join("|");
    if (!dayCount || key !== currentKey || (currentEighths > 0 && currentEighths + scene.pageEighths > DAILY_TARGET_EIGHTHS)) {
      dayCount += 1;
      currentKey = key;
      currentEighths = 0;
    }
    currentEighths += scene.pageEighths;
  }
  return dayCount;
}

function dayOutOfDays(days: ScheduleDay[]) {
  const cast = [...new Set(days.flatMap((day) => day.cast))].sort();
  return cast.map((castMember) => {
    const workDays = days
      .filter((day) => day.cast.includes(castMember))
      .map((day) => day.dayNumber);
    return {
      castMember,
      statuses: days.map((day) => {
        if (day.cast.includes(castMember)) return "Work";
        const previous = [...workDays].reverse().find((dayNumber) => dayNumber < day.dayNumber);
        const next = workDays.find((dayNumber) => dayNumber > day.dayNumber);
        if (!previous || !next) return "Off";
        const previousLocation = days[previous - 1]?.location;
        const nextLocation = days[next - 1]?.location;
        return previousLocation !== nextLocation ? "Travel" : "Hold";
      }),
    };
  });
}

export function buildShootingSchedule(scenes: ScheduleSceneInput[]): Omit<ShootingSchedule, "rationale"> {
  const orderedBlocks = orderLocationBlocks(groupScenes(scenes));
  const packedDays = packLocationGroups(orderedBlocks).map((day, index) => ({
    ...day,
    dayNumber: index + 1,
    weekday: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index % 7],
  }));
  const scriptOrderDays = countScriptOrderDays(scenes);
  return {
    targetEighths: DAILY_TARGET_EIGHTHS,
    totalDays: packedDays.length,
    scriptOrderDays,
    daysSaved: Math.max(0, scriptOrderDays - packedDays.length),
    days: packedDays,
    dayOutOfDays: dayOutOfDays(packedDays),
  };
}