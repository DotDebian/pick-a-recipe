"""AI pass that tidies a shopping list after recipes are added.

The static merge in shopping._merge_into only joins lines whose names match
after plural folding and whose units add up. A shopper thinks in products:
"oignon" and "oignon blanc" are one thing to buy, "3 c. à soupe" of parmesan
is part of the 100 g block, and "coupé en petits morceaux" is a cooking step,
not something to look for in the shop. This module hands the open lines to
the configured model and applies its consolidated list.

Safety rules, because the model's answer is applied to data people rely on:
- only open lines are sent (checked and excluded ones are never touched);
- every line id must come back exactly once, otherwise the answer is dropped;
- a line changed while the model was thinking (checked off, edited, deleted)
  aborts the whole pass, and the list stays as the static merge left it;
- an aisle the user chose by hand for a food wins over the model's guess.
"""

from __future__ import annotations

import json
import threading
from typing import Any

from helpers import setup_logger
from kitchen import aisles
from kitchen.db import connect

logger = setup_logger(__name__)

_MAX_ITEMS = 150

_state_lock = threading.Lock()
_running: set[int] = set()
_rerun: set[int] = set()

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source_ids": {"type": "array", "items": {"type": "integer"}},
                    "food": {"type": "string"},
                    "quantity": {"type": ["number", "null"]},
                    "unit": {"type": "string"},
                    "note": {"type": "string"},
                    "aisle": {"type": "string", "enum": list(aisles.AISLES)},
                },
                "required": ["source_ids", "food", "quantity", "unit", "note", "aisle"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}

PROMPT = """You tidy a household shopping list. The input is every open line of the list,
gathered from several recipes. Return the list a person would actually take to the shop.

Rules:
1. Merge lines that are the same thing to buy: plural/singular, a generic name and a more
   specific one ("oignon" + "oignon blanc", "pâtes" + "pâtes sèches", "huile" + "huile
   d'olive" when no other oil is listed, "ail" + "tête d'ail", "poulet" + "blanc de poulet").
   Name the merged line with the most useful purchasable name.
2. Never merge different products: "crème" vs "crème fraîche", "tomates" vs "tomates
   séchées", "fromage frais" vs "fromage", "lait" vs "lait de coco", "sucre" vs "sucre glace".
3. Add quantities up. Express the total in the unit the product is bought in (g, kg, ml, l,
   or a count with an empty unit). Convert spoons or cups only when the result is sensible
   for shopping, and then mention the original amounts briefly in the note.
4. Never invent a quantity. If no line gives an amount, quantity is null. If only some do,
   total the known ones and say "+ un peu" (or the equivalent) in the note.
5. The note is for buying, not cooking: keep variety, fat content, size, "facultatif"
   (only when every merged line was optional). Drop preparation steps ("coupé en morceaux",
   "cuites al dente", "émincé", seasoning instructions). Keep it short, often empty.
6. Write food and note in the language the lines are written in. Do not translate, but
   fix a word-for-word translation into the name the product is sold under locally
   (French: "lait évaporé" -> "lait concentré non sucré", "crème épaisse" for heavy cream
   -> "crème liquide entière").
7. aisle is the supermarket section, one of the allowed values.
8. Every input id must appear in exactly one output item's source_ids. Do not drop lines.

Return JSON: {"items": [{"source_ids": [...], "food": "...", "quantity": n|null,
"unit": "...", "note": "...", "aisle": "..."}]}"""


def _open_rows(conn, list_id: int) -> list:
    return conn.execute(
        "SELECT * FROM shopping_items WHERE list_id = ? AND checked = 0 AND excluded = 0"
        " ORDER BY position, id",
        (list_id,),
    ).fetchall()


def _payload(rows) -> list[dict]:
    out = []
    for r in rows:
        sources = [s.get("name", "") for s in json.loads(r["source_recipes"] or "[]")]
        out.append({
            "id": r["id"], "food": r["food"], "quantity": r["quantity_value"],
            "unit": r["unit"], "note": r["note"], "recipes": sources,
            "added_by_hand": bool(r["manual"]),
        })
    return out


