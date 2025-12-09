import os
import time
import threading
from datetime import datetime, timedelta
from flask import Flask, request
import requests

app = Flask(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
API_KEY = os.getenv("SUPABASE_ANON_KEY", "")

ultima_actividad = datetime.now()

headers = {
    "apikey": API_KEY,
    "Authorization": f"Bearer {API_KEY}",
}

def ping_supabase():
    if not SUPABASE_URL or not API_KEY:
        return
    try:
        requests.get(SUPABASE_URL, headers=headers, timeout=10)
    except Exception:
        pass

@app.after_request
def add_cors_headers(resp):
    origin = os.getenv("ALLOWED_ORIGIN", "*")
    resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp

@app.route("/actividad", methods=["POST", "GET", "OPTIONS"])
def registrar_actividad():
    global ultima_actividad
    if request.method in ("POST", "GET"):
        ultima_actividad = datetime.now()
        return "OK"
    return ("", 204)

def logica_keepalive():
    while True:
        delta = datetime.now() - ultima_actividad
        if delta < timedelta(hours=1):
            ping_supabase(); time.sleep(600)
        elif delta < timedelta(days=1):
            ping_supabase(); time.sleep(14400)
        elif delta < timedelta(days=3):
            ping_supabase(); time.sleep(43200)
        else:
            ping_supabase(); time.sleep(86400)

threading.Thread(target=logica_keepalive, daemon=True).start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
