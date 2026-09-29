"""BonusRadar Italia — FastAPI entrypoint.

Da app/backend:
    uvicorn server:app --host 0.0.0.0 --port 8001
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from lib.db import db, ensure_indexes
from routers.app_routes import router as api_router
from seed import main as seed_main
from services.scanner import weekly_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bonusradar")

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await ensure_indexes()
        await seed_main()
    except Exception as exc:
        logger.warning("MongoDB non raggiungibile: %s — l'app parte ma i dati non saranno disponibili", exc)
    scheduler = asyncio.create_task(weekly_scheduler())
    logger.info("BonusRadar avviato · scheduler settimanale attivo")
    yield
    scheduler.cancel()


app = FastAPI(title="BonusRadar Italia", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        file = FRONTEND_DIST / full_path
        if full_path and file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
