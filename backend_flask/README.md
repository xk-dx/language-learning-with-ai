# WordForge Flask AI proxy

This small Flask service exposes a minimal OpenAI-compatible text proxy and a connectivity test endpoint.

Files:
- `app.py` - Flask app with endpoints:
  - `GET /api/config` — return configured `OPENAI_BASE_URL` and `DEFAULT_MODEL` (does not return API key)
  - `POST /api/text-proxy` — forward a `prompt` to the provider and return the raw provider response
  - `POST /api/test-connection` — run a single test prompt against the provider to verify connectivity

Setup

1. Create a Python virtualenv and install requirements:

```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` and fill `OPENAI_API_KEY` and `OPENAI_BASE_URL` (e.g. DeepSeek or OpenAI compatible endpoint). If your provider expects a different path, set `OPENAI_BASE_URL` accordingly (should usually include `/v1`).

3. Run the service:

```bash
python app.py
```

Quick tests

- Check config:

```bash
curl http://localhost:5001/api/config
```

- Test connectivity (will attempt one provider call):

```bash
curl -X POST http://localhost:5001/api/test-connection -H 'Content-Type: application/json' -d '{"prompt":"Hello from test"}'
```

- Proxy a chat completion:

```bash
curl -X POST http://localhost:5001/api/text-proxy -H 'Content-Type: application/json' -d '{"prompt":"请给我一句关于旅行的简单句子，中文"}'
```

Notes

- This service forwards requests to the configured provider using the `chat/completions` endpoint. Some providers (or DeepSeek) may require different paths or model names — adjust `OPENAI_BASE_URL` and `DEFAULT_MODEL` in `.env` accordingly.
- Do NOT commit secrets. Keep `.env` out of version control.

If you want, provide me the `OPENAI_API_KEY` and `OPENAI_BASE_URL` here and I can run a connectivity test for you; alternatively run the `curl` tests locally and paste the output if you want me to interpret results.
