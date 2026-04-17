import asyncio
import json
import logging
import base64
import io
from datetime import datetime
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image as PILImage

from ui_image_designer import ui_image_agent, _get_and_clear_session_images, _cleanup_session_images

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="UI Designer API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions: dict = {}
executor = ThreadPoolExecutor(max_workers=4)
MAX_SESSION_MESSAGES = 100

NODE_PROGRESS = {
    "chatbot": 10,
    "document_processor": 20,
    "prompt_enhancer": 35,
    "image_generator": 90,
    "completion": 100,
}

NODE_STATUS_MESSAGES = {
    "chatbot": "🧠 Understanding your request...",
    "document_processor": "📄 Analysing document structure and requirements...",
    "prompt_enhancer": "🎨 Building locked design system and page prompts...",
    "image_generator": "✨ Generating high-fidelity UI screens...",
    "completion": "✅ Finalising your designs...",
}


class AgentUpdate(BaseModel):
    type: str
    node_name: Optional[str] = None
    message: Optional[str] = None
    data: Optional[dict] = None
    timestamp: str = ""


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket):
        if session_id in self.active_connections:
            try:
                self.active_connections[session_id].remove(websocket)
            except ValueError:
                pass

    async def broadcast(self, session_id: str, message: AgentUpdate):
        if session_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_json(message.model_dump())
                except Exception as exc:
                    logger.error("Broadcast error: %s", exc)
                    disconnected.append(connection)
            for conn in disconnected:
                try:
                    self.active_connections[session_id].remove(conn)
                except ValueError:
                    pass


manager = ConnectionManager()


def _extract_pdf_text(file_bytes: bytes) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)
    except ImportError:
        pass
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        return "\n".join(page.extract_text() for page in reader.pages)
    except ImportError:
        logger.warning("No PDF reader available. Install pdfplumber or PyPDF2")
        return "[PDF content — install pdfplumber or PyPDF2 to extract text]"
    except Exception as e:
        logger.error("PDF extraction error: %s", e)
        return ""


def _extract_docx_text(file_bytes: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs)
    except ImportError:
        pass
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            root = ET.fromstring(z.read("word/document.xml"))
        paragraphs = []
        for para in root.findall(".//w:p", ns):
            texts = [t.text for t in para.findall(".//w:t", ns) if t.text]
            if texts:
                paragraphs.append("".join(texts))
        return "\n".join(paragraphs)
    except Exception as e:
        logger.error("DOCX extraction error: %s", e)
        return ""


def _extract_image_base64(file_bytes: bytes) -> str:
    try:
        img = PILImage.open(io.BytesIO(file_bytes))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as e:
        logger.error("Image processing error: %s", e)
        return ""


