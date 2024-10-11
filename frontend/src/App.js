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
  const [rooms, setRooms] = useState([]);

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

    newSocket.on("name_set", () => {
      setEditingName(false);
      localStorage.setItem("playerName", name.trim());
    });

    newSocket.on("match_found", ({ room }) => {
      setRoomId(room);
      changeGameState("running");
      console.log(`Match found in room ${room}`);
    });

    newSocket.on("lobby", ({ room }) => {
      setRoomId(room);
      changeGameState("lobby");
      console.log(`New room created ${room}`);
    });

    newSocket.on("game_result", (data) => {
      setPlayerChoice(data.your_move);
      setOpponentChoice(data.opponent_move);
      setResult(data.result);
      changeGameState("game_over");
      submitScore();
    });

    newSocket.on("rooms_updated", ({ rooms }) => {
      setRooms(rooms);
      console.log("Rooms updated:", rooms);
    });

    newSocket.on("opponent_left", quitGame);
    newSocket.on("error", quitGame);

    return () => {
      newSocket.disconnect();
    };
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

  const startGame = (mode) => socket?.emit("create_room", { mode });

  const handleChoice = (choice) => {
    setPlayerChoice(choice);
    if (socket && roomId) {
      socket.emit("make_move", { room: roomId, move: choice });
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
    const trimmedName = name.trim();
    localStorage.setItem("playerName", trimmedName);
    fetch(`${SOCKET_SERVER_URL}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName, score }),
    }).then((res) => res.json())
      .catch((err) => console.error("Error submitting score:", err));
  };

  const quitGame = () => {
    if (socket && roomId) {
      socket.emit("quit_game", { room: roomId });
      console.log(`Player ${socket.id} left room ${roomId}`);
      setRoomId(null);
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

  const joinRoom = (roomId) => {
    socket.emit("join_room", { room: roomId });
    setRoomId(roomId);
    changeGameState("running");
    console.log(`Joined room ${roomId}`);
  };

  const changeGameState = (newState) => {
    if (["lobby", "running"].includes(gameState) && !["lobby", "running"].includes(newState)) {
      quitGame();
    } else if (!["lobby", "running"].includes(gameState) && newState === "lobby") {
      console.log("Entering lobby or running state.");
    }
    setGameState(newState);
  };

  return (
    <div className="app">
      <div className="header_container">
        <div className={editingName ? "" : "text_display"} style={editingName ? {} : { fontSize: "4vh" }}>
          {editingName ? (<input className="text_input" type="text" value={name} onChange={updateNameInput} />) : (name)}
        </div>
        <button className="button" onClick={handleEditOrSave} disabled={editingName && !!nameError}>
          {editingName ? "Save" : "Edit"}
        </button>
      </div>

      {nameError ? (<div className="text_display">{nameError}</div>) : (
        <div className="main_container">
          {gameState === "main_menu" && (
            <div className="button_container">
              <button className="button" onClick={() => changeGameState("menu")}>Rock, Paper, Scissors</button>
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
                <button className="button" onClick={() => changeGameState("main_menu")}>Back</button>
              </div>
            </div>
          )}

          {gameState === "lobby" && (
            <div className="table_menu_container">
              <div className="text_display">Available Rooms</div>
              <div className="table_container">
                <table className="rooms_table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>S</th>
                      <th>nb</th>
                      <th>Players</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.filter(room => {
                      return room.players && !room.players.includes(name);
                    }).length > 0 ? (
                          rooms.filter(room => room.players && !room.players.includes(name)).map((room) => (
                        <tr key={room.room_id}>
                          <td>{room.room_id.substring(0, 3)}...</td>
                          <td>{room.status === "waiting" ? "🟢" : "🔴"}</td>
                          <td>{room.num_players}/2</td>
                          <td>
                            <ul className="player_list">
                              {room.players.map((player, index) => (
                                <li key={index}>{player}</li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            <button className="button" onClick={() => joinRoom(room.room_id)} disabled={room.status !== "waiting"}>
                              Join
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (<tr><td colSpan="5">No available rooms.</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div className="button_container" style={{ paddingBottom: "3vh" }}>
                <button className="button" onClick={quitGame}>Back</button>
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
            <div className="table_menu_container">
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
                        <td>{index + 1}</td>
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
              <div className="button_container" style={{ paddingBottom: "3vh" }}>
                <button className="button" onClick={() => changeGameState("main_menu")}>Main Menu</button>
              </div>
            </div>
          )}
        </div>
      )}

      {gameState === "lobby" && roomId && (
        <div className="footer_container">
          <div className="button_container">
            <button className="button" onClick={quitGame}>Quit</button>
            <ul className="player_list">
              {rooms.find(room => room.room_id === roomId)?.players.map((player, index) => (
                <li key={index}>{player}</li>
              ))}
            </ul>
            <button className="button">Ready</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;