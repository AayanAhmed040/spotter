from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Auth0 — the API must be registered in Auth0 with this exact identifier.
    auth0_domain: str = ""
    auth0_audience: str = ""

    # Any SQLAlchemy URL. Supabase / Tiger Cloud / Neon: paste the Postgres connection string.
    # Default file name kept from the Spotter era so existing local databases keep working.
    database_url: str = "sqlite:///./spotter.db"

    # Comma-separated list of browser origins allowed to call the API.
    cors_origins: str = "http://localhost:5173,https://localhost:5173"

    # Gemini (optional — features fall back to rule-based output without it).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    gemini_timeout_s: float = 20.0

    @property
    def auth0_issuer(self) -> str:
        return f"https://{self.auth0_domain}/"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        # Hosted Postgres providers hand out postgres:// or postgresql:// URLs; use psycopg 3.
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
