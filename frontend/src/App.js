// frontend/App.js

import React, { useState, useEffect, useMemo, useRef } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [gameState, setGameState] = useState("main");
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const nameRef = useRef(name);
  const [nameError, setNameError] = useState("");

  const [roomsSortConfig, setRoomsSortConfig] = useState({ key: "room_id", direction: "asc" });
  const [leaderboardSortConfig, setLeaderboardSortConfig] = useState({ key: "r", direction: "desc" });

  const [editingName, setEditingName] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [displayLeaderboard, setDisplayLeaderboard] = useState(false);
  const [displayOthersRooms, setDisplayOthersRooms] = useState(true);
  const [displaySettings, setDisplaySettings] = useState(false);

  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [avatar, setAvatar] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);
  const [avatarList, setAvatarList] = useState([]);

  const [wins2win, setWins2win] = useState(2);
  const [roomRank, setRoomRank] = useState(0);

  const colors = ["#0AF", "#F00"]
  
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL, {
      transports: ["websocket"], // Force WebSocket transport
      reconnectionAttempts: 5,    // Optional: Limit reconnection attempts
    });
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

    newSocket.on("name_taken", () => {
      setNameError("Someone is using this name right now");
      setEditingName(true);
    });

    newSocket.on("name_set", ({ d }) => {
      setEditingName(false);
      setAvatar(d.avatar);
      const trimmedName = nameRef.current.trim();
      localStorage.setItem("playerName", trimmedName);
      console.log("Name set successfully with avatar:", d.avatar);
    });

    newSocket.on("avatar_set", ({ d }) => {
      setAvatar(d.avatar);
      console.log(`Avatar successfully updated to: ${d.avatar}`);
    });

    fetch(`${SOCKET_SERVER_URL}/avatars/batch`)
      .then(response => response.json())
      .then(d => {
        if (d.avatar_list) {
          setAvatarList(Object.entries(d.avatar_list));
        } else {
          console.error("Failed to fetch batch avatars:", d.error);
        }
      })
      .catch(err => {
        console.error("Error fetching batch avatars:", err);
      }
    );

    newSocket.on("leaderboard_updated", ({ leaderboard }) => setLeaderboard(leaderboard));

    newSocket.on("room_created", ({ d }) => {
      setRoomId(d.room_id);
      setPlayers(d.players);
      changeGameState("lobby");
      console.log(`New room created: ${d.room_id}`);
    });

    newSocket.on("room_joined", ({ d }) => {
      setRoomId(d.room_id);
      setPlayers(d.players);
      changeGameState("lobby");
      console.log(`New player in room ${d.room_id}`);
    });

    newSocket.on("wins2win_updated", ({ d }) => {
      setWins2win(d.wins2win);
      console.log(`Wins to win updated to ${d.wins2win}`);
    });

    newSocket.on("game_start", ({ d }) => {
      setRoomId(d.room_id);
      setPlayers(d.players);
      changeGameState("running");
      console.log(`Game started in room ${d.room_id}`);
    });

    newSocket.on("player_left", ({ d }) => {
      if (d.player === name) {
        console.log(`You left the room.`);
      } else {
        console.log(`Player ${d.player} has left the room.`);
        setPlayers(d.players);
      }
    });

    newSocket.on("game_result", ({ d }) => {
      const newRound = {winner: d.winner, move1: d.moves[0], move2: d.moves[1], scores: d.scores};
      setRounds(prevRounds => [...prevRounds, newRound]);
      setScores(d.scores);
      if (d.game_over) {
        console.log(`Game over in room ${roomId}`);
        changeGameState("game_over");
      } else {
        console.log(`Round winner: ${d.winner} in room: ${d.roomId}`);
        setSelectedChoice(null);
      }
    });

    newSocket.on("rooms_updated", ({ d }) => {
      const transformedRooms = d.rooms.map(r => ({
        room_id: r.room_id, status: r.status, wins2win: r.wins2win, nb: r.nb, players: r.players
      }));
      setRooms(transformedRooms);
      console.log("Rooms updated:", transformedRooms);
    });

    newSocket.on("error", quitGame);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    const rank = players.map(p => p.name).indexOf(name);
    setRoomRank(rank !== -1 ? rank : 0);
  }, [players, name]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socket) {
        socket.disconnect();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (socket) {
        socket.disconnect();
      }
    };
  }, [socket]);

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
    const img = new Image();
    img.src = `${SOCKET_SERVER_URL}/avatars/${avatar}`;
  }, [avatar]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

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

  const quitGame = () => {
    if (socket && roomId) {
      socket.emit("quit_game", { room: roomId });
      console.log(`Player ${socket.id} left room ${roomId}`);
      setRoomId(null);
    }
    setRounds([]);
    setPlayers([]);
    setWins2win(2);
    setIsReady(false);
    setSelectedChoice(null);
    setGameState("main");
  };

  const handleEditingName = () => {
    if (editingName) {
      setEditingName(false);
      if (newName.trim() === "") {
        setNameError("Name cannot be empty");
        return;
      }
      const trimmedNewName = newName.trim();
      setName(trimmedNewName);
      // The ref will be updated via useEffect
      localStorage.setItem("playerName", trimmedNewName);
      socket.emit("edit_name", { new_name: trimmedNewName });
      console.log(`Name updated to: ${trimmedNewName}`);
      setNewName("");
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

  const toggleSettings = () => {
    if (editingName) {
      setEditingName(false);
    }
    setDisplaySettings(prev => !prev);
  };

  const handleEditingAvatar = (newAvatar) => {
    if (editingAvatar) {
      setAvatar(newAvatar);
      setEditingAvatar(false);
      socket.emit("set_avatar", { avatar: newAvatar });
      console.log(`Avatar changed to: ${newAvatar}`);
    }
  };

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
      socket.emit("update_wins2win", { room: roomId, wins2win: newWins2win });
    }
  }

  const renderRoomTable = () => {
    return (
      <div className="table_container">
        <table className="rounds_table">
          <thead>
            <tr>
              <th>R</th>
              <th>
                <div className="circle_wrapper" style={{ margin: "0.4vh 0.2vh 0.4vh 0", border: `2px solid ${colors[0]}` }}>
                  <img src={`${SOCKET_SERVER_URL}/avatars/${players[0].avatar}`} className="avatar" />
                </div>
              </th>
              <th>
                <div className="circle_wrapper" style={{ margin: "0.4vh 0.2vh 0.4vh 0", border: `2px solid ${colors[1]}` }}>
                  <img src={`${SOCKET_SERVER_URL}/avatars/${players[1].avatar}`} className="avatar" />
                </div>
              </th>
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
    );
  }

  return (
    <div className="app">
      <div className="header_container">
        <div className="button_container">
          {!displayLeaderboard && !displaySettings && gameState != "main" &&
            <button className="button" onClick={() => setDisplayLeaderboard(prev => !prev)}>🏆</button>}
          {avatar && (<div className="circle_wrapper" style={{ marginLeft: "0.8vh", border: `2px solid ${colors[roomRank]}` }}>
            <img src={`${SOCKET_SERVER_URL}/avatars/${avatar}`} className="avatar" />
          </div>)}
          <div className="text_display" style={{ fontSize: "2vh" }}>{name}</div>
          {!displayLeaderboard && !displaySettings && !["lobby", "running"].includes(gameState) &&
            <button className="button" onClick={toggleSettings}>⚙️</button>}
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

      {displaySettings && !editingAvatar && (<div className="main_container">
        <div>
          <div className="text_display">Settings</div>
          <div className="button_container">
            <div className={editingName ? "" : "text_display"}>
              {editingName ? (<input className="text_input" type="text" placeholder="Enter name..."
                onChange={(e) => setNewName(e.target.value)}/>) : (name)}
            </div>
            <button className="button" onClick={handleEditingName}
              disabled={name === newName}>{editingName ? "✔️" : "✏️"}</button>
          </div>
          <div className="button_container">
            <div className="circle_wrapper" style={{ marginRight: "1vh", border: `2px solid ${colors[roomRank]}` }}>
              <img src={`${SOCKET_SERVER_URL}/avatars/${avatar}`} className="avatar" />
            </div>
            <button className="button" onClick={() => setEditingAvatar(true)}>✏️</button>
          </div>
        </div>
      </div>)}

      {editingAvatar && (<div className="main_container">
        <div>
          <div className="text_display">Select an Avatar</div>
          <div className="button_container">
            {avatarList.map(([avatarName, avatarDataURI], index) => (
              <div key={index} className="circle_wrapper" onClick={() => handleEditingAvatar(avatarName)}
                style={avatarName === avatar ? { border: `2px solid ${colors[roomRank]}` } : {}}>
                <img className="avatar" src={avatarDataURI} alt={avatarName} />
              </div>
            ))}
          </div>
        </div>
      </div>)}

      {!name ? (<div className="main_container">
        <div className="text_display">Loading...</div>
      </div>) : nameError || displayLeaderboard || displaySettings ? (<div className="text_display">{nameError}</div>) : (<div className="main_container">

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
          {displayOthersRooms && (<div>
            <div className="text_display">Others Rooms</div>
            <div className="table_container">
              <table className="rooms_table">
                <thead>
                  <tr>
                    <th>R</th>
                    <th onClick={() => handleSort("status", "rooms")}>S</th>
                    <th onClick={() => handleSort("nb", "rooms")}>nb</th>
                    <th>Players</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRooms.filter(r => {
                    return r.players && !Object.keys(r.players).includes(name);
                  }).length > 0 ? (
                      sortedRooms.filter(r => r.players && !Object.keys(r.players).includes(name)).map((r) => (
                        <tr key={r.room_id}>
                          <td>{r.wins2win}</td>
                          <td>{r.status === "running" ? "🟢" : "🔴"}</td>
                          <td>{r.nb}/2</td>
                          <td>
                            <ul className="player_list">
                              {Object.entries(r.players).map(([playerName, { status }], index) => (  // Iterate over entries
                                <li key={index}>
                                  {status === "ready" ? "🟢" : "🔴"} {playerName}
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            {r.status === "waiting" && (
                              <button className="button" onClick={() => joinRoom(r.room_id)}>Go</button>
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
          </div>)}
          <div className="button_container">
            <button className="button" onClick={() => setDisplayOthersRooms(prev => !prev)}>
              {displayOthersRooms ? "Hide Others Rooms" : "Show Others Rooms"}
            </button>
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
          <div className="text_display">Game History</div>{renderRoomTable()}
        </div>)}

        {gameState === "game_over" && (<div className="table_menu_container">
          <div className="text_display">Final Results</div>{renderRoomTable()}
        </div>)}

      </div>)}

      {displayLeaderboard ? (<div className="footer_container">
        <div className="button_container">
          <button className="button" onClick={() => setDisplayLeaderboard(prev => !prev)}>Back</button>
        </div>
      </div>) : displaySettings && !editingAvatar ? (<div className="footer_container">
        <div className="button_container">
          <button className="button" onClick={toggleSettings}>Back</button>
        </div>
      </div>) : editingAvatar ? (<div className="footer_container">
        <div className="button_container">
              <button className="button" onClick={() => setEditingAvatar(false)}>Back</button>
        </div>
      </div>) : (<div className="footer_container">

        {gameState === "menu" && (<div className="button_container">
          <button className="button" onClick={() => changeGameState("main")}>Back</button>
        </div>)}

        {gameState === "lobby" && (<div className="button_container">
          <button className="button" onClick={quitGame}>Quit</button>
          <ul className="player_list">
            {rooms.find(r => r.room_id === roomId)?.players && Object.entries(rooms.find(r => r.room_id === roomId).players).map(([player, info], index) => (
              <li key={index}>{info.status === "ready" ? "🟢" : "🔴"} {player}</li>
            ))}
          </ul>
          <button className="button" onClick={handleReady}>{isReady ? "Wait" : "Ready"}</button>
        </div>)}

        {gameState === "running" && (<div className="button_container">
          <button className="button" onClick={() => changeGameState("main")}>Quit</button>
          <ul className="player_list">
            {rooms.find(r => r.room_id === roomId)?.players && Object.entries(rooms.find(r => r.room_id === roomId).players).map(([player, info], index) => (
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