import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routers import groups, me, workouts

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Striqs API", version="0.2.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,  # bearer tokens, no cookies
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "ngrok-skip-browser-warning"],
        max_age=600,
    )
    app.include_router(me.router)
    app.include_router(groups.router)
    app.include_router(workouts.router)

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "ok": True,
            "auth0Configured": bool(settings.auth0_domain and settings.auth0_audience),
            "geminiConfigured": bool(settings.gemini_api_key),
            "database": settings.sqlalchemy_url.split(":")[0],
        }

    return app


app = create_app()