def validate(answer: Any, ids: set[int]) -> list[dict]:
    """The model's items if they cover every id exactly once; ValueError otherwise."""
    if not isinstance(answer, dict) or not isinstance(answer.get("items"), list):
        raise ValueError("answer has no items list")
    seen: set[int] = set()
    items = []
    for item in answer["items"]:
        if not isinstance(item, dict):
            raise ValueError("item is not an object")
        source_ids = item.get("source_ids")
        if not isinstance(source_ids, list) or not source_ids:
            raise ValueError("item without source_ids")
        for sid in source_ids:
            if not isinstance(sid, int) or sid not in ids or sid in seen:
                raise ValueError(f"bad or repeated id {sid!r}")
            seen.add(sid)
        food = " ".join(str(item.get("food") or "").split())
        if not food:
            raise ValueError("item without a name")
        quantity = item.get("quantity")
        if quantity is not None:
            if not isinstance(quantity, (int, float)) or quantity < 0:
                raise ValueError(f"bad quantity {quantity!r}")
            quantity = float(quantity)
        aisle = item.get("aisle") if item.get("aisle") in aisles.AISLES else "other"
        items.append({
            "source_ids": source_ids, "food": food[:200], "quantity": quantity,
            "unit": str(item.get("unit") or "")[:40], "note": str(item.get("note") or "")[:300],
            "aisle": aisle,
        })
    if seen != ids:
        raise ValueError(f"{len(ids - seen)} line(s) missing from the answer")
    return items


def _ask_model(lines: list[dict]) -> Any:
    from ai_providers import AiSession

    raw = AiSession().complete_json(
        PROMPT,
        json.dumps({"lines": lines}, ensure_ascii=False),
        schema_name="shopping_list",
        json_schema=SCHEMA,
    )
    return json.loads(raw)


def apply(list_id: int, rows, items: list[dict]) -> bool:
    """Write the consolidated items; False when the list moved underneath."""
    from kitchen.shopping import _now

    snapshot = {r["id"]: r["updated_at"] for r in rows}
    by_id = {r["id"]: r for r in rows}
    overrides = aisles.load_overrides()
    with connect() as conn:
        current = {r["id"]: r["updated_at"] for r in _open_rows(conn, list_id)}
        if any(current.get(i) != ts for i, ts in snapshot.items()):
            logger.info("[Shopping AI] List %s changed during the pass; leaving it as is.", list_id)
            return False
        for item in items:
            members = [by_id[i] for i in item["source_ids"]]
            keep = min(members, key=lambda r: (r["position"], r["id"]))
            sources: list[dict] = []
            for m in members:
                for s in json.loads(m["source_recipes"] or "[]"):
                    if s.get("id") not in {x.get("id") for x in sources}:
                        sources.append(s)
            aisle = overrides.get(aisles.food_key(item["food"])) or item["aisle"]
            quantity = round(item["quantity"], 3) if item["quantity"] is not None else None
            conn.execute(
                "UPDATE shopping_items SET food = ?, quantity_value = ?, unit = ?, note = ?, aisle = ?,"
                " source_recipes = ?, manual = ?, updated_at = ? WHERE id = ?",
                (item["food"], quantity, item["unit"], item["note"], aisle,
                 json.dumps(sources, ensure_ascii=False),
                 1 if any(m["manual"] for m in members) else 0, _now(), keep["id"]),
            )
            others = [m["id"] for m in members if m["id"] != keep["id"]]
            if others:
                conn.execute(
                    f"DELETE FROM shopping_items WHERE id IN ({','.join('?' for _ in others)})", others
                )
        conn.commit()
    return True


def consolidate(list_id: int) -> dict:
    """One AI pass over a list. Never raises; returns what happened."""
    with connect() as conn:
        rows = _open_rows(conn, list_id)
    if len(rows) < 2:
        return {"status": "skipped", "reason": "fewer than two open lines"}
    if len(rows) > _MAX_ITEMS:
        return {"status": "skipped", "reason": "list too long"}
    try:
        items = validate(_ask_model(_payload(rows)), {r["id"] for r in rows})
    except Exception as exc:
        logger.warning("[Shopping AI] Pass on list %s dropped: %s", list_id, exc)
        return {"status": "failed", "error": str(exc)[:200]}
    if not apply(list_id, rows, items):
        return {"status": "conflict"}
    logger.info("[Shopping AI] List %s: %d lines -> %d", list_id, len(rows), len(items))
    return {"status": "ok", "before": len(rows), "after": len(items)}


def is_running(list_id: int) -> bool:
    with _state_lock:
        return list_id in _running


def consolidate_async(list_id: int, on_done=None) -> None:
    """Run a pass in the background; a request during a pass queues one more."""
    with _state_lock:
        if list_id in _running:
            _rerun.add(list_id)
            return
        _running.add(list_id)

    def worker():
        try:
            while True:
                result = consolidate(list_id)
                with _state_lock:
                    again = list_id in _rerun
                    _rerun.discard(list_id)
                    if not again:
                        _running.discard(list_id)
                if on_done:
                    try:
                        on_done(list_id, result)
                    except Exception:  # pragma: no cover - notification only
                        pass
                if not again:
                    return
        except Exception:  # pragma: no cover - consolidate never raises
            with _state_lock:
                _running.discard(list_id)
                _rerun.discard(list_id)
            raise

    threading.Thread(target=worker, daemon=True, name=f"shopping-ai-{list_id}").start()
