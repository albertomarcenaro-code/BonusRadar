#!/usr/bin/env python3
"""
BonusRadar Italia — scraper automatico delle fonti ufficiali di bonus.

Visita i portali istituzionali — nazionali (incentivi.gov.it, INPS,
Agenzia delle Entrate) e locali liguri (Comune di Genova, Regione
Liguria) — individua gli avvisi che sembrano segnalare bonus/bandi
attivi ed estrae per ciascuno:

  - titolo, descrizione sintetica, ente erogatore
  - requisiti principali (ISEE, residenza, età, …) via euristica lessicale
  - scadenza e importo quando riconoscibili nel testo
  - link ufficiale e categoria (stesso vocabolario del frontend)

Output (entrambi, quando possibile):

  1. Supabase — tabella `bonuses`, upsert sul vincolo unico `norm_title`.
     I bandi che questa run non trova più NON vengono cancellati: restano in
     tabella come storico con `is_active = false` (+ `archived_at`), così il
     contatore pubblico cresce e il catalogo/matching vede solo i bandi in
     vigore. L'archiviazione richiede SUPABASE_SERVICE_ROLE_KEY e viene
     saltata per prudenza se la run trova meno della metà degli attivi; si
     disattiva con --no-archive. Le colonne sono in supabase_catalog_stats.sql.
  2. Fallback JSON — `app/frontend/public/data/bonuses.json` (configurabile
     con --json o BONUSES_JSON_PATH): letto dal frontend anche dagli utenti
     NON autenticati (la RLS non permette loro di leggere la tabella).

L'elenco delle fonti è letto dalla tabella Supabase `catalog_sources`
(solo le righe con `enabled = true`, in ordine di `priority`); se la tabella
non è leggibile si usa la lista `SOURCES` definita in questo file. Il seed
della tabella è in `supabase_catalog_sources.sql`.

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
# User-Agent da browser: alcuni portali (es. Agenzia delle Entrate) filtrano
# gli UA "bot": in caso di 403/406 si riprova una volta con questo.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
REQUEST_TIMEOUT = 20          # secondi
DELAY_BETWEEN_REQUESTS = 1.0  # richiesta educata tra una fonte e l'altra
MAX_ITEMS_PER_SOURCE = 12

# Archiviazione di `bonuses`: niente viene cancellato. Un bando che la run non
# rintraccia più resta in tabella come storico (`is_active = false`), esce dal
# catalogo e dal matching con il profilo, mentre il contatore pubblico cresce.
# L'archiviazione si applica solo quando la run è credibile: se una fonte
# risponde male e i bandi trovati crollano, non si tocca niente.
# Obsolescenza nel JSON pubblico e nel catalogo locale: una scheda che non
# viene più ritrovata per MISS_LIMIT run consecutive viene archiviata (esce dal
# catalogo). Le run in cui la sua fonte non ha risposto non contano: un timeout
# non è una prova che il bando sia scaduto.
MISS_LIMIT = 3

ARCHIVE_MIN_KEEP = 10    # bandi estratti minimi perché l'archiviazione avvenga
ARCHIVE_MIN_SHARE = 0.5  # i bandi trovati devono essere ≥ 50% degli attivi
ARCHIVE_BATCH = 100      # id per richiesta PATCH (limite di lunghezza dell'URL)

DEFAULT_JSON_PATH = os.environ.get(
    "BONUSES_JSON_PATH", "app/frontend/public/data/bonuses.json"
)

# Fonti di FALLBACK: usate solo se la tabella `catalog_sources` su Supabase
# non è leggibile (assente, RLS o rete). L'elenco ufficiale vive nel database
# (vedi supabase_catalog_sources.sql) e si aggiorna senza toccare il codice.
# `list_url` è la pagina indice da cui si estraggono i link; `base_url` serve
# a rendere assoluti i link relativi.
# `topics` (opzionale): filtro tematico — solo i link il cui testo contiene
# una di queste parole sono candidati (deduzione locale mirata).
# `residency` (opzionale): requisito di residenza da aggiungere alle schede
# estratte dalla fonte (Comune di Genova → residenza comunale, Regione
# Liguria → residenza regionale).
SOURCES: list[dict] = [
    {
        "name": "incentivi.gov.it",
        "authority": "Presidenza del Consiglio dei Ministri",
        "list_url": "https://incentivi.gov.it/",
        "base_url": "https://incentivi.gov.it/",
        "target": ("persona", "impresa"),
    },
    {
        "name": "INPS",
        "authority": "INPS",
        "list_url": "https://www.inps.it/",
        "base_url": "https://www.inps.it/",
        "target": ("persona",),
    },
    {
        "name": "Agenzia delle Entrate",
        "authority": "Agenzia delle Entrate",
        # La vecchia pagina "/area-stampa/novita" risponde 404 da tempo:
        # la home è raggiungibile e produce candidati reali.
        "list_url": "https://www.agenziaentrate.gov.it/",
        "base_url": "https://www.agenziaentrate.gov.it/",
        "target": ("persona", "impresa"),
    },
    # ---------------- Fonti locali prioritarie ----------------
    {
        "name": "Comune di Genova",
        "authority": "Comune di Genova",
        "list_url": "https://www.comune.genova.it/novita/avvisi",
        "base_url": "https://www.comune.genova.it/",
        "residency": "Residenza nel Comune di Genova",
        "topics": (
            # contributi casa/affitto
            "affitto", "casa", "abitaz", "alloggi", "ristrutturaz", "ediliz",
            # mobilità sostenibile
            "mobilit", "biciclett", "bike", "consegna a domicilio",
            # agevolazioni famiglie
            "famiglia", "figli", "nido", "asilo", "maternit", "genitori",
            # scuola/nidi
            "scuola", "mensa", "student",
            # commercio/imprese locali
            "commercio", "commerc", "esercizi", "imprese", "negoz", "tessuto economico",
        ),
        "target": ("persona", "impresa"),
    },
    {
        "name": "Regione Liguria",
        "authority": "Regione Liguria",
        "list_url": "https://www.regione.liguria.it/homepage-bandi-e-avvisi/publiccompetitions.html",
        "base_url": "https://www.regione.liguria.it/",
        "residency": "Residenza in Liguria",
        "topics": (
            # efficientamento energetico
            "energet", "efficientament", "fotovoltaic", "caldaia", "isolament",
            "riqualificaz",
            # sostegno alla famiglia
            "famiglia", "figli", "nido", "maternit", "assegno",
            # trasporti
            "trasport", "mobilit", "abbonament", "ferrovi", "treno",
            # formazione/lavoro
            "formazion", "lavoro", "occupabilit", "apprendistat", "impresa",
            "inoccup", "corsi", "borse", "student", "iscrizion",
        ),
        "target": ("persona", "impresa"),
    },

    # ---------------- Fonti nazionali aggiuntive (ampliamento ricerca) ----------------
    # Fonti presenti nella mappa `catalog_sources` (priorità 4 e 7-10) che qui
    # mancavano: senza credenziali Supabase il fallback non le scansionava e le
    # loro schede restavano ferme. Aggiunte il 16/11/2026.
    {
        "name": "Invitalia",
        "authority": "Invitalia — Agenzia nazionale per lo sviluppo d'impresa",
        "list_url": "https://www.invitalia.it/per-le-imprese/incentivi-e-strumenti",
        "base_url": "https://www.invitalia.it/",
        "target": ("impresa",),
    },
    {
        "name": "MASE",
        "authority": "Ministero dell'Ambiente e della Sicurezza Energetica",
        "list_url": "https://www.mase.gov.it/portale/incentivi",
        "base_url": "https://www.mase.gov.it/",
        "target": ("impresa",),
    },
    {
        "name": "ENEA — Efficienza Energetica",
        "authority": "ENEA",
        "list_url": "https://www.efficienzaenergetica.enea.it/",
        "base_url": "https://www.efficienzaenergetica.enea.it/",
        "target": ("persona", "impresa"),
    },
    {
        "name": "SIMEST (Gruppo CDP)",
        "authority": "SIMEST",
        "list_url": "https://www.simest.it/",
        "base_url": "https://www.simest.it/",
        "target": ("impresa",),
    },
    {
        "name": "Ministero della Cultura (MiC)",
        "authority": "Ministero della Cultura",
        "list_url": "https://cultura.gov.it/",
        "base_url": "https://cultura.gov.it/",
        "target": ("impresa",),
    },
    {
        "name": "Ministero del Lavoro",
        "authority": "Ministero del Lavoro e delle Politiche Sociali",
        "list_url": "https://www.lavoro.gov.it/",
        "base_url": "https://www.lavoro.gov.it/",
        "target": ("persona", "impresa"),
    },
    {
        "name": "Cliclavoro",
        "authority": "Ministero del Lavoro e delle Politiche Sociali",
        "list_url": "https://www.cliclavoro.gov.it/",
        "base_url": "https://www.cliclavoro.gov.it/",
        "target": ("persona", "impresa"),
    },
    {
        "name": "INAIL",
        "authority": "INAIL",
        "list_url": "https://www.inail.it/cs/news",
        "base_url": "https://www.inail.it/",
        "target": ("impresa", "persona"),
    },
    # ---------------- Fonti regionali aggiuntive ----------------
    {
        "name": "Regione Toscana",
        "authority": "Regione Toscana",
        "list_url": "https://www.regione.toscana.it/",
        "base_url": "https://www.regione.toscana.it/",
        "residency": "Residenza in Toscana",
        "target": ("persona", "impresa"),
    },
    {
        "name": "Regione Veneto",
        "authority": "Regione Veneto",
        "list_url": "https://www.regione.veneto.it/",
        "base_url": "https://www.regione.veneto.it/",
        "residency": "Residenza nel Veneto",
        "target": ("persona", "impresa"),
    },
    # ---------------- Imprese, artigiani e professionisti ----------------
    # Aggiunte il 16/11/2026 dopo la verifica delle pagine di elenco: tutte
    # rispondono e producono card con il parser attuale.
    {
        "name": "Lazio Innova",
        "authority": "Regione Lazio (Lazio Innova)",
        "list_url": "https://www.lazioinnova.it/bandi/",
        "base_url": "https://www.lazioinnova.it/",
        "residency": "Sede operativa o residenza nel Lazio",
        "target": ("impresa", "professionisti"),
    },
    {
        "name": "Invitalia — Autoimpiego e nuove imprese",
        "authority": "Invitalia",
        "list_url": "https://www.invitalia.it/per-chi-vuole-fare-impresa/incentivi-e-strumenti",
        "base_url": "https://www.invitalia.it/",
        # Pagina curata: le card sono i nomi degli incentivi, senza testo.
        "all_items": True,
        # Progetti educativi per le scuole, non incentivi per chi fa impresa.
        "exclude": (
            "saper(e)consumare", "sapereconsumare", "progetto rete",
            # Link promozionali in colonna: non sono autoimpiego.
            "ecobonus", "colonnine", "mobilità sostenibile",
        ),
        "target": ("impresa", "artigiani"),
    },
    {
        "name": "Sardegna Impresa (Confartigianato)",
        "authority": "Confartigianato Sud Sardegna",
        "list_url": "https://www.sardegnaimpresa.it/bandi",
        "base_url": "https://www.sardegnaimpresa.it/",
        "residency": "Sede operativa in Sardegna",
        # La pagina mescola bandi e articoli divulgativi.
        "topics": ("bando", "avviso", "incentiv", "finanziament", "credito d'imposta", "contribut"),
        "target": ("artigiani", "impresa"),
    },
    {
        "name": "Fondoprofessioni",
        "authority": "Fondoprofessioni",
        "list_url": "https://www.fondoprofessioni.it/avvisi",
        "base_url": "https://www.fondoprofessioni.it/",
        # La pagina di elenco è molto "di servizio": solo gli avvisi veri.
        "topics": ("avviso", "bando", "voucher", "formazione", "contribut"),
        # La pagina è un menu: si scartano eventi, premi e materiali.
        "exclude": ("forum", "concorso", "premio", "video appuntamento", "convegno"),
        "target": ("professionisti",),
    },
    {
        "name": "Regione Friuli Venezia Giulia",
        "authority": "Regione Autonoma Friuli Venezia Giulia",
        "list_url": "https://www.regione.fvg.it/",
        "base_url": "https://www.regione.fvg.it/",
        "residency": "Sede operativa o residenza in Friuli Venezia Giulia",
        # Home molto ampia: senza filtro tematico entrano solo notizie.
        # La home contiene anche bandi per Comuni, scuole ed ETS: il filtro
        # tiene solo ciò che parla di imprese, artigiani e professionisti.
        "topics": (
            "impres", "artigian", "professionist", "pmi", "startup",
            "innovazione", "internazional", "voucher",
        ),
        "target": ("impresa", "artigiani"),
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
    "casa": ("ristrutturaz", "affitto", "casa", "ediliz", "mutuo", "immobilia", "abitaz", "alloggi"),
    "famiglia": ("figli", "nido", "asilo", "famiglia", "maternit", "assegno unico", "nucleo", "scuola", "mensa"),
    "lavoro": ("lavoro", "impresa", "assunzion", "apprendistat", "dipendente", "autonom", "formazion", "occupabilit", "commerc"),
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

# Frammenti di testo che rivelano un elemento di interfaccia (widget,
# selettori, menu) e non un avviso: scartati in build_bonus.
NOISE_SUBSTRINGS = (
    "selected items", "mostra di più", "mostra di piu", "filtra per",
    "seleziona", "loading", "caricamento",
    # Paginazione e inviti generici delle pagine di elenco: non sono bandi.
    "navigazione articoli", "prenota il tuo video appuntamento",
)

# Atti amministrativi che non sono bonus per i cittadini: gare, affidamenti,
# concessioni e procedure interne. Filtro sul titolo, così il catalogo non
# propone come "idoneo" un avviso di procedura negoziata.
# Notizie e contenuti informativi che non sono bandi: comunicati, osservatori,
# premi, vademecum, eventi. Il catalogo deve contenere opportunità, non articoli.
NEWS_NOISE_SUBSTRINGS = (
    "osservatorio", "chiarimenti", "premio", "esito dei controlli", "video guida",
    "job&orienta", "job & orienta", "comunicazioni sui contributi", "vademecum",
    "rafforzano", "smau", "convegno", "seminario", "webinar", "comunicato",
    "rassegna", "intervista", "criterio del", "multicomparto", "controlli ex post",
    "campagna proattiva", "in diretta",
    # Annunci di incontri/convegni sul tema: informazione, non opportunità.
    "incontro su", "incontro dedicato",
)

ADMIN_NOISE_SUBSTRINGS = (
    "procedura negoziata", "avviso di indizione", "affidamento",
    "concessione di derivazione", "derivazione idrica", "ricerca acque sotterranee",
    "mobilità volontaria", "graduatorie", "calendario colloqui",
    "nomina del revisore", "istanza concessione", "manifestazione di interesse",
)

# Titoli generici di menu/navigazione: non sono bandi. Usati in build_bonus
# per scartare i link di servizio che il filtro keyword lascia passare.
# Destinatario dedotto dal testo del bando. Serve a rendere utile il filtro
# "destinatari": le fonti generiche valgono per entrambi i pubblici, ma il
# singolo avviso spesso parla solo di imprese o solo di famiglie.
TARGET_IMPRESE_RE = re.compile(
    r"\b(imprese?|pmi|start[\s-]?up|aziende|società|ditte?|artigian\w*|"
    r"professionist\w*|libere professioni|partita iva|ateco|consorzi\w*|"
    r"cooperative?|enti locali|ets|associazioni di categoria|operatori economici|"
    r"datori? di lavoro|assunzion\w*)\b",
    re.I,
)
TARGET_PERSONE_RE = re.compile(
    r"\b(famiglie|cittadin\w*|nucleo familiare|figli\w*|minori|studenti|"
    r"pensionat\w*|isee|disabilit\w*|affitto|asilo nido|maggiorenni|"
    r"consumatori)\b",
    re.I,
)


def deduce_target(text: str, fallback: tuple[str, ...] | list[str]) -> list[str]:
    """Target del singolo bando dal suo testo, con la fonte come fallback.

    Se il testo parla solo di imprese → imprese; solo di famiglie/cittadini →
    persone; di entrambi → entrambi; di nessuno dei due → target della fonte.
    """
    low = text.lower()
    # "Aziende sanitarie", "aziende Usl", "aziende ospedaliere" non sono
    # imprese: senza questa pulizia un avviso per medici risultava "impresa".
    low = re.sub(
        r"aziende?\s+(sanitari\w*|usl|ospedalier\w*|per i servizi sanitari)",
        "enti sanitari",
        low,
    )
    target: list[str] = []
    if TARGET_IMPRESE_RE.search(low):
        target.append("impresa")
        if re.search(r"artigian", low):
            target.append("artigiani")
        if re.search(r"professionist|libere professioni", low):
            target.append("professionisti")
    if TARGET_PERSONE_RE.search(low):
        target.append("persona")
    if not target:
        return list(fallback)
    return list(dict.fromkeys(target))


GENERIC_TITLES = {
    "bandi e concorsi", "bandi di concorso", "bandi e avvisi", "avvisi e bandi",
    "in primo piano", "in evidenza", "in diretta", "news e eventi", "news & eventi",
    "notizie", "novita", "novità", "comunicati", "comunicati e news",
    "eventi", "approfondimenti", "leggi tutto", "continua a leggere",
    "scopri di più", "scopri di piu", "vai al sito", "tutte le notizie",
    "home page", "cerca", "contatti", "menu", "approfondisci",
}
RE_DEADLINE_CARD = re.compile(
    # "Scadenza: ore 12.00 del giorno 12 ottobre 2026", "Chiusura: 30/09/2026",
    # "Termine presentazione domande: 15 ottobre 2026", "entro il 30/09/2026"
    r"(?:scadenza|chiusura|termine|entro il?)[^\n]{0,140}?"
    r"(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"
    r"|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|"
    r"luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})",
    re.IGNORECASE,
)
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


class CardParser(HTMLParser):
    """Estrae le 'card' dei notiziari istituzionali: ciascuna ha un titolo
    (h2/h3/h4 con class~title), un link "leggi tutto" e un'eventuale data.
    Usata per Comune di Genova e Regione Liguria, dove il link ha testo
    generico ("Vai alla notizia") e il titolo vero sta nell'heading sopra."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.cards: list[dict] = []
        self._heading: str | None = None     # titolo in accumulo
        self._in_heading = False
        self._href: str | None = None        # href correntemente aperto
        self._href_text: list[str] = []
        self._time_attr: str | None = None
        self._card_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str]]) -> None:
        a = dict(attrs)
        if tag in ("h2", "h3", "h4"):
            # Ogni heading apre una card nuova: senza questo azzeramento il testo
            # della card precedente finiva nel sommario della successiva.
            self._heading = ""
            self._in_heading = True
            self._card_text = []
        elif tag == "a" and self._heading is not None:
            self._href = a.get("href")
            self._href_text = []
        elif tag == "time" and self._heading is not None:
            self._time_attr = a.get("datetime")

    def handle_data(self, data: str) -> None:
        if self._in_heading:
            self._heading += data
        if self._href is not None:
            self._href_text.append(data)
        if self._heading is not None:
            self._card_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in ("h2", "h3", "h4") and self._in_heading:
            self._in_heading = False
        elif tag == "a" and self._href is not None:
            link_text = re.sub(r"\s+", " ", " ".join(self._href_text)).strip()
            title = re.sub(r"\s+", " ", (self._heading or "")).strip()
            generic = link_text.lower() in ("", "vai alla notizia", "vai alla pagina della notizia", "leggi tutto", "read more", "continua")
            if not generic and link_text:
                title = title or link_text
            if title and self._href:
                self.cards.append({
                    "title": title,
                    "href": self._href,
                    "time": self._time_attr,
                    "text": re.sub(r"\s+", " ", " ".join(self._card_text)).strip(),
                })
            self._href = None
            self._href_text = []
            self._time_attr = None
            self._heading = None
            self._card_text = []


