#!/usr/bin/env python3
"""Extract screenplay scenes and call Gemini for a structured breakdown."""

import concurrent.futures
import json
import os
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

import pdfplumber
from google import genai
from google.genai import types
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


CATEGORIES = [
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
]

SLUG_LINE = re.compile(
    r"^\s*(?:(\d+)[.\s]+)?(INT\.?/EXT\.?|INT/EXT\.?|I/E\.?|INT\.?|EXT\.?)\s+(.+?)\s*-\s*(DAY|NIGHT|DAWN|DUSK|CONTINUOUS|MORNING|EVENING)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

SCENE_TAG_SCHEMA = {
    "type": "object",
    "properties": {
        "scene_number": {"type": "integer"},
        "synopsis": {"type": "string"},
        "elements": {
            "type": "object",
            "properties": {category: {"type": "array", "items": {"type": "string"}} for category in CATEGORIES},
            "required": CATEGORIES,
        },
    },
    "required": ["scene_number", "synopsis", "elements"],
}

BATCH_SCHEMA = {
    "type": "object",
    "properties": {"scenes": {"type": "array", "items": SCENE_TAG_SCHEMA}},
    "required": ["scenes"],
}

RATIONALE_SCHEMA = {
    "type": "object",
    "properties": {"rationale": {"type": "string"}},
    "required": ["rationale"],
}

RISK_SCHEMA = {
    "type": "object",
    "properties": {
        "risk_flags": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "category": {"type": "string"},
                    "title": {"type": "string"},
                    "explanation": {"type": "string"},
                    "scenes": {"type": "array", "items": {"type": "integer"}},
                    "recommendation": {"type": "string"},
                },
                "required": ["severity", "category", "title", "explanation", "scenes", "recommendation"],
            },
        }
    },
    "required": ["risk_flags"],
}


def _scene_number(scene: dict) -> int | None:
    number = scene.get("number")
    return int(number) if str(number).isdigit() else None


def _scene_elements(scene: dict, category: str) -> list[str]:
    elements = scene.get("elements") or {}
    values = elements.get(category) or []
    return [str(value) for value in values if str(value).strip()]


def _is_night_window(value: str) -> bool:
    return value.upper() in {"NIGHT", "DUSK", "EVENING"}


def build_grounded_risk_flags(payload: dict) -> list[dict]:
    """Add deterministic findings for risks that are directly evidenced in the breakdown."""
    scenes = [scene for scene in payload.get("scenes", []) if isinstance(scene, dict)]
    numbered_scenes = {number: scene for scene in scenes if (number := _scene_number(scene)) is not None}
    schedule = payload.get("schedule") or {}
    schedule_days = schedule.get("days") or []
    scene_days: dict[int, int] = {}
    for day in schedule_days:
        day_number = day.get("dayNumber")
        if not isinstance(day_number, int):
            continue
        for scene in day.get("scenes") or []:
            number = _scene_number(scene)
            if number is not None:
                scene_days[number] = day_number

    grounded: list[dict] = []
    stunt_scenes = sorted(
        number for number, scene in numbered_scenes.items()
        if _scene_elements(scene, "stunts")
    )
    if stunt_scenes:
        stunt_details = "; ".join(
            f"scene {number}: {', '.join(_scene_elements(numbered_scenes[number], 'stunts'))}"
            for number in stunt_scenes
        )
        grounded.append({
            "severity": "high",
            "category": "Stunts & Safety",
            "title": "Stunt Safety, Insurance & Budget Exposure",
            "explanation": f"Tagged stunt work is present in {stunt_details}. These actions require qualified stunt supervision, safety planning, insurance review, and controlled set time.",
            "scenes": stunt_scenes,
            "recommendation": f"Schedule a stunt coordinator, vehicle/action safety meeting, and insurance review before shooting scenes {', '.join(map(str, stunt_scenes))}; plan protected reset time for each gag.",
        })

    night_scenes_by_day: dict[int, list[int]] = {}
    for number, scene in numbered_scenes.items():
        if str(scene.get("intExt", "")).upper() != "EXT" or not _is_night_window(str(scene.get("timeOfDay", ""))):
            continue
        day_number = scene_days.get(number)
        if day_number is not None:
            night_scenes_by_day.setdefault(day_number, []).append(number)
    for day_number, night_scenes in sorted(night_scenes_by_day.items()):
        night_scenes = sorted(night_scenes)
        time_label = "night/dusk" if any(str(numbered_scenes[number].get("timeOfDay", "")).upper() != "NIGHT" for number in night_scenes) else "night"
        grounded.append({
            "severity": "medium",
            "category": "Night Operations",
            "title": f"EXT {time_label.upper()} Shooting Cost Risk — Day {day_number}",
            "explanation": f"Scenes {', '.join(map(str, night_scenes))} are scheduled as exterior {time_label} work on shooting day {day_number}. Night work requires additional lighting, crew premiums, and turnaround planning.",
            "scenes": night_scenes,
            "recommendation": f"Pre-light and group the exterior setup for scenes {', '.join(map(str, night_scenes))} on shooting day {day_number}; confirm crew turnaround and transport before the call.",
        })

    vehicle_scenes: dict[str, list[int]] = {}
    for number, scene in numbered_scenes.items():
        for vehicle in _scene_elements(scene, "vehicles"):
            normalized = re.sub(r"\s+", " ", vehicle.strip().upper())
            if normalized == "PICKUP TRUCK":
                vehicle_scenes.setdefault("PICKUP TRUCK", []).append(number)
    for vehicle, referenced_scenes in vehicle_scenes.items():
        referenced_scenes = sorted(set(referenced_scenes))
        days = sorted({scene_days[number] for number in referenced_scenes if number in scene_days})
        if len(days) < 2:
            continue
        grounded.append({
            "severity": "medium",
            "category": "Vehicle Continuity",
            "title": f"{vehicle.title()} Continuity Across Multiple Shoot Days",
            "explanation": f"The tagged {vehicle.lower()} is needed in scenes {', '.join(map(str, referenced_scenes))}, spread across shooting days {', '.join(map(str, days))}. This creates picture-match, prep, transport, and availability exposure across separated script blocks.",
            "scenes": referenced_scenes,
            "recommendation": f"Reserve the same {vehicle.lower()} and document its hero continuity before shooting scenes {', '.join(map(str, referenced_scenes))}; capture inserts and matching reference photos at each separated day.",
        })
    return grounded


