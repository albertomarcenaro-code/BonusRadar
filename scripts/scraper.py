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

Estrazione con LLM (opzionale): quando le regex non trovano scadenza, importo
né requisiti, la pagina di dettaglio viene passata a un LLM che risponde in
JSON. Sono previste due configurazioni, in ordine di preferenza:

  LLM_BASE_URL + LLM_API_KEY + LLM_MODEL   endpoint qualsiasi compatibile
                                           OpenAI (ha la precedenza)
  GEMINI_API_KEY                           Google Gemini, endpoint
                                           compatibile OpenAI, modello
                                           gemini-3.5-flash-lite (piano
                                           gratuito), override con LLM_MODEL

Senza chiavi lo scraper funziona come prima. `LLM_MAX_CALLS` (default 20)
limita le chiamate per run e `BONUSRADAR_NO_LLM=1` disattiva del tutto il
fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
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
        # La home regionale dava un solo candidato: la pagina "Incentivi e
        # servizi" dell'agenzia regionale elenca le linee aperte con il periodo
        # di validità ("dal … al …"), che è la scadenza vera.
        # Pagina "bandi e avvisi" della Regione: ogni voce riporta data di
        # pubblicazione e "scadenza GG.MM.AAAA", quindi il termine è nel testo.
        "list_url": "https://www.regione.fvg.it/rafvg/cms/RAFVG/MODULI/bandi_avvisi",
        "base_url": "https://www.regione.fvg.it/",
        "residency": "Sede operativa o residenza in Friuli Venezia Giulia",
        # Le voci vere contengono "bando"/"contributi": il filtro keyword basta
        # e tiene fuori le voci di menu della pagina.
        "exclude": ("cerca bandi", "parola chiave"),
        "target": ("impresa", "artigiani"),
    },
    # ---------------- Bandi "evergreen" (modalità direct) ----------------
    # Non compaiono mai in una pagina di avvisi: esistono come pagina ufficiale
    # permanente. Si leggono direttamente, senza elenco da scansionare.
    {
        "name": "INPS — Prestazioni e sussidi",
        "authority": "INPS",
        "mode": "direct",
        "list_url": "https://www.inps.it/",
        "base_url": "https://www.inps.it/",
        "direct_urls": [
            "https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.assegno-unico-e-universale-per-i-figli-a-carico-55984.assegno-unico-e-universale-per-i-figli-a-carico.html",
            "https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.assegno-di-inclusione-adi.html",
            "https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.bonus-asilo-nido-e-forme-di-supporto-presso-la-propria-abitazione-51105.bonus-asilo-nido-e-forme-di-supporto-presso-la-propria-abitazione.html",
        ],
        "target": ("persona",),
    },
    {
        "name": "Agenzia delle Entrate — Agevolazioni casa",
        "authority": "Agenzia delle Entrate",
        "mode": "direct",
        "list_url": "https://www.agenziaentrate.gov.it/portale/aree-tematiche/casa",
        "base_url": "https://www.agenziaentrate.gov.it/",
        "direct_urls": [
            "https://www.agenziaentrate.gov.it/portale/aree-tematiche/casa/agevolazioni/agevolazioni-per-le-ristrutturazioni-edilizie",
            "https://www.agenziaentrate.gov.it/portale/superbonus-110-",
        ],
        "target": ("persona", "impresa"),
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
        # "… - scadenza 20.11.2026 ### titolo" (elenchi regionali).
        inline = re.search(
            r"scadenz\w*\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})",
            f"{title} {extra_text}",
            re.I,
        )
        card_deadline = RE_DEADLINE_CARD.search(extra_text)
        if inline:
            deadline_text = inline.group(1)
        elif card_deadline:
            inner = RE_DATE.search(card_deadline.group(0))
            deadline_text = inner.group(0) if inner else card_deadline.group(0).strip()
        else:
            # "dal … al 30/11/2026": la fine del periodo è il termine utile.
            period = PERIOD_RE.search(extra_text)
            deadline_text = period.group(1) if period else ""
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


TITLE_JUNK_RE = re.compile(
    r"^(menu principale|menu|salta|home|homepage|contenuto|indice|navigazione|area riservata)",
    re.I,
)
# Titoli che sono solo il nome dell'ente (o un'etichetta di navigazione):
# non descrivono nessun bando e finirebbero in catalogo come voce vuota.
GENERIC_TITLE_RE = re.compile(
    r"^(agenzia delle entrate|inps|inail|invitalia|ministero\b.*|regione\b.*|comune\b.*|"
    r"agevolazioni|incentivi|contributi|servizi|bandi|documenti|casa|imprese|famiglie)$",
    re.I,
)


def _usable_title(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip(" -–—|•")
    if TITLE_JUNK_RE.search(text) or GENERIC_TITLE_RE.search(text):
        return ""
    # "Superbonus" (10 caratteri) è un titolo vero; "Incentivi" no.
    short_ok = len(text) >= 8 and re.search(
        r"bonus|superbonus|assegno|voucher|contribut|indennit|carta|detrazion", text, re.I
    )
    if len(text) < 12 and not short_ok:
        return ""
    return text


def page_title(markup: str) -> str:
    """Titolo della pagina, dal `title` ripulito o dal primo `h1` utile.

    Il `title` è più affidabile dell'h1 (che spesso è il menu): si tolgono le
    parti che ripetono il nome del sito ("… - Agenzia delle Entrate").
    """
    def from_raw(raw: str) -> str:
        raw = re.sub(r"\s+", " ", raw).strip()
        parts = [p.strip() for p in re.split(r"\s+[|–—]\s+|\s+-\s+|\s+·\s+", raw) if p.strip()]
        # La prima parte utile è il titolo vero; le successive ripetono il nome
        # del sito ("Superbonus - Portale Agenzia Entrate").
        for part in parts:
            candidate = _usable_title(part)
            if candidate:
                return candidate
        return ""

    og = re.search(r'(?is)<meta[^>]+property="og:title"[^>]+content="([^"]+)"', markup)
    if og:
        candidate = from_raw(og.group(1))
        if candidate:
            return candidate
    match = re.search(r"(?is)<title[^>]*>(.*?)</title>", markup)
    if match:
        candidate = from_raw(html_to_text(match.group(1)))
        if candidate:
            return candidate
    for h1 in re.findall(r"(?is)<h1[^>]*>(.*?)</h1>", markup):
        candidate = _usable_title(re.sub(r"\s+", " ", html_to_text(h1)).strip())
        if candidate:
            return candidate
    return ""


def first_paragraph(markup: str) -> str:
    """Primo paragrafo utile del corpo pagina (per il riassunto della scheda)."""
    for line in main_content(markup).split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if 60 <= len(line) <= 400 and not JUNK_RE.search(line):
            return line
    return ""


def scrape_direct(source: dict) -> tuple[list[dict], bool]:
    """Fonti "direct": nessun elenco da scansionare, solo URL di schede.

    Serve per i bandi evergreen (Assegno unico, ADI, detrazioni…), che non
    compaiono mai in una pagina di avvisi ma esistono come pagina ufficiale.
    """
    urls = source.get("direct_urls") or []
    print(f"→ Fonte: {source['name']} (modalità diretta, {len(urls)} URL)")
    items: list[dict] = []
    reached = False
    last: object = ""
    for url in urls:
        html: str | None = None
        for ua in (BROWSER_UA, USER_AGENT):
            try:
                html = fetch(url, user_agent=ua)
                break
            except FetchError as exc:
                last = exc
        if html is None:
            print(f"  ⚠︎ non raggiungibile: {url} ({last})")
            continue
        reached = True
        title = page_title(html)
        bonus = build_bonus(source, url, title)
        if not bonus:
            print(f"  ⚠︎ titolo non utilizzabile: {title[:60]!r}")
            continue
        if source.get("detail", True):
            bonus = enrich_from_detail(bonus)
        summary = first_paragraph(html)
        if summary:
            bonus["summary"] = summary[:397]
        items.append(bonus)
        print(f"  ✓ {bonus['title'][:58]}")
    return items, reached


def scrape_source(source: dict) -> tuple[list[dict], bool]:
    """Scarica la pagina indice di una fonte e restituisce (schede, raggiunta).

    `raggiunta` è False quando la pagina non risponde: in quel caso le schede di
    quella fonte non vanno contate come "non più trovate" (obsolescenza).
    """
    if source.get("mode") == "direct":
        return scrape_direct(source)
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
    if items and source.get("detail", True):
        items = enrich_items(items)
        filled = sum(1 for it in items if (it.get("deadline") or "").strip())
        priced = sum(1 for it in items if (it.get("amount") or "").strip())
        print(f"  ↳ dettaglio letto: {filled}/{len(items)} con scadenza · {priced} con importo")
    return items, True


# ---------------------------------------------------------------
# Output: Supabase + JSON
# ---------------------------------------------------------------

def supabase_upsert(
    url: str,
    key: str,
    rows: list[dict],
    *,
    mark_active: bool = True,
    with_target: bool = True,
    with_gate: bool = True,
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
                "required_documents": list(r.get("required_documents") or []),
                "source_url": r["source_url"],
                "source_name": r["source_name"],
                **({"target": r.get("target") or ["persona", "impresa"]} if with_target else {}),
                # Tutto ciò che arriva qui ha passato il gate: nel database la
                # colonna dice perché, così la tabella resta allineata ai bandi
                # verificati anche senza rieseguire la migrazione.
                **(
                    {
                        "gate_status": "bando",
                        "gate_reason": r.get("gate_reason") or "",
                        "detail_fetched_at": r.get("detail_fetched_at"),
                        "source_excerpts": r.get("source_excerpts") or {},
                    }
                    if with_gate
                    else {}
                ),
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
        "&select=slug,name,authority,list_url,base_url,residency,topics,target,priority,mode,direct_urls"
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
            # Colonna `mode`/`direct_urls` mancante (migrazione non eseguita) o
            # `target`: si rilegge senza, invece di perdere la tabella.
            retry = endpoint.replace(",mode,direct_urls", "").replace(",target,", ",")
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
                "mode": row.get("mode") or "list",
                "direct_urls": list(row.get("direct_urls") or []),
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


# ---------------------------------------------------------------
# Gate qualità: bando vs notizia vs quarantena
# ---------------------------------------------------------------
# Il catalogo non è un feed: una voce entra solo se il testo mostra almeno due
# evidenze di bando (scadenza, importo, requisiti, documenti). Comunicati,
# osservatori, atti amministrativi e gare vanno in "notizie"; ciò che parla di
# bandi ma non è verificabile va in quarantena, non in catalogo.
GATE_NOTIZIA_RE = re.compile(
    r"chiariment|osservatori|premio|vademecum|smau|convegno|seminario|webinar|"
    r"comunicat|rassegna|intervista|esito dei controlli|multicomparto|"
    r"campagna proattiva|in diretta|job&orienta|job & orienta|rafforzano|"
    r"in crescita|tutto quello che c'è da sapere|video guida|incontro su|"
    r"incontro dedicato|i dati di|avvio campagna|aggiorna|approfondiment|notizi",
    re.I,
)
# Niente "assunzion" qui di proposito: gli incentivi all'assunzione sono bandi
# per le imprese, non atti amministrativi.
GATE_ATTO_RE = re.compile(
    r"procedura negoziata|avviso di indizione|affidament|concessione di derivazione|"
    r"derivazione idrica|concessione idrica|ricerca acque sotterranee|"
    r"mobilità volontaria|graduatori|nomina del revisore|istanza (di )?concessione|"
    r"derivare acqua|concessione per derivare|"
    r"bandi? di concorso|concorso pubblico|gara|appalto|servizi di pulizia|"
    r"fornitura|incarico di|selezione di personale",
    re.I,
)
GATE_BANDO_RE = re.compile(
    r"\bband[oi]\b|avviso|contribut|incentiv|voucher|agevolaz|finanziament|"
    r"\bfondo\b|detrazion|credito d'imposta|\bbonus\b|domanda|scadenz",
    re.I,
)
# Termini senza data. "sportello" da solo non basta ("sportello postale" è un
# canale di pagamento, non un termine di presentazione).
OPEN_WORDS = re.compile(
    r"fino ad? esaurimento|sempre aperto|a sportello|sportello apert|domande a sportello",
    re.I,
)
# Periodo di validità nelle card: "dal 29/06/2026 al 30/11/2026" → fine periodo.
PERIOD_RE = re.compile(r"\bdal\s+[^.]{0,30}?\s+al\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})", re.I)
# Date che non sono scadenze: norme citate nel testo ("legge 30 dicembre 2025").
NORM_DATE_RE = re.compile(r"\b(legge|decreto|d\.lgs|delibera|regolamento|circolare)\b", re.I)
THRESHOLD_RE = re.compile(r"reddito|patrimonio|ISEE|soglia|limite|massimale|non superiore", re.I)
AMOUNT_HINT_TEXT = re.compile(r"importo|contributo|spettante|fino a|voucher|dotazione|bonus di", re.I)
RE_IT_DATE = re.compile(
    r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b"
    r"|\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|"
    r"settembre|ottobre|novembre|dicembre)\s+(\d{4})\b",
    re.I,
)
MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11,
    "dicembre": 12,
}


def deadline_status(deadline: str, today: datetime | None = None) -> str:
    """Stato del bando dalla sua scadenza: open | closed | unknown."""
    text = (deadline or "").strip()
    if not text:
        return "unknown"
    if OPEN_WORDS.search(text):
        return "open"
    m = RE_IT_DATE.search(text)
    if not m:
        return "unknown"
    if m.group(1):
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        day, month, year = int(m.group(4)), MESI[m.group(5).lower()], int(m.group(6))
    ref = today or datetime.now(timezone.utc)
    try:
        date = datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return "unknown"
    return "closed" if date < ref else "open"


def classify_bonus(bonus: dict) -> tuple[str, str]:
    """Restituisce (verdetto, motivo): bando | notizia | quarantena."""
    title = bonus.get("title") or ""
    low = f"{title} {bonus.get('summary') or ''}".lower()
    if GATE_NOTIZIA_RE.search(title):
        return "notizia", f"comunicato («{GATE_NOTIZIA_RE.search(title).group(0)}»)"
    if GATE_ATTO_RE.search(title):
        return "notizia", f"atto amministrativo/gara («{GATE_ATTO_RE.search(title).group(0)}»)"
    evidence: list[str] = []
    if (bonus.get("deadline") or "").strip():
        evidence.append("scadenza")
    if (bonus.get("amount") or "").strip():
        evidence.append("importo")
    if len(bonus.get("requirements") or []) >= 2:
        evidence.append("requisiti")
    if bonus.get("required_documents"):
        evidence.append("documenti")
    if len(evidence) >= 2:
        return "bando", "evidenze: " + ", ".join(evidence)
    if GATE_BANDO_RE.search(low):
        return "quarantena", (
            "parla di bandi ma senza scadenza/importo/requisiti: "
            + ("nessuna scadenza né importo" if not evidence else "evidenze insufficienti: " + ", ".join(evidence))
        )
    return "quarantena", "nessun segnale di bando"


def _title_tokens(title: str) -> set[str]:
    return {t for t in re.findall(r"[a-zà-ù0-9]+", title.lower()) if len(t) > 3}


def _evidence_score(bonus: dict) -> int:
    return (
        (1 if (bonus.get("deadline") or "").strip() else 0)
        + (1 if (bonus.get("amount") or "").strip() else 0)
        + (1 if len(bonus.get("requirements") or []) >= 2 else 0)
        + (1 if bonus.get("required_documents") else 0)
    )


def dedupe_similar(rows: list[dict], threshold: float = 0.7) -> list[dict]:
    """Toglie i doppioni fra fonti diverse (stesso bando con titoli simili).

    Resta la scheda con più evidenze (meglio una con scadenza e importo che due
    con metà dei dati), a parità quella già in catalogo da più tempo.
    """
    kept: list[dict] = []
    for row in rows:
        tokens = _title_tokens(row.get("title") or "")
        duplicate = None
        for index, existing in enumerate(kept):
            other = _title_tokens(existing.get("title") or "")
            if not tokens or not other:
                continue
            similarity = len(tokens & other) / len(tokens | other)
            if similarity >= threshold:
                duplicate = index
                break
        if duplicate is None:
            kept.append(row)
            continue
        rival = kept[duplicate]
        if _evidence_score(row) > _evidence_score(rival):
            kept[duplicate] = row
    return kept


def split_catalog(
    rows: list[dict], today: datetime | None = None
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Partiziona le schede in (bandi pubblicabili, quarantena, notizie, scaduti).

    Le schede pubblicabili ricevono `status` (open/closed/unknown) e
    `gate_reason`; quelle con `status = closed` non entrano in catalogo.
    """
    verified: list[dict] = []
    quarantine: list[dict] = []
    news: list[dict] = []
    expired: list[dict] = []
    for row in rows:
        # Titoli ereditati da run precedenti con il nome del sito in coda
        # ("Superbonus - Portale Agenzia Entrate"): si ripuliscono qui.
        row["title"] = re.sub(
            r"\s+-\s+(portale|sito|regione|comune|ministero|agenzia)\b.*$", "", row.get("title") or "", flags=re.I
        ).strip() or row.get("title")
    rows = dedupe_similar(rows)
    for row in rows:
        # Titoli che sono solo il nome dell'ente non descrivono un bando: non
        # entrano né in catalogo né in quarantena (spazzatura di navigazione).
        if GENERIC_TITLE_RE.search((row.get("title") or "").strip()):
            continue
        verdict, reason = classify_bonus(row)
        if verdict == "notizia":
            news.append({
                "title": row.get("title", ""),
                "source_name": row.get("source_name", ""),
                "source_url": row.get("source_url", ""),
                "reason": reason,
            })
            continue
        if verdict == "quarantena":
            quarantine.append({**row, "gate_reason": reason})
            continue
        status = deadline_status(row.get("deadline", ""), today)
        entry = {**row, "status": status, "gate_reason": reason}
        if status == "closed":
            expired.append(entry)
        else:
            verified.append(entry)
    return verified, quarantine, news, expired


def quality_metrics(
    verified: list[dict],
    quarantine: list[dict],
    news: list[dict],
    expired: list[dict],
) -> dict:
    """Metriche di qualità del catalogo: riempimento campi e composizione."""
    total = len(verified) or 1

    def share(pred) -> float:
        return round(sum(1 for b in verified if pred(b)) / total * 100, 1)

    by_source: dict[str, int] = {}
    for bonus in verified:
        name = bonus.get("source_name") or "?"
        by_source[name] = by_source.get(name, 0) + 1
    return {
        "verified": len(verified),
        "open": sum(1 for b in verified if b.get("status") == "open"),
        "unknown_deadline": sum(1 for b in verified if b.get("status") == "unknown"),
        "expired": len(expired),
        "quarantine": len(quarantine),
        "news": len(news),
        "fill": {
            "deadline_pct": share(lambda b: bool((b.get("deadline") or "").strip())),
            "amount_pct": share(lambda b: bool((b.get("amount") or "").strip())),
            "requirements_pct": share(lambda b: bool(b.get("requirements"))),
            "documents_pct": share(lambda b: bool(b.get("required_documents"))),
        },
        "by_source": by_source,
    }


# ---------------------------------------------------------------
# Fase B: lettura della pagina di dettaglio
# ---------------------------------------------------------------
# La card di un elenco non contiene scadenza, importo, requisiti o documenti:
# quelli stanno nella pagina del bando. Leggerla è ciò che distingue un catalogo
# da un feed. Ogni campo estratto porta con sé la citazione da cui viene.
MAX_DETAILS_PER_SOURCE = 6
DETAIL_WORKERS = 4
EXCERPT_CHARS = 220

RE_DETAIL_DEADLINE = re.compile(
    r"(?:scadenza|termine|chiusura|entro\s+(?:il|le)|presentazione\s+(?:delle\s+)?domande)"
    r"[^.\n]{0,100}",
    re.I,
)
RE_DETAIL_AMOUNT = re.compile(
    r"(?:(?:fino\s+a|contributo\s+(?:di|fino\s+a)|voucher\s+(?:di|fino\s+a)|dotazione|importo)\s+)"
    r"((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:€|euro))"
    r"|((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:€|euro))",
    re.I,
)
RE_DETAIL_REQ = re.compile(
    r"[^.\n]{0,160}(?:ISEE|residenza|resident[ei]|reddito|età|anni|figli|nucleo familiare|"
    r"partita\s+iva|ATECO|dipendenti|fatturato|imprese|professionist|studenti|disoccupat|"
    r"proprietario|contratto di locazione)[^.\n]{0,240}",
    re.I,
)
RE_DETAIL_DOCS = re.compile(
    r"[^.\n]{0,120}(?:documento|certificazion|autocertificazion|allegare|ISEE|SPID|CIE|"
    r"fattur|bonifico|ricevut|modulo)[^.\n]{0,200}",
    re.I,
)


JUNK_RE = re.compile(
    r"cookie|privacy|newsletter|accedi|area personale|menu|skip to|homepage|\bhome\b|"
    r"contatti|social|facebook|twitter|linkedin|youtube|instagram|telegram|copyright|"
    r"©|p\.iva|pec\b|telefono|fax|posta certificata|mappa del sito|amministrazione trasparente|"
    r"consiglio bandi e gare|ufficio relazioni con il pubblico|motore di ricerca|"
    r"seguici|iscriviti|scarica l'app|torna su|leggi di più|share",
    re.I,
)
REQUISITO_SIGNAL = re.compile(
    r"ISEE|reddito|residen\w+|resident[ei]|cittadin\w+|età|anni compiuti|under \d+|nucleo familiare|"
    r"figli|minori|disabilit|partita\s+iva|partita iva|ATECO|dipendenti|fatturato|imprese|impresa|"
    r"professionist|artigian|studenti|disoccupat|inattiv|proprietari|locazione|affitto|"
    r"micro|piccole|medie dimensioni|startup|enti del terzo settore|ETS",
    re.I,
)


def main_content(markup: str) -> str:
    """Estrae il corpo della pagina, scartando menu, header, footer e aside."""
    for tag in ("main", "article"):
        match = re.search(rf"(?is)<{tag}\b[^>]*>(.*?)</{tag}>", markup)
        if match and len(html_to_text(match.group(1))) > 800:
            markup = match.group(1)
            break
    else:
        markup = re.sub(r"(?is)<(nav|header|footer|aside)\b[^>]*>.*?</\1>", " ", markup)
    # conserva i confini di blocco: le frasi servono separate, non appiattite
    import html as html_module

    markup = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", markup)
    markup = re.sub(r"(?is)<br\s*/?>", "\n", markup)
    markup = re.sub(r"(?is)</(p|div|li|h[1-6]|section|tr|td|dd|dt|blockquote)>", "\n", markup)
    text = html_module.unescape(re.sub(r"<[^>]+>", " ", markup))
    text = re.sub(r"[ \t\r\f\v\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{2,}", "\n", text).strip()


def text_lines(markup: str) -> list[str]:
    """Righe di testo del corpo pagina, ripulite e senza duplicati consecutivi."""
    body = main_content(markup)
    body = re.sub(r"\s*\n\s*", "\n", body)
    lines: list[str] = []
    for raw in body.split("\n"):
        line = re.sub(r"\s+", " ", raw).strip(" .,;:-–—|•\t")
        if len(line) < 4:
            continue
        if lines and lines[-1] == line:
            continue
        lines.append(line)
    return lines


def html_to_text(markup: str) -> str:
    """Testo leggibile da una pagina HTML, senza script/stili e spazi doppi."""
    import html as html_module

    body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", markup)
    text = re.sub(r"<[^>]+>", " ", body)
    text = html_module.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_sentence(raw: str) -> str:
    sentence = re.sub(r"\s+", " ", raw).strip(" .,;:-–—|•")
    return sentence[:EXCERPT_CHARS]


AMOUNT_TOKEN = re.compile(r"(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:€|euro)\b", re.I)
AMOUNT_CONTEXT = re.compile(
    r"fino a|contribut|voucher|dotazione|importo|finanziament|incentiv|agevolaz|"
    r"spesa ammissibile|budget|massimale|\bpari a\b|\bdi\s+\d",
    re.I,
)
# Solo ciò che è davvero un documento da produrre: "fatturato" o "ricevute"
# citate in altre frasi finivano per sembrare documenti del bando.
DOC_SIGNAL = re.compile(
    r"documento|certificazion|autocertificazion|dichiarazione sostitutiva|allegare|\ballegat|"
    r"SPID|CIE|CNS|firma digital|modulo di domanda|domanda online",
    re.I,
)
HEADING_HINT = re.compile(
    r"^(requisiti|destinatari|beneficiari|a chi si rivolge|chi può|soggetti|sono ammessi|possono)", re.I
)


def _amount_number(token: str) -> float | None:
    raw = re.match(r"[\d.,]+", token)
    if not raw:
        return None
    value = raw.group(0)
    if "," in value:
        value = value.replace(".", "").replace(",", ".")
    elif "." in value:
        value = value.replace(".", "")
    try:
        return float(value)
    except ValueError:
        return None


def _plausible_amount(token: str) -> bool:
    """Scarta gli anni (es. «2026 Euro») e i numeri senza senso economico."""
    number = _amount_number(token)
    if number is None:
        return False
    if 1900 <= number <= 2100 and "," not in token and "." not in token.split(" ")[0]:
        return False
    return number >= 100


def extract_detail_fields(markup: str) -> dict:
    """Campi del bando letti nella pagina di dettaglio, con citazione."""
    lines = text_lines(markup)
    fields: dict = {"deadline": "", "amount": "", "requirements": [], "documents": []}
    excerpts: dict = {}

    for line in lines:
        if JUNK_RE.search(line):
            continue
        # Sportello sempre aperto / fino a esaurimento: non è una data, ma è
        # comunque un termine utile e va conservato come tale.
        if OPEN_WORDS.search(line) and len(line) <= 200:
            fields["deadline"] = _clean_sentence(line)
            excerpts["deadline"] = _clean_sentence(line)
            break
        if not RE_DETAIL_DEADLINE.search(line):
            continue
        date = RE_IT_DATE.search(line)
        if not date:
            continue
        # "legge 30 dicembre 2025" non è la scadenza del bando.
        if NORM_DATE_RE.search(line) and not re.search(r"scadenz|termine per", line, re.I):
            continue
        fields["deadline"] = date.group(0)
        excerpts["deadline"] = _clean_sentence(line)
        break
    if not fields["deadline"]:
        flat = " ".join(lines)
        match = RE_DETAIL_DEADLINE.search(flat)
        if match and RE_IT_DATE.search(match.group(0)):
            fields["deadline"] = RE_IT_DATE.search(match.group(0)).group(0)
            excerpts["deadline"] = _clean_sentence(match.group(0))

    best: tuple[float, str, str] | None = None
    for line in lines:
        if JUNK_RE.search(line):
            continue
        # una cifra in una frase che parla di contributo vale più di un numero
        # qualsiasi trovato in pagina: a parità di contesto vince la più alta
        weight = 1.0 if AMOUNT_CONTEXT.search(line) else 0.4
        # Soglie di reddito/patrimonio non sono l'importo del bonus.
        if THRESHOLD_RE.search(line) and not AMOUNT_HINT_TEXT.search(line):
            weight *= 0.15
        # La dotazione del fondo non è il contributo per chi fa domanda.
        if re.search(r"dotazione|milioni|stanziament|plafond", line, re.I):
            weight *= 0.2
        for token in AMOUNT_TOKEN.findall(line):
            if not _plausible_amount(token):
                continue
            score = (_amount_number(token) or 0.0) * weight
            if best is None or score > best[0]:
                best = (score, token, _clean_sentence(line))
    if best:
        quote = best[2]
        # Meglio nessun importo che una soglia di reddito spacciata per bonus.
        if THRESHOLD_RE.search(quote) and not AMOUNT_HINT_TEXT.search(quote):
            best = None
    if best:
        fields["amount"] = _clean_sentence(best[1])
        excerpts["amount"] = best[2]

    seen: set[str] = set()
    for line in lines:
        if JUNK_RE.search(line) or not REQUISITO_SIGNAL.search(line):
            continue
        if not (15 <= len(line) <= 320):
            continue
        verb = re.search(r"\b(essere|avere|possono|deve|devono|rivolt|riservat|spetta|accede|presenta)\b", line, re.I)
        strong = re.search(r"ISEE|partita iva|resident|età|anni|dipendenti|fatturato|contributi", line, re.I)
        if not (HEADING_HINT.search(line) or verb or (strong and len(line) >= 30)):
            continue
        key = line.lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        fields["requirements"].append(_clean_sentence(line))
        if len(fields["requirements"]) >= 6:
            break
    if fields["requirements"]:
        excerpts["requirements"] = fields["requirements"][0]

    seen_docs: set[str] = set()
    for line in lines:
        if JUNK_RE.search(line) or not DOC_SIGNAL.search(line):
            continue
        if not (12 <= len(line) <= 260):
            continue
        key = line.lower()[:50]
        if key in seen_docs:
            continue
        seen_docs.add(key)
        fields["documents"].append(_clean_sentence(line))
        if len(fields["documents"]) >= 5:
            break
    if fields["documents"]:
        excerpts["documents"] = fields["documents"][0]

    fields["excerpts"] = excerpts
    return fields


# ---------------------------------------------------------------
# Fase C: estrazione con LLM quando le regex non bastano
# ---------------------------------------------------------------
# Le regex leggono il linguaggio burocratico solo se è già strutturato ("la
# domanda va presentata entro il …"): quando la pagina dice "le istanze
# potranno essere inoltrate a partire dal …" o spalma l'importo su tre frasi,
# l'estrazione resta vuota. In quel caso il testo principale va a un LLM, che
# restituisce gli stessi campi in JSON insieme alla frase da cui li ha tratti.
LLM_MAX_CHARS = 14000
LLM_TIMEOUT = 45
def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, "") or default))
    except ValueError:
        return default


LLM_MAX_CALLS = _env_int("LLM_MAX_CALLS", 20)

LLM_PROMPT = """Sei un assistente che estrae dati strutturati da pagine web di bandi italiani.
Dal testo seguente estrai SOLO queste informazioni, rispondendo in JSON:
{
  "importo": "importo massimo erogabile (es. '5.000 euro', 'fino a 30% delle spese')",
  "scadenza": "data di scadenza in formato gg/mm/aaaa o testo (es. '31/12/2026', 'fondi esauriti')",
  "requisiti": ["requisito 1", "requisito 2"],  // massimo 5, solo quelli oggettivi
  "documenti": ["documento 1"],  // documenti richiesti per la domanda
  "destinatari": ["famiglie", "imprese", "persona fisica"],  // chi può fare domanda
  "citazioni": {"importo": "frase esatta del testo", "scadenza": "frase esatta", "requisiti": "frase esatta", "documenti": "frase esatta"}
}
Se un campo non è presente nel testo rispondi con null o [].
NON inventare informazioni non presenti nel testo.
Per ogni campo valorizzato copia in "citazioni" la frase esatta del testo (max 220 caratteri) da cui l'hai ricavato.
Rispondi solo con il JSON, senza commenti né blocchi di codice.
"""

# Gemini è l'unico provider con preset: Google espone un endpoint compatibile
# OpenAI (…/v1beta/openai), quindi riusa lo stesso codice degli altri, e
# gemini-3.5-flash-lite rientra nel piano gratuito. Tutto il resto passa da
# LLM_BASE_URL, così non resta in codice nessun endpoint non verificato.
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
GEMINI_MODEL = "gemini-3.5-flash-lite"

_llm_calls = 0
_llm_lock = threading.Lock()
_llm_announced = False


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def llm_provider() -> dict | None:
    """Provider scelto dalle variabili d'ambiente, o None se non c'è una chiave."""
    if _env("BONUSRADAR_NO_LLM").lower() in {"1", "true", "yes"}:
        return None
    model = _env("LLM_MODEL")
    base = _env("LLM_BASE_URL").rstrip("/")
    key = _env("LLM_API_KEY")
    if base and key:
        if not model:
            print("  ! LLM_BASE_URL: indica il modello con LLM_MODEL", file=sys.stderr)
            return None
        return {"label": "LLM_BASE_URL", "base_url": base, "model": model, "key": key}
    gemini_key = _env("GEMINI_API_KEY")
    if gemini_key:
        return {
            "label": "Gemini",
            "base_url": GEMINI_BASE_URL,
            "model": model or GEMINI_MODEL,
            "key": gemini_key,
        }
    return None


def _http_json(url: str, headers: dict, payload: dict) -> dict:
    """POST JSON via urllib (nessuna dipendenza esterna) e risposta decodificata."""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST", headers={**headers, "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _parse_llm_json(raw: str) -> dict | None:
    """JSON del modello, tollerando i fence ```json che a volte aggiunge."""
    text = re.sub(r"^\s*```(?:json)?|```\s*$", "", (raw or "").strip(), flags=re.I)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _llm_text_field(data: dict, key: str, limit: int) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s+", " ", value).strip()
    if value.lower() in {"null", "none", "n/a", "non presente", "non indicato"}:
        return ""
    return value[:limit]


def _llm_list_field(data: dict, key: str, limit: int, item_chars: int = 240) -> list[str]:
    """Lista ripulita dei valori del modello: sempre una lista, mai None."""
    value = data.get(key)
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []  # null, numero o oggetto: il catalogo vuole [] e non null
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        line = re.sub(r"\s+", " ", item).strip(" .,;:-–—|•")
        if len(line) < 4:
            continue
        out.append(line[:item_chars])
        if len(out) >= limit:
            break
    return out


# Titoli di sezione che il modello a volte restituisce al posto di un
# requisito (es. «Requisiti di cittadinanza, soggiorno e residenza»): nominali,
# corti, senza punteggiatura finale e aperti da una parola da indice.
LLM_SECTION_RE = re.compile(
    r"^(requisiti|documenti|documentazione|destinatari|beneficiari|soggetti|"
    r"a\s+chi\s+si\s+rivolge|chi\s+pu[òo]|come\s+funziona|tempi|modalit[àa]|"
    r"importo|scadenza|maggiori\s+informazioni|riferimenti|normativa)\b",
    re.I,
)
RE_HAS_DIGIT = re.compile(r"\d")


def _looks_like_heading(line: str) -> bool:
    """True se la riga è il titolo di una sezione, non un requisito."""
    if len(line) > 80 or len(line.split()) > 8:
        return False
    if re.search(r"[.!?;:]", line):
        return False
    return bool(LLM_SECTION_RE.match(line))


def _llm_amount(data: dict) -> str:
    """Importo solo se contiene almeno una cifra: «fino a una soglia…» non lo è."""
    value = _llm_text_field(data, "importo", 120)
    return value if RE_HAS_DIGIT.search(value) else ""


def _llm_requirements(data: dict) -> list[str]:
    """Requisiti del modello, senza i titoli di sezione finiti nell'elenco."""
    return [r for r in _llm_list_field(data, "requisiti", 5) if not _looks_like_heading(r)]


def _normalize_llm(data: dict) -> dict:
    """Campi LLM ripuliti, con le citazioni che li giustificano.

    Una citazione resta solo se il campo a cui si riferisce è sopravvissuto
    alla validazione: un importo scartato non deve lasciare dietro di sé un
    excerpt che sembra giustificare un dato che in scheda non c'è.
    """
    values: dict = {
        "deadline": _llm_text_field(data, "scadenza", 120),
        "amount": _llm_amount(data),
        "requirements": _llm_requirements(data),
        "documents": _llm_list_field(data, "documenti", 5),
        "destinatari": _llm_list_field(data, "destinatari", 6, 60),
    }
    citations = data.get("citazioni") if isinstance(data.get("citazioni"), dict) else {}
    excerpts: dict = {}
    for field, key in (
        ("deadline", "scadenza"),
        ("amount", "importo"),
        ("requirements", "requisiti"),
        ("documents", "documenti"),
    ):
        if not values[field]:
            continue
        quote = citations.get(key)
        if not isinstance(quote, str):
            continue
        quote = re.sub(r"\s+", " ", quote).strip()[:EXCERPT_CHARS]
        if len(quote) >= 8:
            excerpts[field] = quote
    return {**values, "excerpts": excerpts}


def _llm_completion(provider: dict, snippet: str) -> str:
    """Testo JSON restituito dal modello.

    Due tolleranze: un retry su 429 (limite di richieste, frequente sul piano
    gratuito) e un secondo tentativo senza `response_format`, che alcuni
    endpoint compatibili OpenAI ma non completi rifiutano con 400/422.
    """
    url = provider["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {provider['key']}"}
    payload: dict = {
        "model": provider["model"],
        "temperature": 0,
        "max_tokens": 900,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": LLM_PROMPT},
            {"role": "user", "content": snippet},
        ],
    }
    try:
        data = _http_json(url, headers, payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            time.sleep(4)  # limite del piano gratuito: un secondo tentativo
            data = _http_json(url, headers, payload)
        elif exc.code in {400, 422}:
            payload.pop("response_format", None)
            data = _http_json(url, headers, payload)
        else:
            raise
    return data["choices"][0]["message"]["content"]


def llm_extract_fields(text: str) -> dict | None:
    """Chiede all'LLM i campi del bando; None se manca la chiave o la chiamata fallisce.

    Un errore del provider non interrompe la run: si tiene quello che le regex
    hanno già trovato.
    """
    global _llm_calls, _llm_announced
    if not text:
        return None
    provider = llm_provider()
    if not provider:
        return None
    with _llm_lock:
        if _llm_calls >= LLM_MAX_CALLS:
            return None
        _llm_calls += 1
        announce = not _llm_announced
        _llm_announced = True
    if announce:
        print(f"  · estrazione LLM: {provider['label']} / {provider['model']}", file=sys.stderr)
    try:
        raw = _llm_completion(provider, text[:LLM_MAX_CHARS])
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError) as exc:
        print(f"  ! estrazione LLM non riuscita ({provider['label']}): {exc}", file=sys.stderr)
        return None
    parsed = _parse_llm_json(raw if isinstance(raw, str) else "")
    return _normalize_llm(parsed) if parsed else None


TARGET_DESTINATARI = (
    (re.compile(r"impres|aziend|pmi|ditta|artigian|professionist|partita iva|startup", re.I), "impresa"),
    (re.compile(r"famigli|persona|person[ae] fisic|cittadin|privato|nucleo|studente|pensionat", re.I), "persona"),
)


def target_from_destinatari(destinatari: list[str]) -> list[str]:
    """Target del catalogo (`persona`/`impresa`) dedotto dai destinatari dell'LLM."""
    found: list[str] = []
    for value in destinatari:
        for pattern, label in TARGET_DESTINATARI:
            if pattern.search(value) and label not in found:
                found.append(label)
    return found


def enrich_from_detail(bonus: dict) -> dict:
    """Completa la scheda leggendo la pagina del bando.

    Non sovrascrive ciò che la card dichiara già; aggiunge solo i campi mancanti
    e conserva la citazione (`source_excerpts`) e la data di lettura, così ogni
    dato in catalogo è tracciabile alla fonte.
    """
    url = bonus.get("source_url") or ""
    if not url:
        return bonus
    html: str | None = None
    for agent in (BROWSER_UA, USER_AGENT):
        try:
            html = fetch(url, user_agent=agent)
            break
        except FetchError:
            continue
    if not html:
        return bonus

    text = main_content(html)
    fields = extract_detail_fields(html)
    detail: dict = {}
    if not (bonus.get("deadline") or "").strip() and fields["deadline"]:
        detail["deadline"] = fields["deadline"]
    if not (bonus.get("amount") or "").strip() and fields["amount"]:
        detail["amount"] = fields["amount"]
    existing = [r.lower() for r in (bonus.get("requirements") or [])]
    extra_req = [
        r for r in fields["requirements"] if not any(r.lower()[:40] in e for e in existing)
    ]
    if extra_req:
        detail["requirements"] = list(bonus.get("requirements") or []) + extra_req[:4]
    if fields["documents"]:
        detail["required_documents"] = list(bonus.get("required_documents") or []) + fields["documents"][:4]
    excerpts = dict(fields["excerpts"])

    # Regex a secco: il linguaggio burocratico non offre appigli. Se manca
    # almeno uno tra scadenza, importo e requisiti si prova con l'LLM, che
    # restituisce gli stessi campi con la frase da cui li ha tratti.
    need_llm = (
        not (detail.get("deadline") or (bonus.get("deadline") or "").strip())
        or not (detail.get("amount") or (bonus.get("amount") or "").strip())
        or not (detail.get("requirements") or bonus.get("requirements"))
    )
    llm = llm_extract_fields(text) if need_llm else None
    if llm:
        if llm["deadline"] and not detail.get("deadline") and not (bonus.get("deadline") or "").strip():
            detail["deadline"] = llm["deadline"]
            if llm["excerpts"].get("deadline"):
                excerpts["deadline"] = llm["excerpts"]["deadline"]
        if llm["amount"] and not detail.get("amount") and not (bonus.get("amount") or "").strip():
            detail["amount"] = llm["amount"]
            if llm["excerpts"].get("amount"):
                excerpts["amount"] = llm["excerpts"]["amount"]
        if llm["requirements"] and not detail.get("requirements") and not bonus.get("requirements"):
            detail["requirements"] = llm["requirements"]
            if llm["excerpts"].get("requirements"):
                excerpts["requirements"] = llm["excerpts"]["requirements"]
        if llm["documents"] and not detail.get("required_documents"):
            detail["required_documents"] = llm["documents"]
            if llm["excerpts"].get("documents"):
                excerpts["documents"] = llm["excerpts"]["documents"]

    # Il testo del dettaglio è il segnale migliore per il destinatario.
    fallback = tuple(bonus.get("target") or ()) or ("persona", "impresa")
    detail["target"] = deduce_target(f"{bonus.get('title','')} {text[:4000]}", fallback)
    # Se il lessico non dice nulla (target = quello della fonte) i destinatari
    # letti dall'LLM sono un'informazione in più, non un'alternativa.
    if llm and detail["target"] == list(fallback):
        guessed = target_from_destinatari(llm["destinatari"])
        if guessed:
            detail["target"] = guessed
    detail["detail_fetched_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if excerpts:
        detail["source_excerpts"] = excerpts
    return {**bonus, **detail}


def enrich_items(items: list[dict]) -> list[dict]:
    """Arricchisce in parallelo le schede leggendo le rispettive pagine di dettaglio."""
    if not items:
        return items
    from concurrent.futures import ThreadPoolExecutor

    worth: list[dict] = []
    skipped: list[dict] = []
    for item in items:
        title = item.get("title") or ""
        if GATE_NOTIZIA_RE.search(title) or GATE_ATTO_RE.search(title):
            skipped.append(item)  # comunicato o atto: non vale una richiesta
        else:
            worth.append(item)
    head, rest = worth[:MAX_DETAILS_PER_SOURCE], worth[MAX_DETAILS_PER_SOURCE:]
    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as pool:
        enriched = list(pool.map(enrich_from_detail, head))
    return enriched + rest + skipped


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
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    # Le schede in quarantena restano nel giro: se la run le ritrova vengono
    # rivalutate, se non le ritrova non spariscono dal file.
    previous = list(data.get("bonuses", [])) + list(data.get("quarantine", []))
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


def write_json(
    path: Path,
    rows: list[dict],
    sources_count: int,
    db_rows: int | None,
    quarantine: list[dict] | None = None,
    news: list[dict] | None = None,
    quality: dict | None = None,
) -> None:
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
        # Fuori catalogo ma conservati per revisione e audit: non sono bandi
        # pubblicabili, quindi non entrano in conteggi, matching o alert.
        "quarantine": quarantine or [],
        "news": news or [],
        "quality": quality or {},
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

    # 1c) gate qualità: in catalogo solo i bandi con evidenze verificabili
    verified: list[dict] = []
    quarantine: list[dict] = []
    news_items: list[dict] = []
    expired: list[dict] = []
    quality: dict = {}
    if rows:
        verified, quarantine, news_items, expired = split_catalog(rows)
        quality = quality_metrics(verified, quarantine, news_items, expired)
        print(
            f"✓ Gate qualità: {len(verified)} bandi in catalogo "
            f"({quality['open']} aperti, {quality['unknown_deadline']} senza scadenza) · "
            f"{len(quarantine)} in quarantena · {len(news_items)} notizie · "
            f"{len(expired)} scaduti"
        )
        print(
            "  riempimento campi: "
            f"scadenza {quality['fill']['deadline_pct']}% · "
            f"importo {quality['fill']['amount_pct']}% · "
            f"requisiti {quality['fill']['requirements_pct']}% · "
            f"documenti {quality['fill']['documents_pct']}%"
        )
        rows = verified

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
        if not ok and "gate_status" in detail.lower():
            # Migrazione del gate non ancora eseguita: si riscrive senza le
            # colonne di qualità, senza perdere l'aggiornamento del catalogo.
            print(
                "::warning::colonne del gate assenti su bonuses: esegui "
                "supabase_migration_verified_catalog.sql. Riscrivo senza gate."
            )
            ok, detail = supabase_upsert(url, key, rows, with_gate=False)
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
    write_json(
        json_path,
        rows,
        sources_count,
        db_rows,
        quarantine=quarantine,
        news=news_items,
        quality=quality,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
