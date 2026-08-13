# Silnik Multibota na VPS/NAS: docker build -t multibot-engine engine/
#   docker run -d -p 8700:8700 -v multibot-data:/data multibot-engine
# Harness/UI laczy sie przez ENGINE_URL=http://<host>:8700 (zero spawnu).
# xvfb: sesje przegladarek botow sa headed (take-over), bez X pada
# "The platform failed to initialize".
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git xvfb \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# hermes-agent: tylko editable (backend budowy odrzuca wheel/sdist)
RUN git clone --filter=blob:none https://github.com/NousResearch/hermes-agent /opt/hermes-agent \
 && git -C /opt/hermes-agent checkout 17688f9 \
 && pip install --no-cache-dir -e /opt/hermes-agent
RUN python -m playwright install chromium --with-deps
COPY server ./server
ENV SLAFY_DATA_DIR=/data HERMES_HOME=/data
VOLUME /data
EXPOSE 8700
CMD ["xvfb-run", "--auto-servernum", "python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8700"]
