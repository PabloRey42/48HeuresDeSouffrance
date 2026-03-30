"""Application FastAPI — documentation Swagger sur /docs."""

from fastapi import FastAPI

from app.api.impact import router as impact_router

app = FastAPI(
    title="Indice météo-pollution",
    description="Pipeline pollution (data.gouv) + météo SYNOP + jointure spatiale + indice 0–100.",
    version="1.0.0",
)

app.include_router(impact_router)
