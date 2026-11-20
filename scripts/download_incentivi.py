#!/usr/bin/env python3
"""
BonusRadar Italia — download degli open data MIMIT via API CKAN di dati.gov.it.

L'host `www.incentivitalia.gov.it` (e la famiglia `incentivi.gov.it` /
`rna.gov.it`) è irraggiungibile da molte reti, quindi il download diretto
dell'export non è affidabile. Questo script **non** dipende da quell'host per
scoprire i dati: interroga le API CKAN ufficiali di `dati.gov.it`, che sono
raggiungibili, e da lì arriva agli URL delle risorse.

Flusso:

1. `package_search` sull'organizzazione MIMIT:
       https://www.dati.gov.it/opendata/api/3/action/package_search
           ?fq=organization:ministero-delle-imprese-e-del-made-in-italy
           &rows=100
   (paginato su `result.count`), con filtro di pertinenza su nome/titolo/tag.
2. Per ogni dataset pertinente ispeziona `resources`: usa `format` JSON e, solo
   se il JSON non è disponibile, CSV. URL da `url`, `download_url` o
   `access_url`.
3. Scarica le risorse e le fonde in un unico elenco di schede (dedupe per id/
   titolo/link). Se CKAN non espone URL utilizzabili, prova il mirror europeo
   (`https://data.europa.eu/api/hub/search/`), che però rimanda agli stessi URL
   ministeriali.
4. Con `--import` normalizza subito le schede (solo "Cittadino") nel file che
   il passo 1d di `scripts/scraper.py` legge: `incentivi_import.json` accanto al
   catalogo. Così il download alimenta il catalogo principale invece di
   restare un file isolato.

Solo libreria standard (Python 3.10+): nessuna dipendenza da installare.

Uso:
    python3 scripts/download_incentivi.py --import
    python3 scripts/download_incentivi.py --out /tmp/incentivi_aggiornati.json
    python3 scripts/download_incentivi.py --source ckan --rows 100
    python3 scripts/download_incentivi.py --source eu        # solo mirror UE
    python3 scripts/download_incentivi.py --source solr      # legacy
    python3 scripts/download_incentivi.py --file /percorso/OpenData_Incentivi.json
    python3 scripts/download_incentivi.py --flat

Codici di uscita: 0 = download riuscito, 1 = errore di formato/file locale,
2 = nessuna sorgente raggiungibile.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------
# Configurazione
# ---------------------------------------------------------------

CKAN_API = "https://www.dati.gov.it/opendata/api/3/action"
CKAN_ORG = "ministero-delle-imprese-e-del-made-in-italy"
CKAN_ROWS = 100

EU_HUB_SEARCH = "https://data.europa.eu/api/hub/search/search"
EU_HUB_DATASET = "https://data.europa.eu/api/hub/search/datasets/{id}"

# Dataset che contiene il catalogo completo delle schede per i cittadini.
CATALOG_DATASET = "open-data-incentivi"

# Parole che rendono un dataset pertinente (incentivi, agevolazioni, misure).
RELEVANT_KEYWORDS = (
    "incentiv",
    "agevol",
    "misura",
    "rna",
    "programm",
    "ricognizion",
)

# Registri RNA (misure/aiuti): storicizzati in XML, non sono il catalogo delle
# agevolazioni per i cittadini e non hanno risorse JSON/CSV utili.
EXCLUDED_DATASETS = ("open-data-rna-misure", "open-data-rna-aiuti")

JSON_FORMATS = {"JSON", "GEOJSON"}
CSV_FORMATS = {"CSV"}
# Formati che non contengono schede (o che non sappiamo leggere): si saltano.
SKIP_FORMATS = {"XML", "RDF", "PDF", "HTML", "ZIP", "XLS", "XLSX", "ODS"}

# Export ufficiale: ultima spiaggia, se un giorno la rete lo consente.
MIMIT_URLS = (
    "https://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json",
    "http://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json",
)

SOLR_URL = "https://www.incentivi.gov.it/solr/coredrupal/select"

DEFAULT_OUT = "incentivi_aggiornati.json"
# Stesso path letto dal passo 1d di scraper.py (accanto al catalogo). Il file di
# default dell'import resta la fonte di verità: qui lo importiamo dal modulo.
DEFAULT_IMPORT_OUT = "app/frontend/public/data/incentivi_import.json"

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
    "Connection": "close",
}

DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 2
SOLR_ROWS = 500

# Chiavi in cui alcune distribuzioni avvolgono l'elenco delle schede.
LIST_KEYS = ("data", "incentivi", "items", "results", "records", "docs", "misure")


class DownloadError_(Exception):
    """Errore di rete o di formato del payload."""


# ---------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------


def http_get(url: str, timeout: int = DEFAULT_TIMEOUT, retries: int = DEFAULT_RETRIES) -> bytes:
    """GET con retry e backoff. Solleva `DownloadError_` con un messaggio utile."""
    last = "errore sconosciuto"
    for attempt in range(1, max(1, retries) + 1):
        req = urllib.request.Request(url, headers=HEADERS, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = getattr(resp, "status", 200)
                if status != 200:
                    raise DownloadError_(f"HTTP {status} su {url}")
                body = resp.read()
                encoding = (resp.headers.get("Content-Encoding") or "").lower()
                if encoding == "gzip":
                    body = gzip.decompress(body)
                if not body:
                    raise DownloadError_(f"risposta vuota da {url}")
                print(f"  · GET {url} → HTTP {status}, {len(body)} byte")
                return body
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code} {exc.reason} su {url}"
            # 4xx (tranne 408/429) non ha senso ritentarlo.
            if 400 <= exc.code < 500 and exc.code not in (408, 429):
                break
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError) or "timed out" in str(reason):
                last = f"timeout dopo {timeout}s su {url}"
            else:
                last = f"{url}: {reason}"
        if attempt < retries:
            pause = min(6.0, 1.0 * attempt + random.uniform(0, 0.4))
            print(f"  ! tentativo {attempt}/{retries} fallito ({last}); riprovo tra {pause:.1f}s")
            time.sleep(pause)
    raise DownloadError_(last)


# ---------------------------------------------------------------
# CKAN — scoperta dei dataset MIMIT
# ---------------------------------------------------------------


def ckan_call(
    action: str, params: dict, timeout: int, retries: int, base: str = CKAN_API
) -> dict:
    """Chiama un'azione CKAN e restituisce `result`, con errore esplicito."""
    url = f"{base.rstrip('/')}/{action}?{urllib.parse.urlencode(params)}"
    try:
        data = json.loads(http_get(url, timeout, retries).decode("utf-8-sig"))
    except (DownloadError_, json.JSONDecodeError) as exc:
        raise DownloadError_(f"CKAN {action}: {exc}") from exc
    if not data.get("success"):
        raise DownloadError_(f"CKAN {action}: {data.get('error')}")
    result = data.get("result")
    if not isinstance(result, dict):
        raise DownloadError_(f"CKAN {action}: risultato inatteso ({type(result).__name__})")
    return result


