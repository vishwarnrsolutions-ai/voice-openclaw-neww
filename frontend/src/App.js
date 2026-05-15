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
  const [status, setStatus] = useState("Backend not connected");
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

    // Auto-start wake listening after the page loads
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

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (error) {
          console.error("Recognition stop error:", error);
        }
      }

      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const socket = new WebSocket("ws://localhost:8081/ws/voice");

    socket.onopen = () => {
      setConnected(true);
      setStatus("Connected to backend. Wake listening will start automatically.");
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Message from backend:", data);

      if (data.type === "status") {
        setStatus(data.message);
      }

      if (data.type === "result") {
        isProcessingRef.current = false;

        setOpenClawReply(data.message);
        setStatus("OpenClaw task completed. You can continue speaking.");
        speak(data.message);
      }

      if (data.type === "error") {
        isProcessingRef.current = false;

        setStatus(data.message);
        speak(data.message);
      }

      if (data.type === "ignored") {
        isProcessingRef.current = false;
        setStatus(data.message);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);

      isProcessingRef.current = false;
      setConnected(false);
      setStatus("WebSocket error. Check backend.");
    };

    socket.onclose = () => {
      console.log("WebSocket closed");

      isProcessingRef.current = false;
      setConnected(false);
      setStatus("Backend disconnected");
    };

    socketRef.current = socket;
  };

  const startRecognitionWatchdog = () => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
    }

    // Check every 5 seconds whether speech recognition is still running
    watchdogRef.current = setInterval(() => {
      if (!wakeModeRef.current) return;
      if (!recognitionRef.current) return;

      if (!isRecognitionRunningRef.current) {
        console.log("Watchdog: recognition is not running. Restarting...");

        try {
          recognitionRef.current.start();
        } catch (error) {
          console.error("Watchdog restart error:", error);
        }
      }
    }, 5000);
  };

  const stopRecognitionWatchdog = () => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const safelyStartRecognition = (delay = 500) => {
    setTimeout(() => {
      if (!wakeModeRef.current) return;
      if (!recognitionRef.current) return;
      if (isRecognitionRunningRef.current) return;

      try {
        recognitionRef.current.start();
        console.log("Speech recognition started or restarted");
      } catch (error) {
        console.error("Recognition start/restart error:", error);
      }
    }, delay);
  };

  const safelyStopRecognition = () => {
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.stop();
    } catch (error) {
      console.error("Recognition stop error:", error);
    }
  };

  const speak = (text) => {
    if (!window.speechSynthesis) {
      alert("Speech synthesis is not supported in this browser.");
      return;
    }

    // Pause recognition while the assistant is speaking
    safelyStopRecognition();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      console.log("TTS finished");

      // Restart wake listening after TTS is completed
      if (wakeModeRef.current) {
        safelyStartRecognition(700);
      }
    };

    utterance.onerror = (error) => {
      console.error("TTS error:", error);

      // Try to restart recognition even if TTS fails
      if (wakeModeRef.current) {
        safelyStartRecognition(700);
      }
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const cleanCommand = (text) => {
    return text.replace(WAKE_WORD, "").trim();
  };

  const isEndPhrase = (text) => {
    return END_PHRASES.some((phrase) => text.includes(phrase));
  };

  const handleRecognizedText = (transcript) => {
    const text = transcript.toLowerCase().trim();

    console.log("Heard:", text);
    setVoiceText(transcript);

    // End the active assistant session
    if (isEndPhrase(text)) {
      assistantActiveRef.current = false;
      setAssistantActive(false);

      isProcessingRef.current = false;

      setStatus("Assistant is sleeping. Say Alex to wake me again.");
      speak("Okay, I will wait for Alex again.");
      return;
    }

    // Wake word detected: activate assistant session
    if (text.includes(WAKE_WORD)) {
      assistantActiveRef.current = true;
      setAssistantActive(true);

      if (isProcessingRef.current) {
        setStatus("Already processing a command. Please wait...");
        return;
      }

      const command = cleanCommand(text);

      if (!command) {
        setStatus("Alex detected. Assistant is active. Please say your command.");
        speak("Yes? What should I do?");
        return;
      }

      setStatus("Alex detected. Sending command to backend...");

      isProcessingRef.current = true;
      sendCommandToBackend(command);
      return;
    }

    // If assistant is active, allow commands without saying Alex again
    if (assistantActiveRef.current) {
      if (isProcessingRef.current) {
        setStatus("Already processing a command. Please wait...");
        return;
      }

      setStatus("Assistant active. Sending command to backend...");

      isProcessingRef.current = true;
      sendCommandToBackend(text);
      return;
    }

    // If assistant is sleeping, ignore commands without wake word
    setStatus("Assistant sleeping. Say Alex to start.");
  };

  const startWakeListening = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech Recognition is not supported. Please use Chrome browser.");
      setStatus("Speech Recognition is not supported. Please use Chrome.");
      return;
    }

    // Do not create a new recognition instance if wake mode is already active
    if (wakeModeRef.current && recognitionRef.current) {
      setStatus("Wake listening is already active.");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isRecognitionRunningRef.current = true;
      wakeModeRef.current = true;

      setWakeMode(true);
      setListening(true);

      if (assistantActiveRef.current) {
        setStatus("Assistant active. You can continue speaking.");
      } else {
        setStatus("Assistant sleeping. Say Alex to start.");
      }

      console.log("Wake listening started");
    };

    recognition.onresult = (event) => {
      const lastResultIndex = event.results.length - 1;
      const transcript = event.results[lastResultIndex][0].transcript;

      handleRecognizedText(transcript);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);

      if (event.error === "no-speech") {
        setStatus("No speech detected. Still listening...");
        return;
      }

      if (event.error === "audio-capture") {
        setStatus("Microphone not found or not working.");
        speak("Microphone not found or not working.");

        wakeModeRef.current = false;
        assistantActiveRef.current = false;
        isRecognitionRunningRef.current = false;

        stopRecognitionWatchdog();

        setWakeMode(false);
        setAssistantActive(false);
        setListening(false);
        return;
      }

      if (event.error === "not-allowed") {
        setStatus("Microphone permission denied. Please allow microphone access.");
        speak("Microphone permission denied.");

        wakeModeRef.current = false;
        assistantActiveRef.current = false;
        isRecognitionRunningRef.current = false;

        stopRecognitionWatchdog();

        setWakeMode(false);
        setAssistantActive(false);
        setListening(false);
        return;
      }

      if (event.error === "aborted") {
        console.log("Recognition aborted intentionally.");
        return;
      }

      setStatus(`Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      console.log("Speech recognition ended");

      isRecognitionRunningRef.current = false;

      if (wakeModeRef.current) {
        safelyStartRecognition(700);
      } else {
        setListening(false);
        setWakeMode(false);
        setStatus("Wake listening stopped");
      }
    };

    recognitionRef.current = recognition;

    wakeModeRef.current = true;
    setWakeMode(true);

    startRecognitionWatchdog();
    safelyStartRecognition(100);
  };

  const stopWakeListening = () => {
    wakeModeRef.current = false;
    assistantActiveRef.current = false;
    isProcessingRef.current = false;

    setWakeMode(false);
    setAssistantActive(false);
    setListening(false);
    setStatus("Wake listening stopped");

    stopRecognitionWatchdog();
    safelyStopRecognition();
  };

  const sendCommandToBackend = (command) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      isProcessingRef.current = false;

      setStatus("Backend is not connected");
      speak("Backend is not connected");
      return;
    }

    console.log("Sending command to backend:", command);

    socketRef.current.send(
      JSON.stringify({
        command: command,
      })
    );

    setStatus("Command sent to backend. Waiting for orchestrate...");
  };

  const testTextCommand = () => {
    if (isProcessingRef.current) {
      setStatus("Already processing a command. Please wait...");
      return;
    }

    const command = "open the google map";

    assistantActiveRef.current = true;
    setAssistantActive(true);

    setVoiceText(`Alex ${command}`);
    isProcessingRef.current = true;

    sendCommandToBackend(command);
  };

  const testEndSession = () => {
    handleRecognizedText("thank you Alex");
  };

  return (
    <div className="page">
      <div className="card">
        <h1>Voice Assistant</h1>

        <p className="subtitle">
          Say <b>Alex</b> once to start. Then continue commands without Alex.
          <br />
          Say <span>"thank you Alex"</span> to stop the active session.
        </p>

        <div className={connected ? "connected" : "disconnected"}>
          {connected ? "Backend Connected" : "Backend Disconnected"}
        </div>

        <div className={wakeMode ? "connected" : "disconnected"}>
          {wakeMode ? "Wake Mode On" : "Wake Mode Off"}
        </div>

        <div className={listening ? "connected" : "disconnected"}>
          {listening ? "Speech Recognition Running" : "Speech Recognition Stopped"}
        </div>

        <div className={assistantActive ? "connected" : "disconnected"}>
          {assistantActive ? "Assistant Active" : "Assistant Sleeping"}
        </div>

        <div className="buttons">
          <button className="stop-btn" onClick={stopWakeListening}>
            Stop Listening
          </button>

          <button className="start-btn" onClick={startWakeListening}>
            Restart Listening
          </button>

          <button className="test-btn" onClick={testTextCommand}>
            Test Command
          </button>

          <button className="test-btn" onClick={testEndSession}>
            Test End Session
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
          <h3>Alex Reply</h3>
          <p>{openClawReply || "No reply yet"}</p>
        </div>
      </div>
    </div>
  );
}

export default App;