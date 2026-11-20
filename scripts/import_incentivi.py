#!/usr/bin/env python3
"""
BonusRadar Italia — import open data di Incentivi Italia (MIMIT).

Scarica il JSON aperto della piattaforma Incentivi Italia, il file con nome
**stabile** (niente data nel percorso) pubblicato su:

    https://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json

tiene le sole schede rivolte alle **persone fisiche** — cioè i record in cui
`Tipologia_Soggetto` contiene "Cittadino" — e le converte nel formato bando di
BonusRadar.

L'output è `app/frontend/public/data/incentivi_import.json`, il file che il
passo 1d di `scripts/scraper.py` fonde nel catalogo principale
(`app/frontend/public/data/bonuses.json`). Lo script non scrive su Supabase e
non modifica `SOURCES`.

Il download può arrivare anche da `scripts/download_incentivi.py`, che scopre le
risorse via API CKAN di dati.gov.it quando l'host MIMIT è bloccato: le funzioni
`bonuses_from_records` e `write_import_file` sono condivise con quel comando
(`download_incentivi.py --import`).

Uso:
    python3 scripts/import_incentivi.py                       # URL ufficiale
    python3 scripts/import_incentivi.py --file /tmp/dump.json  # file già scaricato
    python3 scripts/import_incentivi.py --url https://…json
    python3 scripts/import_incentivi.py --examples 5 --out /tmp/prova.json

Il portale MIMIT non è raggiungibile da tutte le reti: quando il download
fallisce, scarica il file altrove e passalo con `--file`.

Solo libreria standard (Python 3.10+): nessuna dipendenza esterna.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------
# Configurazione
# ---------------------------------------------------------------

# Nome file fisso: a differenza del vecchio export di incentivi.gov.it
# (`YYYY-M-D_opendata-export.json`, con la data nel percorso) questo URL non
# cambia, quindi non serve indovinare la data del giorno.
DEFAULT_URLS = (
    "https://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json",
    # Il dataset è censito su dati.gov.it con URL http://: se il sito non ha
    # un redirect, il solo https può non bastare.
    "http://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json",
)

DEFAULT_OUT = "app/frontend/public/data/incentivi_import.json"

# Fonte mostrata sulle schede importate: il dataset è del MIMIT.
DEFAULT_SOURCE_NAME = "MIMIT — Incentivi Italia"

USER_AGENT = (
    "Mozilla/5.0 (compatible; BonusRadarBot/1.0; "
    "+https://github.com/albertomarcenaro-code/BonusRadar)"
)
REQUEST_TIMEOUT = 60

# Valore del campo `Tipologia_Soggetto` che identifica la persona fisica.
# Il catalogo non usa "persona_fisica": l'etichetta è "Cittadino".
CITIZEN = "cittadino"

# Tipologia dichiarata dalla scheda → target del catalogo. La persona fisica è
# il motivo per cui importiamo, quindi `persona` è sempre presente.
TARGET_MAP = (
    ("cittadin", "persona"),
    ("impres", "impresa"),
    ("professionist", "professionista"),
    ("artigian", "artigiano"),
)

# Categorie del catalogo (stesso vocabolario del frontend).
CATEGORY_KEYWORDS = {
    "casa": ("casa", "abitazion", "affitt", "locazion", "mutuo", "edili", "ristrutturaz",
             "efficientamento", "condomin", "prima casa", "sism"),
    "famiglia": ("famiglia", "figli", "minori", "natalità", "natalita", "asilo", "nido",
                 "genitori", "maternità", "maternita", "congedo", "nucleo familiare"),
    "lavoro": ("lavoro", "occupazion", "disoccupat", "assunzion", "apprendist",
               "contratto", "reddito", "naspi", "collocamento", "tirocin", "stage"),
    "salute": ("salute", "sanitari", "disabil", "invalid", "cure", "medic", "riabilit",
               "assistenza", "caregiver"),
    "energia": ("energia", "fotovoltaic", "bollett", "utenze", "gas", "elettric",
                "rinnovabil", "pannelli"),
    "mobilita": ("mobilità", "mobilita", "trasport", "auto", "veicol", "bici", "abbonament",
                 "patente", "tpl"),
    "studio": ("studio", "borsa di studio", "universit", "scuola", "formazion", "corsi",
               "dottorato", "erasmus", "libri", "tasse universitarie"),
    "impresa": ("impresa", "startup", "partita iva", "autonom", "commercio", "artigian",
                "pmi", "microimpres", "aziend"),
}

# Campi ammessi negli esempi stampati a video.
EXAMPLE_FIELDS = (
    "Titolo",
    "Tipologia_Soggetto",
    "Soggetto_Concedente",
    "Regioni",
    "Forma_agevolazione",
    "Stanziamento_incentivo",
    "Data_apertura",
    "Data_chiusura",
    "Link_istituzionale",
)

TAG_RE = re.compile(r"<[^>]+>")


# ---------------------------------------------------------------
# Scaricamento e lettura
# ---------------------------------------------------------------


class ImportError_(Exception):
    """Errore di scaricamento o di formato del file aperto."""


def read_source(location: str, timeout: int = REQUEST_TIMEOUT) -> bytes:
    """Restituisce i byte del JSON: da file locale se `location` è un percorso."""
    local = Path(location)
    if local.exists():
        return local.read_bytes()
    if not location.startswith(("http://", "https://")):
        raise ImportError_(f"file non trovato: {location}")

    req = urllib.request.Request(
        location,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "it-IT,it;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise ImportError_(f"HTTP {exc.code} {exc.reason} su {location}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ImportError_(f"{location}: {exc}") from exc


def download(locations: tuple[str, ...], timeout: int) -> tuple[bytes, str]:
    """Prova le sorgenti in ordine e restituisce (contenuto, sorgente usata)."""
    errors: list[str] = []
    for location in locations:
        try:
            return read_source(location, timeout), location
        except ImportError_ as exc:
            errors.append(str(exc))
    raise ImportError_("Nessuna sorgente raggiungibile:\n  " + "\n  ".join(errors))


def parse_records(raw: bytes) -> list[dict]:
    """Interpreta il JSON aperto: lista di schede o contenitore con lista."""
    # Il file ufficiale è UTF-8 con BOM: senza utf-8-sig la prima chiave
    # diventa "\ufeffID_Incentivo" e ogni lookup fallisce.
    text = raw.decode("utf-8-sig", errors="replace").strip()
    if not text:
        raise ImportError_("File vuoto")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        preview = text[:300].replace("\n", " ")
        raise ImportError_(f"JSON non valido ({exc}); inizio file: {preview!r}") from exc

    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        # Alcune distribuzioni avvolgono l'elenco in {"data": [...]} o simili.
        for key in ("data", "incentivi", "items", "results", "records"):
            value = data.get(key)
            if isinstance(value, list):
                return [r for r in value if isinstance(r, dict)]
        for value in data.values():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return [r for r in value if isinstance(r, dict)]
    raise ImportError_(f"Struttura JSON inattesa: {type(data).__name__}")


# ---------------------------------------------------------------
# Filtro e normalizzazione
# ---------------------------------------------------------------


def as_list(value) -> list[str]:
    """Normalizza un campo multi-valore: array nel JSON, stringa nel CSV."""
    if value is None:
        return []
    if isinstance(value, list):
        items = [str(v) for v in value]
    else:
        items = str(value).replace(";", ",").split(",")
    return [i.strip() for i in items if i and i.strip()]


def is_citizen(record: dict) -> bool:
    """Vero se la scheda è rivolta anche alla persona fisica."""
    return any(CITIZEN in t.lower() for t in as_list(record.get("Tipologia_Soggetto")))


def clean_text(value) -> str:
    """Testo su una riga sola, senza markup residuo."""
    text = TAG_RE.sub(" ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def close_date(record: dict) -> date | None:
    """`Data_chiusura` in forma di data, se leggibile."""
    raw = clean_text(record.get("Data_chiusura"))
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
                "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw[: len(datetime.now().strftime(fmt))], fmt).date()
        except ValueError:
            continue
    return None


def open_date(record: dict) -> str:
    """`Data_apertura` in ISO `YYYY-MM-DD`, se leggibile."""
    raw = clean_text(record.get("Data_apertura"))
    if not raw:
        return ""
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
                "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw[: len(datetime.now().strftime(fmt))], fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def guess_category(text: str) -> str:
    """Categoria del catalogo a partire dal testo della scheda."""
    lowered = text.lower()
    best, best_hits = "altro", 0
    for category, keywords in CATEGORY_KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw in lowered)
        if hits > best_hits:
            best, best_hits = category, hits
    return best


def targets_for(record: dict) -> list[str]:
    """Target del catalogo dichiarati dalla scheda (almeno `persona`)."""
    targets: list[str] = []
    for label in as_list(record.get("Tipologia_Soggetto")):
        lowered = label.lower()
        for needle, target in TARGET_MAP:
            if needle in lowered and target not in targets:
                targets.append(target)
    return targets or ["persona"]


def format_amount(record: dict) -> str:
    """Importo leggibile: prima l'agevolazione, poi la dotazione del bando."""
    concessione = clean_text(record.get("agevolazione_concedibile"))
    if concessione:
        return concessione[:200]
    spese = clean_text(record.get("spesa_ammessa"))
    if spese:
        return f"Spese ammissibili: {spese}"[:200]

    raw = record.get("Stanziamento_incentivo")
    value = None
    if isinstance(raw, (int, float)):
        value = float(raw)
    elif isinstance(raw, str):
        cleaned = re.sub(r"[^\d,.]", "", raw).replace(".", "").replace(",", ".")
        try:
            value = float(cleaned)
        except ValueError:
            value = None
    if value and value > 0:
        return f"Dotazione: € {value:,.0f}".replace(",", ".")
    return ""


