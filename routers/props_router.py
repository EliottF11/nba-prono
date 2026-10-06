from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone

from database import get_db
import models
import schemas
from routers.auth_router import get_current_user

router = APIRouter(prefix="/api/props", tags=["Props"])

@router.get("/", response_model=List[schemas.PropBetResponse])
def get_pending_props(db: Session = Depends(get_db)):
    """
    Retourne les Prop Bets en cours (statut 'pending').
    Sert à afficher les cartes de pronostics sur les joueurs.
    """
    props = db.query(models.PropBet).filter(models.PropBet.status == "pending").all()
    return props

@router.post("/{prop_id}/predict", response_model=schemas.PropPredictionResponse)
def predict_prop(
    prop_id: int,
    prediction: schemas.PropPredictionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Soumettre ou mettre à jour un choix ('over' ou 'under') sur un Prop Bet.
    """
    prop_bet = db.query(models.PropBet).filter(models.PropBet.id == prop_id).first()
    if not prop_bet:
        raise HTTPException(status_code=404, detail="Prop Bet introuvable")
    
    if prop_bet.status != "pending":
        raise HTTPException(status_code=400, detail="Ce Prop Bet est déjà résolu ou annulé")

    # Vérifier si l'utilisateur a déjà voté
    existing_pred = db.query(models.PropPrediction).filter(
        models.PropPrediction.user_id == current_user.id,
        models.PropPrediction.prop_id == prop_id
    ).first()

    if existing_pred:
        existing_pred.choice = prediction.choice
        db.commit()
        db.refresh(existing_pred)
        return existing_pred
    else:
        new_pred = models.PropPrediction(
            user_id=current_user.id,
            prop_id=prop_id,
            choice=prediction.choice
        )
        db.add(new_pred)
        db.commit()
        db.refresh(new_pred)
        return new_pred
