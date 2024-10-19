// frontend/App.js

import React, { useState, useEffect, useMemo, useRef } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [gameState, setGameState] = useState("main");
  const [pid, setPid] = useState("");
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
  const [specPlayerId, setSpecPlayerId] = useState(null);
  const [specRoomId, setSpecRoomId] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [avatar, setAvatar] = useState(null);

  const [rounds, setRounds] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  
  const [rooms, setRooms] = useState({});
  const [specPlayerData, setSpecPlayerData] = useState({});
  const [specRoomData, setSpecRoomData] = useState({});
  const [avatarList, setAvatarList] = useState({});
  const [pidNameAvatar, setPidNameAvatar] = useState({});

  const [wins2win, setWins2win] = useState(2);
  const [roomSize, setRoomSize] = useState(2);
  const [roomRank, setRoomRank] = useState(0);

  const colors = ["#0AF", "#F00", "#0C3", "#DD0", "#B0D"]
  
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL, {
      transports: ["websocket"],  // Force WebSocket transport
      reconnectionAttempts: 5,    // Optional: Limit reconnection attempts
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to backend");
      let storedPid = localStorage.getItem("pid");
      if (!storedPid) {
        storedPid = generatePid();
        localStorage.setItem("pid", storedPid);
      }
      newSocket.emit("set_pid", { pid: storedPid });
    });
    
    newSocket.on("name_taken", () => {
      setNameError("Someone is using this name right now");
      setEditingName(true);
    });
    
    newSocket.on("pid_set", d => {
      setPid(d.pid);
      setName(d.name);
      setAvatar(d.avatar);
      console.log(`pid successfully set to ${d.pid}`);
    });

    newSocket.on("avatar_set", d => {
      setAvatar(d.avatar);
      console.log(`Avatar successfully updated from ${avatar} to ${d.avatar}`);
    });

    fetch(`${SOCKET_SERVER_URL}/avatars/batch`)
      .then(r => r.json())
      .then(d => {setAvatarList(d)})
      .catch(e => {console.error("Error fetching avatars/batch:", e)});

    newSocket.on("leaderboard_updated", d => setLeaderboard(d.leaderboard));

    newSocket.on("room_created", d => {
      setRoomId(d.rid);
      changeGameState("lobby");
      console.log(`New room created: ${d.rid}`);
    });

    newSocket.on("room_joined", d => {
      setRoomId(d.rid);
      changeGameState("lobby");
      console.log(`New player in room ${d.rid}`);
    });

    newSocket.on("room_updated", d => {
      if (d.wins2win !== undefined) {
        setWins2win(d.wins2win);
        console.log(`Wins to win updated to ${d.wins2win}`);
      }
      if (d.rsize !== undefined) {
        setRoomSize(d.rsize);
        console.log(`Room size updated to ${d.rsize}`);
      }
    });

    newSocket.on("game_start", d => {
      setRoomId(d.rid);
      changeGameState("running");
      console.log(`Game started in room ${d.rid}`);
    });

    newSocket.on("player_left", d => {
      if (d.player === name) {
        console.log(`You left the room.`);
      } else {
        console.log(`Player ${d.player} has left the room.`);
      }
    });

    newSocket.on("game_result", d => {
      setRounds(d.rounds);
      if (d.game_over) {
        console.log(`Game over in room ${d.rid}`);
        quitGame("game_over");
        setSpecRoomId(d.rid);
      } else {
        console.log(d.winner ? `Round winner: ${d.winner} in room: ${d.rid}` : `New step in room: ${d.rid}`);
        setSelectedChoice(null);
      }
    });

    newSocket.on("rooms_updated", d => setRooms(d.rooms));

    newSocket.on("warning", w => {
      console.warn("Warning:", w.message || w);
      alert(`Warning: ${w.message || "A non-critical issue occurred."}`);
    });

    newSocket.on("error", e => {
      console.error("Socket Error:", e.message || e);
      alert(`Error: ${e.message || "An unexpected error occurred."}`);
      quitGame("main");
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
    if (rooms[roomId]?.players) {
      const rank = Object.keys(rooms[roomId]?.players).map(p => p.name).indexOf(name);
      setRoomRank(rank !== -1 ? rank : 0);
    }
  }, [rooms, name]);

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
          socket.on("connect", () => handleJoinRoomFromURL());
        }
      }
    }
  }, [socket]); // Depend on the 'socket' variable

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const generatePid = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 10 }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
  };

  const startGame = mode => {
    setRounds([]);
    socket?.emit("create_room", { mode, wins2win, roomSize });
  };

  const handleChoice = choice => {
    setSelectedChoice(choice);
    setIsReady(true);
    if (socket && roomId) {
      console.log(`You made a move: ${choice}`);
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

  const quitGame = (game_state) => {
    if (socket && roomId && gameState != "game_over") {
      socket.emit("quit_game", { room: roomId });
      console.log(`Player ${socket.id} left room ${roomId}`);
    }
    setRoomId(null);
    setRounds([]);
    setWins2win(2);
    setRoomSize(2);
    setIsReady(false);
    setSelectedChoice(null);
    setGameState(game_state);
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
      const new_name = newName.trim();
      setName(new_name);
      // The ref will be updated via useEffect
      socket.emit("edit_name", { old_name: name, new_name: new_name });
      console.log(`Name updated to: ${new_name}`);
      setNewName("");
    } else {
      setEditingName(true);
    }
  };

  const joinRoom = rid => {
    if (socket) {
      socket.emit("join_room", { room: rid });
      setRoomId(rid);
      if (rooms[rid]) {
        setWins2win(rooms[rid].wins2win);
        setRoomSize(rooms[rid].rsize);
      }
      changeGameState("lobby");
      console.log(`Joined room ${rid}`);
    } else {
      console.error("Socket not ready yet, unable to join room.");
    }
  };

  const changeGameState = newState => {
    if (["lobby", "running"].includes(gameState) && !["lobby", "running"].includes(newState)) {
      quitGame("main");
    }
    setGameState(newState);
  };

  const fallbackCopyTextToClipboard = text => {
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

  const handleCopyURL = url => {
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

  const handleWins2win = e => {
    if (socket && roomId) {
      socket.emit("update_room", { room: roomId, wins2win: e });
    }
  }

  const handleRoomSize = e => {
    if (socket && roomId) {
      socket.emit("update_room", { room: roomId, rsize: e });
    }
  }

  const handleAis = e => {
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

  useEffect(() => {
    if (specRoomId && !specRoomData[specRoomId]) {
      fetch(`${SOCKET_SERVER_URL}/rooms/${specRoomId}`)
        .then(r => r.json())
        .then(d => {
          setPidNameAvatar(prev => ({...prev, ...d.pid_name_avatar}));
          setSpecRoomData(prev => ({...prev, ...d.room_data}));
        })
        .catch(e => { console.error(`Error fetching rooms/${specRoomId}:`, e) });
    }
  }, [specRoomId]);
    
  useEffect(() => {
    if (specPlayerId && !specPlayerData[specPlayerId]) {
      fetch(`${SOCKET_SERVER_URL}/players/${specPlayerId}`)
        .then(r => r.json())
        .then(d => {
          setPidNameAvatar(prev => ({...prev, ...d.pid_name_avatar}));
          setSpecPlayerData(prev => ({...prev, ...d.pid_data}));
          setSpecRoomData(prev => ({ ...prev, ...d.room_data }));
        })
        .catch(e => { console.error(`Error fetching players/${specPlayerId}:`, e) });
    }
  }, [specPlayerId]);

  const quitGameOver = () => {
    setGameState("main");
    setSpecRoomId(null);
  };

  const decompress = d => {
    const [playersData, roundsData] = d.split("$");
    const players = playersData.split("|").reduce((acc, p) => {
      const [playerId, data] = p.split(";");
      const [team, is_ai_str, w_str, l_str] = data.split(",");
      acc[playerId] = {team: team, is_ai: is_ai_str === "T", w: parseInt(w_str, 10), l: parseInt(l_str, 10)};
      return acc;
    }, {});
    const playersList = Object.keys(players);
    const rounds = roundsData.split("|").map((r, index) => {
      const [winnerIndexStr, stepsStr] = r.split(";");
      const winnerIndex = parseInt(winnerIndexStr, 10);
      const winner = playersList[winnerIndex];
      const steps = stepsStr.split(",").map(step => step.split("").map(ch => ch === " " ? "" : ch));
      return {index: index + 1, winner: winner, steps: steps};
    });
    return {players: players, rounds: rounds};
  };

  const renderRoomTable = () => {
    let room = rooms[roomId]
    room = specRoomData?.[specRoomId] ? decompress(specRoomData[specRoomId]) : room;
    if (!room || !room.players || !room.rounds) {
      return <div className="text_display">Loading...</div>;
    }
    const highestScore = Math.max(...Object.values(room.players).map(p => p.w));
    return (<>
      <div className="main_container">
        <div className="table_menu_container">
          <div className="table_container">
            <table className="rounds_table">
              <thead>
                <tr>
                  <th>R</th>
                  {Object.entries(room.players).map(([k, v], i) => (
                    <th key={i}>
                      <div className="circle_wrapper"
                        style={{ margin: "0.4vh 0.2vh 0.4vh 0", border: `2px solid ${colors[i]}` }}>
                        <img src={avatarList[v.avatar || pidNameAvatar[k].avatar]} alt={`${k}'s avatar`} />
                      </div>
                    </th>
                  ))}
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {room.rounds.map((r, i) => (
                  <React.Fragment key={i}>
                    {r.steps.map((step, j) => (
                      <tr key={`${i}-${j}`}>
                        <td>{`${i + 1}.${j + 1}`}</td>
                        {step.map((move, k) => (
                          <td key={k}>
                            {move === "R" ? "✊" : move === "P" ? "✋" : move === "S" ? "✌️" : ""}
                          </td>
                        ))}
                        <td className={r.winner === pid ? "win" : "lose"}>
                          {j === r.steps.length - 1 ? room.players[r.winner]?.name || pidNameAvatar[r.winner]?.name : ""}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr ref={tableEndRef}>
                  <td></td>
                  {Object.values(room.players).map((p, i) => (
                    <td key={i} className={p.w === highestScore ? "win" : "lose"}>{p.w}</td>
                  ))}
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="footer_container">
        <div className="button_container">
          <button className="button" onClick={() => setSpecRoomId(null)} style={{ cursor: "pointer" }}>Back</button>
        </div>
      </div>
    </>);
  };

  const renderPlayerData = () => {
    if (!specPlayerId || !specPlayerData) {
      return <div className="text_display">Loading...</div>;
    }
    const specGames = Object.fromEntries(
      Object.entries(specPlayerData?.games || {}).map(([k, v]) => [k, decompress(v)])
    );
    const maxLen = Math.max(0, ...Object.values(specGames).map(g => Object.keys(g.players).length));
    return (<>
      <div className="main_container">
        {!specPlayerData?.a ? (<div className="text_display">Loading...</div>) : (
          <div className="table_menu_container">
            <div className="button_container">
              <div className="circle_wrapper" style={{ border: `2px solid ${colors[0]}` }}>
                <img src={avatarList[specPlayerData.a]} alt={`${specPlayerData.n}'s Avatar`} />
              </div>
              <div className="text_display">{specPlayerData.n}</div>
            </div>
            <div className="button_container">
              <div className="text_display">R: {specPlayerData.r}% | W: {specPlayerData.w} | L: {specPlayerData.l}</div>
            </div>
            <div className="table_container">
              <table className="player_table">
                <thead>
                  <th></th>
                  {[...Array(maxLen)].map((_, i) => (
                    <><th key={`P${i}`}>{i+1}</th><th key={`S${i}`}></th></>
                  ))}
                </thead>
                <tbody>
                  {Object.entries(specGames).map(([key, val], i) => {
                    const players = Object.entries(val.players);
                    const emptyTd = maxLen - players.length;
                    return (
                      <tr>
                        <td onClick={() => setSpecRoomId(key)}>{i + 1} 👁️</td>
                        {players.map(([k, v], j) => (
                          <React.Fragment key={j}>
                            <td onClick={() => setSpecPlayerId(k)} style={{ cursor: "pointer", padding: "0" }}>
                              <img className="avatar" src={avatarList[pidNameAvatar[k].avatar]}
                                alt={`${pidNameAvatar[k].name}'s Avatar`}/>
                            </td>
                            <td onClick={() => setSpecPlayerId(k)} style={{ cursor: "pointer" }}>{v.w}</td>
                          </React.Fragment>
                        ))}
                        {Array(emptyTd).fill(<><td key={`p${i}`}/><td key={`s${i}`}/></>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div className="footer_container">
        <div className="button_container">
          <button className="button" onClick={() => setSpecPlayerId(null)} style={{ cursor: "pointer" }}>Back</button>
        </div>
      </div>
    </>);
  };

  const renderEditingAvatar = (<>
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
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => setEditingAvatar(false)}>Back</button>
      </div>
    </div>
  </>)

  const renderDisplaySettings = (<>
    <div className="main_container">
      <div>
        <div className="text_display">Settings</div>
        <div className="button_container">
          <div className={editingName ? "" : "text_display"}>
            {editingName ? (<input className="text_input" type="text" placeholder="Enter name..."
              onChange={e => setNewName(e.target.value)} />) : (name)}
          </div>
          <button className="button" onClick={handleEditingName}
            disabled={name === newName}>{editingName ? "✔️" : "✏️"}</button>
        </div>
        <div className="button_container">
          <div className="circle_wrapper" style={{ marginRight: "1vh", border: `2px solid ${colors[roomRank]}` }}>
            <img src={avatarList[avatar]} alt="Your Avatar" />
          </div>
          <button className="button" onClick={() => setEditingAvatar(true)}>✏️</button>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={toggleSettings}>Back</button>
      </div>
    </div>
  </>)

  const renderLeaderboard = (<>
    <div className="main_container">
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
              {!!leaderboard && sortedLeaderboard.map((p, i) => (
                <tr key={i} onClick={() => setSpecPlayerId(p.pid)} style={{cursor: "pointer"}}>
                  <td className={p.n === name ? "highlighted_text" : ""}>{i + 1}</td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.r.toFixed(0)}</td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.w}</td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.l}</td>
                  <td style={{ padding: "0" }}>
                    <img src={avatarList[p.a]} className="avatar" alt={`${p.n}'s Avatar`} />
                  </td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => setDisplayLeaderboard(prev => !prev)}>Back</button>
      </div>
    </div>
  </>)

  const renderMain = (<>
    <div className="main_container">
      {!pid ? (<div className="text_display">Loading...</div>) : (
        <div className="button_container">
          <button className="button" onClick={() => changeGameState("menu")}>✊✋✌️</button>
        </div>
      )}
    </div>
    <div className="footer_container">
      <div className="text_display" style={{ fontSize: "1.7vh" ,fontStyle: "italic", color: "#999" }}>Hardtech</div>
    </div>
  </>)

  const renderMenu = (<>
    <div className="main_container">
      <div>
        <div className="text_display">Select Mode</div>
        <div className="button_container">
          <button className="button" onClick={() => startGame("ai")}>Versus AI</button>
          <button className="button" onClick={() => startGame("online")}>Versus Player</button>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => changeGameState("main")}>Back</button>
      </div>
    </div>
  </>)

  const renderLobby = (<>
    <div className="main_container">
      <div className="table_menu_container">
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
                {Object.keys(rooms).filter(rid => rid !== roomId).length ? (
                  Object.entries(rooms).filter(([rid]) => rid !== roomId).map(([rid, r]) => (<tr key={rid}>
                    <td>{r.wins2win}</td>
                    <td>{r.rsize}</td>
                    <td>{r.status === "running" ? "🟢" : "🔴"}</td>
                    <td>{Object.keys(r.players).length}/{r.rsize}</td>
                    <td>
                      <ul className="player_list">
                        {Object.entries(r.players).map(([k, v], i) => (
                          <li key={i}>{v.status === "ready" ? "🟢" : "🔴"} {v.name}</li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      {r.status === "waiting" && Object.keys(r.players).length != r.rsize && (
                        <button className="button" onClick={() => joinRoom(rid)}>Go</button>
                      )}
                    </td>
                  </tr>
                  ))) : (
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
            onFocus={e => e.target.select()} />
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
            disabled={roomSize <= rooms[roomId]?.players?.length}>-1</button>
          <div className="text_display">{roomSize}</div>
          <button className="button" disabled={5 <= roomSize} onClick={() => handleRoomSize(1)}>+1</button>
        </div>
        <div className="button_container">
          <div className="text_display">Manage AIs:</div>
          <button className="button" onClick={() => handleAis(-1)}
            disabled={!(rooms[roomId]?.players && Object.values(rooms[roomId].players).some(v => v.is_ai))}>-1</button>
          <div className="text_display">{Object.values(rooms[roomId]?.players ?? {}).filter(v => v.is_ai).length}</div>
          <button className="button" onClick={() => handleAis(1)}
            disabled={roomSize <= Object.keys(rooms[roomId]?.players ?? {}).length}>+1</button>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => quitGame("main")}>Quit</button>
        <ul className="player_list">
          {rooms[roomId]?.players &&
            Object.values(rooms[roomId].players).map((v, i) => (
              <li key={i}>{v.status === "ready" ? "🟢" : "🔴"} {v.name}</li>
            ))}
        </ul>
        <button className="button" onClick={handleReady}>{isReady ? "Wait" : "Ready"}</button>
      </div>
    </div>
  </>)

  const renderRunning = (<>
    <div className="main_container">
      <div className="table_menu_container">
        <div className="text_display">Game History</div>
        {renderRoomTable()}
        <div className="text_display">Choose Your Move</div>
        <div className="button_container">
          {["R", "P", "S"].map((choice) => (
            <button onClick={() => handleChoice(choice)}
              key={choice} className={selectedChoice === choice ? "highlighted_button" : "button"}
              disabled={!rooms[roomId]?.players[pid]?.on}>
              {choice === "R" ? "✊" : choice === "P" ? "✋" : "✌️"}
            </button>
          ))}
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => changeGameState("main")}>Quit</button>
        <ul className="player_list">
          {rooms[roomId]?.players &&
            Object.values(rooms[roomId].players).map((v, i) => (
              <li key={i}>{v.cmove ? "🟢" : "🔴"} {v.name}</li>
            ))}
        </ul>
      </div>
    </div>
  </>)

  const renderGameOver = (<>
    <div className="main_container">
      <div className="table_menu_container">
        <div className="text_display">Final Results</div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={quitGameOver}>Main Menu</button>
      </div>
    </div>
  </>)

  return (
    <div className="app">
      {!pid ? (<div className="text_display">Loading...</div>) : (
        <div className="header_container">
          <div className="button_container">
            {gameState != "main" &&
              <button className={displayLeaderboard ? "highlighted_button" : "button"} onClick={() => setDisplayLeaderboard(prev => !prev)}>🏆</button>
            }
            {avatar && (
              <div className="circle_wrapper" onClick={() => setSpecPlayerId(pid)}
                style={{cursor: "pointer", marginLeft: "0.8vh", border: `2px solid ${colors[roomRank]}` }}>
                <img src={avatarList[avatar]} alt="Your Avatar"/>
              </div>
            )}
            <div className="text_display" style={{ cursor: "pointer", fontSize: "2vh" }}
              onClick={() => setSpecPlayerId(pid)}>{name}</div>
            {!["lobby", "running"].includes(gameState) &&
              <button className={displaySettings ? "highlighted_button" : "button"} onClick={toggleSettings}>⚙️</button>
            }
          </div>
        </div>
      )}

      {specRoomId ? renderRoomTable() :
      specPlayerId ? renderPlayerData() :
      editingAvatar ? renderEditingAvatar :
      displaySettings ? renderDisplaySettings :
      displayLeaderboard ? renderLeaderboard :
      <>
        {gameState === "main" && renderMain}
        {gameState === "menu" && renderMenu}
        {gameState === "lobby" && renderLobby}
        {gameState === "running" && renderRunning}
        {gameState === "game_over" && renderGameOver}
      </>}

    </div>
  );
}

export default App;