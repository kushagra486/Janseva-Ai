"""Authentication and role checks.

Production: the web app forwards the user's Supabase access token. We verify it (HS256 with
SUPABASE_JWT_SECRET, or the project's JWKS for asymmetric keys) and read the role from
app_metadata.role, which only the service role can set.

Demo mode (no Supabase configured): X-Demo-Role / X-Demo-User headers stand in for a login so
the officer dashboard can be shown without accounts. Never enable demo mode on a public
deployment that holds real data.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

import httpx
import jwt
from fastapi import Depends, Header, HTTPException

from .config import get_settings

Role = Literal["citizen", "officer", "admin"]


@dataclass
class User:
    id: str | None
    role: Role
    ward: str | None = None


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json")


def _decode(token: str) -> dict:
    s = get_settings()
    alg = jwt.get_unverified_header(token).get("alg", "HS256")
    if alg == "HS256":
        if not s.supabase_jwt_secret:
            raise HTTPException(401, "HS256 token but SUPABASE_JWT_SECRET is not set")
        key = s.supabase_jwt_secret
    else:
        key = _jwks_client(s.supabase_url).get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=[alg], audience="authenticated")


def auth_required() -> bool:
    s = get_settings()
    return bool(s.supabase_jwt_secret or s.supabase_url)


async def current_user(authorization: str | None = Header(default=None),
                       x_demo_role: str | None = Header(default=None),
                       x_demo_user: str | None = Header(default=None)) -> User:
    if not auth_required():
        role = x_demo_role if x_demo_role in ("citizen", "officer", "admin") else "citizen"
        return User(id=x_demo_user or "demo-citizen", role=role, ward=None)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required")
    try:
        claims = _decode(authorization.split(" ", 1)[1])
    except (jwt.PyJWTError, httpx.HTTPError) as e:
        raise HTTPException(401, f"Invalid token: {e}") from e
    meta = claims.get("app_metadata") or {}
    role = meta.get("role") if meta.get("role") in ("citizen", "officer", "admin") else "citizen"
    return User(id=claims["sub"], role=role, ward=meta.get("ward"))


def require_role(*roles: Role):
    async def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"Requires role: {', '.join(roles)}")
        return user
    return dep


async def download_object(bucket: str, path: str) -> tuple[bytes, str]:
    """Fetch a private Storage object with the service key."""
    s = get_settings()
    if not s.supabase_enabled:
        raise HTTPException(400, "file_path needs Supabase; upload the file directly instead")
    url = f"{s.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers={"Authorization": f"Bearer {s.supabase_service_key}",
                                           "apikey": s.supabase_service_key})
    if r.status_code == 404:
        raise HTTPException(404, "File not found in storage")
    r.raise_for_status()
    return r.content, r.headers.get("content-type", "application/octet-stream")


def check_owned_path(user: User, path: str) -> None:
    """Storage paths are `<user_id>/<file>`; a citizen may only read their own."""
    if user.role == "citizen" and not path.startswith(f"{user.id}/"):
        raise HTTPException(403, "Not your file")
