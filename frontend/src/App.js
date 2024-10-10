// frontend/App.js

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [gameState, setGameState] = useState("main_menu");
  const [playerChoice, setPlayerChoice] = useState(null);
  const [opponentChoice, setOpponentChoice] = useState(null);
  const [result, setResult] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [name, setName] = useState("");
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "r", direction: "desc" });
  const [editingName, setEditingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [visibleNotif, setVisibleNotif] = useState(false);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to backend");
      let storedName = localStorage.getItem("playerName");
      if (!storedName) {
        storedName = generateRandomName();
        localStorage.setItem("playerName", storedName);
      }
      setName(storedName);
      newSocket.emit("set_name", { name: storedName });
    });

    newSocket.on("leaderboard_updated", ({ leaderboard }) => setLeaderboard(leaderboard));

    newSocket.on("name_taken", ({ message }) => {
      setNameError(message);
    });

    newSocket.on("name_set", ({ success, message }) => {
      if (success) {
        setEditingName(false);
        setNameError("");
        localStorage.setItem("playerName", name.trim() || generateRandomName());
      } else {
        setNameError(message);
      }
    });

    newSocket.on("match_found", ({ room, opponent }) => {
      setRoomId(room);
      setGameState("running");
      console.log(`Match found in room ${room} against ${opponent}`);
    });

    newSocket.on("lobby", ({ room }) => {
      setRoomId(room);
      setGameState("lobby");
      console.log(`Waiting for an opponent in room ${room}`);
    });

    newSocket.on("game_result", (data) => {
      setPlayerChoice(data.your_move);
      setOpponentChoice(data.opponent_move);
      setResult(data.result);
      setGameState("game_over");
      submitScore();
    });

    newSocket.on("opponent_left", resetGame);
    newSocket.on("error", resetGame);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  useEffect(() => {
    const storedName = localStorage.getItem("playerName");
    if (storedName) {
      setName(storedName);
    }
  }, []);

  useEffect(() => setVisibleNotif(!!nameError), [nameError]);

  const generateRandomName = () => {
    const adjectives = ["Brave", "Clever", "Swift", "Mighty", "Bold"];
    const animals = ["Tiger", "Falcon", "Wolf", "Eagle", "Lion"];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${animals[Math.floor(Math.random() * animals.length)]}-${Math.floor(Math.random() * 9000) + 1000}`;
  };

  const fetchLeaderboard = () => {
    fetch(`${SOCKET_SERVER_URL}/leaderboard`).then((res) => res.json())
      .then((data) => setLeaderboard(data))
      .catch((err) => console.error("Error fetching leaderboard:", err));
  };

  const startGame = (mode) => socket?.emit("find_match", { mode });

  const handleChoice = (choice) => {
    setPlayerChoice(choice);
    if (socket && roomId) {
      socket.emit("make_move", { move: choice, room: roomId });
    }
  };

  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    }
    setSortConfig({ key, direction });
  };

  const sortedLeaderboard = useMemo(() => {
    const sortableItems = [...leaderboard];
    sortableItems.sort((a, b) => {
      if (a[sortConfig.key] < b[sortConfig.key]) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }
      if (a[sortConfig.key] > b[sortConfig.key]) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
    return sortableItems;
  }, [leaderboard, sortConfig]);

  const submitScore = () => {
    const score = result === "You Win!" ? 1 : result === "You Lose!" ? -1 : 0;
    const trimmedName = name.trim() || generateRandomName();
    localStorage.setItem("playerName", trimmedName);
    fetch(`${SOCKET_SERVER_URL}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName, score }),
    }).then((res) => res.json())
      .catch((err) => console.error("Error submitting score:", err));
  };

  const resetGame = () => {
    if (socket) {
      socket.emit("cancel_find_match", { room: roomId, playerId: socket.id });
      console.log("Cancelled match");
    }
    setGameState("main_menu");
  };

  const updateNameInput = (e) => {
    setNameError("");
    const newName = e.target.value;
    setName(newName);
  };

  const handleEditOrSave = () => {
    if (editingName) {
      if (name.trim() === "") {
        setNameError("Name cannot be empty");
        return;
      }
      const trimmedName = name.trim();
      socket.emit("set_name", { name: trimmedName });
    } else {
      setEditingName(true);
    }
  };

  const handleClose = () => {
    setVisibleNotif(false);
    setTimeout(() => setNameError(null), 1000);
  };

  return (
    <div className="app">
      <div className="header_container">
        <div className={editingName ? "" : "text_display"} style={editingName ? {} : { fontSize: "4vh" }}>
          {editingName ? (<input className="text_input" type="text" value={name} onChange={updateNameInput} />) : (name || generateRandomName())}
        </div>
        <button className="button" onClick={handleEditOrSave} disabled={editingName && !!nameError}>
          {editingName ? "Save" : "Edit"}
        </button>
        {nameError && <div className={`notif ${visibleNotif ? 'visible' : ''}`}>
          <button className="close-btn" onClick = { handleClose }>✖</button>
          {nameError}
        </div>}
      </div>

      <div className="main_container">
        {gameState === "main_menu" && (
          <div className="button_container">
            <button className="button" onClick={() => setGameState("menu")}>Rock, Paper, Scissors</button>
          </div>
        )}

        {gameState === "menu" && (
          <div>
            <div className="text_display">Select Mode</div>
            <div className="button_container">
              <button className="button" onClick={() => startGame("ai")}>Versus AI</button>
              <button className="button" onClick={() => startGame("online")}>Versus Player</button>
            </div>
            <div className="button_container">
              <button className="button" onClick={() => setGameState("main_menu")}>Back</button>
            </div>
          </div>
        )}

        {gameState === "lobby" && (
          <div>
            <div className="text_display">Waiting for an opponent...</div>
            <div className="button_container">
              <button className="button" onClick={resetGame}>Cancel</button>
            </div>
          </div>
        )}

        {gameState === "running" && (
          <div>
            <div className="text_display">Choose Your Move</div>
            <div className="button_container">
              <button className="button" onClick={() => handleChoice("Rock")}>Rock</button>
              <button className="button" onClick={() => handleChoice("Paper")}>Paper</button>
              <button className="button" onClick={() => handleChoice("Scissors")}>Scissors</button>
            </div>
          </div>
        )}

        {gameState === "game_over" && (
          <div className="table_header_container">
            <div className="text_display">{playerChoice}/{opponentChoice} = {result}</div>
            <div className="text_display">Leaderboard</div>
            <div className="table_container">
              <table className="leaderboard_table">
                <thead>
                  <tr>
                    <th></th>
                    <th onClick={() => handleSort("r")}>R</th>
                    <th onClick={() => handleSort("w")}>W</th>
                    <th onClick={() => handleSort("d")}>D</th>
                    <th onClick={() => handleSort("l")}>L</th>
                    <th onClick={() => handleSort("n")}>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.map((entry, index) => (
                    <tr key={index}>
                      <td>{index+1}</td>
                      <td>{entry.r.toFixed(0)}</td>
                      <td>{entry.w}</td>
                      <td>{entry.d}</td>
                      <td>{entry.l}</td>
                      <td>{entry.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="button_container" style={{ paddingBottom: "1.5vh" }}>
              <button className="button" onClick={() => setGameState("main_menu")}>Main Menu</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;