def dataset_is_relevant(package: dict) -> bool:
    """Vero se il dataset è il catalogo delle agevolazioni (non un registro RNA)."""
    name = (package.get("name") or "").lower()
    if name.startswith(EXCLUDED_DATASETS):
        return False
    parts = [name, package.get("title") or "", package.get("notes") or ""]
    parts += [t.get("name") or "" for t in package.get("tags") or []]
    haystack = " ".join(parts).lower()
    return any(keyword in haystack for keyword in RELEVANT_KEYWORDS)


def ckan_packages(
    timeout: int,
    retries: int,
    rows: int = CKAN_ROWS,
    max_pages: int = 20,
    base: str = CKAN_API,
) -> list[dict]:
    """Tutti i dataset dell'organizzazione MIMIT, paginati su `result.count`."""
    print(f"[1/3] CKAN dati.gov.it · package_search (organization:{CKAN_ORG})")
    packages: list[dict] = []
    start = 0
    total = None
    for page in range(1, max_pages + 1):
        result = ckan_call(
            "package_search",
            {"fq": f"organization:{CKAN_ORG}", "rows": rows, "start": start},
            timeout,
            retries,
            base,
        )
        if total is None:
            total = int(result.get("count") or 0)
            print(f"  · dataset dichiarati: {total}")
        page_rows = [p for p in result.get("results") or [] if isinstance(p, dict)]
        if not page_rows:
            break
        packages.extend(page_rows)
        start += len(page_rows)
        print(f"  · pagina {page}: {len(packages)}/{total or '?'} dataset")
        if total and start >= total:
            break
    return packages


