// frontend/App.js

import React, { useState, useEffect, useMemo } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [gameState, setGameState] = useState("main");
  const [name, setName] = useState("");
  const [result, setResult] = useState("");
  const [nameError, setNameError] = useState("");

  const [roomsSortConfig, setRoomsSortConfig] = useState({ key: "room_id", direction: "asc" });
  const [leaderboardSortConfig, setLeaderboardSortConfig] = useState({ key: "r", direction: "desc" });

  const [editingName, setEditingName] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [displayLeaderboard, setDisplayLeaderboard] = useState(false);

  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  const [wins2win, setWins2win] = useState(2);

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

    newSocket.on("game_start", ({ room_id, players }) => {
      setPlayers(players);
      setRoomId(room_id);
      changeGameState("running");
      console.log(`Game started in room ${room_id}`);
    });

    newSocket.on("lobby", ({ room_id }) => {
      setRoomId(room_id);
      changeGameState("lobby");
      console.log(`New room created ${room_id}`);
    });

    newSocket.on("wins2win_updated", ({ wins2win }) => {
      setWins2win(wins2win);
      console.log(`Wins to win updated to ${wins2win}`);
    });

    newSocket.on("game_result", (data) => {
      const { winner, game_over, moves, scores } = data;
      const newRound = { winner: winner, move1: moves[0], move2: moves[1], scores: scores };
      setRounds(prevRounds => [...prevRounds, newRound]);
      setScores(scores);
      if (game_over) {
        console.log(`Game over in room ${roomId}`);
        changeGameState("game_over");
        submitScore();
      } else {
        console.log(`Round result in room ${roomId}: ${result}`);
        setResult(result);
        setSelectedChoice(null);
      }
    });

    newSocket.on("rooms_updated", ({ rooms }) => {
      // Transform rooms to include player info as dictionary
      const transformedRooms = rooms.map(room => ({
        room_id: room.room_id,
        status: room.status,
        wins2win: room.wins2win,
        num_players: Object.keys(room.players).length,
        players: room.players
      }));
      setRooms(transformedRooms);
      console.log("Rooms updated:", transformedRooms);
    });

    newSocket.on("player_left", ({ player }) => {
      console.log(`Player ${player} has left the room.`);
      // Optionally, update the players list in the lobby
      setPlayers(prevPlayers => prevPlayers.filter(p => p !== player));
    });

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

  const generateRandomName = () => {
    const adjectives = ["Brave", "Clever", "Swift", "Mighty", "Bold"];
    const animals = ["Tiger", "Falcon", "Wolf", "Eagle", "Lion"];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${animals[Math.floor(Math.random() * animals.length)]}-${Math.floor(Math.random() * 9000) + 1000}`;
  };

  const startGame = (mode) => {
    setRounds([]);
    setScores([]);
    socket?.emit("create_room", { mode, wins2win });
  };

  const handleChoice = (choice) => {
    setSelectedChoice(choice);
    setIsReady(true);
    console.log(`Player ${name} selected ${choice}`);
    socket.emit("player_ready", { room: roomId, status: "ready" });
    console.log(`socket: ${socket}, roomId: ${roomId}`);

    if (socket && roomId) {
      console.log(`Player ${name} made a move: ${choice}`);
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
      .then((data) => {
        if (data.message) {
          console.log(data.message);
        }
      })
      .catch((err) => console.error("Error submitting score:", err));
  };

  const quitGame = () => {
    if (socket && roomId) {
      socket.emit("quit_game", { room: roomId });
      console.log(`Player ${socket.id} left room ${roomId}`);
      setRoomId(null);
    }
    setIsReady(false);
    setGameState("main");
    setRounds([]); // Clear rounds on quit
    setSelectedChoice(null); // Reset the selected choice on quit
    setWins2win(2);
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

  const joinRoom = (room_id) => {
    if (socket) {
      socket.emit("join_room", { room: room_id });
      setRoomId(room_id);
      setWins2win(rooms.find(room => room.room_id === room_id).wins2win);
      changeGameState("lobby");
      console.log(`Joined room ${room_id}`);
    } else {
      console.error("Socket not ready yet, unable to join room.");
    }
  };

  const changeGameState = (newState) => {
    if (["lobby", "running"].includes(gameState) && !["lobby", "running"].includes(newState)) {
      quitGame();
    }
    setGameState(newState);
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

  const toggleLeaderboard = () => setDisplayLeaderboard(prev => !prev);

  const handleReady = () => {
    if (socket && roomId) {
      const newStatus = !isReady;
      setIsReady(newStatus);
      socket.emit("player_ready", { room: roomId, status: newStatus ? "ready" : "waiting" });
      console.log(`Player ${name} is ${newStatus ? "ready" : "waiting"} in room ${roomId}`);
    }
  };

  const handleWins2win = (e) => {
    if (socket && roomId) {
      const newWins2win = Math.max(1, Math.min(5, wins2win + e));
      setWins2win(newWins2win);
      socket.emit("update_wins2win", { room: roomId, wins2win: newWins2win });
      console.log(`Wins to win updated to ${newWins2win}`);
    }
  }

  return (
    <div className="app">
      <div className="header_container">
        <div className="button_container">
          <button className="button" onClick={toggleLeaderboard}>🏆</button>
          <div className={editingName ? "" : "text_display"} style={editingName ? {} : { fontSize: "3vh" }}>
            {editingName ? (<input className="text_input" type="text" value={name} onChange={updateNameInput} />) : (name)}
          </div>
          <button className="button" onClick={handleEditOrSave} disabled={editingName && !!nameError}>
            {editingName ? "✔️" : "✏️"}
          </button>
          {/* <div className="text_display" style={{fontSize:"2vh"}}>{gameState}</div> */}
        </div>
      </div>

      {displayLeaderboard && (<div className="main_container">
        <div className="table_menu_container">
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
                    <td className={entry.n === name ? "highlighted_text" : ""}>{index + 1}</td>
                    <td className={entry.n === name ? "highlighted_text" : ""}>{entry.r.toFixed(0)}</td>
                    <td className={entry.n === name ? "highlighted_text" : ""}>{entry.w}</td>
                    <td className={entry.n === name ? "highlighted_text" : ""}>{entry.d}</td>
                    <td className={entry.n === name ? "highlighted_text" : ""}>{entry.l}</td>
                    <td className={entry.n === name ? "highlighted_text" : ""}>{entry.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>)}

      {nameError || displayLeaderboard ? (<div className="text_display">{nameError}</div>) : (<div className="main_container">

        {gameState === "main" && (<div className="button_container">
          <button className="button" onClick={() => changeGameState("menu")}>✊✋✌️</button>
        </div>)}

        {gameState === "menu" && (<div>
          <div className="text_display">Select Mode</div>
          <div className="button_container">
            <button className="button" onClick={() => startGame("ai")}>Versus AI</button>
            <button className="button" onClick={() => startGame("online")}>Versus Player</button>
          </div>
        </div>)}

        {gameState === "lobby" && (<div className="table_menu_container">
          <div className="text_display">Others Rooms</div>
          <div className="table_container">
            <table className="rooms_table">
              <thead>
                <tr>
                  <th>R</th>
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
                      <td>{room.wins2win}</td>
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
          <div className="text_display">Wins to Win:</div>
          <div className="button_container">
            <button className="button" disabled={wins2win <= 1}
              onClick={() => handleWins2win(-1)}>-1</button>
            <div className="text_display">{wins2win}</div>
            <button className="button" disabled={wins2win >= 5}
              onClick={() => handleWins2win(1)}>+1</button>
          </div>
        </div>)}

        {gameState === "running" && (<div>
          <div className="text_display">Choose Your Move</div>
          <div className="button_container">
            <button
              className={selectedChoice === "Rock" ? "highlighted_button" : "button"}
              onClick={() => handleChoice("Rock")}>✊</button>
            <button
              className={selectedChoice === "Paper" ? "highlighted_button" : "button"}
              onClick={() => handleChoice("Paper")}>✋</button>
            <button
              className={selectedChoice === "Scissors" ? "highlighted_button" : "button"}
              onClick={() => handleChoice("Scissors")}>✌️</button>
          </div>
          <div className="text_display">Game History</div>
          <div className="table_container">
            <table className="rounds_table">
              <thead>
                <tr>
                  <th>R</th>
                  <th>{players[0]}</th>
                  <th>{players[1]}</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{round.move1 === "Rock" ? "✊" : round.move1 === "Paper" ? "✋" : "✌️"}</td>
                    <td>{round.move2 === "Rock" ? "✊" : round.move2 === "Paper" ? "✋" : "✌️"}</td>
                    <td className={round.winner === name ? "win" : "lose"}>{round.winner}</td>
                  </tr>
                ))}
                <tr>
                  <td></td>
                  <td className={scores[0] === Math.max(...scores) ? "win" : scores[0] === Math.min(...scores) ? "lose" : ""}>{scores[0]}</td>
                  <td className={scores[1] === Math.max(...scores) ? "win" : scores[1] === Math.min(...scores) ? "lose" : ""}>{scores[1]}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>)}

        {gameState === "game_over" && (<div className="table_menu_container">
          <div className="text_display">Final Results</div>
          <div className="table_container">
            <table className="rounds_table">
              <thead>
                <tr>
                  <th>R</th>
                  <th>{players[0]}</th>
                  <th>{players[1]}</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{round.move1 === "Rock" ? "✊" : round.move1 === "Paper" ? "✋" : "✌️"}</td>
                    <td>{round.move2 === "Rock" ? "✊" : round.move2 === "Paper" ? "✋" : "✌️"}</td>
                    <td className={round.winner === name ? "win" : "lose"}>{round.winner}</td>
                  </tr>
                ))}
                <tr>
                  <td></td>
                  <td className={scores[0] === Math.max(...scores) ? "win" : scores[0] === Math.min(...scores) ? "lose" : ""}>{scores[0]}</td>
                  <td className={scores[1] === Math.max(...scores) ? "win" : scores[1] === Math.min(...scores) ? "lose" : ""}>{scores[1]}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>)}

      </div>)}

      {!displayLeaderboard && (<div className="footer_container">

        {gameState === "menu" && (<div className="button_container">
          <button className="button" onClick={() => changeGameState("main")}>Back</button>
        </div>)}

        {gameState === "lobby" && (<div className="button_container">
          <button className="button" onClick={quitGame}>Quit</button>
          <ul className="player_list">
            {rooms.find(room => room.room_id === roomId)?.players && Object.entries(rooms.find(room => room.room_id === roomId).players).map(([player, info], index) => (
              <li key={index}>{info.status === "ready" ? "🟢" : "🔴"} {player}</li>
            ))}
          </ul>
          <button className="button" onClick={handleReady}>{isReady ? "Wait" : "Ready"}</button>
        </div>)}

        {gameState === "running" && (<div className="button_container">
          <button className="button" onClick={() => changeGameState("main")}>Quit</button>
          <ul className="player_list">
            {rooms.find(room => room.room_id === roomId)?.players && Object.entries(rooms.find(room => room.room_id === roomId).players).map(([player, info], index) => (
              <li key={index}>{info.played ? "🟢" : "🔴"} {player}</li>
            ))}
          </ul>
        </div>)}

        {gameState === "game_over" && (<div className="button_container">
          <button className="button" onClick={quitGame}>Main Menu</button>
        </div>)}

      </div>)}
    </div>
  );
}

export default App;