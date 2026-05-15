import os
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# React dev server URL
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENCLAW_AGENT = os.getenv("OPENCLAW_AGENT", "main")
OPENCLAW_TIMEOUT = int(os.getenv("OPENCLAW_TIMEOUT", "90"))


@app.get("/")
def home():
    return {
        "message": "FastAPI backend is running",
        "websocket": "/ws/voice"
    }


def create_openclaw_prompt(command: str) -> str:
    return f"""
You are connected to a voice command UI.

User command:
{command}

Use available OpenClaw tools to complete the user's request directly.

If the user asks to open Google Maps, YouTube, Google, a website, or any browser page:
- Use the browser tool to open it directly.
- Do not only provide a link.
- Do not say you cannot open it unless the browser tool is unavailable.

After completing the task, reply with one short user-friendly sentence.
"""


async def call_openclaw(command: str) -> str:
    prompt = create_openclaw_prompt(command)

    process = await asyncio.create_subprocess_exec(
        "openclaw",
        "agent",
        "--agent",
        OPENCLAW_AGENT,
        "--message",
        prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=OPENCLAW_TIMEOUT
        )
    except asyncio.TimeoutError:
        process.kill()
        return "Sorry, OpenClaw took too long to respond."

    output = stdout.decode("utf-8", errors="ignore").strip()
    error = stderr.decode("utf-8", errors="ignore").strip()

    if process.returncode != 0:
        print("OpenClaw error:", error)
        return "Sorry, I could not complete that task using OpenClaw."

    if output:
        return output

    return "Task completed successfully."


@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    await websocket.accept()
    print("Frontend connected")

    try:
        while True:
            data = await websocket.receive_json()
            command = data.get("command", "").strip()

            if not command:
                await websocket.send_json({
                    "type": "error",
                    "message": "No voice command received."
                })
                continue

            print("Voice command:", command)

            await websocket.send_json({
                "type": "status",
                "message": "Command received. Sending to Orchestrate..."
            })

            result = await call_openclaw(command)

            await websocket.send_json({
                "type": "result",
                "command": command,
                "message": result
            })

    except WebSocketDisconnect:
        print("Frontend disconnected")
    except Exception as e:
        print("Backend error:", str(e))
        await websocket.send_json({
            "type": "error",
            "message": "Backend error occurred."
        })