class FetchError(Exception):
    """Errore di scaricamento: permette il retry con User-Agent da browser."""

    def __init__(self, status: int | None, detail: str):
        super().__init__(f"HTTP {status}: {detail}" if status else detail)
        self.status = status


def fetch(url: str, user_agent: str = USER_AGENT) -> str:
    """Scarica una pagina HTTP(S) restituendo l'HTML come testo."""
    req = urllib.request.Request(
        url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"}
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset, errors="replace")
    except urllib.error.HTTPError as exc:
        raise FetchError(exc.code, exc.reason) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FetchError(None, str(exc)) from exc


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


def extract_items(html: str, base_url: str) -> list[dict]:
    """Estrae gli elementi di un notiziario provando prima il parser di card
    (titolo vero + link + data), poi ricadendo sui link classici con testo
    significativo. Ogni elemento: {url, title, text}.
    """
    card_parser = CardParser()
    try:
        card_parser.feed(html)
    except Exception:
        pass

    items: list[dict] = []
    seen: set[str] = set()
    for card in card_parser.cards:
        absolute = urljoin(base_url, card["href"])
        if not absolute.startswith("http") or absolute in seen:
            continue
        seen.add(absolute)
        items.append({"url": absolute, "title": card["title"], "text": card["text"]})

    if items:  # notiziario a card riconosciuto
        return items

    # Fallback: link con testo proprio significativo (pagine a elenco semplice)
    for absolute, text in extract_links(html, base_url):
        if len(text) >= 20:
            items.append({"url": absolute, "title": text, "text": text})
    return items