def build_requirements(record: dict) -> list[str]:
    """Requisiti utili al matching, senza inventare nulla."""
    requirements: list[str] = []
    destinatari = as_list(record.get("Tipologia_Soggetto"))
    if destinatari:
        requirements.append("Destinatari: " + ", ".join(destinatari))

    regions = as_list(record.get("Regioni"))
    comuni = as_list(record.get("Comuni"))
    if regions:
        requirements.append("Regioni: " + ", ".join(regions))
    elif comuni:
        requirements.append("Comuni: " + ", ".join(comuni))
    else:
        ambito = clean_text(record.get("Ambito_territoriale"))
        if ambito:
            requirements.append("Ambito territoriale: " + ambito)

    spese = clean_text(record.get("spesa_ammessa"))
    if spese:
        requirements.append("Spese ammissibili: " + spese[:200])

    forma = clean_text(record.get("Forma_agevolazione"))
    if forma:
        requirements.append("Forma dell'agevolazione: " + forma[:200])
    return requirements


def stable_id(record: dict) -> str:
    """Id stabile: usa `ID_Incentivo`, con fallback sul titolo normalizzato."""
    key = clean_text(record.get("ID_Incentivo")) or clean_text(record.get("Titolo")).lower()
    return "inc-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def bonuses_from_records(
    records: list[dict], source_name: str = DEFAULT_SOURCE_NAME
) -> tuple[list[dict], int]:
    """Schede per i cittadini normalizzate, già deduplicate.

    Restituisce (bandi, schede con "Cittadino" in `Tipologia_Soggetto`).
    """
    citizens = [r for r in records if is_citizen(r)]
    bonuses = [b for b in (to_bonus(r, source_name) for r in citizens) if b]
    return dedupe_bonuses(bonuses), len(citizens)


