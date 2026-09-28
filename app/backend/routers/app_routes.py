"""All BonusRadar routes — mounted on api_router (/api) from server.py."""

import asyncio
import io
import shutil
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from lib.db import db
from models.schemas import (
    Bonus,
    Dashboard,
    DocumentCreate,
    DocumentFolder,
    DocumentStatusUpdate,
    Profile,
    ProfileIn,
    ScanStatus,
    Source,
    SourceIn,
)
from services import docgen, scanner

router = APIRouter()
_tasks: set[asyncio.Task] = set()


def _bg(coro):
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


# ---------- Profile ----------
@router.get("/profile", response_model=Profile | None)
async def get_profile():
    doc = await db.profile.find_one({"_id": "me"})
    if not doc:
        return None
    doc.pop("_id")
    return Profile(**doc)


@router.put("/profile", response_model=Profile)
async def save_profile(body: ProfileIn):
    if not body.full_name.strip():
        raise HTTPException(422, "Nome obbligatorio")
    p = Profile(**body.model_dump())
    await db.profile.replace_one({"_id": "me"}, {"_id": "me", **p.model_dump()}, upsert=True)
    _bg(scanner.run_evaluation_only())  # profile changed → re-evaluate eligibility
    return p


# ---------- Sources ----------
@router.get("/sources", response_model=list[Source])
async def list_sources():
    return await db.sources.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)


@router.post("/sources", response_model=Source)
async def add_source(body: SourceIn):
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(422, "URL non valido: deve iniziare con http:// o https://")
    if await db.sources.find_one({"url": url}):
        raise HTTPException(409, "Fonte già presente")
    s = Source(name=body.name.strip() or url, url=url)
    await db.sources.insert_one(s.model_dump())
    return s


@router.delete("/sources/{id}")
async def delete_source(id: str):
    r = await db.sources.delete_one({"id": id})
    if not r.deleted_count:
        raise HTTPException(404, "Fonte non trovata")
    return {"ok": True}


# ---------- Scan ----------
@router.get("/scan/status", response_model=ScanStatus)
async def scan_status():
    return await scanner.get_status()


@router.post("/scan", response_model=ScanStatus)
async def trigger_scan():
    st = await scanner.get_status()
    if st.running:
        raise HTTPException(409, "Scansione già in corso")
    _bg(scanner.run_scan())
    await asyncio.sleep(0.2)
    return await scanner.get_status()


@router.post("/bonus/evaluate", response_model=ScanStatus)
async def trigger_evaluate():
    if not await db.profile.find_one({"_id": "me"}):
        raise HTTPException(400, "Completa prima il questionario")
    _bg(scanner.run_evaluation_only())
    await asyncio.sleep(0.2)
    return await scanner.get_status()


# ---------- Bonus ----------
@router.get("/bonus", response_model=list[Bonus])
async def list_bonus():
    order = {"eligible": 0, "maybe": 1, "unknown": 2, "not_eligible": 3}
    items = await db.bonuses.find({}, {"_id": 0, "norm_title": 0}).to_list(500)
    items.sort(key=lambda b: (order.get(b.get("eligibility", "unknown"), 2), b.get("title", "")))
    return items


@router.get("/bonus/{id}", response_model=Bonus)
async def get_bonus(id: str):
    b = await db.bonuses.find_one({"id": id}, {"_id": 0, "norm_title": 0})
    if not b:
        raise HTTPException(404, "Bonus non trovato")
    return b


@router.post("/bonus/{id}/seen", response_model=Bonus)
async def mark_seen(id: str):
    await db.bonuses.update_one({"id": id}, {"$set": {"is_new": False}})
    return await get_bonus(id)


# ---------- Documents ----------
@router.get("/documents", response_model=list[DocumentFolder])
async def list_documents():
    return await db.documents.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/documents", response_model=DocumentFolder)
async def create_document(body: DocumentCreate):
    bonus = await db.bonuses.find_one({"id": body.bonus_id}, {"_id": 0})
    if not bonus:
        raise HTTPException(404, "Bonus non trovato")
    profile = await db.profile.find_one({"_id": "me"})
    if not profile:
        raise HTTPException(400, "Completa prima il questionario")
    folder = DocumentFolder(bonus_id=bonus["id"], bonus_title=bonus["title"], authority=bonus.get("authority", ""))
    try:
        files, content = await docgen.generate(folder.id, bonus, profile)
    except Exception as exc:
        raise HTTPException(502, f"Generazione documenti non riuscita: {str(exc)[:120]}")
    folder.files = files
    folder.attachments = [str(a) for a in content.get("attachments", [])]
    folder.submission_notes = str(content.get("submission_notes", ""))
    await db.documents.insert_one(folder.model_dump())
    return folder


@router.patch("/documents/{id}", response_model=DocumentFolder)
async def update_document(id: str, body: DocumentStatusUpdate):
    r = await db.documents.find_one_and_update({"id": id}, {"$set": {"status": body.status}}, projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "Cartella non trovata")
    return r


@router.delete("/documents/{id}")
async def delete_document(id: str):
    r = await db.documents.delete_one({"id": id})
    if not r.deleted_count:
        raise HTTPException(404, "Cartella non trovata")
    shutil.rmtree(docgen.STORAGE / id, ignore_errors=True)
    return {"ok": True}


@router.get("/documents/{id}/file/{kind}")
async def download_file(id: str, kind: str):
    doc = await db.documents.find_one({"id": id})
    f = next((x for x in (doc or {}).get("files", []) if x["kind"] == kind), None)
    path = docgen.STORAGE / id / f["name"] if f else None
    if not path or not path.exists():
        raise HTTPException(404, "File non trovato")
    media = "application/pdf" if kind == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return FileResponse(path, media_type=media, filename=f["name"])


@router.get("/documents/{id}/zip")
async def download_zip(id: str):
    doc = await db.documents.find_one({"id": id})
    if not doc:
        raise HTTPException(404, "Cartella non trovata")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in doc.get("files", []):
            p = docgen.STORAGE / id / f["name"]
            if p.exists():
                z.write(p, f["name"])
        notes = "Allegati da preparare:\n" + "\n".join(f"- {a}" for a in doc.get("attachments", []))
        notes += f"\n\nCome presentare la domanda:\n{doc.get('submission_notes', '')}\n"
        z.writestr("LEGGIMI-istruzioni.txt", notes)
    buf.seek(0)
    name = f"{docgen.slug(doc['bonus_title'])}.zip"
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------- Dashboard ----------
@router.get("/dashboard", response_model=Dashboard)
async def dashboard():
    profile = await db.profile.find_one({"_id": "me"})
    return Dashboard(
        has_profile=bool(profile),
        profile_name=(profile or {}).get("full_name", ""),
        bonus_total=await db.bonuses.count_documents({}),
        bonus_eligible=await db.bonuses.count_documents({"eligibility": "eligible"}),
        bonus_maybe=await db.bonuses.count_documents({"eligibility": "maybe"}),
        bonus_new=await db.bonuses.count_documents({"is_new": True}),
        documents_total=await db.documents.count_documents({}),
        documents_to_sign=await db.documents.count_documents({"status": "da_firmare"}),
        sources_total=await db.sources.count_documents({}),
        scan=await scanner.get_status(),
    )