# ---------------------------------------------------------------
# Estrazione dei campi del bonus
# ---------------------------------------------------------------

def clean_title(text: str) -> str:
    """Ripulisce il testo per usarlo come titolo (senza troncare prefissi
    come 'Avviso di concorso…', che fanno parte del titolo stesso)."""
    text = re.sub(r"\s+", " ", text).strip(" .|—–-|")
    return text[:160]


def guess_category(text: str) -> str:
    low = text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(k in low for k in keywords):
            return category
    return "altro"


def _mentioned(pattern: str, low: str) -> bool:
    """True se `pattern` compare come parola: "età" non deve combaciare con
    "società" o "entità", che non sono requisiti di età."""
    return re.search(rf"\b{re.escape(pattern.lower())}", low) is not None


def extract_requirements(text: str) -> list[str]:
    low = text.lower()
    return [p for p in REQUIREMENT_PATTERNS if _mentioned(p, low)]


def extract_documents(text: str) -> list[str]:
    low = text.lower()
    return [p for p in DOCUMENT_PATTERNS if _mentioned(p, low)]


def normalize_title(title: str) -> str:
    """Come il vincolo norm_title su Supabase: lower(btrim(title))."""
    return re.sub(r"\s+", " ", title.strip().lower())


def stable_id(norm_title: str) -> str:
    digest = hashlib.sha1(norm_title.encode("utf-8")).hexdigest()[:12]
    return f"scr-{digest}"


