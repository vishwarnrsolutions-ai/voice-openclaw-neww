import { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Backend not connected");
  const [voiceText, setVoiceText] = useState("");
  const [openClawReply, setOpenClawReply] = useState("");

  const socketRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const socket = new WebSocket("ws://localhost:8081/ws/voice");

    socket.onopen = () => {
      setConnected(true);
      setStatus("Connected to backend");
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Message from backend:", data);

      if (data.type === "status") {
        setStatus(data.message);
      }

      if (data.type === "result") {
        setOpenClawReply(data.message);
        setStatus("OpenClaw task completed");
        speak(data.message);
      }

      if (data.type === "error") {
        setStatus(data.message);
        speak(data.message);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setConnected(false);
      setStatus("WebSocket error. Check backend.");
    };

    socket.onclose = () => {
      console.log("WebSocket closed");
      setConnected(false);
      setStatus("Backend disconnected");
    };

    socketRef.current = socket;
  };

  const speak = (text) => {
    if (!window.speechSynthesis) {
      alert("Speech synthesis is not supported in this browser.");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const startVoiceRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech Recognition is not supported. Please use Chrome browser.");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setListening(true);
      setStatus("Listening...");
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;

      setVoiceText(text);
      setStatus("Voice recognized. Sending to backend...");

      sendCommandToBackend(text);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setListening(false);
      setStatus(`Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopVoiceRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setListening(false);
    setStatus("Voice recognition stopped");
  };

  const sendCommandToBackend = (command) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setStatus("Backend is not connected");
      speak("Backend is not connected");
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        command: command,
      })
    );
  };

  const testTextCommand = () => {
    const command = "Say hello in one sentence";
    setVoiceText(command);
    sendCommandToBackend(command);
  };

  return (
    <div className="page">
      <div className="card">
        <h1>Voice OpenClaw Assistant</h1>

        <p className="subtitle">
          Click <b>Start Voice</b> and say: <br />
          <span>"open the google map"</span>
        </p>

        <div className={connected ? "connected" : "disconnected"}>
          {connected ? "Backend Connected" : "Backend Disconnected"}
        </div>

        <div className="buttons">
          <button
            className="start-btn"
            onClick={startVoiceRecognition}
            disabled={listening}
          >
            {listening ? "Listening..." : "Start Voice"}
          </button>

          <button className="stop-btn" onClick={stopVoiceRecognition}>
            Stop
          </button>

          <button className="test-btn" onClick={testTextCommand}>
            Test Text
          </button>
        </div>

        <div className="box">
          <h3>Status</h3>
          <p>{status}</p>
        </div>

        <div className="box">
          <h3>Recognized Voice Text</h3>
          <p>{voiceText || "No voice command yet"}</p>
        </div>

        <div className="box">
          <h3>OpenClaw Reply</h3>
          <p>{openClawReply || "No reply yet"}</p>
        </div>
      </div>
    </div>
  );
}

export default App;