def read_script(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        with pdfplumber.open(path) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages)
    return path.read_text(encoding="utf-8", errors="replace")


def normalise_int_ext(value: str) -> str:
    value = value.upper().replace(".", "")
    return "INT/EXT" if value in {"INT/EXT", "I/E"} else value


def parse_scenes(script: str) -> list[dict]:
    matches = list(SLUG_LINE.finditer(script))
    if not matches:
        raise ValueError("No standard screenplay slug lines were found. Use headings such as 'INT. DINER - NIGHT'.")

    scenes = []
    for index, match in enumerate(matches):
        scene_text = script[match.start() : matches[index + 1].start() if index + 1 < len(matches) else len(script)].strip()
        location = match.group(3).strip().upper()
        lines = max(1, len(scene_text.splitlines()))
        scenes.append(
            {
                "number": int(match.group(1) or index + 1),
                "intExt": normalise_int_ext(match.group(2)),
                "location": location,
                "timeOfDay": match.group(4).upper(),
                "pageEighths": max(1, round((lines / 55) * 8)),
                "synopsis": "",
                "rawText": scene_text,
            }
        )
    return scenes


def analyse_batch(client: genai.Client, batch: list[dict]) -> list[dict]:
    scene_payload = [{"scene_number": item["number"], "scene_text": item["rawText"]} for item in batch]
    prompt = """You are a film 1st Assistant Director performing a precise script breakdown.
Return a JSON scene entry for every input scene. Use one concise synopsis sentence and tag only clearly supported production needs.
Named speaking characters belong in cast. Props are only objects handled by actors. Return empty arrays where no requirement exists.
Use all provided category keys exactly as specified.

SCENES:
""" + json.dumps(scene_payload)
    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=BATCH_SCHEMA,
            temperature=0.1,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    return json.loads(response.text or '{"scenes": []}')["scenes"]


def generate_schedule_rationale(schedule: dict) -> str:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured for the API server.")
    prompt = """You are a film production coordinator. Explain this proposed shooting schedule in one plain-English paragraph.
Focus on the major location, INT/EXT, and day/night grouping decisions, the 40-eighth page target, and how the sequence limits scattered actor call days.
Do not invent availability, crew rules, travel distances, or production constraints not present in the schedule.

SCHEDULE:
""" + json.dumps(schedule)
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=RATIONALE_SCHEMA,
            temperature=0.2,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    return json.loads(response.text or "{}").get("rationale") or "The schedule groups scenes by location and shooting conditions to reduce moves and consolidate cast calls."

 
