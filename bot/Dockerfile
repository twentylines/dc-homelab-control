FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && addgroup -g 1000 bot && adduser -D -u 1000 -G bot bot
COPY homelab_bot ./homelab_bot
COPY legacy_healthcheck.py /usr/local/bin/node
RUN chmod 755 /usr/local/bin/node && python -m compileall -q /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER bot
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/healthz', timeout=3).read()"
CMD ["python", "-m", "homelab_bot.main"]
