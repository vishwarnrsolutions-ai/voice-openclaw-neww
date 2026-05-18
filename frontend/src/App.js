import { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const WAKE_WORD = "alex";
  const END_PHRASES = [
    "thank you alex",
    "thanks alex",
    "that's all alex",
    "that is all alex",
    "stop alex",
    "bye alex",
    "goodbye alex",
    "sleep alex",
  ];

  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [wakeMode, setWakeMode] = useState(false);
  const [assistantActive, setAssistantActive] = useState(false);
  const [status, setStatus] = useState("Connecting to backend...");
  const [voiceText, setVoiceText] = useState("");
  const [openClawReply, setOpenClawReply] = useState("");

  const socketRef = useRef(null);
  const recognitionRef = useRef(null);
  const wakeModeRef = useRef(false);
  const assistantActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isRecognitionRunningRef = useRef(false);
  const watchdogRef = useRef(null);

  useEffect(() => {
    connectWebSocket();

    const autoStartTimer = setTimeout(() => {
      startWakeListening();
    }, 1000);

    return () => {
      clearTimeout(autoStartTimer);
      stopRecognitionWatchdog();

      wakeModeRef.current = false;
      assistantActiveRef.current = false;
      isProcessingRef.current = false;
      isRecognitionRunningRef.current = false;

      if (recognitionRef.current) recognitionRef.current.stop();
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  const connectWebSocket = () => {
    const socket = new WebSocket("ws://localhost:8081/ws/voice");

    socket.onopen = () => {
      setConnected(true);
      setStatus("Ready. Say Alex to start.");
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Backend message:", data);

      if (data.type === "status") setStatus(data.message);
      if (data.type === "result") {
        isProcessingRef.current = false;
        setOpenClawReply(data.message);
        setStatus("Task completed. You can continue speaking.");
        speak(data.message);
      }
      if (data.type === "error") {
        isProcessingRef.current = false;
        setStatus(data.message);
        speak(data.message);
      }
      if (data.type === "ignored") isProcessingRef.current = false;
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      isProcessingRef.current = false;
      setConnected(false);
      setStatus("Backend connection error.");
    };

    socket.onclose = () => {
      console.log("WebSocket closed");
      isProcessingRef.current = false;
      setConnected(false);
      setStatus("Backend disconnected.");
    };

    socketRef.current = socket;
  };

  const startRecognitionWatchdog = () => {
    if (watchdogRef.current) clearInterval(watchdogRef.current);

    watchdogRef.current = setInterval(() => {
      if (!wakeModeRef.current) return;
      if (!recognitionRef.current) return;
      if (!isRecognitionRunningRef.current) {
        try { recognitionRef.current.start(); } 
        catch (error) { console.error("Watchdog restart error:", error); }
      }
    }, 5000);
  };

  const stopRecognitionWatchdog = () => {
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    watchdogRef.current = null;
  };

  const safelyStartRecognition = (delay = 500) => {
    setTimeout(() => {
      if (!wakeModeRef.current || !recognitionRef.current || isRecognitionRunningRef.current) return;
      try { recognitionRef.current.start(); } 
      catch (error) { console.error("Recognition start/restart error:", error); }
    }, delay);
  };

  const safelyStopRecognition = () => {
    if (!recognitionRef.current) return;
    try { recognitionRef.current.stop(); } 
    catch (error) { console.error("Recognition stop error:", error); }
  };

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    safelyStopRecognition();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => { if (wakeModeRef.current) safelyStartRecognition(700); };
    utterance.onerror = () => { if (wakeModeRef.current) safelyStartRecognition(700); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const cleanCommand = (text) => text.replace(WAKE_WORD, "").trim();
  const isEndPhrase = (text) => END_PHRASES.some((phrase) => text.includes(phrase));

  const handleRecognizedText = (transcript) => {
    const text = transcript.toLowerCase().trim();
    setVoiceText(transcript);

    if (isEndPhrase(text)) {
      assistantActiveRef.current = false;
      setAssistantActive(false);
      isProcessingRef.current = false;
      setStatus("Assistant sleeping. Say Alex to wake me again.");
      speak("Okay, I will wait for Alex again.");
      return;
    }

    if (text.includes(WAKE_WORD)) {
      assistantActiveRef.current = true;
      setAssistantActive(true);
      if (isProcessingRef.current) { setStatus("Already processing a command."); return; }
      const command = cleanCommand(text);
      if (!command) { setStatus("Alex detected. What should I do?"); speak("Yes? What should I do?"); return; }
      setStatus("Alex detected. Sending command to OpenClaw...");
      isProcessingRef.current = true;
      sendCommandToBackend(command);
      return;
    }

    if (assistantActiveRef.current) {
      if (isProcessingRef.current) { setStatus("Already processing a command."); return; }
      setStatus("Assistant active. Sending command to OpenClaw...");
      isProcessingRef.current = true;
      sendCommandToBackend(text);
      return;
    }

    setStatus("Sleeping. Say Alex to start.");
  };

  const startWakeListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatus("Speech Recognition unsupported."); return; }
    if (wakeModeRef.current && recognitionRef.current) { setStatus("Wake listening active."); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isRecognitionRunningRef.current = true;
      wakeModeRef.current = true;
      setWakeMode(true);
      setListening(true);
      setStatus(assistantActiveRef.current ? "Assistant active." : "Sleeping. Say Alex to start.");
    };

    recognition.onresult = (event) => {
      const lastIndex = event.results.length - 1;
      const transcript = event.results[lastIndex][0].transcript;
      handleRecognizedText(transcript);
    };

    recognition.onerror = (event) => {
      console.error("Recognition error:", event.error);
      if (event.error === "no-speech") return;
      if (event.error === "audio-capture" || event.error === "not-allowed") {
        wakeModeRef.current = false; assistantActiveRef.current = false; isRecognitionRunningRef.current = false;
        stopRecognitionWatchdog(); setWakeMode(false); setAssistantActive(false); setListening(false);
      }
    };

    recognition.onend = () => {
      isRecognitionRunningRef.current = false;
      if (wakeModeRef.current) safelyStartRecognition(700);
      else { setListening(false); setWakeMode(false); setStatus("Wake listening stopped."); }
    };

    recognitionRef.current = recognition;
    wakeModeRef.current = true; setWakeMode(true);
    startRecognitionWatchdog();
    safelyStartRecognition(100);
  };

  const sendCommandToBackend = (command) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) { isProcessingRef.current = false; setStatus("Backend not connected."); speak("Backend not connected."); return; }
    socketRef.current.send(JSON.stringify({ command }));
    setStatus("Command sent. Waiting for OpenClaw...");
  };

  return (
    <div className="alexa-page">
      <div className="alexa-shell">
        <header className="alexa-header">
          <div>
            <p className="alexa-eyebrow">OpenClaw Voice Assistant</p>
            <h1>Ask Alex</h1>
            <p className="alexa-subtitle">
              Say <b>Alex</b> to activate. Continue commands naturally.
              Say <b>thank you Alex</b> to end the session.
            </p>
          </div>

          <div className="mini-status-row">
            <span className={`mini-dot ${connected ? "green" : "red"}`} title="Backend"></span>
            <span className={`mini-dot ${wakeMode ? "blue" : "red"}`} title="Wake listener"></span>
            <span className={`mini-dot ${listening ? "green" : "red"}`} title="Speech recognition"></span>
            <span className={`mini-dot ${assistantActive ? "blue" : "gray"}`} title="Assistant session"></span>
          </div>
        </header>

        <main className="alexa-main">
          <div className={`alexa-orb ${assistantActive ? "active" : "sleeping"}`}>
            <div className="orb-wave wave-one"></div>
            <div className="orb-wave wave-two"></div>
            <div className="orb-inner"><span>A</span></div>
          </div>

          <div className="alexa-state">
            <h2>{assistantActive ? "Listening for your command" : "Say 'Alex' to wake me"}</h2>
            <p>{status}</p>
          </div>
        </main>

        <section className="alexa-cards">
          <div className="alexa-card">
            <p className="card-label">Recognized Voice</p>
            <h3>{voiceText || "Waiting..."}</h3>
          </div>
          <div className="alexa-card">
            <p className="card-label">OpenClaw Reply</p>
            <h3>{openClawReply || "No response yet."}</h3>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;