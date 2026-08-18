"""
GeminiClient — called only for the uncertain 40-60% confidence band. Wraps
google-generativeai; on any error (no API key, network failure, quota
exceeded, malformed response) it returns None so the pipeline falls back to
the rule+ML decision instead of crashing.
"""

import os
import re
from dataclasses import dataclass
from typing import Optional

PROMPT_TEMPLATE = """Laptop idle {idle_time}s. RSSI {rssi}. Phone moving: {phone_moving}.
Mouse inactive: {mouse_inactive}. Keyboard inactive: {keyboard_inactive}.
Recent user corrections: {profile_summary}.
Should the laptop lock? Respond with LOCK or WAIT and a one-sentence reason."""


@dataclass
class GeminiResult:
    decision: str  # "LOCK" | "WAIT"
    reason: str


class GeminiClient:
    def __init__(self, api_key: Optional[str] = None, model_name: str = "gemini-1.5-flash"):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model_name = model_name
        self._model = None
        if self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self._model = genai.GenerativeModel(self.model_name)
            except Exception as e:
                print(f"[GeminiClient] Failed to initialize: {e}")
                self._model = None
        else:
            print("[GeminiClient] No GEMINI_API_KEY set — Gemini calls will be skipped, "
                  "pipeline falls back to rule+ML for the uncertain band.")

    def is_available(self) -> bool:
        return self._model is not None

    def decide(self, ctx: dict, profile_summary: str) -> Optional[GeminiResult]:
        if not self.is_available():
            return None

        prompt = PROMPT_TEMPLATE.format(
            idle_time=ctx["idleTime"],
            rssi=ctx["rssi"],
            phone_moving=ctx["phoneMoving"],
            mouse_inactive=not ctx["mouseActive"],
            keyboard_inactive=not ctx["keyboardActive"],
            profile_summary=profile_summary,
        )

        try:
            response = self._model.generate_content(
                prompt,
                generation_config={"temperature": 0.2, "max_output_tokens": 100},
            )
            text = (response.text or "").strip()
            return self._parse(text)
        except Exception as e:
            print(f"[GeminiClient] API call failed, falling back: {e}")
            return None

    @staticmethod
    def _parse(text: str) -> Optional[GeminiResult]:
        if not text:
            return None
        match = re.search(r"\b(LOCK|WAIT)\b", text, re.IGNORECASE)
        if not match:
            return None
        decision = match.group(1).upper()
        # Reason = whatever's left of the response, first sentence, trimmed.
        reason = text.replace(match.group(1), "", 1).strip(" :-.\n")
        reason = reason.split("\n")[0].strip() or f"Gemini judged {decision} from current context"
        return GeminiResult(decision=decision, reason=f"[Gemini] {reason}")
