"""Claude Sonnet 4.5 via emergentintegrations — returns parsed JSON for backend jobs."""

import json
import os
import re

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

from models.schemas import new_id

MODEL = ("anthropic", "claude-sonnet-4-5-20250929")


async def ask_json(system: str, prompt: str):
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=f"bonus-{new_id()}",
        system_message=system + "\nRispondi SOLO con JSON valido, senza testo aggiuntivo né blocchi markdown.",
    ).with_model(*MODEL)
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