def dedupe_bonuses(bonuses: list[dict]) -> list[dict]:
    """Una scheda per misura: dedupe per link ufficiale, id e titolo normalizzato."""
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    unique: list[dict] = []
    for bonus in bonuses:
        url = str(bonus.get("source_url") or "").rstrip("/").lower()
        title = re.sub(r"[^a-z0-9]+", " ", str(bonus.get("title") or "").lower()).strip()
        if (url and url in seen_urls) or (title and title in seen_titles):
            continue
        if url:
            seen_urls.add(url)
        if title:
            seen_titles.add(title)
        unique.append(bonus)
    return unique


def write_import_file(bonuses: list[dict], out: Path) -> Path:
    """Scrive il file di import nel formato atteso dal passo 1d della pipeline."""
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": DEFAULT_SOURCE_NAME,
        "count": len(bonuses),
        "bonuses": bonuses,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nOutput: {out} ({len(bonuses)} bandi)")
    return out


def to_bonus(record: dict, source_name: str) -> dict | None:
    """Converte una scheda open data nel formato bando del catalogo."""
    title = clean_text(record.get("Titolo"))
    url = clean_text(record.get("Link_istituzionale"))
    if not title or not url.startswith(("http://", "https://")):
        return None

    description = clean_text(record.get("Descrizione"))
    summary = description[:397].rstrip() + "…" if len(description) > 400 else description
    end = close_date(record)
    return {
        "id": stable_id(record),
        "title": title[:300],
        "authority": clean_text(record.get("Soggetto_Concedente")) or "Incentivi Italia",
        "category": guess_category(f"{title} {description}"),
        "amount": format_amount(record),
        "deadline": end.isoformat() if end else "",
        "summary": summary,
        "description": description[:2000],
        "requirements": build_requirements(record),
        "target": targets_for(record),
        "source_url": url,
        "source_name": source_name,
        "opening_date": open_date(record),
    }


