"""Auth0 access-token validation.

Every protected endpoint depends on `current_user`, which:
  1. reads the Bearer token,
  2. verifies its RS256 signature against the tenant's JWKS (keys cached, auto-rotated),
  3. checks issuer, audience, expiry, issued-at and subject,
  4. maps `sub` to our own user row (creating it on first sight — never duplicating it).

User IDs are never taken from request bodies or query strings; identity comes only
from the verified token.
"""
import logging
import re
import secrets
from dataclasses import dataclass
from typing import Annotated, Any, Protocol

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db, utcnow
from .models import User

log = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)


class SigningKeySource(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> Any: ...


@dataclass(frozen=True)
class VerifiedToken:
    raw: str
    claims: dict[str, Any]

    @property
    def sub(self) -> str:
        return self.claims["sub"]

    @property
    def scopes(self) -> set[str]:
        return set(str(self.claims.get("scope", "")).split())


class Auth0Verifier:
    def __init__(self, settings: Settings, keys: SigningKeySource | None = None):
        if not settings.auth0_domain or not settings.auth0_audience:
            raise RuntimeError("AUTH0_DOMAIN and AUTH0_AUDIENCE must be set (see api/.env.example)")
        self.issuer = settings.auth0_issuer
        self.audience = settings.auth0_audience
        self.keys: SigningKeySource = keys or jwt.PyJWKClient(
            f"{self.issuer}.well-known/jwks.json", cache_keys=True, lifespan=3600, timeout=5
        )

    def verify(self, token: str) -> VerifiedToken:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError as e:
            raise _unauthorized("Malformed token") from e
        if header.get("alg") != "RS256":
            # Blocks alg=none / HS256 key-confusion attacks.
            raise _unauthorized("Unsupported token algorithm")
        try:
            signing_key = self.keys.get_signing_key_from_jwt(token)
        except jwt.PyJWKClientConnectionError as e:
            log.error("Could not reach Auth0 JWKS: %s", e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Auth provider unreachable") from e
        except jwt.PyJWKClientError as e:
            raise _unauthorized("Unknown signing key") from e
        try:
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self.audience,
                issuer=self.issuer,
                leeway=30,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.ExpiredSignatureError as e:
            raise _unauthorized("Token expired", error="invalid_token") from e
        except jwt.InvalidTokenError as e:
            raise _unauthorized(f"Invalid token: {e}") from e
        return VerifiedToken(raw=token, claims=claims)


def _unauthorized(detail: str, error: str = "invalid_token") -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": f'Bearer error="{error}", error_description="{detail}"'},
    )


def get_verifier(request: Request) -> Auth0Verifier:
    verifier = getattr(request.app.state, "verifier", None)
    if verifier is None:
        verifier = Auth0Verifier(get_settings())
        request.app.state.verifier = verifier
    return verifier


def verified_token(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    verifier: Annotated[Auth0Verifier, Depends(get_verifier)],
) -> VerifiedToken:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauthorized("Missing bearer token", error="invalid_request")
    return verifier.verify(creds.credentials)


def current_user(
    token: Annotated[VerifiedToken, Depends(verified_token)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = db.scalar(select(User).where(User.auth0_sub == token.sub))
    if user is None:
        user = provision_user(db, token.sub, profile={})
    return user


CurrentUser = Annotated[User, Depends(current_user)]
DB = Annotated[Session, Depends(get_db)]


PLACEHOLDER_NAME = "New member"
# Names given to profiles before Auth0 sent a real one (older builds used the first).
PLACEHOLDER_NAMES = ("New Spotter", PLACEHOLDER_NAME)


def provision_user(db: Session, sub: str, profile: dict[str, Any]) -> User:
    """Create the app-side profile for an Auth0 identity. Idempotent under races."""
    display = (profile.get("name") or profile.get("nickname") or "").strip()
    if not display or "@" in display:
        display = PLACEHOLDER_NAME
    base = profile.get("nickname") or (profile.get("email") or "").split("@")[0] or "athlete"
    user = User(
        auth0_sub=sub,
        username=unique_username(db, base),
        display_name=display[:80],
        avatar_url=profile.get("picture"),
        email=profile.get("email"),
        last_seen_at=utcnow(),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Two first requests from the same new user arrived together; use the winner.
        db.rollback()
        existing = db.scalar(select(User).where(User.auth0_sub == sub))
        if existing is None:
            raise
        return existing
    db.refresh(user)
    return user


def unique_username(db: Session, base: str) -> str:
    slug = re.sub(r"[^a-z0-9_]", "", base.lower().replace(".", "_").replace("-", "_"))[:20] or "athlete"
    if len(slug) < 3:
        slug = f"{slug}_fit"
    candidate = slug
    while db.scalar(select(User.id).where(User.username == candidate)) is not None:
        candidate = f"{slug}{secrets.randbelow(9000) + 1000}"
    return candidate
