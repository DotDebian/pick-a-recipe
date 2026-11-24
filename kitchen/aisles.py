"""Which supermarket aisle a food belongs in.

A built-in keyword map (English and Hebrew) gives a first guess; when someone
moves an item to another aisle the choice is remembered for that food and
wins from then on.
"""

from __future__ import annotations

import re

from kitchen.db import connect

AISLES = (
    "produce", "dairy", "meat", "fish", "bakery", "pantry", "spices", "canned",
    "frozen", "drinks", "snacks", "household", "other",
)

_KEYWORDS: dict[str, tuple[str, ...]] = {
    "produce": (
        "apple", "banana", "lemon", "lime", "orange", "onion", "garlic", "tomato", "potato",
        "carrot", "cucumber", "pepper", "lettuce", "spinach", "cabbage", "zucchini", "eggplant",
        "mushroom", "parsley", "cilantro", "coriander", "basil", "mint", "dill", "scallion",
        "celery", "avocado", "ginger", "broccoli", "cauliflower", "berries", "strawberr", "grape",
        "herb", "leek", "beet", "squash", "pumpkin", "sweet potato", "kale", "chili",
        "תפוח", "בננה", "לימון", "תפוז", "בצל", "שום", "עגבני", "תפוחי אדמה", "תפו\"א", "גזר",
        "מלפפון", "פלפל", "חסה", "תרד", "כרוב", "קישוא", "חציל", "פטרי", "פטרוזיליה", "כוסברה",
        "בזיליקום", "נענע", "שמיר", "בצל ירוק", "סלרי", "אבוקדו", "ג'ינג'ר", "ברוקולי", "כרובית",
        "תות", "ענבים", "כרשה", "סלק", "דלעת", "בטטה", "צ'ילי",
    ),
    "dairy": (
        "milk", "cream", "butter", "cheese", "yogurt", "yoghurt", "egg", "mozzarella", "parmesan",
        "feta", "ricotta", "labneh", "sour cream", "חלב", "שמנת", "חמאה", "גבינ", "יוגורט",
        "ביצ", "מוצרלה", "פרמזן", "פטה", "ריקוטה", "לבנה", "קוטג'",
    ),
    "meat": (
        "chicken", "beef", "pork", "lamb", "turkey", "bacon", "sausage", "ground meat", "steak",
        "mince", "עוף", "בקר", "כבש", "הודו", "נקניק", "בשר", "סטייק", "חזה", "שניצל", "פרגית",
    ),
    "fish": (
        "salmon", "tuna", "fish", "shrimp", "prawn", "cod", "tilapia", "anchov", "סלמון", "טונה",
        "דג", "שרימפס", "אמנון", "בקלה", "אנשובי",
    ),
    "bakery": ("bread", "pita", "bun", "baguette", "tortilla", "לחם", "פיתה", "לחמני", "באגט", "טורטיה", "חלה"),
    "spices": (
        "salt", "cumin", "paprika", "turmeric", "cinnamon", "oregano", "thyme", "rosemary",
        "black pepper", "chili flakes", "nutmeg", "cardamom", "bay leaf", "spice", "vanilla",
        "מלח", "כמון", "פפריקה", "כורכום", "קינמון", "אורגנו", "טימין", "רוזמרין", "פלפל שחור",
        "אגוז מוסקט", "עלה דפנה", "תבלין", "וניל", "זעתר", "סומק", "בהרט",
    ),
    "canned": (
        "canned", "can of", "tomato paste", "tomato sauce", "chickpeas", "beans", "corn", "coconut milk",
        "שימורי", "רסק עגבניות", "רוטב עגבניות", "חומוס", "שעועית", "תירס", "חלב קוקוס",
    ),
    "frozen": ("frozen", "ice cream", "peas", "קפוא", "גלידה", "אפונה"),
    "drinks": ("wine", "beer", "juice", "soda", "water", "coffee", "tea", "יין", "בירה", "מיץ", "סודה", "מים", "קפה"),
    "snacks": ("chips", "chocolate", "cookie", "cracker", "nuts", "שוקולד", "עוגיות", "קרקר", "חטיף", "אגוז"),
    "pantry": (
        "flour", "sugar", "rice", "pasta", "noodle", "oil", "vinegar", "honey", "oats", "lentil",
        "quinoa", "couscous", "bulgur", "breadcrumb", "baking", "yeast", "soy sauce", "tahini",
        "mustard", "ketchup", "mayonnaise", "stock", "broth", "syrup", "cocoa", "semolina",
        "קמח", "סוכר", "אורז", "פסטה", "אטריות", "שמן", "חומץ", "דבש", "שיבולת", "עדשים", "קינואה",
        "קוסקוס", "בורגול", "פירורי לחם", "אבקת אפייה", "שמרים", "סויה", "טחינה", "חרדל", "קטשופ",
        "מיונז", "ציר", "סילאן", "קקאו", "סולת",
    ),
    "household": ("foil", "paper", "soap", "detergent", "napkin", "נייר", "סבון", "אלומיניום", "מפיות"),
}

# Longer keywords first so "black pepper" beats "pepper" and "coconut milk" beats "milk".
_ORDERED = sorted(
    ((kw, aisle) for aisle, kws in _KEYWORDS.items() for kw in kws),
    key=lambda pair: len(pair[0]),
    reverse=True,
)


def _singular_stem(word: str) -> str:
    """A comparison stem shared by a word's singular and plural, English or French.

    Only ever compared with another stem, never shown: "peaches"/"peach",
    "tomatoes"/"tomato", "tomates séchées"/"tomate séchée", "poireaux"/"poireau",
    "pois chiches"/"pois chiche" all land on the same string.
    """
    if len(word) <= 3 or not re.fullmatch(r"[a-zà-ÿœæ]+", word):
        return word
    if word.endswith("ies"):
        word = word[:-3] + "y"
    elif word.endswith(("eaux", "aux", "oux")):
        word = word[:-1]
    elif word.endswith("oes"):
        word = word[:-2]
    elif word.endswith("s") and not word.endswith(("ss", "us", "is", "os")):
        word = word[:-1]
    if word.endswith("e") and len(word) > 3:
        word = word[:-1]
    return word


def food_key(food: str) -> str:
    text = " ".join(str(food or "").casefold().split())
    text = re.sub(r"[^\w\s\u0590-\u05FF'\"-]", "", text)
    return " ".join(_singular_stem(w) for w in text.split())


def guess_aisle(food: str) -> str:
    folded = " ".join(str(food or "").casefold().split())
    for keyword, aisle in _ORDERED:
        if keyword in folded:
            return aisle
    return "other"


def classify(food: str, overrides: dict[str, str] | None = None) -> str:
    key = food_key(food)
    if overrides is None:
        overrides = load_overrides()
    return overrides.get(key) or guess_aisle(food)


def load_overrides() -> dict[str, str]:
    with connect() as conn:
        return {r["food_key"]: r["aisle"] for r in conn.execute("SELECT food_key, aisle FROM aisle_overrides")}


def remember(food: str, aisle: str) -> None:
    if aisle not in AISLES:
        return
    key = food_key(food)
    if not key:
        return
    with connect() as conn:
        if guess_aisle(food) == aisle:
            conn.execute("DELETE FROM aisle_overrides WHERE food_key = ?", (key,))
        else:
            conn.execute(
                "INSERT INTO aisle_overrides(food_key, aisle) VALUES (?, ?)"
                " ON CONFLICT(food_key) DO UPDATE SET aisle = excluded.aisle",
                (key, aisle),
            )
        conn.commit()
