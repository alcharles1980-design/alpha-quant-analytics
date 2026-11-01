"""Tiny HTTP helpers shared by the scripts (retry on rate limits / server errors). Keys come from the environment; never printed."""
import os, time
from zoneinfo import ZoneInfo
import requests

ET = ZoneInfo('America/New_York')
AH = lambda: {'APCA-API-KEY-ID': os.environ['APCA_API_KEY_ID'], 'APCA-API-SECRET-KEY': os.environ['APCA_API_SECRET_KEY']}


def get(url, params=None, headers=None, tries=8):
    for k in range(tries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (k + 1)); continue
            return r
        except requests.RequestException:
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f'GET failed after {tries} tries: {url}')
