# UI Designer Backend

## Setup

1. Create a virtual environment and activate it.
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and set `GOOGLE_API_KEY`.
4. Run:
   ```
   python app.py
   ```

WebSocket endpoint: ws://localhost:8000/ws-ui/{session_id}
Static images: http://localhost:8000/ui_designs/
