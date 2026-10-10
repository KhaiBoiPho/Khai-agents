"""DeepThink: a bounded multi-step research mode (plan, search, check, summarize).

Importing this package is cheap; LangGraph is imported only when a run starts.
"""

from core.deepthink.limits import DeepThinkLimits

__all__ = ["DeepThinkLimits"]