def resource_candidates(package: dict) -> list[dict]:
    """Risorse JSON (poi CSV) di un dataset, con l'URL effettivo da scaricare."""
    name = package.get("name") or ""
    out: list[dict] = []
    for res in package.get("resources") or []:
        if not isinstance(res, dict):
            continue
        fmt = (res.get("format") or res.get("distribution_format") or "").strip().upper()
        if not fmt:
            url_hint = (res.get("url") or res.get("access_url") or "").lower()
            fmt = "JSON" if url_hint.endswith(".json") else "CSV" if url_hint.endswith(".csv") else ""
        if fmt in SKIP_FORMATS or fmt not in JSON_FORMATS | CSV_FORMATS:
            continue
        url = ""
        for field in ("url", "download_url", "access_url"):
            value = (res.get(field) or "").strip()
            if value.startswith(("http://", "https://")):
                url = value
                break
        if not url:
            continue
        out.append(
            {
                "dataset": name,
                "dataset_title": package.get("title") or name,
                "resource": res.get("name") or res.get("id") or "",
                "format": fmt,
                "url": url,
                "modified": (res.get("last_modified") or package.get("metadata_modified") or "")[:19],
            }
        )
    # Il catalogo completo prima: se risponde, è la sorgente più ricca.
    out.sort(key=lambda r: (0 if r["dataset"] == CATALOG_DATASET else 1, 0 if r["format"] == "JSON" else 1))
    return out


def select_candidates(packages: list[dict]) -> tuple[list[dict], list[str]]:
    """Filtra i dataset pertinenti e raccoglie le risorse scaricabili."""
    relevant: list[dict] = []
    for package in packages:
        if dataset_is_relevant(package):
            relevant.append(package)
    print(f"  · dataset pertinenti: {len(relevant)}")
    # Il catalogo completo per primo; il resto è contorno (RNA, programmi).
    relevant.sort(key=lambda p: 0 if p.get("name") == CATALOG_DATASET else 1)
    for package in relevant[:15]:
        print(
            f"    - {package.get('name')} · {(package.get('title') or '')[:70]}"
            f" · {len(package.get('resources') or [])} risorse"
        )
    if len(relevant) > 15:
        print(f"    … e altri {len(relevant) - 15} dataset")
    candidates: list[dict] = []
    seen: set[str] = set()
    for package in relevant:
        for candidate in resource_candidates(package):
            if candidate["url"] in seen:
                continue
            seen.add(candidate["url"])
            candidates.append(candidate)
    # Priorità globale: prima il catalogo MIMIT, poi gli altri dataset.
    candidates.sort(key=lambda c: 0 if c["dataset"] == CATALOG_DATASET else 1)
    return candidates, [p.get("name") or "" for p in relevant]


# ---------------------------------------------------------------
# Mirror europeo (fallback)
# ---------------------------------------------------------------


