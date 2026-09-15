"""
Module de sécurité et d'authentification.
- Hachage de mot de passe avec sel aléatoire (PBKDF2-HMAC-SHA256, standard sécurisé sans dépendances compilées C).
- Signature et vérification de jetons de session (Tokens signés par HMAC-SHA256).
- Dépendance FastAPI pour récupérer l'utilisateur courant.
"""
import os
import hmac
import hashlib
import base64
import json
import time
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db
from models import User

from dotenv import load_dotenv

# Chargement du fichier .env
load_dotenv()

# Clé secrète pour signer les jetons (sécurisée dans .env)
SECRET_KEY = os.getenv("SECRET_KEY", "nba-prono-super-secret-key-change-in-prod")
ALGORITHM = "HS256"
TOKEN_EXPIRE_SECONDS = 60 * 60 * 24 * 7  # 7 jours

security = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    """Hache un mot de passe en clair avec un sel cryptographique de 16 octets."""
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    # Format stocké : salt_hex$key_hex
    return f"{salt.hex()}${key.hex()}"

def verify_password(password: str, hashed_password: str) -> bool:
    """Vérifie si un mot de passe correspond au hash stocké en temps constant."""
    try:
        salt_hex, key_hex = hashed_password.split("$")
        salt = bytes.fromhex(salt_hex)
        expected_key = bytes.fromhex(key_hex)
        actual_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return hmac.compare_digest(actual_key, expected_key)
    except Exception:
        return False

def create_access_token(user_id: int, username: str) -> str:
    """Génère un jeton signé infalsifiable contenant l'id utilisateur et son expiration."""
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": int(time.time()) + TOKEN_EXPIRE_SECONDS
    }
    payload_json = json.dumps(payload, separators=(',', ':')).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")
    
    # Signature HMAC-SHA256
    signature = hmac.new(SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
    
    return f"{payload_b64}.{sig_b64}"

def decode_access_token(token: str) -> Optional[dict]:
    """Valide la signature du jeton et retourne le contenu si valide et non expiré."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, sig_b64 = parts
        
        # Vérification de signature
        expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
        expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode("utf-8").rstrip("=")
        
        if not hmac.compare_digest(sig_b64, expected_sig_b64):
            return None
            
        # Décodage avec padding base64
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
        
        # Vérification expiration
        if payload.get("exp", 0) < time.time():
            return None
            
        return payload
    except Exception:
        return None

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Dépendance FastAPI injectant l'utilisateur connecté à partir du header 'Authorization: Bearer <token>'.
    Lève une exception 401 si le token est manquant, invalide ou expiré.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session non trouvée ou non authentifiée",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Jeton de session invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    user = db.query(User).filter(User.id == payload.get("user_id")).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utilisateur introuvable",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
