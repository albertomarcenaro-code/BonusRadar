#!/usr/bin/env python3
"""
BonusRadar Italia — download automatico del catalogo completo Incentivi Italia.

Scarica **tutte** le schede della piattaforma Incentivi Italia (MIMIT) senza
passare dal browser e le salva in un JSON pulito, UTF-8.

Sorgenti (in ordine di tentativo):

1. **CKAN di dati.gov.it** — usata solo per *risolvere* l'URL della risorsa
   JSON, così se il MIMIT cambia percorso lo script lo segue da solo:
       https://www.dati.gov.it/opendata/api/3/action/package_show?id=open-data-incentivi
2. **Export JSON ufficiale** (nome file stabile, senza data nel percorso):
       https://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json
       http://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json
   È lo stesso file che il pulsante «esporta JSON» del portale serve al
   browser: contiene l'intero catalogo in una sola risposta, quindi non ha
   paginazione.
3. **Solr del portale** (fallback, se l'export non è raggiungibile) — è il
   motore dietro la ricerca del sito; `wt=json`, paginazione `start`/`rows`:
       https://www.incentivi.gov.it/solr/coredrupal/select?q=*:*&start=0&rows=500&wt=json

Solo libreria standard (Python 3.10+): nessuna dipendenza da installare.

Uso:
    python3 scripts/download_incentivi.py
    python3 scripts/download_incentivi.py --out /tmp/incentivi_aggiornati.json
    python3 scripts/download_incentivi.py --source mimit --rows 500
    python3 scripts/download_incentivi.py --source solr --timeout 60
    python3 scripts/download_incentivi.py --file /percorso/OpenData_Incentivi.json
    python3 scripts/download_incentivi.py --flat          # lista nuda, senza metadati

Codici di uscita: 0 = download riuscito, 1 = errore di rete/formato,
2 = nessuna sorgente raggiungibile e nessun file indicato.
"""

from __future__ import annotations

import argparse
import gzip
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

CKAN_PACKAGE = "https://www.dati.gov.it/opendata/api/3/action/package_show?id=open-data-incentivi"

MIMIT_URLS = (
    "https://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json",
    # Il dataset è censito su dati.gov.it con URL http://: senza redirect il
    # solo https può non bastare.
    "http://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json",
)

SOLR_URL = "https://www.incentivi.gov.it/solr/coredrupal/select"

DEFAULT_OUT = "incentivi_aggiornati.json"

# User-Agent da browser reale: alcuni WAF (F5/Imperva) rispondono 403 ai bot
# dichiarati. Non serve un token: l'export è pubblico e senza autenticazione.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    # Identity: niente Content-Encoding da decodificare a mano.
    "Accept-Encoding": "identity",
    "Connection": "close",
}

DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 3
SOLR_ROWS = 500

# Chiavi in cui alcune distribuzioni avvolgono l'elenco delle schede.
LIST_KEYS = ("data", "incentivi", "items", "results", "records", "docs")


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
            last = f"{url}: {reason}"
        if attempt < retries:
            pause = min(8.0, 1.5 * attempt + random.uniform(0, 0.6))
            print(f"  ! tentativo {attempt}/{retries} fallito ({last}); riprovo tra {pause:.1f}s")
            time.sleep(pause)
    raise DownloadError_(last)


# ---------------------------------------------------------------
# Sorgenti
# ---------------------------------------------------------------


def ckan_resource_url(timeout: int, retries: int) -> str | None:
    """Legge da CKAN l'URL della risorsa JSON più aggiornata (solo risoluzione)."""
    print("[1/3] CKAN dati.gov.it: risolvo l'URL della risorsa JSON")
    try:
        data = json.loads(http_get(CKAN_PACKAGE, timeout, retries).decode("utf-8-sig"))
    except (DownloadError_, json.JSONDecodeError) as exc:
        print(f"  ! CKAN non disponibile ({exc}); uso gli URL canonici")
        return None
    resources = (data.get("result") or {}).get("resources") or []
    for res in resources:
        fmt = (res.get("format") or "").strip().upper()
        url = (res.get("url") or "").strip()
        if fmt == "JSON" and url.startswith(("http://", "https://")):
            print(f"  ✓ risorsa JSON: {url}")
            print(f"    (ultima modifica metadati: {(data.get('result') or {}).get('metadata_modified')})")
            return url
    print("  ! nessuna risorsa JSON nel pacchetto CKAN; uso gli URL canonici")
    return None


