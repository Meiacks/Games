// frontend/App.js

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [gameState, setGameState] = useState("main");
  const [playerChoice, setPlayerChoice] = useState(null);
  const [opponentChoice, setOpponentChoice] = useState(null);
  const [result, setResult] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [name, setName] = useState("");
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [leaderboardSortConfig, setLeaderboardSortConfig] = useState({ key: "r", direction: "desc" });
  const [roomsSortConfig, setRoomsSortConfig] = useState({ key: "room_id", direction: "asc" });
  const [editingName, setEditingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [visibleNotif, setVisibleNotif] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

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

    newSocket.on("name_taken", ({ message }) => {
      setNameError(message);
      setEditingName(true);
    });

    newSocket.on("name_set", () => {
      setEditingName(false);
      localStorage.setItem("playerName", name.trim());
    });

    newSocket.on("leaderboard_updated", ({ leaderboard }) => setLeaderboard(leaderboard));

    newSocket.on("match_found", ({ room }) => {
      setRoomId(room);
      changeGameState("running");
      console.log(`Match found in room ${room}`);
    });

    newSocket.on("game_start", ({ room }) => {
      changeGameState("running");
      console.log(`Game started in room ${room}`);
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

    // Inside your rooms_updated handler
    newSocket.on("rooms_updated", ({ rooms }) => {
      // Transform rooms to include player info as dictionary
      const transformedRooms = rooms.map(room => ({
        room_id: room.room_id,
        status: room.status,
        num_players: Object.keys(room.players).length,
        players: room.players
      }));
      setRooms(transformedRooms);
      console.log("Rooms updated:", transformedRooms);
    });

    newSocket.on("opponent_left", quitGame);
    newSocket.on("error", quitGame);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromURL = urlParams.get('room');

    if (roomFromURL) {
      const handleJoinRoomFromURL = () => {
        setRoomId(roomFromURL);
        changeGameState("lobby"); // Ensure the game state is set to "lobby"
        socket.emit("join_room", { room: roomFromURL });
        console.log(`Auto-joining room from URL: ${roomFromURL}`);

        // Clean up the URL after joining
        const newURL = window.location.origin;
        window.history.replaceState({}, document.title, newURL);
      };

      if (socket) {
        // If socket is already connected, join the room immediately
        if (socket.connected) {
          handleJoinRoomFromURL();
        } else {
          // Wait for socket connection if it's not yet connected
          socket.on("connect", () => {
            handleJoinRoomFromURL();
          });
        }
      }
    }
  }, [socket]); // Depend on the 'socket' variable

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
    setIsPlayerReady(true);
    socket.emit("player_ready", { room: roomId, status: "ready" });
    if (socket && roomId) {
      socket.emit("make_move", { room: roomId, move: choice });
    }
  };

  const handleSort = (key, table) => {
    let direction = "desc";

    if (table === "leaderboard") {
      if (leaderboardSortConfig.key === key && leaderboardSortConfig.direction === "desc") {
        direction = "asc";
      }
      setLeaderboardSortConfig({ key, direction });
    } else if (table === "rooms") {
      if (roomsSortConfig.key === key && roomsSortConfig.direction === "desc") {
        direction = "asc";
      }
      setRoomsSortConfig({ key, direction });
    }
  };

  const sortedLeaderboard = useMemo(() => {
    const sortableItems = [...leaderboard];
    sortableItems.sort((a, b) => {
      if (a[leaderboardSortConfig.key] < b[leaderboardSortConfig.key]) {
        return leaderboardSortConfig.direction === "asc" ? -1 : 1;
      }
      if (a[leaderboardSortConfig.key] > b[leaderboardSortConfig.key]) {
        return leaderboardSortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
    return sortableItems;
  }, [leaderboard, leaderboardSortConfig]);

  const sortedRooms = useMemo(() => {
    const sortableRooms = [...rooms];
    sortableRooms.sort((a, b) => {
      if (a[roomsSortConfig.key] < b[roomsSortConfig.key]) {
        return roomsSortConfig.direction === "asc" ? -1 : 1;
      }
      if (a[roomsSortConfig.key] > b[roomsSortConfig.key]) {
        return roomsSortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
    return sortableRooms;
  }, [rooms, roomsSortConfig]);

  const submitScore = () => {
    const score = result === "Win!" ? 1 : result === "Lose!" ? -1 : 0;
    const trimmedName = name.trim();
    localStorage.setItem("playerName", trimmedName);
    fetch(`${SOCKET_SERVER_URL}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName, score }),
    })
      .then((res) => res.json())
      .catch((err) => console.error("Error submitting score:", err));
  };

  const quitGame = () => {
    if (socket && roomId) {
      socket.emit("quit_game", { room: roomId });
      console.log(`Player ${socket.id} left room ${roomId}`);
      setRoomId(null);
    }
    setIsPlayerReady(false);
    setGameState("main");
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
    if (socket) {
      socket.emit("join_room", { room: roomId });
      setRoomId(roomId);
      changeGameState("lobby");
      console.log(`Joined room ${roomId}`);
    } else {
      console.error("Socket not ready yet, unable to join room.");
    }
  };

  const changeGameState = (newState) => {
    if (["lobby", "running"].includes(gameState) && !["lobby", "running"].includes(newState)) {
      quitGame();
    } else if (!["lobby", "running"].includes(gameState) && newState === "lobby") {
      console.log("Entering lobby or running state.");
    }
    setGameState(newState);
  };

  const handleReady = () => {
    if (socket && roomId) {
      const newStatus = !isPlayerReady;
      setIsPlayerReady(newStatus);
      socket.emit("player_ready", { room: roomId, status: newStatus ? "ready" : "waiting" });
      console.log(`Player ${name} is ${newStatus ? "ready" : "waiting"} in room ${roomId}`);
    }
  };

  const fallbackCopyTextToClipboard = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";  // Prevent scroll jump
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand("copy") ? alert("URL copied!") : alert("Failed to copy.");
    } catch {
      alert("Failed to copy. Please try manually.");
    }

    document.body.removeChild(textArea);
  };

  const handleCopyURL = (url) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => alert("URL copied to clipboard!"))
        .catch(() => alert("Failed to copy URL. Please try manually."));
    } else {
      fallbackCopyTextToClipboard(url);
    }
  };

  return (
    <div className="app">
      <div className="header_container">
        <div className="button_container">
          <div className={editingName ? "" : "text_display"} style={editingName ? {} : { fontSize: "3vh" }}>
            {editingName ? (<input className="text_input" type="text" value={name} onChange={updateNameInput} />) : (name)}
          </div>
          <button className="button" onClick={handleEditOrSave} disabled={editingName && !!nameError}>
            {editingName ? "Save" : "Edit"}
          </button>
          <div className="text_display" style={{fontSize:"2vh"}}>{gameState}</div>
        </div>
      </div>

      {nameError ? (<div className="text_display">{nameError}</div>) : (
        <div className="main_container">
          {gameState === "main" && (
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
            </div>
          )}

          {gameState === "lobby" && (
            <div className="table_menu_container">
              <div className="text_display">Available Rooms</div>
              <div className="table_container">
                <table className="rooms_table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort("room_id", "rooms")}>Room</th>
                      <th onClick={() => handleSort("status", "rooms")}>S</th>
                      <th onClick={() => handleSort("num_players", "rooms")}>nb</th>
                      <th>Players</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRooms.filter(room => {
                      return room.players && !Object.keys(room.players).includes(name);
                    }).length > 0 ? (
                      sortedRooms.filter(room => room.players && !Object.keys(room.players).includes(name)).map((room) => (
                        <tr key={room.room_id}>
                          <td>{room.room_id.substring(0, 3)}...</td>
                          <td>{room.status === "running" ? "🟢" : "🔴"}</td>
                          <td>{room.num_players}/2</td>
                          <td>
                            <ul className="player_list">
                              {Object.keys(room.players).map((player, index) => (
                                <li key={index}>
                                  {room.players[player].status === "ready" ? "🟢" : "🔴"} {player}
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            {room.status == "waiting" && (
                              <button className="button" onClick={() => joinRoom(room.room_id)}>Go</button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5">No available rooms.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="text_display">Share Link:</div>
              <div className="button_container">
                <input type="text" readOnly className="text_input"
                  value={`${window.location.origin}/?room=${roomId}`}
                  onFocus={(e) => e.target.select()}/>
                <button className="button" onClick={() => handleCopyURL(`${window.location.origin}/?room=${roomId}`)}>
                  Copy
                </button>
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
                      <th onClick={() => handleSort("r", "leaderboard")}>R</th>
                      <th onClick={() => handleSort("w", "leaderboard")}>W</th>
                      <th onClick={() => handleSort("d", "leaderboard")}>D</th>
                      <th onClick={() => handleSort("l", "leaderboard")}>L</th>
                      <th onClick={() => handleSort("n", "leaderboard")}>Name</th>
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
            </div>
          )}
        </div>
      )}

      {gameState === "menu" && (
        <div className="footer_container">
          <div className="button_container">
            <button className="button" onClick={() => changeGameState("main")}>Back</button>
          </div>
        </div>
      )}

      {gameState === "lobby" && roomId && (
        <div className="footer_container">
          <div className="button_container">
            <button className="button" onClick={quitGame}>Quit</button>
            <ul className="player_list">
              {rooms.find(room => room.room_id === roomId)?.players && Object.entries(rooms.find(room => room.room_id === roomId).players).map(([player, info], index) => (
                <li key={index}>
                  {info.status === "ready" ? "🟢" : "🔴"} {player}
                </li>
              ))}
            </ul>
            <button className="button" onClick={handleReady}>{isPlayerReady ? "Wait" : "Ready"}</button>
          </div>
        </div>
      )}

      {gameState === "running" && (
        <div className="footer_container">
          <div className="button_container">
            <button className="button" onClick={() => changeGameState("main")}>Quit</button>
            <ul className="player_list">
              {rooms.find(room => room.room_id === roomId)?.players && Object.entries(rooms.find(room => room.room_id === roomId).players).map(([player, info], index) => (
                <li key={index}>
                  {info.status === "ready" ? "🟢" : "🔴"} {player}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {gameState === "game_over" && (
        <div className="footer_container">
          <div className="button_container">
            <button className="button" onClick={quitGame}>Main Menu</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;