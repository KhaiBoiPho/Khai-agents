"""Per-conversation cost from provider-reported charges, and OpenRouter balance."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest

from app_server.connection import ConnectionState
from app_server.dispatcher import Dispatcher
from core.application.config_store import ConfigStore
from core.application.llm_configuration_service import LLMConfigurationService
from core.providers.base import LLMResponse, USAGE_COST_KEY
from core.providers.credentials import CredentialStore
from core.providers.openai_compat import OpenAICompatProvider
from tests.application.test_usage_and_compaction import (
    StubProvider,
    _application,
    _close,
    _params,
    _run_turn,
)


class CostedProvider(StubProvider):
    """A provider that, like OpenRouter, reports what each response cost."""

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        response = await super().chat_with_retry(**kwargs)
        response.usage[USAGE_COST_KEY] = 1_250_000  # $0.00125
        return response


def test_openrouter_usage_cost_is_carried_as_nano_usd() -> None:
    usage = OpenAICompatProvider._extract_usage(
        {"usage": {"prompt_tokens": 10, "completion_tokens": 2, "cost": 0.0000375}}
    )
    assert usage[USAGE_COST_KEY] == 37_500
    plain = OpenAICompatProvider._extract_usage(
        {"usage": {"prompt_tokens": 10, "completion_tokens": 2}}
    )
    assert USAGE_COST_KEY not in plain


def test_thread_usage_sums_reported_costs(tmp_path: Path) -> None:
    application, thread_id, _ = _application(tmp_path, CostedProvider())
    dispatcher = Dispatcher(application, ConnectionState(application.broker))
    try:
        _run_turn(application, thread_id, "hello")
        _run_turn(application, thread_id, "again")
        result = dispatcher._handlers["thread/usage"](_params({"threadId": thread_id}))
        assert result["requests"] == 2
        assert result["costUsd"] == pytest.approx(0.0025)
        assert result["unpricedRequests"] == 0
        [connection] = result["connections"]
        assert connection["costUsd"] == pytest.approx(0.0025)
    finally:
        _close(application)


def _service(tmp_path: Path, monkeypatch, handler) -> LLMConfigurationService:
    monkeypatch.setenv("DEEPCODE_HOME", str(tmp_path))
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    return LLMConfigurationService(
        config_store=ConfigStore(tmp_path / "config.json"),
        credential_store=CredentialStore(tmp_path / "credentials.json"),
    )


def test_openrouter_balance_is_account_remainder_capped_by_key_limit(
    tmp_path: Path, monkeypatch
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer sk-or-test"
        if request.url.path.endswith("/credits"):
            return httpx.Response(
                200, json={"data": {"total_credits": 10.0, "total_usage": 2.5}}
            )
        return httpx.Response(200, json={"data": {"limit_remaining": 5.0}})

    balance = _service(tmp_path, monkeypatch, handler).balance("openrouter")
    assert balance["supported"] is True
    assert balance["totalCredits"] == 10.0
    assert balance["remainingUsd"] == 5.0


def test_balance_without_key_limit_and_for_other_providers(
    tmp_path: Path, monkeypatch
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/credits"):
            return httpx.Response(
                200, json={"data": {"total_credits": 3.0, "total_usage": 1.0}}
            )
        return httpx.Response(200, json={"data": {"limit_remaining": None}})

    service = _service(tmp_path, monkeypatch, handler)
    assert service.balance("openrouter")["remainingUsd"] == 2.0
    assert service.balance("gemini") == {"supported": False}


def test_balance_baseline_follows_spending_top_ups_and_new_keys(
    tmp_path: Path, monkeypatch
) -> None:
    account = {"total_credits": 30.0, "total_usage": 29.0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/credits"):
            return httpx.Response(200, json={"data": dict(account)})
        return httpx.Response(200, json={"data": {"limit_remaining": None}})

    service = _service(tmp_path, monkeypatch, handler)
    # First seen: the bar starts full at what is left now, not at $30.
    first = service.balance("openrouter")
    assert first["remainingUsd"] == pytest.approx(1.0)
    assert first["baselineUsd"] == pytest.approx(1.0)
    # Spending lowers the remainder against the same baseline.
    account["total_usage"] = 29.75
    spent = service.balance("openrouter")
    assert spent["remainingUsd"] == pytest.approx(0.25)
    assert spent["baselineUsd"] == pytest.approx(1.0)
    # A top-up grows the account's credits: full again at the new remainder.
    account["total_credits"] = 40.0
    topped = service.balance("openrouter")
    assert topped["remainingUsd"] == pytest.approx(10.25)
    assert topped["baselineUsd"] == pytest.approx(10.25)
    # A different key starts its own baseline.
    account["total_usage"] = 35.0
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-other")
    other = service.balance("openrouter")
    assert other["baselineUsd"] == pytest.approx(5.0)
    stored = (tmp_path / "provider_balance.json").read_text()
    assert "sk-or" not in stored


def test_usage_summary_prefers_reported_costs(tmp_path: Path) -> None:
    from core.application import DeepCodeApplication
    from core.application.usage_service import UsageService, model_prices
    from core.persistence.usage_repository import UsageRepository

    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    try:
        with application.database.transaction() as connection:
            repository = UsageRepository(connection)
            repository.record(
                thread_id="thr_a",
                usage={"prompt_tokens": 100, "completion_tokens": 10, USAGE_COST_KEY: 2_000_000},
                model_id="gpt-4o",
            )
            repository.record(
                thread_id="thr_b",
                usage={"prompt_tokens": 50, "completion_tokens": 5},
                model_id="gpt-4o",
            )
        summary = UsageService(application.database).summary()
        prices = model_prices("gpt-4o")
        assert prices is not None
        listed = (50 * prices[0] + 5 * prices[1]) / 1_000_000
        for view in (summary["allTime"], summary["today"], summary["models"][0]):
            assert view["costUsd"] == pytest.approx(0.002 + listed)
            assert view["requests"] == 2
            assert view["inputTokens"] == 150
            assert view["unpricedRequests"] == 0
    finally:
        application.close()
