#!/usr/bin/env python3
"""Extract screenplay scenes and call Gemini for a structured breakdown."""

import concurrent.futures
import json
import os
import re
import sys
from pathlib import Path

import pdfplumber
from google import genai
from google.genai import types


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


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--schedule-rationale":
        schedule = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print(json.dumps({"rationale": generate_schedule_rationale(schedule)}))
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