# ---------------------------------------------------------------
# Esempi a video
# ---------------------------------------------------------------


def show_examples(records: list[dict], count: int) -> None:
    if not records or count <= 0:
        return
    print(f"\nEsempi ({min(count, len(records))} di {len(records)}):")
    for record in records[:count]:
        print("\n" + "-" * 70)
        for field in EXAMPLE_FIELDS:
            value = record.get(field)
            if isinstance(value, list):
                value = " | ".join(str(v) for v in value)
            print(f"{field}: {value if value not in (None, '') else '—'}")
        description = clean_text(record.get("Descrizione"))
        if description:
            print(f"Descrizione: {description[:400]}")


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Importa le schede per i cittadini dal JSON open data di Incentivi Italia."
    )
    parser.add_argument(
        "--file",
        action="append",
        help="file JSON già scaricato (ripetibile; ha precedenza sugli URL)",
    )
    parser.add_argument(
        "--url",
        action="append",
        help="URL o percorso del JSON (ripetibile; default: endpoint ufficiale stabile)",
    )
    parser.add_argument(
        "--out", default=DEFAULT_OUT, help=f"file di output (default {DEFAULT_OUT})"
    )
    parser.add_argument(
        "--examples", type=int, default=2, help="quante schede stampare (default 2)"
    )
    parser.add_argument(
        "--timeout", type=int, default=REQUEST_TIMEOUT, help="timeout per tentativo, in secondi"
    )
    args = parser.parse_args(argv)

    locations = tuple(args.file or args.url or DEFAULT_URLS)
    try:
        raw, used_source = download(locations, args.timeout)
        records = parse_records(raw)
    except ImportError_ as exc:
        # Codice 2: in CI un errore di rete deve essere visibile, non silenzioso.
        print(f"ERRORE: {exc}", file=sys.stderr)
        return 2

    bonuses, citizens_count = bonuses_from_records(records)
    citizens = [r for r in records if is_citizen(r)]
    skipped = citizens_count - len(bonuses)

    print(f"Sorgente: {used_source}")
    print(f"Schede totali scaricate: {len(records)}")
    print(f"Schede con \"Cittadino\" in Tipologia_Soggetto: {citizens_count}")
    print(f"Scartate per dati mancanti (titolo o link ufficiale) o duplicate: {skipped}")
    print(f"Scritte nel file di import: {len(bonuses)}")

    show_examples(citizens, args.examples)

    if bonuses:
        write_import_file(bonuses, Path(args.out))
    else:
        print("\nNessun bando importabile: file di output non scritto.")

    if not records:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