def eu_hub_candidates(timeout: int, retries: int, query: str = "incentivi") -> list[dict]:
    """Distribuzioni dal portale europeo: stessi URL MIMIT, ma rete diversa."""
    print("[1/3] Mirror UE · data.europa.eu (fallback)")
    params = {"q": query, "limit": 50}
    url = f"{EU_HUB_SEARCH}?{urllib.parse.urlencode(params)}"
    try:
        data = json.loads(http_get(url, timeout, retries).decode("utf-8-sig"))
    except (DownloadError_, json.JSONDecodeError) as exc:
        print(f"  ! mirror UE non disponibile ({exc})")
        return []
    results = ((data.get("result") or {}).get("results")) or []
    candidates: list[dict] = []
    seen: set[str] = set()
    for item in results:
        dataset_id = item.get("id") or ""
        catalog = (item.get("catalog") or {}).get("id") or ""
        if not dataset_id or "dati-gov-it" not in catalog:
            continue
        try:
            detail = json.loads(
                http_get(EU_HUB_DATASET.format(id=urllib.parse.quote(dataset_id)), timeout, retries)
            )
        except (DownloadError_, json.JSONDecodeError) as exc:
            print(f"  ! {dataset_id}: {exc}")
            continue
        detail = detail.get("result") or detail
        title = detail.get("title") or {}
        label = title.get("it") or title.get("en") or dataset_id
        for dist in detail.get("distributions") or []:
            urls = (dist.get("access_url") or []) + (dist.get("download_url") or [])
            fmt = ((dist.get("format") or {}).get("id") or "").upper()
            if fmt in SKIP_FORMATS or fmt not in JSON_FORMATS | CSV_FORMATS:
                continue
            for value in urls:
                if not isinstance(value, str) or not value.startswith(("http://", "https://")):
                    continue
                if value in seen:
                    continue
                seen.add(value)
                candidates.append(
                    {
                        "dataset": dataset_id,
                        "dataset_title": label,
                        "resource": ((dist.get("title") or {}).get("it") or dist.get("id") or ""),
                        "format": fmt,
                        "url": value,
                        "modified": "",
                    }
                )
    print(f"  · distribuzioni trovate: {len(candidates)}")
    return candidates


# ---------------------------------------------------------------
# Lettura dei payload (JSON e CSV)
# ---------------------------------------------------------------


def _records_from_obj(data) -> list[dict]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if not isinstance(data, dict):
        return []
    for key in LIST_KEYS:
        value = data.get(key)
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return [r for r in value if isinstance(r, dict)]
    response = data.get("response")
    if isinstance(response, dict) and isinstance(response.get("docs"), list):
        return [r for r in response["docs"] if isinstance(r, dict)]
    for value in data.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return [r for r in value if isinstance(r, dict)]
    return []


def parse_csv(raw: bytes, origin: str) -> list[dict]:
    """CSV MIMIT: separatore `;` o `,`, UTF-8 con BOM."""
    text = raw.decode("utf-8-sig", errors="replace").strip()
    if not text:
        raise DownloadError_(f"payload CSV vuoto da {origin}")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = [{k: v for k, v in row.items() if k} for row in reader]
    if not rows:
        raise DownloadError_(f"nessuna riga CSV in {origin}")
    return rows


def parse_payload(raw: bytes, origin: str) -> list[dict]:
    """Interpreta il payload: JSON (lista o contenitore) oppure CSV."""
    text = raw.decode("utf-8-sig", errors="replace").strip()
    if not text:
        raise DownloadError_(f"payload vuoto da {origin}")
    if not text.startswith(("[", "{")):
        return parse_csv(raw, origin)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        head = text[:200].replace("\n", " ")
        raise DownloadError_(f"JSON non valido da {origin} ({exc}); inizio: {head!r}") from exc
    clean = _records_from_obj(data)
    if not clean:
        raise DownloadError_(f"nessuna scheda riconosciuta in {origin}")
    return clean


# ---------------------------------------------------------------
# Download delle risorse
# ---------------------------------------------------------------