def build_bonus(source: dict, url: str, raw_title: str, extra_text: str = "") -> dict | None:
    """Costruisce la scheda bonus a partire da un elemento candidato.
    `extra_text` è il testo della card: arricchisce importo, scadenza,
    requisiti e documenti senza sostituire il titolo."""
    title = clean_title(raw_title)
    if len(title) < 12:
        return None
    # Voci di menu/navigazione che superano il filtro keyword ma non sono bandi
    # (es. "Bandi e concorsi", "In primo piano"): scartate qui per non sporcare
    # il catalogo con link di servizio.
    if title.lower().strip(" .:|—–-").rstrip(".") in GENERIC_TITLES:
        return None
    if any(noise in title.lower() for noise in NOISE_SUBSTRINGS):
        return None
    if any(noise in title.lower() for noise in ADMIN_NOISE_SUBSTRINGS):
        return None
    if any(noise in title.lower() for noise in NEWS_NOISE_SUBSTRINGS):
        return None

    full_text = f"{title} {extra_text}"
    # Target: prima il testo del bando, poi la fonte (persona / impresa /
    # artigiani / professionisti). Senza indicazioni vale per entrambi i
    # pubblici, così non sparisce dalla vista di nessuno.
    source_target = tuple(t for t in (source.get("target") or ()) if t)
    target = deduce_target(full_text, source_target or ("persona", "impresa"))
    summary = (extra_text.strip() or title) if len(title) > 40 else f"Avviso pubblicato su {source['name']}: apri la fonte per i dettagli."
    if len(summary) > 400:
        summary = summary[:397].rstrip() + "…"
    amount_match = RE_AMOUNT.search(full_text)
    # Scadenza: nelle card solo da frasi esplicite ("Scadenza: …") — la data
    # generica della card è la pubblicazione, non la scadenza. Nei link semplici
    # (extra_text vuoto) la data nel titolo è di solito la scadenza reale.
    if extra_text:
        card_deadline = RE_DEADLINE_CARD.search(extra_text)
        if card_deadline:
            inner = RE_DATE.search(card_deadline.group(0))
            deadline_text = inner.group(0) if inner else card_deadline.group(0).strip()
        else:
            deadline_text = ""
    else:
        date_match = RE_DATE.search(title)
        deadline_text = date_match.group(0) if date_match else ""

    requirements = extract_requirements(full_text)
    # Requisito di residenza dichiarato dalla fonte (fonti locali).
    residency = source.get("residency")
    if residency and residency not in requirements:
        requirements.append(residency)

    return {
        "id": stable_id(normalize_title(title)),
        "title": title,
        "authority": source["authority"],
        "category": guess_category(f"{title} {url}"),
        "amount": amount_match.group(0).strip() if amount_match else "",
        "deadline": deadline_text,
        "summary": summary,
        "requirements": requirements,
        "required_documents": extract_documents(title),
        "source_url": url,
        "source_name": source["name"],
        "target": target,
        "eligibility": "unknown",
        "eligibility_reason": "",
        "is_new": True,
    }


