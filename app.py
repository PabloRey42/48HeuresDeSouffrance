from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = create_engine('postgresql://etienne:password@127.0.0.1:5432/air_db')

@app.get("/api/zones")
def get_zones():
    with engine.connect() as connection:
        result = connection.execute(text("SELECT DISTINCT \"Zas\" FROM qualite_air WHERE \"Zas\" IS NOT NULL ORDER BY \"Zas\""))
        return [row[0] for row in result]

@app.get("/api/points")
def get_points(min_val: float = 0, max_val: float = 200, date_start: str = None, date_end: str = None, site: str = None, zone: str = None):
    query = f"SELECT * FROM qualite_air WHERE valeur BETWEEN {min_val} AND {max_val}"
    
    if date_start and date_end:
        query += f" AND \"Date de début\"::date BETWEEN '{date_start}' AND '{date_end}'"
    if site:
        query += f" AND \"nom site\" ILIKE '%%{site}%%'"
    if zone and zone != "Toutes":
        query += f" AND \"Zas\" = '{zone}'"
    
    df = pd.read_sql(query, engine)
    df['Date de début'] = df['Date de début'].astype(str)
    return df.to_dict(orient="records")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)