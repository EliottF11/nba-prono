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


# --- Schémas Pronostics d'Avant-Saison (Chantier 3) ---

class SeasonPredictionCreate(BaseModel):
    nba_champion: str = Field(..., min_length=2, max_length=100, description="Champion NBA")
    cup_winner: str = Field(..., min_length=2, max_length=100, description="Vainqueur du tournoi NBA (NBA Cup)")
    mvp: str = Field(..., min_length=2, max_length=100, description="MVP de la saison régulière")
    dpoy: str = Field(..., min_length=2, max_length=100, description="Défenseur de l'année (DPOY)")
    roy: str = Field(..., min_length=2, max_length=100, description="Rookie de l'année (ROY)")


class SeasonPredictionResponse(BaseModel):
    id: Optional[int] = None
    user_id: Optional[int] = None
    nba_champion: Optional[str] = None
    cup_winner: Optional[str] = None
    mvp: Optional[str] = None
    dpoy: Optional[str] = None
    roy: Optional[str] = None
    is_locked: bool = False
    deadline: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Schémas Pronostics Hebdomadaires (Chantier 4) ---

class WeeklyPlayerPredictionCreate(BaseModel):
    week_number: int = Field(..., ge=1, le=50, description="Numéro de la semaine NBA")
    east_player: str = Field(..., min_length=2, max_length=100, description="Joueur de la semaine - Conférence Est")
    west_player: str = Field(..., min_length=2, max_length=100, description="Joueur de la semaine - Conférence Ouest")


class WeeklyPlayerPredictionResponse(BaseModel):
    id: Optional[int] = None
    user_id: Optional[int] = None
    week_number: int
    east_player: Optional[str] = None
    west_player: Optional[str] = None
    is_locked: bool = False
    deadline: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Schémas Ligues Privées (Chantier 5) ---

class LeagueCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=50, description="Nom de la ligue privée")


class LeagueJoin(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, description="Code d'invitation à 6 caractères")


class LeagueMemberResponse(BaseModel):
    user_id: int
    username: str
    total_points: float
    rank: int
    joined_at: datetime
    is_creator: bool = False
    predictions_count: int = 0
    won_count: int = 0


class LeagueDetailResponse(BaseModel):
    id: int
    name: str
    code: str
    creator_id: int
    creator_username: str
    created_at: datetime
    members_count: int
    user_rank: Optional[int] = None
    members: List[LeagueMemberResponse]


class LeagueSummaryResponse(BaseModel):
    id: int
    name: str
    code: str
    creator_id: int
    creator_username: str
    members_count: int
    user_rank: Optional[int] = None
    created_at: datetime

