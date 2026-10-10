"""Hard budgets for one DeepThink run.

Every number here exists to keep a research run cheap and bounded: the plan
and check calls are small JSON prompts, only short snippets reach the check
prompt, and the final prompt carries trimmed page excerpts under a fixed
character budget.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Absolute ceiling for search rounds (the initial round plus at most two
#: follow-up rounds), whatever a caller configures.
MAX_SEARCH_ROUNDS_CEILING = 3


@dataclass(frozen=True, slots=True)
class DeepThinkLimits:
    # Planning
    max_sub_questions: int = 4
    # Search
    max_results_per_query: int = 5
    max_pages_per_question: int = 2
    page_char_budget: int = 4_000
    snippet_char_budget: int = 300
    search_concurrency: int = 4
    #: Initial round + follow-up rounds (default: one follow-up round).
    max_search_rounds: int = 2
    max_follow_up_queries: int = 3
    # LLM budget for the whole run
    max_llm_calls: int = 6
    #: Estimated/observed prompt tokens summed over every call in the run.
    max_input_tokens: int = 40_000
    plan_max_tokens: int = 700
    check_max_tokens: int = 500
    summarize_max_tokens: int = 3_000
    #: Characters of numbered source evidence in the final prompt.
    evidence_char_budget: int = 20_000
    #: Ceiling for the research brief handed to the agent for deliverables.
    deliver_brief_char_budget: int = 6_000
    # Conversation context handed to plan/summarize
    history_messages: int = 4
    history_char_budget: int = 2_400
    # Timeouts (seconds)
    plan_timeout_s: float = 60.0
    search_timeout_s: float = 90.0
    tool_timeout_s: float = 25.0
    check_timeout_s: float = 60.0
    summarize_timeout_s: float = 240.0
    tool_discovery_timeout_s: float = 20.0

    def __post_init__(self) -> None:
        for name in (
            "max_sub_questions",
            "max_results_per_query",
            "search_concurrency",
            "max_search_rounds",
            "max_llm_calls",
        ):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} must be at least 1")
        if self.max_search_rounds > MAX_SEARCH_ROUNDS_CEILING:
            object.__setattr__(self, "max_search_rounds", MAX_SEARCH_ROUNDS_CEILING)
        if self.max_llm_calls < 2:
            # Plan may be skipped on failure, but the answer always needs one.
            object.__setattr__(self, "max_llm_calls", 2)


__all__ = ["MAX_SEARCH_ROUNDS_CEILING", "DeepThinkLimits"]
