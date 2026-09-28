"""Weekly AI scan of monitored sources + AI eligibility evaluation."""

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
from bs4 import BeautifulSoup

from lib.db import db
from models.schemas import Bonus, ScanStatus, now_utc
from services.llm import ask_json

logger = logging.getLogger(__name__)
SCAN_INTERVAL = timedelta(days=7)
META_ID = "scan_status"
_lock = asyncio.Lock()

EXTRACT_SYSTEM = (
    "Sei un analista esperto di agevolazioni pubbliche italiane (bonus, contributi, bandi, detrazioni). "
    "Dal testo di una pagina web estrai i bonus/agevolazioni per cittadini e famiglie attualmente attivi o in arrivo."
)
ELIG_SYSTEM = (
    "Sei un consulente CAF esperto di bonus italiani. Valuti con precisione l'idoneità di una persona "
    "e della sua famiglia ai bonus in base ai requisiti, spiegando in italiano in modo chiaro e breve."
)


def _aware(dt):
    if dt and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def get_status() -> ScanStatus:
    doc = await db.meta.find_one({"_id": META_ID}) or {}
    doc.pop("_id", None)
    st = ScanStatus(**doc)
    st.last_run_at = _aware(st.last_run_at)
    st.next_run_at = (st.last_run_at + SCAN_INTERVAL) if st.last_run_at else None
    return st


async def _set_status(**fields):
    await db.meta.update_one({"_id": META_ID}, {"$set": fields}, upsert=True)


async def _log(msg: str):
    logger.info("scan: %s", msg)
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    await db.meta.update_one(
        {"_id": META_ID},
        {"$push": {"log": {"$each": [f"[{stamp}] {msg}"], "$slice": -40}}, "$set": {"phase": msg}},
        upsert=True,
    )


async def fetch_page_text(url: str) -> str:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; BonusRadar/1.0)"}
    async with httpx.AsyncClient(follow_redirects=True, timeout=30, headers=headers) as client:
        r = await client.get(url)
        r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "footer", "nav"]):
        tag.decompose()
    text = " ".join(soup.get_text(" ").split())
    return text[:18000]


async def extract_bonuses(source: dict, text: str) -> list[dict]:
    prompt = f"""Fonte: {source['name']} ({source['url']})
Testo della pagina:
\"\"\"{text}\"\"\"

Restituisci un array JSON (max 12 elementi) di oggetti con campi:
title, authority, category (uno tra: casa, famiglia, lavoro, mobilita, studio, salute, energia, altro),
amount (stringa, es. "fino a 3.000 €"), deadline (stringa, es. "31/12/2026" o "" se ignota),
summary (2 frasi), requirements (array di stringhe con i requisiti chiave: ISEE, età, figli, residenza...),
required_documents (array di documenti tipicamente richiesti).
Se non ci sono bonus pertinenti restituisci []."""
    data = await ask_json(EXTRACT_SYSTEM, prompt)
    return data if isinstance(data, list) else data.get("bonuses", [])


def _norm(title: str) -> str:
    return " ".join(title.lower().split())


async def upsert_bonuses(items: list[dict], source: dict) -> int:
    count = 0
    for it in items:
        title = (it.get("title") or "").strip()
        if not title:
            continue
        key = _norm(title)
        fields = {
            "authority": it.get("authority") or source["name"],
            "category": it.get("category") or "altro",
            "amount": str(it.get("amount") or ""),
            "deadline": str(it.get("deadline") or ""),
            "summary": it.get("summary") or "",
            "requirements": [str(x) for x in it.get("requirements") or []],
            "required_documents": [str(x) for x in it.get("required_documents") or []],
            "source_url": source["url"],
            "source_name": source["name"],
        }
        existing = await db.bonuses.find_one({"norm_title": key})
        if existing:
            await db.bonuses.update_one({"id": existing["id"]}, {"$set": fields})
        else:
            b = Bonus(title=title, **fields)
            await db.bonuses.insert_one({**b.model_dump(), "norm_title": key})
        count += 1
    return count


