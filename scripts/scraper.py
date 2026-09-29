#!/usr/bin/env python3
"""
BonusRadar Italia — scraper automatico delle fonti ufficiali di bonus.

Visita i portali istituzionali (incentivi.gov.it, INPS, Agenzia delle Entrate;
estendibile a portali regionali/comunali), individua gli avvisi che sembrano
segnalare bonus/bandi attivi ed estrae per ciascuno:

  - titolo, descrizione sintetica, ente erogatore
  - requisiti principali (ISEE, residenza, età, …) via euristica lessicale
  - scadenza e importo quando riconoscibili nel testo
  - link ufficiale e categoria (stesso vocabolario del frontend)

Output (entrambi, quando possibile):

  1. Supabase — tabella `bonuses`, upsert sul vincolo unico `norm_title`.
     Serve un key con permesso di scrittura: si usa SUPABASE_SERVICE_ROLE_KEY
     se presente (consigliata: la policy RLS consente agli utenti solo la
     lettura); in mancanza si prova la chiave anon, che RLS bloccherà e
     lo script proseguirà con il solo file JSON.
  2. Fallback JSON — `app/frontend/public/data/bonuses.json` (configurabile
     con --json o BONUSES_JSON_PATH): letto dal frontend anche dagli utenti
     NON autenticati (la RLS non permette loro di leggere la tabella).

Uso:
    python3 scripts/scraper.py                     # supabase + json
    python3 scripts/scraper.py --json percorso.json

Solo libreria standard (Python 3.10+): nessuna dipendenza esterna.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

# ---------------------------------------------------------------
# Configurazione
# ---------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (compatible; BonusRadarBot/1.0; "
    "+https://github.com/albertomarcenaro-code/BonusRadar)"
)
REQUEST_TIMEOUT = 20          # secondi
DELAY_BETWEEN_REQUESTS = 1.0  # richiesta educata tra una fonte e l'altra
MAX_ITEMS_PER_SOURCE = 12

DEFAULT_JSON_PATH = os.environ.get(
    "BONUSES_JSON_PATH", "app/frontend/public/data/bonuses.json"
)

# Fonti ufficiali monitorate. `list_url` è la pagina indice da cui si
# estraggono i link; `known_root` serve a rendere assoluti i link relativi.
SOURCES: list[dict] = [
    {
        "name": "incentivi.gov.it",
        "authority": "Presidenza del Consiglio dei Ministri",
        "list_url": "https://incentivi.gov.it/",
        "base_url": "https://incentivi.gov.it/",
    },
    {
        "name": "INPS",
        "authority": "INPS",
        "list_url": "https://www.inps.it/",
        "base_url": "https://www.inps.it/",
    },
    {
        "name": "Agenzia delle Entrate",
        "authority": "Agenzia delle Entrate",
        "list_url": "https://www.agenziaentrate.gov.it/portale/web/guest/area-stampa/novita",
        "base_url": "https://www.agenziaentrate.gov.it/",
    },
]

# Parole-chiave: un link è candidato "bonus" se il testo le contiene.
BONUS_KEYWORDS = (
    "bonus", "contribut", "assegno", "detrazi", "agevolaz", "sostegno",
    "fondo", "voucher", "buoni", "incentiv", "bandi", "avviso",
)

# mappa categoria → parole-chiave (vocabolario identico a CATEGORY_LABEL
# in app/frontend/src/lib/format.ts)
CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "casa": ("ristrutturaz", "affitto", "casa", "ediliz", "mutuo", "immobilia", "abitaz"),
    "famiglia": ("figli", "nido", "famiglia", "maternit", "assegno unico", "nucleo"),
    "lavoro": ("lavoro", "impresa", "assunzion", "apprendistat", "dipendente", "autonom"),
    "mobilita": ("mobilità", "mobilita", "auto", "scooter", "veicol", "trasporti"),
    "studio": ("student", "universit", "bors", "merito", "scuola", "libri"),
    "salute": ("psicolog", "salute", "sanitar", "medic", "dentista"),
    "energia": ("energia", "fotovoltaic", "caldaia", "efficientament", "isolament"),
}

# Euristica requisiti / documenti: frasi cercate nel testo dell'avviso.
REQUIREMENT_PATTERNS = (
    "ISEE", "residenza", "età", "reddito", "figli", "SPID", "CIE",
    "proprietario", "contratto", "nucleo familiare", "affidamento",
)
DOCUMENT_PATTERNS = (
    "ISEE", "documento d'identità", "codice fiscale", "IBAN", "SPID",
    "contratto", "fattura", "bonifico", "autocertificazione", "visura",
)

RE_AMOUNT = re.compile(r"(?:fino a |da |detrazione )?\d[\d.,]*\s*(?:€|euro)", re.IGNORECASE)
RE_DATE = re.compile(
    r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"                      # 31/12/2026
    r"|\b\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|"
    r"luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4}\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------
# Parsing HTML (solo stdlib)
# ---------------------------------------------------------------

class LinkParser(HTMLParser):
    """Raccoglie le coppie (href, testo) dei link di una pagina HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str]]) -> None:
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            text = re.sub(r"\s+", " ", " ".join(self._text)).strip()
            if text:
                self.links.append((self._href, text))
            self._href = None
            self._text = []


