"""Pydantic v2 models — mirrored by hand in frontend/src/lib/types.ts."""

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


# ---------- Profile ----------
class FamilyMember(BaseModel):
    name: str = ""
    relation: str = ""  # coniuge, figlio, genitore, altro
    birth_date: str = ""
    fiscal_code: str = ""
    disabled: bool = False
    student: bool = False
    dependent: bool = True


class ProfileIn(BaseModel):
    full_name: str
    fiscal_code: str = ""
    birth_date: str = ""
    birth_place: str = ""
    gender: str = ""
    address: str = ""
    city: str = ""
    province: str = ""
    region: str = ""
    postal_code: str = ""
    phone: str = ""
    email: str = ""
    iban: str = ""
    employment_status: str = ""
    annual_income: float | None = None
    isee_value: float | None = None
    housing: str = ""  # proprietario, affitto, altro
    family_members: list[FamilyMember] = []
    interests: list[str] = []
    notes: str = ""


class Profile(ProfileIn):
    updated_at: datetime = Field(default_factory=now_utc)


# ---------- Sources ----------
class SourceIn(BaseModel):
    name: str
    url: str


class Source(SourceIn):
    id: str = Field(default_factory=new_id)
    created_at: datetime = Field(default_factory=now_utc)
    last_scanned_at: datetime | None = None
    last_status: str = "mai scansionata"
    bonus_found: int = 0


class ScanStatus(BaseModel):
    running: bool = False
    phase: str = ""
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    log: list[str] = []


# ---------- Bonus ----------
Eligibility = Literal["eligible", "maybe", "not_eligible", "unknown"]


class Bonus(BaseModel):
    id: str = Field(default_factory=new_id)
    title: str
    authority: str = ""
    category: str = "altro"
    amount: str = ""
    deadline: str = ""
    summary: str = ""
    requirements: list[str] = []
    required_documents: list[str] = []
    source_url: str = ""
    source_name: str = ""
    eligibility: Eligibility = "unknown"
    eligibility_reason: str = ""
    discovered_at: datetime = Field(default_factory=now_utc)
    is_new: bool = True


# ---------- Documents ----------
DocStatus = Literal["da_firmare", "firmato", "inviato", "approvato"]


class DocumentFile(BaseModel):
    name: str
    kind: Literal["pdf", "docx"]


class DocumentFolder(BaseModel):
    id: str = Field(default_factory=new_id)
    bonus_id: str
    bonus_title: str
    authority: str = ""
    created_at: datetime = Field(default_factory=now_utc)
    status: DocStatus = "da_firmare"
    files: list[DocumentFile] = []
    attachments: list[str] = []
    submission_notes: str = ""


class DocumentCreate(BaseModel):
    bonus_id: str


class DocumentStatusUpdate(BaseModel):
    status: DocStatus


class Dashboard(BaseModel):
    has_profile: bool
    profile_name: str = ""
    bonus_total: int
    bonus_eligible: int
    bonus_maybe: int
    bonus_new: int
    documents_total: int
    documents_to_sign: int
    sources_total: int
    scan: ScanStatus