def _profile_summary(p: dict) -> str:
    keep = {k: v for k, v in p.items() if k not in ("_id", "iban", "phone", "email", "fiscal_code", "updated_at")}
    return json.dumps(keep, ensure_ascii=False, default=str)


async def evaluate_eligibility(only_unknown: bool = False) -> int:
    profile = await db.profile.find_one({"_id": "me"})
    if not profile:
        return 0
    query = {"eligibility": "unknown"} if only_unknown else {}
    bonuses = await db.bonuses.find(query, {"_id": 0}).to_list(500)
    done = 0
    for i in range(0, len(bonuses), 10):
        batch = bonuses[i : i + 10]
        payload = [
            {"id": b["id"], "title": b["title"], "authority": b["authority"], "requirements": b["requirements"], "summary": b["summary"]}
            for b in batch
        ]
        prompt = f"""Profilo del richiedente e del nucleo familiare (anno corrente {now_utc().year}):
{_profile_summary(profile)}

Bonus da valutare:
{json.dumps(payload, ensure_ascii=False)}

Per ogni bonus restituisci un array JSON di oggetti {{"id", "eligibility", "reason"}} dove eligibility è
"eligible" (requisiti soddisfatti), "maybe" (dati mancanti o requisiti da verificare) o "not_eligible".
reason: max 2 frasi in italiano, citando i dati concreti del profilo (es. ISEE, figli, età, residenza)."""
        try:
            results = await ask_json(ELIG_SYSTEM, prompt)
        except Exception as exc:  # keep going on a bad batch
            logger.error("eligibility batch failed: %s", exc)
            continue
        for r in results if isinstance(results, list) else []:
            el = r.get("eligibility")
            if el not in ("eligible", "maybe", "not_eligible"):
                continue
            await db.bonuses.update_one(
                {"id": r.get("id")}, {"$set": {"eligibility": el, "eligibility_reason": r.get("reason", "")}}
            )
            done += 1
    return done


async def run_scan():
    if _lock.locked():
        return
    async with _lock:
        await _set_status(running=True, phase="Avvio scansione", log=[])
        try:
            sources = await db.sources.find({}, {"_id": 0}).to_list(100)
            await _log(f"Scansione di {len(sources)} fonti")
            for s in sources:
                try:
                    await _log(f"Download: {s['name']}")
                    text = await fetch_page_text(s["url"])
                    await _log(f"Analisi AI: {s['name']}")
                    items = await extract_bonuses(s, text)
                    n = await upsert_bonuses(items, s)
                    status = f"ok · {n} bonus"
                    await _log(f"{s['name']}: {n} bonus rilevati")
                except Exception as exc:
                    n, status = 0, f"errore: {str(exc)[:80]}"
                    await _log(f"{s['name']}: {status}")
                await db.sources.update_one(
                    {"id": s["id"]}, {"$set": {"last_scanned_at": now_utc(), "last_status": status, "bonus_found": n}}
                )
            await _log("Valutazione idoneità con AI")
            n = await evaluate_eligibility()
            await _log(f"Completato · {n} bonus valutati")
        finally:
            await _set_status(running=False, last_run_at=now_utc())


async def run_evaluation_only():
    if _lock.locked():
        return
    async with _lock:
        await _set_status(running=True, phase="Valutazione idoneità con AI")
        try:
            n = await evaluate_eligibility()
            await _log(f"Idoneità aggiornata · {n} bonus valutati")
        finally:
            await _set_status(running=False, phase="")


async def weekly_scheduler():
    await _set_status(running=False)  # clear a stale flag from a previous process
    while True:
        try:
            st = await get_status()
            if await db.sources.count_documents({}) and (not st.last_run_at or now_utc() - st.last_run_at >= SCAN_INTERVAL):
                await run_scan()
        except Exception as exc:
            logger.error("weekly scheduler: %s", exc)
        await asyncio.sleep(3600)
