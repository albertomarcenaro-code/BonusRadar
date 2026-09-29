"""MongoDB (motor) connection + indexes."""

import os

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "bonusradar")

client: AsyncIOMotorClient = AsyncIOMotorClient(
    MONGO_URL,
    uuidRepresentation="standard",
    serverSelectionTimeoutMS=4000,
    connectTimeoutMS=4000,
)
db = client[MONGO_DB]


async def ensure_indexes() -> None:
    await db.bonuses.create_index("id", unique=True)
    await db.bonuses.create_index("norm_title", unique=True)
    await db.sources.create_index("id", unique=True)
    await db.sources.create_index("url", unique=True)
    await db.documents.create_index("id", unique=True)
    await db.documents.create_index("bonus_id")
