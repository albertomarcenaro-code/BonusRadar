"""Idempotent seed: default Italian bonus sources + a starter catalogue. Run: python seed.py"""

import asyncio

from lib.db import db, ensure_indexes
from models.schemas import Bonus, Source

SOURCES = [
    ("INPS - Prestazioni e servizi", "https://www.inps.it/it/it/inps-comunica/notizie.html"),
    ("Agenzia delle Entrate - Agevolazioni", "https://www.agenziaentrate.gov.it/portale/web/guest/agevolazioni"),
    ("Governo - Bonus e agevolazioni", "https://www.governo.it/it/approfondimento/bonus-e-agevolazioni"),
    ("Money.it - Bonus", "https://www.money.it/bonus"),
]

BONUSES = [
    dict(title="Assegno Unico e Universale per i figli", authority="INPS", category="famiglia", amount="da 57 € a 201 € al mese per figlio",
         deadline="domanda sempre aperta", summary="Sostegno economico mensile per ogni figlio a carico fino a 21 anni. L'importo varia in base all'ISEE del nucleo.",
         requirements=["Figli a carico minori di 21 anni", "Residenza in Italia", "ISEE facoltativo (senza ISEE importo minimo)"],
         required_documents=["Documento d'identità", "Codici fiscali dei figli", "IBAN", "DSU/ISEE in corso di validità"], source_url="https://www.inps.it"),
    dict(title="Bonus Asilo Nido", authority="INPS", category="famiglia", amount="fino a 3.600 € annui",
         deadline="31/12/2026", summary="Rimborso delle rette di asili nido pubblici e privati o supporto domiciliare per bambini sotto i 3 anni.",
         requirements=["Figli di età inferiore a 3 anni", "Iscrizione ad asilo nido", "ISEE minorenni per importo maggiorato (fino a 40.000 €)"],
         required_documents=["Ricevute di pagamento rette", "ISEE minorenni", "IBAN"], source_url="https://www.inps.it"),
    dict(title="Bonus Nuovi Nati", authority="INPS", category="famiglia", amount="1.000 € una tantum",
         deadline="entro 120 giorni dalla nascita", summary="Contributo una tantum per ogni figlio nato o adottato dal 2025.",
         requirements=["Figlio nato o adottato dal 01/01/2025", "ISEE non superiore a 40.000 €", "Residenza in Italia"],
         required_documents=["Certificato di nascita", "ISEE", "IBAN"], source_url="https://www.inps.it"),
    dict(title="Carta Dedicata a te", authority="Ministero Agricoltura / Comuni", category="famiglia", amount="500 € su carta prepagata",
         deadline="assegnazione automatica tramite Comune", summary="Contributo per l'acquisto di beni alimentari di prima necessità e carburante.",
         requirements=["Nucleo di almeno 3 componenti", "ISEE non superiore a 15.000 €", "Non percepire altri sostegni al reddito"],
         required_documents=["ISEE ordinario", "Documento d'identità"], source_url="https://www.masaf.gov.it"),
    dict(title="Bonus Psicologo", authority="INPS", category="salute", amount="fino a 1.500 €",
         deadline="finestra annuale INPS", summary="Contributo per sessioni di psicoterapia presso professionisti iscritti all'albo.",
         requirements=["ISEE non superiore a 50.000 €", "Residenza in Italia"], required_documents=["ISEE", "SPID/CIE"], source_url="https://www.inps.it"),
    dict(title="Bonus Ristrutturazioni (detrazione 50%/36%)", authority="Agenzia delle Entrate", category="casa", amount="detrazione fino al 50% su max 96.000 €",
         deadline="31/12/2026", summary="Detrazione IRPEF per interventi di recupero edilizio sull'abitazione principale, ripartita in 10 anni.",
         requirements=["Proprietario o titolare di diritto reale sull'immobile", "Pagamento con bonifico parlante", "Abitazione principale per aliquota 50%"],
         required_documents=["Fatture", "Bonifici parlanti", "Titolo abilitativo edilizio"], source_url="https://www.agenziaentrate.gov.it"),
    dict(title="Contributo Affitto Giovani (detrazione under 31)", authority="Agenzia delle Entrate", category="casa", amount="da 991,60 € a 2.000 € annui",
         deadline="in dichiarazione dei redditi", summary="Detrazione per giovani tra 20 e 31 anni che affittano l'abitazione principale.",
         requirements=["Età tra 20 e 31 anni non compiuti", "Reddito complessivo non superiore a 15.493,71 €", "Contratto di affitto registrato"],
         required_documents=["Contratto di locazione registrato", "Ricevute canone"], source_url="https://www.agenziaentrate.gov.it"),
    dict(title="Bonus Elettrodomestici", authority="MIMIT", category="energia", amount="fino a 200 € (300 € con ISEE < 25.000 €)",
         deadline="fino a esaurimento fondi", summary="Contributo per l'acquisto di elettrodomestici ad alta efficienza energetica prodotti in UE con rottamazione del vecchio.",
         requirements=["Maggiorenne residente in Italia", "Rottamazione di un elettrodomestico equivalente", "ISEE per importo maggiorato"],
         required_documents=["SPID/CIE", "ISEE", "Fattura di acquisto"], source_url="https://www.mimit.gov.it"),
]


async def main():
    await ensure_indexes()
    for name, url in SOURCES:
        if not await db.sources.find_one({"url": url}):
            await db.sources.insert_one(Source(name=name, url=url).model_dump())
    for b in BONUSES:
        key = " ".join(b["title"].lower().split())
        if not await db.bonuses.find_one({"norm_title": key}):
            src = b["source_url"]
            await db.bonuses.insert_one({**Bonus(**b, source_name=b["authority"], is_new=False).model_dump(), "norm_title": key, "source_url": src})
    print("seed ok:", await db.sources.count_documents({}), "sources,", await db.bonuses.count_documents({}), "bonuses")


if __name__ == "__main__":
    asyncio.run(main())