def generate_schedule_risk(payload: dict) -> list[dict]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured for the API server.")
    prompt = """You are a film production manager reviewing a proposed shooting schedule and its screenplay breakdown for budget risk.
Identify only risks supported by the supplied data. Look specifically for:
1. expensive elements used in only one or two scenes, especially a vehicle, animal, or set dressing/set build;
2. the same expensive element scheduled on non-consecutive shooting days;
3. every exterior NIGHT, DUSK, or EVENING scene. Treat DUSK and EVENING as a night shooting window when the schedule groups them as NIGHT; keep separate shooting-day/location blocks as separate risks;
4. each tagged stunt as a safety, insurance, and budget risk. Describe the exact tagged action and cite every applicable scene;
5. a named vehicle that recurs across non-consecutive shooting days, including continuity, transport, prep, and availability exposure;
6. stunts or visual effects scheduled on the same day as scenes with heavy dialogue;
7. source music or songs that may require licensing.

Return one structured flag per distinct issue, or an empty list when the breakdown does not support a finding.
Use high for a likely material cost/schedule risk, medium for a meaningful planning risk, and low for a watch item.
Every flag must name the relevant scene numbers in `scenes` and provide a specific, actionable recommendation that also names those scene numbers.
Do not invent costs, locations, dialogue, licensing status, animals, stunts, VFX, or elements not present in the input. A night interior is not a night exterior. Do not flag generic props as expensive.

SCHEDULE AND BREAKDOWN:
""" + json.dumps(payload)
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=RISK_SCHEMA,
            temperature=0.1,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    result = json.loads(response.text or '{"risk_flags": []}')
    flags = result.get("risk_flags", [])
    valid_scene_numbers = {
        int(scene["number"])
        for scene in payload.get("scenes", [])
        if isinstance(scene, dict) and str(scene.get("number", "")).isdigit()
    }
    if not isinstance(flags, list):
        raise ValueError("Gemini returned an invalid production risk list.")
    cleaned = []
    for flag in flags:
        if not isinstance(flag, dict):
            continue
        raw_scenes = flag.get("scenes", [])
        if not isinstance(raw_scenes, list) or not raw_scenes:
            continue
        if not all(str(number).isdigit() and int(number) in valid_scene_numbers for number in raw_scenes):
            continue
        scenes = sorted({int(number) for number in raw_scenes})
        severity = flag.get("severity") if flag.get("severity") in {"high", "medium", "low"} else "low"
        if not flag.get("title") or not flag.get("recommendation") or not scenes:
            continue
        cleaned.append(
            {
                "severity": severity,
                "category": str(flag.get("category") or "Production planning"),
                "title": str(flag["title"]),
                "explanation": str(flag.get("explanation") or ""),
                "scenes": scenes,
                "recommendation": str(flag["recommendation"]),
            }
        )
    grounded = build_grounded_risk_flags(payload)

    def covered_by_grounded_flag(flag: dict) -> bool:
        text = f"{flag.get('category', '')} {flag.get('title', '')}".lower()
        if any(item["category"] == "Stunts & Safety" for item in grounded) and ("stunt" in text or "safety" in text):
            return True
        if any(item["category"] == "Night Operations" for item in grounded) and ("night" in text or "dusk" in text):
            return True
        return any(item["category"] == "Vehicle Continuity" for item in grounded) and "vehicle" in text and "continuity" in text

    return [flag for flag in cleaned if not covered_by_grounded_flag(flag)] + grounded