def fetch_candidates(
    candidates: list[dict],
    timeout: int,
    retries: int,
    max_resources: int,
    csv_fallback: bool = True,
) -> tuple[list[dict], list[str], list[dict]]:
    """Scarica le risorse in ordine, fino a `max_resources` tentativi.

    Restituisce (schede, errori, dettaglio per risorsa). Gli errori contengono
    l'esito esatto (HTTP 404, timeout, …) così un blocco di rete è visibile.
    """
    print(f"[2/3] Download risorse (max {max_resources} tentativi, timeout {timeout}s)")
    records: list[dict] = []
    errors: list[str] = []
    report: list[dict] = []
    # Un dataset che ha già dato schede via JSON non si riprova in CSV.
    done_datasets: set[str] = set()
    attempts = 0
    for candidate in candidates:
        if attempts >= max_resources:
            break
        dataset = candidate["dataset"]
        if candidate["format"] == "CSV" and (
            not csv_fallback or dataset in done_datasets
        ):
            continue
        attempts += 1
        try:
            raw = http_get(candidate["url"], timeout, retries)
            rows = parse_payload(raw, candidate["url"])
        except DownloadError_ as exc:
            message = f"{candidate['dataset']} · {candidate['format']} · {exc}"
            errors.append(message)
            report.append({**candidate, "ok": False, "error": str(exc), "records": 0})
            print(f"  ✗ {message}")
            continue
        records.extend(rows)
        done_datasets.add(dataset)
        report.append({**candidate, "ok": True, "error": "", "records": len(rows)})
        print(f"  ✓ {candidate['dataset']} · {candidate['resource']} → {len(rows)} schede")
    return records, errors, report


def fetch_solr(
    url: str, rows: int, timeout: int, retries: int, max_pages: int = 200
) -> tuple[list[dict], str]:
    """Legacy: Solr del portale, paginato su `numFound`."""
    print(f"[2/3] Solr del portale ({url}) con paginazione rows={rows}")
    records: list[dict] = []
    start = 0
    total = None
    for page in range(1, max_pages + 1):
        params = {"q": "*:*", "start": start, "rows": rows, "wt": "json"}
        payload = http_get(f"{url}?{urllib.parse.urlencode(params)}", timeout, retries)
        try:
            data = json.loads(payload.decode("utf-8-sig"))
        except json.JSONDecodeError as exc:
            raise DownloadError_(f"risposta Solr non JSON ({exc}) da {url}") from exc
        response = data.get("response") if isinstance(data, dict) else None
        if not isinstance(response, dict):
            raise DownloadError_(f"struttura Solr inattesa: {list(data)[:8] if isinstance(data, dict) else type(data).__name__}")
        docs = [d for d in response.get("docs") or [] if isinstance(d, dict)]
        if total is None:
            total = int(response.get("numFound") or 0)
            print(f"  · numFound = {total}")
        if not docs:
            break
        records.extend(docs)
        start += len(docs)
        print(f"  · pagina {page}: {len(records)}/{total or '?'} schede")
        if total and start >= total:
            break
    if not records:
        raise DownloadError_("Solr non ha restituito alcuna scheda")
    return records, url


# ---------------------------------------------------------------
# Pulizia e statistiche
# ---------------------------------------------------------------


def clean_record(record: dict) -> dict:
    """Toglie valori vuoti/None e normalizza gli spazi, senza rinominare i campi."""
    out: dict = {}
    for key, value in record.items():
        if not isinstance(key, str) or key.startswith("_version_"):
            continue
        if isinstance(value, str):
            value = re.sub(r"\s+", " ", value).strip()
            if value:
                out[key] = value
        elif value is None or value == [] or value == {}:
            continue
        else:
            out[key] = value
    return out


def record_key(record: dict) -> str | None:
    for field in ("ID_Incentivo", "id", "Link_istituzionale", "url", "Titolo", "title"):
        value = record.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    return None


def title_key(record: dict) -> str:
    value = record.get("Titolo") or record.get("title") or ""
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def dedupe(records: list[dict]) -> tuple[list[dict], int]:
    """Deduplica per id/link e, in seconda battuta, per titolo normalizzato."""
    seen: set[str] = set()
    seen_titles: set[str] = set()
    unique: list[dict] = []
    duplicates = 0
    for record in records:
        key = record_key(record)
        title = title_key(record)
        if (key and key in seen) or (title and title in seen_titles):
            duplicates += 1
            continue
        if key:
            seen.add(key)
        if title:
            seen_titles.add(title)
        unique.append(record)
    return unique, duplicates


