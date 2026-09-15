from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import secrets

from database import get_db
from models import User, League, LeagueMember
from schemas import (
    LeagueCreate,
    LeagueJoin,
    LeagueDetailResponse,
    LeagueSummaryResponse,
    LeagueMemberResponse
)
from auth import get_current_user

router = APIRouter(prefix="/api/leagues", tags=["Leagues"])

# Caractères clairs et lisibles pour les codes d'invitation à 6 caractères (sans confusion O/0 ou I/1)
LEAGUE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_unique_league_code(db: Session) -> str:
    """Génère un code d'invitation unique à 6 caractères alphanumériques."""
    for _ in range(100):
        code = "".join(secrets.choice(LEAGUE_CODE_CHARS) for _ in range(6))
        if not db.query(League).filter(League.code == code).first():
            return code
    raise HTTPException(status_code=500, detail="Impossible de générer un code de ligue unique.")


def build_league_detail(league: League, current_user: User) -> LeagueDetailResponse:
    """Construit la réponse détaillée d'une ligue avec son classement interne ordonné."""
    # Récupérer tous les membres avec leurs utilisateurs triés par total_points décroissant
    members_data = []
    for m in league.members:
        u = m.user
        preds = u.predictions
        won_count = sum(1 for p in preds if p.points_won > 0)
        members_data.append({
            "member": m,
            "user": u,
            "points": u.total_points,
            "preds_count": len(preds),
            "won_count": won_count
        })

    # Tri par points décroissants, puis par id de membre (ordre d'adhésion)
    members_data.sort(key=lambda x: (x["points"], -x["member"].id), reverse=True)

    ranked_members: List[LeagueMemberResponse] = []
    user_rank = None

    for rank_idx, item in enumerate(members_data, start=1):
        u = item["user"]
        m = item["member"]
        if u.id == current_user.id:
            user_rank = rank_idx

        ranked_members.append(LeagueMemberResponse(
            user_id=u.id,
            username=u.username,
            total_points=u.total_points,
            rank=rank_idx,
            joined_at=m.joined_at,
            is_creator=(u.id == league.creator_id),
            predictions_count=item["preds_count"],
            won_count=item["won_count"]
        ))

    return LeagueDetailResponse(
        id=league.id,
        name=league.name,
        code=league.code,
        creator_id=league.creator_id,
        creator_username=league.creator.username if league.creator else "Inconnu",
        created_at=league.created_at,
        members_count=len(ranked_members),
        user_rank=user_rank,
        members=ranked_members
    )


@router.post("", response_model=LeagueDetailResponse, status_code=status.HTTP_201_CREATED)
def create_league(
    payload: LeagueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Crée une nouvelle ligue privée et génère un code d'invitation unique à 6 caractères.
    Le créateur est automatiquement inscrit comme premier membre.
    """
    clean_name = payload.name.strip()
    if len(clean_name) < 3:
        raise HTTPException(status_code=400, detail="Le nom de la ligue doit comporter au moins 3 caractères.")

    code = generate_unique_league_code(db)

    new_league = League(
        name=clean_name,
        code=code,
        creator_id=current_user.id
    )
    db.add(new_league)
    db.flush()

    # Inscrire automatiquement le créateur
    membership = LeagueMember(
        league_id=new_league.id,
        user_id=current_user.id
    )
    db.add(membership)
    db.commit()
    db.refresh(new_league)

    return build_league_detail(new_league, current_user)


@router.post("/join", response_model=LeagueDetailResponse)
def join_league(
    payload: LeagueJoin,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Rejoint une ligue privée existante à l'aide de son code d'invitation à 6 caractères.
    """
    clean_code = payload.code.strip().upper()
    if len(clean_code) != 6:
        raise HTTPException(status_code=400, detail="Le code de ligue doit comporter exactement 6 caractères.")

    league = db.query(League).filter(League.code == clean_code).first()
    if not league:
        raise HTTPException(status_code=404, detail="Aucune ligue trouvée avec ce code d'invitation.")

    # Vérifier si l'utilisateur est déjà membre
    existing = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Vous êtes déjà membre de cette ligue.")

    new_member = LeagueMember(
        league_id=league.id,
        user_id=current_user.id
    )
    db.add(new_member)
    db.commit()
    db.refresh(league)

    return build_league_detail(league, current_user)


@router.get("/my", response_model=List[LeagueSummaryResponse])
def get_my_leagues(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Renvoie la liste des ligues dont l'utilisateur actuel est membre,
    avec le nombre de participants et son rang dans chacune.
    """
    memberships = db.query(LeagueMember).filter(LeagueMember.user_id == current_user.id).all()
    summaries = []

    for m in memberships:
        league = m.league
        if not league:
            continue

        # Calcul rapide du rang de l'utilisateur dans cette ligue
        all_members = league.members
        sorted_members = sorted(
            all_members,
            key=lambda x: (x.user.total_points if x.user else 0, -x.id),
            reverse=True
        )

        user_rank = None
        for idx, sm in enumerate(sorted_members, start=1):
            if sm.user_id == current_user.id:
                user_rank = idx
                break

        summaries.append(LeagueSummaryResponse(
            id=league.id,
            name=league.name,
            code=league.code,
            creator_id=league.creator_id,
            creator_username=league.creator.username if league.creator else "Inconnu",
            members_count=len(all_members),
            user_rank=user_rank,
            created_at=league.created_at
        ))

    # Tri : ligues les plus récemment rejointes en premier
    summaries.sort(key=lambda x: x.created_at, reverse=True)
    return summaries


@router.get("/{league_id}", response_model=LeagueDetailResponse)
def get_league_detail(
    league_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Renvoie les détails complets d'une ligue et son classement interne actualisé.
    L'utilisateur doit être membre de la ligue pour y accéder.
    """
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    # Vérifier l'appartenance à la ligue
    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()

    if not membership:
        raise HTTPException(status_code=403, detail="Vous devez rejoindre cette ligue pour consulter son classement.")

    return build_league_detail(league, current_user)


@router.post("/{league_id}/leave")
def leave_league(
    league_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Permet à un membre de quitter une ligue privée.
    Si le créateur quitte et qu'il est le seul membre, la ligue est dissoute.
    """
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()

    if not membership:
        raise HTTPException(status_code=400, detail="Vous n'êtes pas membre de cette ligue.")

    # Si créateur et d'autres membres existent, transférer au plus ancien membre
    if league.creator_id == current_user.id:
        other_members = [m for m in league.members if m.user_id != current_user.id]
        if other_members:
            # Transférer le créateur au membre suivant
            other_members.sort(key=lambda x: x.joined_at)
            league.creator_id = other_members[0].user_id
        else:
            # Dernier membre restant : suppression de la ligue
            db.delete(league)
            db.commit()
            return {"message": "La ligue a été dissoute car vous étiez le seul membre restant."}

    db.delete(membership)
    db.commit()
    return {"message": f"Vous avez quitté la ligue '{league.name}'."}
