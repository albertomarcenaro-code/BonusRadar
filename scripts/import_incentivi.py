#!/usr/bin/env python3
"""
BonusRadar Italia — anteprima dell'import open data di Incentivi Italia.

Scarica il JSON aperto della piattaforma Incentivi Italia (MIMIT), il file
con nome **stabile** (niente data nel percorso) pubblicato su:

    https://www.incentivitalia.gov.it/open-data/incentivi/OpenData_Incentivi.json

e mostra quante schede riguardano le **persone fisiche**, cioè i record in cui
`Tipologia_Soggetto` contiene "Cittadino". Serve a capire, prima di scrivere
qualunque codice di import, quanto materiale utile c'è per BonusRadar: il
catalogo nasce come registro degli aiuti alle imprese, quindi la fetta per i
privati va misurata, non presunta.

Questo script è di **sola lettura**: non tocca `SOURCES`, non aggiorna
`app/frontend/public/data/bonuses.json` e non scrive su Supabase. Stampa il
conteggio, un riepilogo dei campi utili e qualche scheda di esempio.

Uso:
    python3 scripts/import_incentivi.py                  # conteggio + 2 esempi
    python3 scripts/import_incentivi.py --examples 5     # più esempi
    python3 scripts/import_incentivi.py --dump /tmp/cittadini.json
    python3 scripts/import_incentivi.py --url file.json  # prova su un file locale

Solo libreria standard (Python 3.10+): nessuna dipendenza esterna.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
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

USER_AGENT = (
    "Mozilla/5.0 (compatible; BonusRadarBot/1.0; "
    "+https://github.com/albertomarcenaro-code/BonusRadar)"
)
REQUEST_TIMEOUT = 60

# Valore del campo `Tipologia_Soggetto` che identifica la persona fisica.
# Il catalogo non usa "persona_fisica": l'etichetta è "Cittadino".
CITIZEN = "cittadino"


# ---------------------------------------------------------------
# Scaricamento
# ---------------------------------------------------------------


class ImportError_(Exception):
    """Errore di scaricamento o di formato del file aperto."""


def read_source(url: str, timeout: int = REQUEST_TIMEOUT) -> bytes:
    """Restituisce i byte del JSON: da file locale se `url` è un percorso."""
    local = Path(url)
    if local.exists():
        return local.read_bytes()

    req = urllib.request.Request(
        url,
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
        raise ImportError_(f"HTTP {exc.code} {exc.reason} su {url}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ImportError_(f"{url}: {exc}") from exc


def download(urls: tuple[str, ...], timeout: int) -> tuple[bytes, str]:
    """Prova gli URL in ordine e restituisce (contenuto, url usato)."""
    errors: list[str] = []
    for url in urls:
        try:
            return read_source(url, timeout), url
        except ImportError_ as exc:
            errors.append(str(exc))
    raise ImportError_("Nessun URL raggiungibile:\n  " + "\n  ".join(errors))


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
# Filtro e riepilogo
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


def only_citizen(record: dict) -> bool:
    """Vero se la scheda è riservata alla persona fisica (nessuna impresa)."""
    return as_list(record.get("Tipologia_Soggetto")) and all(
        CITIZEN in t.lower() for t in as_list(record.get("Tipologia_Soggetto"))
    )


def close_date(record: dict) -> date | None:
    """`Data_chiusura` in forma di data, se leggibile."""
    raw = str(record.get("Data_chiusura") or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
                "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw[: len(datetime.now().strftime(fmt))], fmt).date()
        except ValueError:
            continue
    return None


def is_open(record: dict) -> bool:
    """Scheda ancora utilizzabile: senza scadenza (a sportello) o non scaduta."""
    end = close_date(record)
    return end is None or end >= date.today()


def summarize(records: list[dict], url: str) -> list[dict]:
    """Stampa il riepilogo e restituisce le schede per i cittadini."""
    citizens = [r for r in records if is_citizen(r)]
    reserved = [r for r in citizens if only_citizen(r)]
    open_citizens = [r for r in citizens if is_open(r)]
    no_date = [r for r in citizens if close_date(r) is None]
    with_region = [r for r in citizens if as_list(r.get("Regioni"))]
    with_link = [r for r in citizens if str(r.get("Link_istituzionale") or "").strip()]

    print(f"Fonte: {url}")
    print(f"Schede totali nel file: {len(records)}")
    print(f"Schede con \"Cittadino\" in Tipologia_Soggetto: {len(citizens)}")
    print(f"  · riservate ai cittadini (nessuna tipologia d'impresa): {len(reserved)}")
    print(f"  · ancora aperte o senza scadenza: {len(open_citizens)}")
    print(f"  · senza Data_chiusura (a sportello): {len(no_date)}")
    print(f"  · con almeno una Regione indicata: {len(with_region)}")
    print(f"  · con Link_istituzionale: {len(with_link)}")
    return citizens


# Campi mostrati negli esempi: quelli che servono a decidere se il record è
# importabile in catalogo (chi, cosa, dove, quanto, fino a quando).
EXAMPLE_FIELDS = (
    "ID_Incentivo",
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
        description = str(record.get("Descrizione") or "").strip()
        if description:
            print(f"Descrizione: {description[:400]}")


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Conta e mostra le schede per i cittadini del JSON open data di Incentivi Italia."
    )
    parser.add_argument(
        "--url",
        action="append",
        help="URL o percorso locale del JSON (ripetibile; default: endpoint ufficiale stabile)",
    )
    parser.add_argument(
        "--examples", type=int, default=2, help="quante schede stampare (default 2)"
    )
    parser.add_argument(
        "--dump", metavar="PERCORSO", help="salva le schede filtrate in JSON (solo per ispezione)"
    )
    parser.add_argument(
        "--timeout", type=int, default=REQUEST_TIMEOUT, help="timeout per tentativo, in secondi"
    )
    args = parser.parse_args(argv)

    urls = tuple(args.url) if args.url else DEFAULT_URLS
    try:
        raw, used_url = download(urls, args.timeout)
        records = parse_records(raw)
    except ImportError_ as exc:
        # Fail-open: nessun dato, ma la run non deve far fallire l'import in CI
        # prima di sapere se il problema è di rete o di formato.
        print(f"ERRORE: {exc}", file=sys.stderr)
        return 2

    citizens = summarize(records, used_url)
    show_examples(citizens, args.examples)

    if args.dump:
        path = Path(args.dump)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(citizens, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\nSchede filtrate salvate in {path} ({len(citizens)} record)")

    if not records:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
