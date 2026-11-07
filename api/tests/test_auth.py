import time

import jwt
from cryptography.hazmat.primitives import serialization

from .conftest import AUDIENCE, make_token, other_key, private_key


def call(client, token):
    return client.get("/api/me", headers={"Authorization": f"Bearer {token}"} if token else {})


def test_valid_token_provisions_user_once(client):
    t = make_token("auth0|alice")
    first = call(client, t)
    second = call(client, t)
    assert first.status_code == 200
    assert first.json()["id"] == second.json()["id"]  # no duplicate accounts


def test_missing_token(client):
    r = call(client, None)
    assert r.status_code == 401
    assert "Bearer" in r.headers["www-authenticate"]


def test_expired_token(client):
    past = int(time.time()) - 7200
    r = call(client, make_token("auth0|alice", iat=past, exp=past + 60))
    assert r.status_code == 401
    assert "expired" in r.json()["detail"].lower()


def test_wrong_audience(client):
    assert call(client, make_token("auth0|alice", aud="https://some-other-api")).status_code == 401


def test_wrong_issuer(client):
    assert call(client, make_token("auth0|alice", iss="https://evil.us.auth0.com/")).status_code == 401


def test_signed_by_wrong_key(client):
    assert call(client, make_token("auth0|alice", key=other_key)).status_code == 401


def test_unknown_kid(client):
    assert call(client, make_token("auth0|alice", kid="rotated-away")).status_code == 401


def test_missing_sub(client):
    assert call(client, make_token(None)).status_code == 401


def test_alg_none_rejected(client):
    unsigned = jwt.encode({"sub": "auth0|alice", "aud": AUDIENCE}, None, algorithm="none")
    assert call(client, unsigned).status_code == 401


def test_hs256_key_confusion_rejected(client):
    # Classic attack: sign with HS256 using the public key as the HMAC secret.
    pub_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    forged = jwt.encode(
        {"sub": "auth0|alice", "aud": AUDIENCE, "iss": "x", "exp": time.time() + 60},
        pub_pem.decode()[:64],
        algorithm="HS256",
        headers={"kid": "test-key-1"},
    )
    assert call(client, forged).status_code == 401


def test_garbage_token(client):
    assert call(client, "not.a.jwt").status_code == 401


def test_session_endpoint_reports_verified_claims(actor):
    r = actor("auth0|alice").get("/api/auth/session")
    assert r.status_code == 200
    body = r.json()
    assert body["subject"] == "auth0|alice"
    assert body["verified"] is True
    assert AUDIENCE in body["audience"]


def test_sync_falls_back_to_hints_when_userinfo_unreachable(actor, monkeypatch):
    import httpx

    async def boom(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx.AsyncClient, "get", boom)
    r = actor("google-oauth2|123").post("/api/me/sync", json={"name": "Priya Shah", "nickname": "priya.s"})
    assert r.status_code == 200
    u = r.json()["user"]
    assert u["displayName"] == "Priya Shah"
    assert u["username"] == "priya_s"
    assert r.json()["created"] is True
