"""
translates greek meal names to english using google translate via deep translator.
"""

from deep_translator import GoogleTranslator


def _get_all_strings(weeks: list[dict]) -> list[str]:
    """collect every unique greek meal string across all weeks"""
    seen = set()
    result = []
    for week in weeks:
        for day in week.values():
            for meal in ("lunch", "dinner"):
                for course in ("first", "main"):
                    for item in day[meal][course]:
                        if item and item not in seen:
                            seen.add(item)
                            result.append(item)
            for key in ("lunchExtra", "dinnerExtra"):
                for item in day.get(key, []):
                    if item and item not in seen:
                        seen.add(item)
                        result.append(item)
    return result


def translate_weeks(weeks: list[dict]) -> list[dict]:
    strings = _get_all_strings(weeks)
    if not strings:
        return weeks

    print(f"Translating {len(strings)} unique meal strings via Google Translate...")
    translator = GoogleTranslator(source="el", target="en")

    translated = translator.translate_batch(strings)
    translation_map = dict(zip(strings, translated))

    def translate_list(items: list[str]) -> list[str]:
        return [translation_map.get(item, item) for item in items]

    translated_weeks = []
    for week in weeks:
        translated_week = {}
        for day_key, day in week.items():
            translated_week[day_key] = {
                "lunch": {
                    "first": translate_list(day["lunch"]["first"]),
                    "main":  translate_list(day["lunch"]["main"]),
                },
                "dinner": {
                    "first": translate_list(day["dinner"]["first"]),
                    "main":  translate_list(day["dinner"]["main"]),
                },
                "lunchExtra":  translate_list(day["lunchExtra"]),
                "dinnerExtra": translate_list(day["dinnerExtra"]),
            }
        translated_weeks.append(translated_week)

    print("Done.")
    return translated_weeks