def scrape_source(source: dict) -> tuple[list[dict], bool]:
    """Scarica la pagina indice di una fonte e restituisce (schede, raggiunta).

    `raggiunta` è False quando la pagina non risponde: in quel caso le schede di
    quella fonte non vanno contate come "non più trovate" (obsolescenza).
    """
    print(f"→ Fonte: {source['name']} ({source['list_url']})")
    html: str | None = None
    for ua, label in ((USER_AGENT, "UA bot"), (BROWSER_UA, "UA browser")):
        try:
            html = fetch(source["list_url"], user_agent=ua)
            break
        except FetchError as exc:
            print(f"  ⚠︎ {label} fallito: {exc}")
    if html is None:
        print("  ⚠︎ fonte saltata (non raggiungibile): le altre proseguono")
        return [], False

    topics = source.get("topics")
    items: list[dict] = []
    for element in extract_items(html, source["base_url"]):
        if len(items) >= MAX_ITEMS_PER_SOURCE:
            break
        hay = f"{element['title']} {element['text']}".lower()
        # Pagine di elenco curate (es. Invitalia "incentivi e strumenti"): le
        # card hanno solo il nome dell'incentivo, senza keyword nel testo, quindi
        # il filtro per parole chiave le scarterebbe tutte.
        if not source.get("all_items"):
            if not any(k in hay for k in BONUS_KEYWORDS):
                continue
            # Filtro tematico delle fonti locali: solo gli avvisi in tema.
            if topics and not any(t in hay for t in topics):
                continue
        # Esclusioni puntuali per fonte (voci della pagina che non sono bandi).
        if any(x in hay for x in source.get("exclude", ())):
            continue
        bonus = build_bonus(source, element["url"], element["title"], element["text"])
        if bonus:
            items.append(bonus)

    print(f"  ✓ {len(items)} candidati estratti")
    return items, True


# ---------------------------------------------------------------
# Output: Supabase + JSON
# ---------------------------------------------------------------

def supabase_upsert(
    url: str, key: str, rows: list[dict], *, mark_active: bool = True, with_target: bool = True
) -> tuple[bool, str]:
    """Upsert su PostgREST: POST /rest/v1/bonuses?on_conflict=norm_title.

    `mark_active` rimette `is_active = true`: un bando archiviato che ricompare
    torna in vigore senza intervento manuale. Si disattiva solo quando la
    colonna non esiste ancora (supabase_catalog_stats.sql non eseguito).
    """
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
                **({"target": r.get("target") or ["persona", "impresa"]} if with_target else {}),
                "is_new": r["is_new"],
                **({"is_active": True} if mark_active else {}),
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


def supabase_host(url: str) -> str:
    """Host del progetto Supabase (solo il dominio: nessuna chiave nel log)."""
    return url.split("://", 1)[-1].split("/", 1)[0].strip() or url


def supabase_sources(url: str, key: str) -> list[dict] | None:
    """Elenco fonti dalla tabella `catalog_sources` (solo quelle abilitate).

    None se la tabella non è leggibile: in quel caso si usa l'elenco nel codice.
    Le righe sono già nel formato atteso da scrape_source().
    """
    endpoint = (
        url.rstrip("/")
        + "/rest/v1/catalog_sources?enabled=is.true"
        "&select=slug,name,authority,list_url,base_url,residency,topics,target,priority"
        "&order=priority.asc"
    )
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    try:
        req = urllib.request.Request(endpoint, headers=headers)
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as exc:
        # Colonna `target` non ancora creata (migrazione non eseguita): si
        # rilegge senza, invece di rinunciare alla tabella e alle sue fonti.
        if exc.code == 400:
            retry = endpoint.replace(",target,", ",")
            try:
                req = urllib.request.Request(retry, headers=headers)
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode("utf-8") or "[]")
                print("ℹ︎ catalog_sources senza colonna `target`: esegui la migrazione")
            except Exception as exc2:
                print(f"⚠︎ Fonti da catalog_sources non leggibili: {exc2}")
                return None
        else:
            body = exc.read().decode("utf-8", errors="replace")[:160]
            print(f"⚠︎ Fonti da catalog_sources non leggibili: HTTP {exc.code} {body}")
            return None
    except Exception as exc:
        print(f"⚠︎ Fonti da catalog_sources non leggibili: {exc}")
        return None

    sources: list[dict] = []
    for row in data:
        if not isinstance(row, dict) or not row.get("list_url"):
            continue
        name = row.get("name") or row.get("slug") or ""
        sources.append(
            {
                "name": name,
                "authority": row.get("authority") or name,
                "list_url": row["list_url"],
                "base_url": row.get("base_url") or row["list_url"],
                "residency": row.get("residency") or None,
                "topics": tuple(row["topics"]) if row.get("topics") else None,
                "target": tuple(row["target"]) if row.get("target") else None,
            }
        )
    return sources or None