def run_ui_agent_async(initial_state: dict):
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def agent_worker():
        try:
            for event in ui_image_agent.stream(initial_state, {"recursion_limit": 30}):
                asyncio.run_coroutine_threadsafe(queue.put(event), loop)
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)
        except Exception as exc:
            logger.error("UI agent error: %s", exc)
            asyncio.run_coroutine_threadsafe(queue.put({"error": str(exc)}), loop)
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)

    executor.submit(agent_worker)

    async def generator():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event

    return generator()


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Handle PDF / DOCX / image uploads for UI generation."""
    try:
        file_bytes = await file.read()
        filename = (file.filename or "").lower()
        result: dict = {"filename": file.filename, "size": len(file_bytes), "type": "unknown"}

        if filename.endswith(".pdf"):
            text = _extract_pdf_text(file_bytes)
            result.update({"type": "pdf", "text": text, "char_count": len(text)})
        elif filename.endswith(".docx"):
            text = _extract_docx_text(file_bytes)
            result.update({"type": "docx", "text": text, "char_count": len(text)})
        elif filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
            b64 = _extract_image_base64(file_bytes)
            result.update({"type": "image", "base64": b64, "note": "Used as reference for style matching"})
        else:
            return {"error": "Unsupported file type. Use PDF, DOCX, PNG, JPG, or WEBP."}, 400

        logger.info("Processed upload: %s (%s)", result["filename"], result["type"])
        return result
    except Exception as e:
        logger.error("Upload error: %s", e)
        return {"error": str(e)}, 500


@app.websocket("/ws-ui/{session_id}")
async def websocket_ui_designer(websocket: WebSocket, session_id: str):
    await manager.connect(websocket, session_id)

    if session_id not in sessions:
        sessions[session_id] = {
            "status": "idle",
            "current_node": None,
            "progress": 0,
            "messages": [],
            "created_at": datetime.now().isoformat(),
            "last_image_path": "",
            "ui_images": [],
            "design_brief": None,
            "reference_image_base64": None,
        }

    sent_image_ids: set = set()

    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            user_message = message_data.get("message", "").strip()
            reference_image = message_data.get("reference_image")

            if not user_message:
                await websocket.send_json({"type": "error", "message": "Message cannot be empty"})
                continue

            sessions[session_id]["messages"].append({
                "role": "user",
                "content": user_message,
                "timestamp": datetime.now().isoformat(),
            })
            sessions[session_id]["messages"] = sessions[session_id]["messages"][-MAX_SESSION_MESSAGES:]

            if reference_image:
                sessions[session_id]["reference_image_base64"] = reference_image

            sessions[session_id]["status"] = "running"
            sessions[session_id]["progress"] = 0
            sent_image_ids.clear()

            initial_state = {
                "user_prompt": user_message,
                "session_id": session_id,
                "last_image_path": sessions[session_id].get("last_image_path", ""),
                "design_brief": sessions[session_id].get("design_brief"),
                "reference_image_base64": sessions[session_id].get("reference_image_base64"),
                "chat_history": sessions[session_id].get("messages", []),
                "ui_images": sessions[session_id].get("ui_images", []),
            }

            node_sequence: list = []
            final_state: dict = {}

            async for event in run_ui_agent_async(initial_state):
                if event is None:
                    break

                if not isinstance(event, dict):
                    continue

                if "error" in event:
                    await manager.broadcast(session_id, AgentUpdate(
                        type="error",
                        message=event["error"],
                        timestamp=datetime.now().isoformat(),
                    ))
                    continue

                for node_name, node_output in event.items():
                    if node_name == "__start__":
                        continue

                    node_sequence.append(node_name)
                    sessions[session_id]["current_node"] = node_name
                    sessions[session_id]["progress"] = NODE_PROGRESS.get(
                        node_name,
                        min(95, int(100 * len(node_sequence) / 6)),
                    )

                    if isinstance(node_output, dict):
                        final_state.update(node_output)

                    status_msg = NODE_STATUS_MESSAGES.get(node_name, f"Processing {node_name}...")
                    await manager.broadcast(session_id, AgentUpdate(
                        type="node_start",
                        node_name=node_name,
                        message=status_msg,
                        data={"progress": sessions[session_id]["progress"]},
                        timestamp=datetime.now().isoformat(),
                    ))

                    if isinstance(node_output, dict):
                        if node_name == "image_generator":
                            # Stream images as soon as they are ready
                            new_images = _get_and_clear_session_images(session_id)
                            if new_images:
                                new_unsent = [img for img in new_images if img.get("id") not in sent_image_ids]
                                if new_unsent:
                                    sent_image_ids.update(img["id"] for img in new_unsent if img.get("id"))
                                    await manager.broadcast(session_id, AgentUpdate(
                                        type="ui_images",
                                        data={"images": new_unsent},
                                        timestamp=datetime.now().isoformat(),
                                    ))
                        else:
                            await manager.broadcast(session_id, AgentUpdate(
                                type="node_end",
                                node_name=node_name,
                                data={**node_output, "progress": sessions[session_id]["progress"]},
                                timestamp=datetime.now().isoformat(),
                            ))

            # Persist session state
            if final_state.get("design_brief"):
                sessions[session_id]["design_brief"] = final_state["design_brief"]
            if final_state.get("last_image_path"):
                sessions[session_id]["last_image_path"] = final_state["last_image_path"]

            # Fallback: send images if streaming missed them
            if final_state.get("ui_images"):
                # Accumulate images across turns and replace older versions by page.
                existing_by_page = {
                    str(img.get("page_name", "")).strip().lower(): img
                    for img in sessions[session_id].get("ui_images", [])
                    if img.get("page_name")
                }
                for img in final_state["ui_images"]:
                    page_key = str(img.get("page_name", "")).strip().lower()
                    if page_key:
                        existing_by_page[page_key] = img

                sessions[session_id]["ui_images"] = list(existing_by_page.values())
                unsent = [img for img in final_state["ui_images"] if img.get("id") not in sent_image_ids]
                if unsent:
                    await manager.broadcast(session_id, AgentUpdate(
                        type="ui_images",
                        data={
                            "images": unsent,
                            "final_spec": final_state.get("final_spec", {}),
                            "consistency_rules": final_state.get("consistency_rules", []),
                        },
                        timestamp=datetime.now().isoformat(),
                    ))

            # Final completion message
            assistant_message = final_state.get("chatbot_response", "")
            if assistant_message:
                sessions[session_id]["messages"].append({
                    "role": "assistant",
                    "content": assistant_message,
                    "timestamp": datetime.now().isoformat(),
                })
                sessions[session_id]["messages"] = sessions[session_id]["messages"][-MAX_SESSION_MESSAGES:]

            await manager.broadcast(session_id, AgentUpdate(
                type="message",
                message=assistant_message,
                data={"completion": True, "progress": 100},
                timestamp=datetime.now().isoformat(),
            ))

            sessions[session_id]["status"] = "completed"
            sessions[session_id]["progress"] = 100
            _cleanup_session_images(session_id)

    except WebSocketDisconnect:
        manager.disconnect(session_id, websocket)
        _cleanup_session_images(session_id)
        logger.info("Client disconnected from session %s", session_id)
    except Exception as exc:
        logger.error("WebSocket error in session %s: %s", session_id, exc)
        _cleanup_session_images(session_id)
        await manager.broadcast(session_id, AgentUpdate(
            type="error",
            message=f"Connection error: {str(exc)}",
            timestamp=datetime.now().isoformat(),
        ))
        manager.disconnect(session_id, websocket)


ui_designs_path = Path(__file__).resolve().parent / "ui_designs"
ui_designs_path.mkdir(parents=True, exist_ok=True)
app.mount("/ui_designs", StaticFiles(directory=str(ui_designs_path), html=True), name="ui_designs")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")