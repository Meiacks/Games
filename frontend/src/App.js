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

  const [roomsSortConfig, setRoomsSortConfig] = useState({ key: "rid", direction: "asc" });
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

  const [avatarList, setAvatarList] = useState({});

  const [wins2win, setWins2win] = useState(2);
  const [roomSize, setRoomSize] = useState(2);
  const [roomRank, setRoomRank] = useState(0);

  const colors = ["#0AF", "#F00", "#0C3", "#DD0", "#B0D"]
  
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
      .then(r => r.json())
      .then(d => {setAvatarList(d.avatar_list)})
      .catch(e => {console.error("Error fetching batch avatars:", e)});

    newSocket.on("players_updated", ({ d }) => setLeaderboard(d.players));

    newSocket.on("room_created", ({ d }) => {
      setRoomId(d.rid);
      setPlayers(d.players);
      changeGameState("lobby");
      console.log(`New room created: ${d.rid}`);
    });

    newSocket.on("room_joined", ({ d }) => {
      setRoomId(d.rid);
      setPlayers(d.players);
      changeGameState("lobby");
      console.log(`New player in room ${d.rid}`);
    });

    newSocket.on("room_updated", ({ d }) => {
      if (d.wins2win !== undefined) {
        setWins2win(d.wins2win);
        console.log(`Wins to win updated to ${d.wins2win}`);
      }
      if (d.rsize !== undefined) {
        setRoomSize(d.rsize);
        console.log(`Room size updated to ${d.rsize}`);
      }
    });

    newSocket.on("game_start", ({ d }) => {
      setRoomId(d.rid);
      setPlayers(d.players);
      changeGameState("running");
      console.log(`Game started in room ${d.rid}`);
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
      setRounds(d.rounds);
      if (d.game_over) {
        console.log(`Game over in room ${roomId}`);
        changeGameState("game_over");
      } else {
        console.log(`Round winner: ${d.winner} in room: ${roomId}`);
        setSelectedChoice(null);
      }
    });

    newSocket.on("rooms_updated", ({ d }) => {
      const transformedRooms = d.rooms.map(r => ({
        rid: r.rid, status: r.status, wins2win: r.wins2win, rsize: r.rsize, nb: r.nb, players: r.players
      }));
      setRooms(transformedRooms);
      console.log("Rooms updated:", transformedRooms);
    });

    newSocket.on("error", (e) => {
      console.error("Socket Error:", e.message || e);
      alert(`Error: ${e.message || "An unexpected error occurred."}`);
      quitGame();
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

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
    const rank = players.map(p => p.name).indexOf(name);
    setRoomRank(rank !== -1 ? rank : 0);
  }, [players, name]);

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
    nameRef.current = name;
  }, [name]);

  const generateRandomName = () => {
    const adjectives = ["Brave", "Clever", "Swift", "Mighty", "Bold"];
    const animals = ["Tiger", "Falcon", "Wolf", "Eagle", "Lion"];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${animals[Math.floor(Math.random() * animals.length)]}-${Math.floor(Math.random() * 9000) + 1000}`;
  };

  const startGame = (mode) => {
    setRounds([]);
    socket?.emit("create_room", { mode, wins2win, roomSize });
  };

  const handleChoice = (choice) => {
    setSelectedChoice(choice);
    setIsReady(true);
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
    setRoomSize(2);
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
      if (/^ai\d+$/i.test(newName.trim())) {
        setNameError("Name cannot be AI");
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

  const joinRoom = (rid) => {
    if (socket) {
      socket.emit("join_room", { room: rid });
      setRoomId(rid);
      const room = rooms.find(r => r.rid === rid);
      if (room) {
        setWins2win(room.wins2win);
        setRoomSize(room.rsize);
      }
      changeGameState("lobby");
      console.log(`Joined room ${rid}`);
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
      setWins2win(newWins2win);
      socket.emit("update_room", { room: roomId, wins2win: newWins2win });
    }
  }

  const handleRoomSize = (e) => {
    if (socket && roomId) {
      const newRoomSize = Math.max(2, Math.min(5, roomSize + e));
      setRoomSize(newRoomSize);
      socket.emit("update_room", { room: roomId, rsize: newRoomSize });
    }
  }

  const handleAis = (e) => {
    if (socket && roomId) {
      socket.emit("manage_ais", { room: roomId, ai_dif: e });
    }
  }

  const tableEndRef = useRef(null);
  useEffect(() => {
    if (tableEndRef.current) {
      tableEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [rounds]);

  const renderRoomTable = () => {
    const room = rooms.find(r => r.rid === roomId);

    if (!room || !room.players) {
      return <div>Room not found or no players available.</div>;
    }

    const highestScore = Math.max(...Object.values(room.players).map(p => p.w));

    return (
      <div className="table_container">
        <table className="rounds_table">
          <thead>
            <tr>
              <th>R</th>
              {players.map((p, i) => (
                <th key={i}>
                  <div className="circle_wrapper"
                    style={{ margin: "0.4vh 0.2vh 0.4vh 0", border: `2px solid ${colors[i]}` }}>
                    <img src={avatarList[p.avatar]} alt={`${p.name}'s avatar`} />
                  </div>
                </th>
              ))}
              <th>Winner</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r, i) => (
              <React.Fragment key={i}>
                {r.steps.map((step, j) => (
                  <tr key={`${i}-${j}`}>
                    <td>{`${i + 1}.${j + 1}`}</td>
                    {step.map((move, k) => (
                      <td key={k}>
                        {move === "R" ? "✊" : move === "P" ? "✋" : move === "S" ? "✌️" : ""}
                      </td>
                    ))}
                    <td className={r.winner === name ? "win" : "lose"}>
                      {j === r.steps.length - 1 ? r.winner : ""}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            <tr ref={tableEndRef}> {/* This row acts as a scroll target */}
              <td></td>
              {Object.values(room.players).map((p, i) => (
                <td key={i} className={p.w === highestScore ? "win" : "lose"}>{p.w}</td>
              ))}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="app">
      <div className="header_container">
        <div className="button_container">
          {!displayLeaderboard && !displaySettings && gameState != "main" &&
            <button className="button" onClick={() => setDisplayLeaderboard(prev => !prev)}>🏆</button>}
          {avatar && (<div className="circle_wrapper" style={{ marginLeft: "0.8vh", border: `2px solid ${colors[roomRank]}` }}>
            <img src={avatarList[avatar]} alt="Your Avatar"/>
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
                  <th onClick={() => handleSort("l", "leaderboard")}>L</th>
                  <th onClick={() => handleSort("avatar", "leaderboard")}>A</th>
                  <th onClick={() => handleSort("n", "leaderboard")}>Name</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeaderboard.map((p, i) => (
                  <tr key={i}>
                    <td className={p.n === name ? "highlighted_text" : ""}>{i + 1}</td>
                    <td className={p.n === name ? "highlighted_text" : ""}>{p.r.toFixed(0)}</td>
                    <td className={p.n === name ? "highlighted_text" : ""}>{p.w}</td>
                    <td className={p.n === name ? "highlighted_text" : ""}>{p.l}</td>
                    <td style={{ padding: "0" }}>
                      <img src={avatarList[p.avatar]} className="avatar" alt={`${p.n}'s Avatar`} />
                    </td>
                    <td className={p.n === name ? "highlighted_text" : ""}>{p.n}</td>
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
              <img src={avatarList[avatar]} alt="Your Avatar"/>
            </div>
            <button className="button" onClick={() => setEditingAvatar(true)}>✏️</button>
          </div>
        </div>
      </div>)}

      {editingAvatar && (
        <div className="main_container">
          <div>
            <div className="text_display">Select an Avatar</div>
            <div className="button_container">
              {Object.entries(avatarList).filter(([k]) => k !== "ai.svg").map(([k, v], i) => (
                <div key={i} className="circle_wrapper" onClick={() => handleEditingAvatar(k)}
                  style={k === avatar ? { border: `2px solid ${colors[roomRank]}` } : {}}>
                  <img src={v} alt={k} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
                    <th>S</th>
                    <th onClick={() => handleSort("status", "rooms")}>O</th>
                    <th onClick={() => handleSort("nb", "rooms")}>N</th>
                    <th>P</th>
                    <th>L</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRooms.filter(r => (r.players && !Object.keys(r.players).includes(name))).length > 0 ? (
                    sortedRooms.filter(r => r.players && !Object.keys(r.players).includes(name)).map((r) => (
                      <tr key={r.rid}>
                        <td>{r.wins2win}</td>
                        <td>{r.rsize}</td>
                        <td>{r.status === "running" ? "🟢" : "🔴"}</td>
                        <td>{r.nb}/{r.rsize}</td>
                        <td>
                          <ul className="player_list">
                            {Object.entries(r.players).map(([k, v], i) => (
                              <li key={i}>{v.status === "ready" ? "🟢" : "🔴"} {k}</li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {r.status === "waiting" && Object.keys(r.players).length != r.rsize && (
                            <button className="button" onClick={() => joinRoom(r.rid)}>Go</button>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6">No available rooms.</td>
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
              value={roomId ? `${window.location.origin}/?room=${roomId}` : ""}
              onFocus={(e) => e.target.select()}/>
            <button className="button" onClick={() => handleCopyURL(`${window.location.origin}/?room=${roomId}`)}>
              Copy
            </button>
          </div>
          <div className="button_container">
            <div className="text_display">Wins to Win:</div>
            <button className="button" disabled={wins2win <= 1} onClick={() => handleWins2win(-1)}>-1</button>
            <div className="text_display">{wins2win}</div>
            <button className="button" disabled={5 <= wins2win} onClick={() => handleWins2win(1)}>+1</button>
          </div>
          <div className="button_container">
            <div className="text_display">Room Size:</div>
              <button className="button" onClick={() => handleRoomSize(-1)}
                disabled={roomSize <= Object.keys(rooms.find(r => r.rid === roomId)?.players ?? {}).length}>-1</button>
            <div className="text_display">{roomSize}</div>
            <button className="button" disabled={5 <= roomSize} onClick={() => handleRoomSize(1)}>+1</button>
          </div>
          <div className="button_container">
            <div className="text_display">Manage AIs:</div>
            <button className="button" onClick={() => handleAis(-1)}
              disabled={!Object.values(rooms.find(r => r.rid === roomId)?.players || []).some(p => p.is_ai)}>-1</button>
              <div className="text_display">{Object.values(rooms.find(r => r.rid === roomId)?.players ?? {}).filter(v => v.is_ai).length}</div>
            <button className="button" onClick={() => handleAis(1)}
              disabled={roomSize <= Object.keys(rooms.find(r => r.rid === roomId)?.players ?? {}).length}>+1</button>
          </div>
        </div>)}

        {gameState === "running" && (<div className="table_menu_container">
          <div className="text_display">Game History</div>
          {renderRoomTable()}
          <div className="text_display">Choose Your Move</div>
          <div className="button_container">
            {["R", "P", "S"].map((choice) => (
              <button onClick={() => handleChoice(choice)}
                key={choice} className={selectedChoice === choice ? "highlighted_button" : "button"}
                disabled={!rooms.find(r => r.rid === roomId)?.players[name]?.on}>
                {choice === "R" ? "✊" : choice === "P" ? "✋" : "✌️"}
              </button>
            ))}
          </div>
        </div>
        )}

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
            {rooms.find(r => r.rid === roomId)?.players &&
              Object.entries(rooms.find(r => r.rid === roomId).players).map(([k, v], i) => (
                <li key={i}>{v.status === "ready" ? "🟢" : "🔴"} {k}</li>
            ))}
          </ul>
          <button className="button" onClick={handleReady}>{isReady ? "Wait" : "Ready"}</button>
        </div>)}

        {gameState === "running" && (<div className="button_container">
          <button className="button" onClick={() => changeGameState("main")}>Quit</button>
          <ul className="player_list">
            {rooms.find(r => r.rid === roomId)?.players &&
              Object.entries(rooms.find(r => r.rid === roomId).players).map(([k, v], i) => (
                <li key={i}>{v.cmove ? "🟢" : "🔴"} {k}</li>
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