def supabase_snapshot(url: str, key: str) -> set[str] | None:
    """Titoli normalizzati presenti in `bonuses`, per verificare l'upsert.

    None se la lettura non è permessa (RLS con la sola chiave anon): in quel
    caso non si può affermare niente sulla scrittura.
    """
    endpoint = url.rstrip("/") + "/rest/v1/bonuses?select=norm_title&limit=5000"
    req = urllib.request.Request(
        endpoint,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:160]
        print(f"⚠︎ Verifica Supabase non possibile: HTTP {exc.code} {body}")
        return None
    except Exception as exc:  # rete assente o risposta non JSON
        print(f"⚠︎ Verifica Supabase non possibile: {exc}")
        return None
    return {row.get("norm_title", "") for row in data if isinstance(row, dict)}


def supabase_rows(url: str, key: str, *, only_active: bool = False) -> list[dict] | None:
    """Righe di `bonuses` (id, titolo normalizzato, fonte) per l'archiviazione.

    `only_active` limita alle righe ancora in vigore: sono le uniche che questa
    run può rendere obsolete. None se la lettura non è permessa o fallisce: in
    quel caso non si archivia niente (serve sapere cosa c'è in tabella).
    """
    endpoint = (
        url.rstrip("/")
        + "/rest/v1/bonuses?select=id,norm_title,title,source_name&limit=5000"
        + ("&is_active=is.true" if only_active else "")
    )
    req = urllib.request.Request(
        endpoint,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:160]
        print(f"⚠︎ Archiviazione non possibile: lettura bonuses HTTP {exc.code} {body}")
        return None
    except Exception as exc:  # rete assente o risposta non JSON
        print(f"⚠︎ Archiviazione non possibile: {exc}")
        return None
    return [row for row in data if isinstance(row, dict) and row.get("id")]


