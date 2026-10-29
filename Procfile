web: MALLOC_ARENA_MAX=2 gunicorn main:app -w 1 -k uvicorn.workers.UvicornWorker --max-requests 500 --max-requests-jitter 50 --timeout 60 --bind 0.0.0.0:$PORT
