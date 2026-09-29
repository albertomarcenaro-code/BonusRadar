"""Claude Sonnet 4.5 via emergentintegrations — returns parsed JSON for backend jobs.

Il pacchetto `emergentintegrations` non è su PyPI pubblico: si installa con
    pip install emergentintegrations --extra-index-url https://packages.emergentagent.com/simple
L'import è lazy: senza il pacchetto (o senza EMERGENT_LLM_KEY) l'app parte
comunque; solo le funzionalità AI (scansione, valutazione, generazione documenti)
restituiscono un errore esplicito.
"""

import json
import os
import re

from models.schemas import new_id

MODEL = ("anthropic", "claude-sonnet-4-5-20250929")


class LlmUnavailable(RuntimeError):
    """Sollevata quando il client LLM non è configurato nel runtime corrente."""


def _chat():
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: PLC0415
    except ImportError as exc:
        raise LlmUnavailable(
            "Pacchetto 'emergentintegrations' non installato: "
            "pip install emergentintegrations --extra-index-url https://packages.emergentagent.com/simple"
        ) from exc
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise LlmUnavailable("Variabile d'ambiente EMERGENT_LLM_KEY non impostata: funzioni AI disabilitate.")
    return LlmChat, UserMessage, api_key


async def ask_json(system: str, prompt: str):
    LlmChat, UserMessage, api_key = _chat()
    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"bonus-{new_id()}",
            system_message=system + "\nRispondi SOLO con JSON valido, senza testo aggiuntivo né blocchi markdown.",
        )
        .with_model(*MODEL)
    )
    from emergentintegrations.llm.chat import StreamDone, TextDelta  # noqa: PLC0415

    parts: list[str] = []
    async for ev in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(ev, TextDelta):
            parts.append(ev.content)
        elif isinstance(ev, StreamDone):
            break
    text = "".join(parts).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"(\{.*\}|\[.*\])", text, re.S)
        if not m:
            raise
        return json.loads(m.group(1))