def parse_date(value) -> date | None:
    """Interpreta le date del dataset; None se non riconoscibile (fail-open)."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    head = text[:10]
    try:
        return datetime.strptime(head, "%Y-%m-%d").date()
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(head, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def status_counts(records: list[dict]) -> dict[str, int]:
    today = date.today()
    counts = {"aperti": 0, "chiusi": 0, "senza scadenza": 0}
    for record in records:
        raw = record.get("Data_chiusura") or record.get("deadline") or record.get("scadenza")
        end = parse_date(raw)
        if end is None:
            counts["senza scadenza"] += 1
        elif end < today:
            counts["chiusi"] += 1
        else:
            counts["aperti"] += 1
    return counts


# ---------------------------------------------------------------
# Output
# ---------------------------------------------------------------


def write_output(
    path: Path,
    records: list[dict],
    source: str,
    source_url: str,
    flat: bool,
    report: list[dict] | None = None,
    errors: list[str] | None = None,
    datasets: list[str] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if flat:
        body: object = records
    else:
        body = {
            "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": source,
            "source_url": source_url,
            "count": len(records),
            "datasets": datasets or [],
            "resources": report or [],
            "errors": errors or [],
            "items": records,
        }
    text = json.dumps(body, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")
    print(f"  ✓ scritto {path} ({path.stat().st_size} byte, UTF-8)")


def import_into_catalog(records: list[dict], out: Path) -> tuple[int, int]:
    """Normalizza le schede nel file letto dal passo 1d della pipeline.

    Restituisce (bandi scritti, schede "Cittadino" trovate). Riusa
    `scripts/import_incentivi.py` così la normalizzazione resta una sola.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import import_incentivi  # noqa: PLC0415  (import locale: evita cicli)

    bonuses, citizens = import_incentivi.bonuses_from_records(records)
    if bonuses:
        import_incentivi.write_import_file(bonuses, out)
    return len(bonuses), citizens