def fetch(url: str) -> str:
    """Scarica una pagina HTTP(S) restituendo l'HTML come testo."""
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def extract_links(html: str, base_url: str) -> list[tuple[str, str]]:
    """Estrae i link della pagina, assolutizzati e deduplicati."""
    parser = LinkParser()
    try:
        parser.feed(html)
    except Exception:  # HTML malformato: teniamo comunque i link trovati
        pass
    seen: set[str] = set()
    result: list[tuple[str, str]] = []
    for href, text in parser.links:
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue
        absolute = urljoin(base_url, href)
        if not absolute.startswith("http"):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        result.append((absolute, text))
    return result


# ---------------------------------------------------------------
# Estrazione dei campi del bonus
# ---------------------------------------------------------------

def clean_title(text: str) -> str:
    """Ripulisce il testo del link per usarlo come titolo."""
    text = re.sub(r"^(avviso|bando|comunicato|nota|scadenza)[:\s-]*", "", text, flags=re.IGNORECASE)
    text = text.strip(" .|—–-")
    return text[:160]


def guess_category(text: str) -> str:
    low = text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(k in low for k in keywords):
            return category
    return "altro"


def extract_requirements(text: str) -> list[str]:
    low = text.lower()
    return [p for p in REQUIREMENT_PATTERNS if p.lower() in low]


def extract_documents(text: str) -> list[str]:
    low = text.lower()
    return [p for p in DOCUMENT_PATTERNS if p.lower() in low]


def normalize_title(title: str) -> str:
    """Come il vincolo norm_title su Supabase: lower(btrim(title))."""
    return re.sub(r"\s+", " ", title.strip().lower())


def stable_id(norm_title: str) -> str:
    digest = hashlib.sha1(norm_title.encode("utf-8")).hexdigest()[:12]
    return f"scr-{digest}"


def build_bonus(source: dict, url: str, raw_title: str) -> dict | None:
    """Costruisce la scheda bonus a partire da un link candidato."""
    title = clean_title(raw_title)
    if len(title) < 12:
        return None

    summary = title if len(title) > 40 else f"Avviso pubblicato su {source['name']}: apri la fonte per i dettagli."
    amount_match = RE_AMOUNT.search(title)
    deadline_match = RE_DATE.search(title)

    return {
        "id": stable_id(normalize_title(title)),
        "title": title,
        "authority": source["authority"],
        "category": guess_category(f"{title} {url}"),
        "amount": amount_match.group(0).strip() if amount_match else "",
        "deadline": deadline_match.group(0) if deadline_match else "",
        "summary": summary,
        "requirements": extract_requirements(title),
        "required_documents": extract_documents(title),
        "source_url": url,
        "source_name": source["name"],
        "eligibility": "unknown",
        "eligibility_reason": "",
        "is_new": True,
    }