def generate_pdf_report(data: dict, output_path: Path) -> None:
    project = data["project"]
    scenes = data.get("scenes", [])
    schedule = data.get("schedule", {})
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, spaceAfter=8))
    styles.add(ParagraphStyle(name="ReportHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=colors.HexColor("#233044"), spaceBefore=12, spaceAfter=6))
    styles.add(ParagraphStyle(name="ReportBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=11))
    styles.add(ParagraphStyle(name="ReportSmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=9))
    styles.add(ParagraphStyle(name="ReportMono", parent=styles["BodyText"], fontName="Courier", fontSize=7.5, leading=9))

    def p(value, style="ReportBody"):
        return Paragraph(escape(str(value or "")).replace("\n", "<br/>"), styles[style])

    def synopsis_paragraph(value):
        synopsis = escape(str(value or "")).replace("\n", "<br/>")
        return Paragraph(f"<b>Synopsis:</b> {synopsis}", styles["ReportBody"])

    document = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
        title=f"{project.get('title', 'Callsheet')} breakdown report",
        author="Callsheet",
    )
    story = [
        p(project.get("title", "Untitled screenplay"), "ReportTitle"),
        p(f"Production breakdown report · {project.get('filename') or 'source screenplay'}", "ReportSmall"),
        Spacer(1, 10),
        p("Production summary", "ReportHeading"),
    ]
    summary_rows = [
        ["Scenes", len(scenes)],
        ["Page eighths", sum(int(scene.get("pageEighths", 0)) for scene in scenes)],
        ["Locations", len({scene.get("location") for scene in scenes})],
        ["Cast / roles", len({role for scene in scenes for role in scene.get("elements", {}).get("cast", [])})],
        ["Scheduled days", schedule.get("totalDays", "—")],
        ["Days saved", schedule.get("daysSaved", "—")],
    ]
    summary = Table([[p(label, "ReportSmall"), p(value, "ReportSmall")] for label, value in summary_rows], colWidths=[1.55 * inch, 1.0 * inch])
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f0eb")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d2d0c7")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [summary, p("Full scene breakdown", "ReportHeading")]
    for scene in scenes:
        elements = scene.get("elements", {})
        story += [
            p(f"Scene {scene.get('number')} · {scene.get('intExt')} · {scene.get('location')} · {scene.get('timeOfDay')} · {scene.get('pageEighths')}/8 pages", "ReportHeading"),
            synopsis_paragraph(scene.get("synopsis", "")),
        ]
        element_rows = [["Category", "Tagged elements"]]
        for category, values in elements.items():
            if values:
                element_rows.append([p(category.replace("_", " ").title(), "ReportSmall"), p(" · ".join(str(value) for value in values), "ReportSmall")])
        if len(element_rows) == 1:
            element_rows.append([p("Elements", "ReportSmall"), p("None tagged", "ReportSmall")])
        element_table = Table(element_rows, colWidths=[1.35 * inch, 5.9 * inch], repeatRows=1)
        element_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#233044")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d2d0c7")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story += [element_table, Spacer(1, 7)]

    story += [PageBreak(), p("Shooting schedule", "ReportTitle")]
    story += [p(schedule.get("rationale", ""), "ReportBody"), Spacer(1, 8)]
    schedule_rows = [["Day", "Location", "Set", "Time", "Pages", "Scenes"]]
    for day in schedule.get("days", []):
        schedule_rows.append([
            p(f"Day {day.get('dayNumber')}", "ReportSmall"),
            p(day.get("location"), "ReportSmall"),
            p(day.get("intExt"), "ReportSmall"),
            p(day.get("timeOfDay"), "ReportSmall"),
            p(f"{day.get('pageEighths')}/8", "ReportSmall"),
            p(", ".join(str(scene.get("number")) for scene in day.get("scenes", [])), "ReportSmall"),
        ])
    schedule_table = Table(schedule_rows, colWidths=[0.55 * inch, 2.0 * inch, 0.65 * inch, 0.8 * inch, 0.55 * inch, 2.7 * inch], repeatRows=1)
    schedule_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#233044")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d2d0c7")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story += [schedule_table]
    if schedule.get("riskFlags"):
        story += [p("Production risk flags", "ReportHeading")]
        for flag in schedule["riskFlags"]:
            story += [p(f"{str(flag.get('severity', 'low')).upper()} · {flag.get('title')} · Scenes {', '.join(str(number) for number in flag.get('scenes', []))}"), p(f"Recommendation: {flag.get('recommendation')}")]
    document.build(story)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--schedule-rationale":
        schedule = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print(json.dumps({"rationale": generate_schedule_rationale(schedule)}))
        return
    if len(sys.argv) == 3 and sys.argv[1] == "--schedule-risk":
        payload = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print(json.dumps({"riskFlags": generate_schedule_risk(payload)}))
        return
    if len(sys.argv) == 4 and sys.argv[1] == "--export-pdf":
        payload = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        generate_pdf_report(payload, Path(sys.argv[3]))
        return
    if len(sys.argv) != 2:
        raise ValueError("Expected the uploaded screenplay path.")
    script = read_script(Path(sys.argv[1]))
    scenes = parse_scenes(script)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured for the API server.")

    client = genai.Client(api_key=api_key)
    batches = [scenes[index : index + 5] for index in range(0, len(scenes), 5)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda batch: analyse_batch(client, batch), batches))

    tags_by_number = {
        item["scene_number"]: item
        for response in responses
        for item in response
    }
    output = []
    for index, scene in enumerate(scenes):
        tagged = tags_by_number.get(scene["number"], {})
        elements = tagged.get("elements", {})
        output.append(
            {
                **scene,
                "id": index + 1,
                "synopsis": tagged.get("synopsis") or "Scene requires editorial review.",
                "elements": {category: elements.get(category, []) for category in CATEGORIES},
            }
        )
    print(json.dumps({"scenes": output}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)