# ---------------------------------------------------------------
# CLI
# ---------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scarica gli open data MIMIT via CKAN e li importa nel catalogo.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--out", default=DEFAULT_OUT, help="file JSON di destinazione")
    parser.add_argument(
        "--source",
        choices=("auto", "ckan", "eu", "solr"),
        default="auto",
        help="auto = CKAN dati.gov.it (con fallback mirror UE), poi Solr",
    )
    parser.add_argument("--url", action="append", default=[], help="URL aggiuntivo dell'export JSON (ripetibile)")
    parser.add_argument("--file", help="usa un export già scaricato invece della rete")
    parser.add_argument("--rows", type=int, default=CKAN_ROWS, help="dataset per pagina nelle API CKAN")
    parser.add_argument("--ckan-api", default=CKAN_API, help="base delle API CKAN da interrogare")
    parser.add_argument("--max-resources", type=int, default=8, help="tentativi massimi di download risorse")
    parser.add_argument("--solr-url", default=SOLR_URL, help="endpoint Solr da interrogare")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="timeout per richiesta, in secondi")
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help="tentativi per richiesta")
    parser.add_argument(
        "--import",
        dest="do_import",
        action="store_true",
        help="scrive anche il file di import letto dal passo 1d della pipeline",
    )
    parser.add_argument("--import-out", default=DEFAULT_IMPORT_OUT, help="path del file di import")
    parser.add_argument("--flat", action="store_true", help="scrivi una lista nuda invece di {count, items}…")
    args = parser.parse_args(argv)

    print("BonusRadar · download catalogo Incentivi MIMIT (CKAN dati.gov.it)")
    print(f"Sorgente: {args.source} · timeout {args.timeout}s · retry {args.retries}")

    records: list[dict] = []
    used_source = ""
    used_url = ""
    errors: list[str] = []
    report: list[dict] = []
    datasets: list[str] = []

    if args.file:
        path = Path(args.file)
        print(f"[1/1] File locale: {path}")
        if not path.exists():
            print(f"ERRORE: file non trovato: {path}", file=sys.stderr)
            return 2
        try:
            records = parse_payload(path.read_bytes(), str(path))
        except DownloadError_ as exc:
            print(f"ERRORE: {exc}", file=sys.stderr)
            return 1
        used_source, used_url = "file", str(path.resolve())
    else:
        candidates: list[dict] = []
        if args.source in ("auto", "ckan"):
            try:
                packages = ckan_packages(
                    args.timeout, args.retries, max(1, args.rows), base=args.ckan_api
                )
                candidates, datasets = select_candidates(packages)
                used_url = (
                    f"{args.ckan_api.rstrip('/')}/package_search?fq=organization:{CKAN_ORG}"
                )
            except DownloadError_ as exc:
                errors.append(str(exc))
                print(f"  ! package_search non disponibile: {exc}")
        if not candidates and args.source in ("auto", "eu"):
            candidates = eu_hub_candidates(args.timeout, args.retries)
            used_url = used_url or EU_HUB_SEARCH
        for valid_url in args.url:
            candidates.append(
                {
                    "dataset": "url",
                    "dataset_title": "URL fornito",
                    "resource": valid_url,
                    "format": "JSON",
                    "url": valid_url,
                    "modified": "",
                }
            )
        if not candidates and args.source in ("auto", "ckan", "eu"):
            # Gli URL canonici restano l'ultima opzione (oggi bloccati dalla VM).
            candidates = [
                {
                    "dataset": CATALOG_DATASET,
                    "dataset_title": "Export ufficiale Incentivi Italia",
                    "resource": url,
                    "format": "JSON",
                    "url": url,
                    "modified": "",
                }
                for url in MIMIT_URLS
            ]
        if candidates:
            records, fetch_errors, report = fetch_candidates(
                candidates,
                args.timeout,
                args.retries,
                max(1, args.max_resources),
            )
            errors.extend(fetch_errors)
            ok = [r for r in report if r["ok"]]
            used_source = (
                f"CKAN dati.gov.it · {len(ok)}/{len(report)} risorse · {len(datasets)} dataset MIMIT"
                if ok
                else "nessuna risorsa scaricata"
            )
        if not records and args.source in ("auto", "solr"):
            try:
                records, used_url = fetch_solr(args.solr_url, SOLR_ROWS, args.timeout, args.retries)
                used_source = "Solr incentivi.gov.it"
            except DownloadError_ as exc:
                errors.append(str(exc))
                print(f"  ! Solr non disponibile: {exc}")
        if not records:
            print("\nERRORE: nessuna sorgente raggiungibile.", file=sys.stderr)
            for failure in errors:
                print(f"  - {failure}", file=sys.stderr)
            print(
                "Suggerimento: se la rete blocca gli host MIMIT, scarica OpenData_Incentivi.json "
                "da un'altra rete e rilancia con --file OpenData_Incentivi.json",
                file=sys.stderr,
            )
            return 2

    cleaned = [clean_record(r) for r in records]
    cleaned = [r for r in cleaned if r]
    unique, duplicates = dedupe(cleaned)
    counts = status_counts(unique)

    print("\nRiepilogo")
    print(f"  schede scaricate : {len(records)}")
    print(f"  duplicati rimossi: {duplicates}")
    print(f"  schede salvate   : {len(unique)}")
    print(
        "  per scadenza     : "
        f"{counts['aperti']} aperti · {counts['chiusi']} chiusi · {counts['senza scadenza']} senza scadenza"
    )
    if report:
        print("  risorse:")
        for item in report:
            state = f"{item['records']} schede" if item["ok"] else f"ERRORE {item['error']}"
            print(f"    - [{item['dataset']}] {item['format']} {item['url']} → {state}")

    out = Path(args.out)
    write_output(out, unique, used_source, used_url, args.flat, report, errors, datasets)

    if args.do_import:
        import_out = Path(args.import_out)
        written, citizens = import_into_catalog(unique, import_out)
        if written:
            print(f"  ✓ import catalogo: {written} bandi ({citizens} schede \"Cittadino\") → {import_out}")
        else:
            print(
                f"  ! import catalogo: nessun bando per i cittadini nelle {len(unique)} schede scaricate "
                f"(file {import_out} invariato)"
            )

    print(f"\n✓ Totale incentivi scaricati: {len(unique)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrotto.", file=sys.stderr)
        sys.exit(130)
