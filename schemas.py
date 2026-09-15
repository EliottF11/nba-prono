"""
Schémas Pydantic pour la validation des requêtes et la sérialisation des réponses API.
"""
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, List

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=30, description="Pseudo du joueur (3 à 30 caractères)")
    email: str = Field(..., min_length=5, max_length=120, description="Adresse e-mail")
    password: str = Field(..., min_length=4, max_length=100, description="Mot de passe (min 4 caractères)")

class UserLogin(BaseModel):
    username: str = Field(..., description="Pseudo ou adresse e-mail")
    password: str = Field(..., min_length=1)

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    total_points: float
    created_at: datetime

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# --- Schémas Équipes & Matchs ---

class TeamResponse(BaseModel):
    id: int
    city: str
    code: str
    color: str
    text_color: str

    class Config:
        from_attributes = True

class MatchResponse(BaseModel):
    id: int
    home_team: TeamResponse
    away_team: TeamResponse
    home_odds: float
    away_odds: float
    deadline: datetime
    status: str
    week_number: int = 1
    winner_team_id: Optional[int] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None

    class Config:
        from_attributes = True

# --- Schémas Pronostics ---

class PredictionCreate(BaseModel):
    match_id: int
    selected_team_id: int

class PredictionResponse(BaseModel):
    id: int
    match_id: int
    selected_team_id: int
    points_won: float
    is_boosted: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

class BoostResponse(BaseModel):
    match_id: int
    is_boosted: bool
    week_number: int
    message: str

# --- Schémas Classement (Leaderboard) ---

class LeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    username: str
    total_points: float
    predictions_count: int = 0
    won_count: int = 0


# --- Schémas Profil, Statistiques & Badges ---

class BadgeResponse(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    unlocked: bool
    current: int
    target: int
    progress_pct: int


class UserStatsResponse(BaseModel):
    user_id: int
    username: str
    email: Optional[str] = None
    total_points: float
    rank: Optional[int] = None
    total_predictions: int
    finished_predictions: int
    won_predictions: int
    lost_predictions: int
    winrate: float
    avg_odds: float
    max_odds: float
    badges: List[BadgeResponse]

