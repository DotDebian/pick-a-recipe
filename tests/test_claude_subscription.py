"""Claude subscription dialect: validation and dispatch, without the network."""

import pytest

import ai_providers as ap


def _provider(**kw):
    return ap.AiProvider(id="claude", name="Claude", api_type=ap.CLAUDE_SUBSCRIPTION,
                         model="sonnet", **kw)


def test_registered_everywhere():
    assert ap.CLAUDE_SUBSCRIPTION in ap.API_TYPES
    assert ap.CLAUDE_SUBSCRIPTION in ap._TEXT_CALLS
    assert ap.CLAUDE_SUBSCRIPTION in ap._IMAGE_CALLS


def test_token_from_env_satisfies_validation(monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-test")
    ap.validate(_provider())


def test_missing_token_is_rejected(monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    with pytest.raises(ap.ProviderConfigError):
        ap.validate(_provider())


def test_stored_key_wins_over_env(monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "env")
    assert ap._subscription_token(_provider(api_key="stored")) == "stored"


def test_text_call_dispatches(monkeypatch):
    seen = {}

    def fake(session, model, system_prompt, blocks, json_schema):
        seen.update(model=model, blocks=blocks, schema=json_schema)
        return '{"ok": true}'

    monkeypatch.setattr(ap, "_subscription_call", fake)
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "x")
    session = ap.AiSession(_provider())
    out = session.complete_json("sys", "hello", schema_name="r",
                                json_schema={"type": "object"})
    assert out == '{"ok": true}'
    assert seen["model"] == "sonnet"
    assert seen["blocks"] == [{"type": "text", "text": "hello"}]