def supabase_patch(url: str, key: str, ids: list[str], payload: dict) -> tuple[bool, str]:
    """PATCH delle righe indicate, a blocchi: `?id=in.("…","…")`.

    Gli id sono UUID generati dal database, quindi entrano nell'URL tra
    virgolette senza bisogno di altro escaping.
    """
    body = json.dumps(payload).encode("utf-8")
    for start in range(0, len(ids), ARCHIVE_BATCH):
        batch = ids[start : start + ARCHIVE_BATCH]
        values = ",".join(f'"{i}"' for i in batch)
        endpoint = url.rstrip("/") + f"/rest/v1/bonuses?id=in.({values})"
        req = urllib.request.Request(
            endpoint,
            data=body,
            method="PATCH",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                if resp.status >= 300:
                    return False, f"HTTP {resp.status}"
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            return False, f"HTTP {exc.code}: {detail}"
        except Exception as exc:
            return False, str(exc)
    return True, f"{len(ids)} righe"


def supabase_archive(url: str, key: str, keep: set[str]) -> int:
    """Marca `is_active = false` sui bandi che questa run non ha più trovato.

    Niente viene cancellato: i bandi escono dal catalogo e dal matching con il
    profilo, ma restano in tabella come storico (`archived_at`), così il
    contatore pubblico cresce. `keep` sono i titoli normalizzati appena scritti.
    Restituisce quante righe sono state archiviate; 0 anche quando
    l'operazione viene saltata, e in quel caso il motivo finisce nel log
    (nessuna archiviazione silenziosa).
    """
    rows = supabase_rows(url, key, only_active=True)
    if rows is None:
        return 0
    total = len(rows)
    if total == 0:
        print("ℹ︎ Archiviazione: nessun bando attivo da valutare")
        return 0
    stale = [r for r in rows if r.get("norm_title") not in keep]
    if not stale:
        print("ℹ︎ Archiviazione: tutti i bandi attivi sono stati ritrovati")
        return 0
    if len(keep) < ARCHIVE_MIN_KEEP or len(keep) < total * ARCHIVE_MIN_SHARE:
        print(
            f"::warning::Archiviazione saltata per prudenza: questa run ha trovato {len(keep)} "
            f"bandi contro {total} attivi in tabella. I {len(stale)} non trovati restano attivi, "
            "così una fonte irraggiungibile non svuota il catalogo."
        )
        return 0
    now = datetime.now(timezone.utc).isoformat()
    ok, detail = supabase_patch(
        url, key, [r["id"] for r in stale], {"is_active": False, "archived_at": now}
    )
    if not ok:
        print(f"::warning::Archiviazione non riuscita ({detail}): i bandi restano attivi")
        return 0
    print(
        f"✓ Archiviazione: {len(stale)} bandi non più trovati marcati come scaduti "
        f"({total} attivi → {total - len(stale)}; restano in tabella come storico)"
    )
    return len(stale)


def retag_catalog(path: Path, sources: list[dict]) -> int:
    """Ricalcola il target di ogni scheda del JSON dal suo testo.

    Serve ai cataloghi raccolti prima che l'etichetta esistesse (o quando il
    target della fonte cambia): senza questo, le schede vecchie resterebbero
    "persona + impresa" e il filtro per destinatario mostrerebbe tutto.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print("⚠︎ nessun catalogo da rietichettare")
        return 1
    defaults = {
        s["name"]: list(s.get("target") or ("persona", "impresa")) for s in sources
    }
    changed = 0
    rows = data.get("bonuses", [])
    for bonus in rows:
        fallback = defaults.get(bonus.get("source_name", ""), ["persona", "impresa"])
        text = " ".join(
            [*bonus.get("requirements", []), bonus.get("title", ""), bonus.get("summary", "")]
        )
        new = deduce_target(text, fallback)
        if new != bonus.get("target"):
            bonus["target"] = new
            changed += 1
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ Target ricalcolato su {len(rows)} schede ({changed} cambiate): {path}")
    return 0


def merge_with_existing(
    rows: list[dict],
    path: Path,
    scanned_sources: set[str] | None = None,
    failed_sources: set[str] | None = None,
    miss_limit: int = MISS_LIMIT,
    source_targets: dict[str, list[str]] | None = None,
) -> tuple[list[dict], int, int, int, int]:
    """Unisce la run al catalogo già presente nel JSON.

    Una singola run non è una fotografia completa delle fonti: una pagina che
    risponde male, un elenco che ruota o un timeout fanno sparire schede ancora
    valide. Le schede già in catalogo restano quindi in elenco, aggiornate quando
    la run le ritrova (stesso titolo normalizzato) e mantenute com'erano quando
    non le ritrova.

    Ogni scheda porta `miss_streak` (run consecutive in cui non è stata
    ritrovata) e `last_seen_at`: superata la soglia `miss_limit` la scheda viene
    archiviata, cioè tolta dal catalogo. Le schede delle fonti che in questa run
    non hanno risposto non incrementano il contatore.

    Restituisce (righe, nuove, aggiornate, conservate, archiviate).
    """
    failed = failed_sources or set()
    # Fonti assenti da questa run (es. elenco nel codice più corto della tabella
    # su Supabase): le loro schede non sono né ritrovate né perse.
    scanned = scanned_sources - failed if scanned_sources else set()
    targets = source_targets or {}

    def with_target(row: dict) -> dict:
        """Rimette il target della fonte sulle schede raccolte prima che
        esistesse il campo: il filtro per destinatario deve funzionare su
        tutto il catalogo, non solo sulle schede dell'ultima run."""
        if row.get("target"):
            return row
        return {**row, "target": targets.get(row.get("source_name", ""), ["persona", "impresa"])}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [{**r, "miss_streak": 0, "last_seen_at": now} for r in rows]
    try:
        previous = json.loads(path.read_text(encoding="utf-8")).get("bonuses", [])
    except (OSError, ValueError):
        previous = []
    if not isinstance(previous, list) or not previous:
        return rows, len(rows), 0, 0, 0

    previous = [r for r in previous if isinstance(r, dict)]
    known = {normalize_title(r.get("title", "")) for r in previous}

    merged: list[dict] = []
    found: set[str] = set()
    new = updated = archived = 0
    for row in rows:
        key = normalize_title(row["title"])
        found.add(key)
        if key in known:
            updated += 1
        else:
            new += 1
        merged.append(with_target(row))

    # Schede non ritrovate: contatore di assenza, archiviazione oltre soglia.
    for old in previous:
        if normalize_title(old.get("title", "")) in found:
            continue
        if old.get("source_name") in failed or (
            scanned and old.get("source_name") not in scanned
        ):
            # Fonte muta o non scansionata in questa run: non è una prova di
            # scadenza, la scheda resta com'era.
            merged.append(with_target(old))
            continue
        streak = int(old.get("miss_streak") or 0) + 1
        if streak >= miss_limit:
            archived += 1
            continue
        merged.append(with_target({**old, "miss_streak": streak}))

    kept = len(previous) - updated - archived
    return merged, new, updated, kept, archived


def write_json(path: Path, rows: list[dict], sources_count: int, db_rows: int | None) -> None:
    """Scrive il file JSON letto dal frontend (catalogo per utenti anonimi).

    `stats` sono i contatori del registro mostrati dalla landing: `bonuses` =
    righe in tabella comprese le archiviate (quando la lettura è permessa,
    altrimenti i bandi di questa run), `active` = bandi in vigore trovati da
    questa run e `sources` = fonti abilitate lette da `catalog_sources` (o
    l'elenco nel codice, se la tabella manca).
    Il sito legge i contatori live via RPC `catalog_stats()`; questo snapshot
    serve solo come fallback quando la RPC non è ancora installata.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    file = {
        "generated_at": now,
        "source": "BonusRadar scraper v1",
        "count": len(rows),
        "stats": {
            "bonuses": db_rows if db_rows is not None else len(rows),
            "active": len(rows),
            "sources": sources_count,
        },
        # `discovered_at` di una scheda conservata resta quello originale: solo
        # le schede appena viste prendono la data di questa run.
        "bonuses": [{**r, "discovered_at": r.get("discovered_at") or now} for r in rows],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(file, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ JSON aggiornato: {path} ({len(rows)} bonus)")
    print(
        f"  contatori registro: {file['stats']['bonuses']} bonus · "
        f"{file['stats']['sources']} fonti abilitate"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Scraper fonti ufficiali BonusRadar")
    ap.add_argument("--json", default=DEFAULT_JSON_PATH, help=f"percorso del file JSON (default: {DEFAULT_JSON_PATH})")
    ap.add_argument(
        "--no-archive",
        action="store_true",
        help="non marcare come scaduti i bandi che questa run non ha trovato",
    )
    ap.add_argument(
        "--replace",
        action="store_true",
        help=(
            "sostituisci il catalogo JSON con la sola run (default: unisci al "
            "catalogo esistente, così le schede non ritrovate non si perdono)"
        ),
    )
    ap.add_argument(
        "--retag",
        action="store_true",
        help=(
            "solo ricalcolo del target di tutte le schede del JSON (dal testo, "
            "con la fonte come fallback), senza scandire le fonti"
        ),
    )
    ap.add_argument(
        "--miss-limit",
        type=int,
        default=MISS_LIMIT,
        help=(
            "run consecutive senza ritrovare una scheda dopo le quali archiviarla "
            f"(default: {MISS_LIMIT})"
        ),
    )
    args = ap.parse_args()

    print("BonusRadar scraper — avvio\n")

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    key = (
        service_key
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("VITE_SUPABASE_ANON_KEY")
        or ""
    )
    host = supabase_host(url) if url else ""
    archive = not args.no_archive

    # 0) elenco fonti: tabella catalog_sources, con fallback al codice
    sources: list[dict] = SOURCES
    if url and key:
        from_table = supabase_sources(url, key)
        if from_table:
            sources = from_table
            print(f"→ Fonti da catalog_sources: {len(sources)} abilitate su {host}")
        else:
            print(
                f"ℹ︎ Uso l'elenco fonti nel codice ({len(SOURCES)} fonti): "
                "catalog_sources assente o non leggibile"
            )

    sources_count = len(sources)

    if args.retag:
        return retag_catalog(Path(args.json), sources)

    # 1) raccolta
    rows: list[dict] = []
    seen: set[str] = set()
    failed_sources: set[str] = set()
    # Fonti "affidabili" in questa run: hanno risposto e hanno prodotto almeno
    # una scheda. Solo per le loro schede un'assenza conta come indizio di
    # obsolescenza: una pagina che risponde 200 ma non espone più l'elenco (JS,
    # redesign) non è una prova che i bandi siano scaduti.
    healthy_sources: set[str] = set()
    source_targets = {
        s["name"]: list(s.get("target") or ("persona", "impresa")) for s in sources
    }
    for source in sources:
        found, reached = scrape_source(source)
        if not reached:
            failed_sources.add(source["name"])
        elif found:
            healthy_sources.add(source["name"])
        for bonus in found:
            key = normalize_title(bonus["title"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(bonus)
        time.sleep(DELAY_BETWEEN_REQUESTS)
    print(f"\nTotale bonus estratti: {len(rows)}")

    json_path = Path(args.json)

    # 1b) unione con il catalogo esistente, prima di Supabase: così anche
    # l'archiviazione e i contatori vedono le schede conservate come attive.
    if rows:
        if args.replace:
            print("ℹ︎ --replace: il catalogo sarà sostituito dalla sola run")
        else:
            rows, new, updated, kept, archived = merge_with_existing(
                rows,
                json_path,
                healthy_sources,
                failed_sources,
                max(1, args.miss_limit),
                source_targets,
            )
            print(
                f"✓ Catalogo unito: {new} nuove · {updated} aggiornate · "
                f"{kept} conservate · {archived} archiviate "
                f"(non ritrovate da {args.miss_limit} run)"
            )
            if failed_sources:
                print(
                    "  fonti mute in questa run (schede non penalizzate): "
                    + ", ".join(sorted(failed_sources))
                )
            idle = sorted(
                s["name"]
                for s in sources
                if s["name"] not in failed_sources and s["name"] not in healthy_sources
            )
            if idle:
                print(
                    "  fonti che hanno risposto senza candidati (schede non "
                    "penalizzate): " + ", ".join(idle)
                )

    # 2) Supabase (se configurato)
    db_rows: int | None = None
    if rows and url and key:
        print(f"→ Supabase: progetto {host}")
        if not service_key:
            print(
                "::warning::SUPABASE_SERVICE_ROLE_KEY assente: con la sola chiave anon la RLS "
                "blocca la scrittura su bonuses. Finché il secret non c'è, resta aggiornato solo il JSON."
            )
        ok, detail = supabase_upsert(url, key, rows)
        if not ok and "target" in detail.lower():
            # Colonna `target` non ancora creata su bonuses: meglio perdere
            # l'etichetta di pubblico che perdere l'aggiornamento del catalogo.
            print(
                "::warning::colonna target assente su bonuses: riscrivo senza target "
                "(esegui supabase_schema.sql)"
            )
            ok, detail = supabase_upsert(url, key, rows, with_target=False)
        if not ok and "is_active" in detail.lower():
            # Colonna non ancora creata: meglio riscrivere senza stato dei bandi
            # che perdere l'aggiornamento della tabella.
            print(
                "::warning::colonna is_active assente su bonuses: esegui "
                "supabase_catalog_stats.sql. Riscrivo senza marcare i bandi attivi."
            )
            ok, detail = supabase_upsert(url, key, rows, mark_active=False)
        print(f"{'✓' if ok else '⚠︎'} Supabase {'aggiornato' if ok else 'non aggiornato'} ({detail})")
        if not ok:
            print("  proseguo con il solo file JSON")

        expected = {normalize_title(r["title"]) for r in rows}

        # 2b) archiviazione: i bandi non più trovati restano in tabella come
        # storico, quindi il contatore pubblico cresce, ma escono dal catalogo
        # e dal matching con il profilo.
        if ok and service_key and archive:
            supabase_archive(url, service_key, expected)
        elif ok and not service_key:
            print("ℹ︎ Archiviazione dei bandi obsoleti saltata: serve SUPABASE_SERVICE_ROLE_KEY.")

        # L'HTTP 2xx da solo non prova che le righe siano in tabella: si rilegge
        # (dopo la pulizia, così il conteggio è quello finale).
        present = supabase_snapshot(url, key) if service_key else None
        if present is None:
            print("ℹ︎ Verifica righe saltata: serve SUPABASE_SERVICE_ROLE_KEY per leggere la tabella.")
        else:
            matched = len(expected & present)
            db_rows = len(present)
            print(f"  righe in bonuses: {len(present)} · titoli di questo scraping presenti: {matched}/{len(expected)}")
            if matched < len(expected):
                print(
                    f"::warning::Supabase {host}: {len(expected) - matched} titoli non risultano in bonuses. "
                    "I secret SUPABASE_URL/VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono puntare "
                    "allo stesso progetto che usa il sito."
                )
    elif rows:
        print("ℹ︎ Credenziali Supabase non presenti → solo file JSON")

    # 3) JSON di fallback (sempre: serve agli utenti non autenticati)
    if rows == 0 and json_path.exists():
        print(f"ℹ︎ Nessun nuovo bonus: mantengo il file esistente {json_path}")
        return 0
    write_json(json_path, rows, sources_count, db_rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
