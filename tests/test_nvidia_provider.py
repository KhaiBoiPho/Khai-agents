"""Pin the NVIDIA NIM provider wiring.

NVIDIA's hosted NIM catalog (build.nvidia.com) serves other vendors' open
models behind an OpenAI-compatible endpoint, so it rides the generic
``openai_compat`` path. These tests pin the base URL, env var and key prefix,
the ``aggregator`` classification, and that ``vendor/model`` ids keep their
prefix and still reach the model-level Kimi handling.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.providers.model_compat import resolve_model_compat  # noqa: E402
from core.providers.registry import find_by_model, find_by_name  # noqa: E402

NVIDIA = find_by_name("nvidia")


def test_nvidia_is_registered() -> None:
    assert NVIDIA is not None
    assert NVIDIA.name == "nvidia"
    assert NVIDIA.display_name == "NVIDIA NIM"
    assert NVIDIA.backend == "openai_compat"


def test_nvidia_provider_specific_endpoint() -> None:
    assert NVIDIA is not None
    assert NVIDIA.default_api_base == "https://integrate.api.nvidia.com/v1"
    assert NVIDIA.env_key == "NVIDIA_API_KEY"
    assert NVIDIA.detect_by_key_prefix == "nvapi-"
    assert NVIDIA.detect_by_base_keyword == "api.nvidia.com"


def test_nvidia_is_classified_as_aggregator() -> None:
    assert NVIDIA is not None
    assert NVIDIA.is_gateway is True
    assert NVIDIA.resolve_endpoint_class(NVIDIA.default_api_base) == "aggregator"
    # A self-hosted NIM container is the operator's own endpoint.
    assert NVIDIA.resolve_endpoint_class("http://127.0.0.1:8000/v1") == "local"


def test_nvidia_prefix_routes_to_nvidia() -> None:
    spec = find_by_model(
        "nvidia/llama-3.3-nemotron-super-49b-v1",
        available_provider_names={"nvidia", "ollama"},
    )
    assert spec is not None and spec.name == "nvidia"


def test_nvidia_keeps_vendor_prefix_and_sends_effort() -> None:
    # Kimi K3 takes a plain ``reasoning_effort`` ladder, no ``thinking`` body.
    assert NVIDIA is not None
    compat = resolve_model_compat(
        model_name="moonshotai/kimi-k3", spec=NVIDIA, reasoning_effort="max"
    )
    assert compat.model_name == "moonshotai/kimi-k3"
    assert compat.token_limit_field == "max_tokens"
    assert compat.reasoning_effort_wire == "max"
    assert compat.thinking_extra_body is None
