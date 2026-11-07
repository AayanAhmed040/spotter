"""Test harness: a throwaway SQLite DB and a locally generated RSA key standing in
for the Auth0 tenant's JWKS. Tokens go through the exact same verification code
path as production — only the key source is swapped."""
import os
import tempfile
import time
from types import SimpleNamespace

_tmp = tempfile.mkdtemp()
os.environ.update(
    AUTH0_DOMAIN="spotter-test.us.auth0.com",
    AUTH0_AUDIENCE="https://api.spotter.test",
    DATABASE_URL=f"sqlite:///{_tmp}/test.db",
    GEMINI_API_KEY="",
)

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import Auth0Verifier  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import Base, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402

ISSUER = "https://spotter-test.us.auth0.com/"
AUDIENCE = "https://api.spotter.test"
KID = "test-key-1"

private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJWKS:
    def get_signing_key_from_jwt(self, token: str):
        kid = jwt.get_unverified_header(token).get("kid")
        if kid != KID:
            raise jwt.PyJWKClientError("Unable to find a signing key that matches")
        return SimpleNamespace(key=private_key.public_key())


def make_token(sub: str, *, key=private_key, kid=KID, alg="RS256", **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": [AUDIENCE, f"{ISSUER}userinfo"],
        "sub": sub,
        "iat": now,
        "exp": now + 3600,
        "azp": "spa-client-id",
        "scope": "openid profile email",
        **overrides,
    }
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid})


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    init_db()
    app.state.verifier = Auth0Verifier(get_settings(), keys=FakeJWKS())
    yield


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


class Actor:
    """A signed-in user making API calls."""

    def __init__(self, client: TestClient, sub: str):
        self.client = client
        self.sub = sub
        self.headers = {"Authorization": f"Bearer {make_token(sub)}"}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)


@pytest.fixture
def actor(client):
    return lambda sub: Actor(client, sub)