def parse_payload(raw: bytes, origin: str) -> list[dict]:
    """Interpreta il payload: lista di schede o contenitore con lista."""
    # L'export ufficiale è UTF-8 con BOM: senza utf-8-sig la prima chiave
    # diventa "\ufeffID_Incentivo" e ogni lookup fallisce.
    text = raw.decode("utf-8-sig", errors="replace").strip()
    if not text:
        raise DownloadError_(f"payload vuoto da {origin}")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        head = text[:200].replace("\n", " ")
        raise DownloadError_(f"JSON non valido da {origin} ({exc}); inizio: {head!r}") from exc

    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        records = []
        for key in LIST_KEYS:
            value = data.get(key)
            if isinstance(value, list):
                records = value
                break
        if not records:
            # Solr: {"response": {"numFound": N, "docs": [...]}}
            response = data.get("response")
            if isinstance(response, dict) and isinstance(response.get("docs"), list):
                records = response["docs"]
        if not records:
            for value in data.values():
                if isinstance(value, list) and value and isinstance(value[0], dict):
                    records = value
                    break
    else:
        records = []

    clean = [r for r in records if isinstance(r, dict)]
    if not clean:
        raise DownloadError_(f"nessuna scheda riconosciuta in {origin}")
    return clean


def fetch_mimit(timeout: int, retries: int, extra_urls: list[str]) -> tuple[list[dict], str]:
    """Scarica l'export JSON completo (una sola richiesta, nessuna paginazione)."""
    print("[2/3] Export JSON ufficiale Incentivi Italia")
    errors: list[str] = []
    for url in extra_urls:
        try:
            return parse_payload(http_get(url, timeout, retries), url), url
        except DownloadError_ as exc:
            errors.append(str(exc))
            print(f"  ! {exc}")
    raise DownloadError_("nessuna sorgente JSON utilizzabile:\n  " + "\n  ".join(errors))


