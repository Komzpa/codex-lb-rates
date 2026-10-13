"""Transient poll failures keep the last snapshot for a bounded grace period."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from custom_components.codex_rates.const import (
    CONF_MODE,
    CONF_POLL_INTERVAL,
    MODE_CODEX_LB,
)
from custom_components.codex_rates.coordinator import CodexRatesCoordinator
from custom_components.codex_rates.exceptions import (
    CodexRatesApiError,
    CodexRatesAuthError,
)
from custom_components.codex_rates.models import AccountQuota, ProviderSnapshot

NOW = datetime(2026, 10, 14, 0, 0, tzinfo=timezone.utc)


class _FailingProvider:
    def __init__(self, err: BaseException) -> None:
        self.err = err

    async def async_fetch(self):
        raise self.err


def _coordinator(monkeypatch, err: BaseException, *, last_ok_ago: timedelta | None):
    import custom_components.codex_rates.coordinator as coordinator_mod

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW if tz is None else NOW.astimezone(tz)

    monkeypatch.setattr(coordinator_mod, "datetime", _FixedDateTime, raising=False)
    entry = SimpleNamespace(
        entry_id="entry",
        options={},
        data={CONF_POLL_INTERVAL: 60, CONF_MODE: MODE_CODEX_LB},
    )
    coordinator = CodexRatesCoordinator(SimpleNamespace(data={}), entry)
    coordinator._provider = _FailingProvider(err)
    coordinator.data = ProviderSnapshot(accounts=[AccountQuota(account_id="acc")])
    coordinator.last_successful_poll_at = (
        None if last_ok_ago is None else NOW - last_ok_ago
    )
    return coordinator


@pytest.mark.asyncio
@pytest.mark.parametrize("err", [TimeoutError(), CodexRatesApiError("HTTP 502")])
async def test_failure_within_grace_keeps_snapshot(monkeypatch, err) -> None:
    coordinator = _coordinator(monkeypatch, err, last_ok_ago=timedelta(seconds=90))
    previous = coordinator.data

    assert await coordinator._async_update_data() is previous
    assert coordinator.last_successful_poll_at == NOW - timedelta(seconds=90)


@pytest.mark.asyncio
async def test_failure_after_grace_marks_unavailable(monkeypatch) -> None:
    from homeassistant.helpers.update_coordinator import UpdateFailed

    coordinator = _coordinator(
        monkeypatch, TimeoutError(), last_ok_ago=timedelta(seconds=180)
    )

    with pytest.raises(UpdateFailed):
        await coordinator._async_update_data()


@pytest.mark.asyncio
async def test_failure_without_prior_success_fails(monkeypatch) -> None:
    from homeassistant.helpers.update_coordinator import UpdateFailed

    coordinator = _coordinator(monkeypatch, TimeoutError(), last_ok_ago=None)

    with pytest.raises(UpdateFailed):
        await coordinator._async_update_data()


@pytest.mark.asyncio
async def test_auth_failure_is_never_masked(monkeypatch) -> None:
    from homeassistant.exceptions import ConfigEntryAuthFailed

    coordinator = _coordinator(
        monkeypatch,
        CodexRatesAuthError("rejected"),
        last_ok_ago=timedelta(seconds=30),
    )

    with pytest.raises(ConfigEntryAuthFailed):
        await coordinator._async_update_data()
