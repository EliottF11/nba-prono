from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint, Boolean
from sqlalchemy.orm import relationship
from database import Base

def utcnow():
    return datetime.now(timezone.utc)

class Team(Base):
    """
    Modèle d'équipe NBA.
    Conforme aux règles de droits : uniquement le nom de la ville et une couleur représentative.
    Aucun logo officiel n'est utilisé.
    """
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    city = Column(String(50), unique=True, nullable=False)      # Ex: "Minnesota", "Boston", "Golden State"
    code = Column(String(5), unique=True, nullable=False)       # Ex: "MIN", "BOS", "GSW"
    color = Column(String(10), nullable=False)                  # Couleur principale unie, ex: "#0C2340"
    text_color = Column(String(10), default="#FFFFFF")          # Couleur de texte pour contraste lisible

    def __repr__(self):
        return f"<Team {self.city} ({self.code})>"


class User(Base):
    """
    Modèle d'utilisateur/joueur.
    Stocke les identifiants et le score cumulé pour le classement en direct.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    total_points = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    predictions = relationship("Prediction", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username} ({self.total_points} pts)>"


class Match(Base):
    """
    Modèle de match hebdomadaire avec cotes fictives et heure limite de pronostic.
    """
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    home_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    away_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    home_odds = Column(Float, nullable=False)                   # Ex: 1.45
    away_odds = Column(Float, nullable=False)                   # Ex: 2.75
    deadline = Column(DateTime, nullable=False)                 # Heure limite pour pronostiquer
    status = Column(String(20), default="upcoming", nullable=False) # "upcoming", "live", "finished"
    winner_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True) # Renseigné quand terminé
    home_score = Column(Integer, nullable=True)                 # Score final domicile (ex: 112)
    away_score = Column(Integer, nullable=True)                 # Score final extérieur (ex: 108)
    week_number = Column(Integer, default=1, index=True, nullable=False) # Semaine NBA (Week 1, Week 2...)

    # Relations
    home_team = relationship("Team", foreign_keys=[home_team_id])
    away_team = relationship("Team", foreign_keys=[away_team_id])
    winner_team = relationship("Team", foreign_keys=[winner_team_id])
    predictions = relationship("Prediction", back_populates="match", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Match {self.home_team_id} vs {self.away_team_id} (W{self.week_number} - Status: {self.status})>"


class Prediction(Base):
    """
    Modèle de pronostic d'un joueur sur un match précis.
    Contrainte d'unicité : 1 seul pronostic par utilisateur et par match (modifiable avant la deadline).
    """
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False)
    selected_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    points_won = Column(Float, default=0.0, nullable=False)
    is_boosted = Column(Boolean, default=False, nullable=False)   # Bonus x2 activé (max 1 par semaine)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    # Relations
    user = relationship("User", back_populates="predictions")
    match = relationship("Match", back_populates="predictions")
    selected_team = relationship("Team")

    __table_args__ = (
        UniqueConstraint("user_id", "match_id", name="uq_user_match_prediction"),
    )

    def __repr__(self):
        return f"<Prediction User {self.user_id} Match {self.match_id} -> Team {self.selected_team_id}>"


class SeasonPrediction(Base):
    """
    Modèle des pronostics d'avant-saison (Chantier 3).
    5 choix définitifs par joueur, verrouillés dès le coup d'envoi du premier match :
    - Champion NBA (ex: Minnesota)
    - Vainqueur du NBA In-Season Tournament (NBA Cup)
    - MVP de la saison régulière (ex: Anthony Edwards)
    - DPOY (Défenseur de l'année)
    - ROY (Rookie de l'année)
    """
    __tablename__ = "season_predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    nba_champion = Column(String(100), nullable=False)
    cup_winner = Column(String(100), nullable=False)
    mvp = Column(String(100), nullable=False)
    dpoy = Column(String(100), nullable=False)
    roy = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", backref="season_prediction")

    def __repr__(self):
        return f"<SeasonPrediction User {self.user_id}: Champ={self.nba_champion}, MVP={self.mvp}>"


class WeeklyPlayerPrediction(Base):
    """
    Modèle des pronostics hebdomadaires (Chantier 4).
    2 joueurs clés obligatoires par semaine avant de valider ses matchs :
    - Joueur de la semaine - Conférence Est
    - Joueur de la semaine - Conférence Ouest
    """
    __tablename__ = "weekly_player_predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    week_number = Column(Integer, nullable=False, index=True)
    east_player = Column(String(100), nullable=False)
    west_player = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", backref="weekly_player_predictions")

    __table_args__ = (
        UniqueConstraint("user_id", "week_number", name="uq_user_week_player_prediction"),
    )

    def __repr__(self):
        return f"<WeeklyPlayerPrediction User {self.user_id} W{self.week_number}: East={self.east_player}, West={self.west_player}>"


class League(Base):
    """
    Modèle de ligue privée (Chantier 5).
    Chaque ligue possède un code d'invitation unique à 6 caractères (ex: 'NBA7X9').
    """
    __tablename__ = "leagues"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(6), unique=True, index=True, nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    creator = relationship("User", foreign_keys=[creator_id])
    members = relationship("LeagueMember", back_populates="league", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<League {self.name} ({self.code})>"


class LeagueMember(Base):
    """
    Membre d'une ligue privée.
    Associe un utilisateur à une ligue.
    """
    __tablename__ = "league_members"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at = Column(DateTime, default=utcnow, nullable=False)

    league = relationship("League", back_populates="members")
    user = relationship("User", backref="league_memberships")

    __table_args__ = (
        UniqueConstraint("league_id", "user_id", name="uq_league_member"),
    )

    def __repr__(self):
        return f"<LeagueMember User {self.user_id} in League {self.league_id}>"