def solr_query(url: str, params: dict, timeout: int, retries: int) -> dict:
    query = urllib.parse.urlencode(params)
    payload = http_get(f"{url}?{query}", timeout, retries)
    try:
        return json.loads(payload.decode("utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise DownloadError_(f"risposta Solr non JSON ({exc}) da {url}") from exc


def fetch_solr(
    url: str, rows: int, timeout: int, retries: int, max_pages: int = 200
) -> tuple[list[dict], str]:
    """Fallback: interroga Solr paginando finché non scarica tutto il `numFound`."""
    print(f"[2/3] Solr del portale ({url}) con paginazione rows={rows}")
    records: list[dict] = []
    start = 0
    total = None
    for page in range(1, max_pages + 1):
        data = solr_query(
            url,
            {"q": "*:*", "start": start, "rows": rows, "wt": "json"},
            timeout,
            retries,
        )
        response = data.get("response") if isinstance(data, dict) else None
        if not isinstance(response, dict):
            raise DownloadError_(
                f"struttura Solr inattesa (manca 'response'): chiavi {list(data)[:8] if isinstance(data, dict) else type(data).__name__}"
            )
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
    if total and len(records) < total:
        print(f"  ! attenzione: scaricate {len(records)} schede su {total} dichiarate")
    return records, url


# ---------------------------------------------------------------
# Pulizia e statistiche
# ---------------------------------------------------------------


def clean_record(record: dict) -> dict:
    """Toglie valori vuoti/None e normalizza gli spazi, senza rinominare i campi."""
    out: dict = {}
    for key, value in record.items():
        if key.startswith("_version_"):  # rumore interno di Solr
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


def dedupe(records: list[dict]) -> tuple[list[dict], int]:
    seen: set[str] = set()
    unique: list[dict] = []
    duplicates = 0
    for record in records:
        key = record_key(record)
        if key and key in seen:
            duplicates += 1
            continue
        if key:
            seen.add(key)
        unique.append(record)
    return unique, duplicates


def parse_date(value) -> date | None:
    """Interpreta le date del dataset; None se non riconoscibile (fail-open)."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    head = text[:10]
    try:  # ISO, anche con ora: 2026-12-31 / 2026-12-31T23:59:59
        return datetime.strptime(head, "%Y-%m-%d").date()
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(head, fmt).date()
        except ValueError:
            continue
    try:  # ISO con offset o millisecondi
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
# CLI
# ---------------------------------------------------------------


def write_output(path: Path, records: list[dict], source: str, source_url: str, flat: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if flat:
        body: object = records
    else:
        body = {
            "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": source,
            "source_url": source_url,
            "count": len(records),
            "items": records,
        }
    text = json.dumps(body, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")
    print(f"  ✓ scritto {path} ({path.stat().st_size} byte, UTF-8)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scarica il catalogo completo degli incentivi italiani e salva un JSON pulito.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--out", default=DEFAULT_OUT, help="file JSON di destinazione")
    parser.add_argument(
        "--source",
        choices=("auto", "mimit", "solr"),
        default="auto",
        help="auto = CKAN + export ufficiale, poi Solr",
    )
    parser.add_argument("--url", action="append", default=[], help="URL aggiuntivo dell'export JSON (ripetibile)")
    parser.add_argument("--file", help="usa un export già scaricato invece della rete")
    parser.add_argument("--rows", type=int, default=SOLR_ROWS, help="schede per pagina nella modalità Solr")
    parser.add_argument("--solr-url", default=SOLR_URL, help="endpoint Solr da interrogare")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="timeout per richiesta, in secondi")
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help="tentativi per richiesta")
    parser.add_argument("--flat", action="store_true", help="scrivi una lista nuda invece di {count, items}…")
    args = parser.parse_args(argv)

    print("BonusRadar · download catalogo Incentivi Italia")
    print(f"Sorgente: {args.source} · timeout {args.timeout}s · retry {args.retries}")

    records: list[dict] = []
    used_source = ""
    used_url = ""

    # Percorso locale: salta la rete (utile su reti che bloccano il MIMIT).
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
        urls: list[str] = list(args.url)
        if args.source in ("auto", "mimit"):
            ckan_url = ckan_resource_url(args.timeout, args.retries) if args.source == "auto" else None
            urls.extend(u for u in ((ckan_url,) if ckan_url else ()) + MIMIT_URLS if u not in urls)
        failures: list[str] = []
        if args.source in ("auto", "mimit"):
            try:
                records, used_url = fetch_mimit(args.timeout, args.retries, urls)
                used_source = "export JSON MIMIT"
            except DownloadError_ as exc:
                failures.append(str(exc))
                print(f"  ! export JSON non disponibile: {exc}")
        if not records and args.source in ("auto", "solr"):
            try:
                records, used_url = fetch_solr(args.solr_url, max(1, args.rows), args.timeout, args.retries)
                used_source = "Solr incentivi.gov.it"
            except DownloadError_ as exc:
                failures.append(str(exc))
                print(f"  ! Solr non disponibile: {exc}")
        if not records:
            print("\nERRORE: nessuna sorgente raggiungibile.", file=sys.stderr)
            for failure in failures:
                print(f"  - {failure}", file=sys.stderr)
            print(
                "Suggerimento: scarica OpenData_Incentivi.json da un'altra rete e "
                "rilancia con --file OpenData_Incentivi.json",
                file=sys.stderr,
            )
            return 2

    # Pulizia: campi vuoti via, duplicati via, ordine stabile.
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

    out = Path(args.out)
    write_output(out, unique, used_source, used_url, args.flat)
    print(f"\n✓ Totale incentivi scaricati: {len(unique)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrotto.", file=sys.stderr)
        sys.exit(130)