def scrape_source(source: dict) -> list[dict]:
    """Scarica la pagina indice di una fonte e restituisce le schede bonus."""
    print(f"→ Fonte: {source['name']} ({source['list_url']})")
    try:
        html = fetch(source["list_url"])
    except Exception as exc:
        print(f"  ⚠︎ scaricamento fallito: {exc}")
        return []

    items: list[dict] = []
    for url, text in extract_links(html, source["base_url"]):
        if len(items) >= MAX_ITEMS_PER_SOURCE:
            break
        low = text.lower()
        if not any(k in low for k in BONUS_KEYWORDS):
            continue
        bonus = build_bonus(source, url, text)
        if bonus:
            items.append(bonus)

    print(f"  ✓ {len(items)} candidati estratti")
    return items


# ---------------------------------------------------------------
# Output: Supabase + JSON
# ---------------------------------------------------------------

def supabase_upsert(url: str, key: str, rows: list[dict]) -> tuple[bool, str]:
    """Upsert su PostgREST: POST /rest/v1/bonuses?on_conflict=norm_title."""
    endpoint = url.rstrip("/") + "/rest/v1/bonuses?on_conflict=norm_title"
    payload = json.dumps(
        [
            {
                "title": r["title"],
                "authority": r["authority"],
                "category": r["category"],
                "amount": r["amount"],
                "deadline": r["deadline"],
                "summary": r["summary"],
                "requirements": r["requirements"],
                "required_documents": r["required_documents"],
                "source_url": r["source_url"],
                "source_name": r["source_name"],
                "is_new": r["is_new"],
            }
            for r in rows
        ]
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            return True, f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:200]
        return False, f"HTTP {exc.code}: {body}"
    except Exception as exc:
        return False, str(exc)


def write_json(path: Path, rows: list[dict]) -> None:
    """Scrive il file JSON letto dal frontend (catalogo per utenti anonimi)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    file = {
        "generated_at": now,
        "source": "BonusRadar scraper v1",
        "count": len(rows),
        "bonuses": [{**r, "discovered_at": now} for r in rows],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(file, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ JSON aggiornato: {path} ({len(rows)} bonus)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Scraper fonti ufficiali BonusRadar")
    ap.add_argument("--json", default=DEFAULT_JSON_PATH, help=f"percorso del file JSON (default: {DEFAULT_JSON_PATH})")
    args = ap.parse_args()

    print("BonusRadar scraper — avvio\n")

    # 1) raccolta
    rows: list[dict] = []
    seen: set[str] = set()
    for source in SOURCES:
        for bonus in scrape_source(source):
            key = normalize_title(bonus["title"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(bonus)
        time.sleep(DELAY_BETWEEN_REQUESTS)
    print(f"\nTotale bonus estratti: {len(rows)}")

    # 2) Supabase (se configurato)
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("VITE_SUPABASE_ANON_KEY")
        or ""
    )
    if rows and url and key:
        ok, detail = supabase_upsert(url, key, rows)
        if ok:
            print(f"✓ Supabase aggiornato ({detail})")
        else:
            print(f"⚠︎ Supabase non aggiornato ({detail}) → proseguo con il solo JSON")
    elif rows:
        print("ℹ︎ Credenziali Supabase non presenti → solo file JSON")

    # 3) JSON di fallback (sempre: serve agli utenti non autenticati)
    json_path = Path(args.json)
    if rows == 0 and json_path.exists():
        print(f"ℹ︎ Nessun nuovo bonus: mantengo il file esistente {json_path}")
        return 0
    write_json(json_path, rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
