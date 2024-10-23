// frontend/App.js

import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [gameState, setGameState] = useState("main");
  const [pid, setPid] = useState("");
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");

  const [editingName, setEditingName] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [displayLead, setDisplayLead] = useState(false);
  const [displayOthersRooms, setDisplayOthersRooms] = useState(true);
  const [displaySettings, setDisplaySettings] = useState(false);

  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [specPlayerId, setSpecPlayerId] = useState(null);
  const [specRoomId, setSpecRoomId] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [avatar, setAvatar] = useState(null);

  const [rounds, setRounds] = useState([]);
  
  const [leadSort, setLeadSort] = useState({ key: "w", direction: "desc" });
  const [lobbySort, setLobbySort] = useState({ key: "status", direction: "asc" });
  const [playerSort, setPlayerSort] = useState({ key: "date", direction: "desc" });

  const [avatarList, setAvatarList] = useState({});
  const [pidPlayer, setPidPlayer] = useState({});
  const [roomsHist, setRoomsHist] = useState({});
  const [playerRoomsHist, setPlayerRoomsHist] = useState({});
  const [rooms, setRooms] = useState({});

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
      const storedPid = localStorage.getItem("pid") || generatePid();
      localStorage.setItem("pid", storedPid);
      newSocket.emit("set_pid", { pid: storedPid });
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

    fetch(`${SOCKET_SERVER_URL}/rooms/batch`)
      .then(r => r.json())
      .then(d => {setRoomsHist(d)})
      .catch(e => {console.error("Error fetching rooms/batch:", e)});

    fetch(`${SOCKET_SERVER_URL}/players/batch`)
      .then(r => r.json())
      .then(d => {setPidPlayer(d)})
      .catch(e => {console.error("Error fetching players/batch:", e)});

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

    newSocket.on("game_start", d => {
      setRoomId(d.rid);
      changeGameState("running");
      console.log(`Game started in room ${d.rid}`);
    });

    newSocket.on("player_left", d =>
      d.pid === pid
        ? console.log(`You left room ${d.rid}.`)
        : console.log(`Player ${d.pid} left room ${d.rid}.`)
    );

    newSocket.on("game_result", d => {
      setRounds(d.rounds);
      if (d.game_over) {
        console.log(`Game over in room ${d.rid}`);
        quitGame(false);
        handleSpecRoomId(d.rid);
      } else {
        console.log(d.winner ? `Round winner: ${d.winner} in room: ${d.rid}` : `New step in room: ${d.rid}`);
        setSelectedChoice(null);
      }
    });

    newSocket.on("db_updated", d => {
      const handlers = { "rooms": setRooms, "rooms_hist": setRoomsHist, "players": setPidPlayer};
      const handler = handlers[d.key];
      if (handler) handler(d.data);
    });

    newSocket.on("warning", w => {
      console.warn("Warning:", w.message || w);
      alert(`Warning: ${w.message || "WARNING"}`);
    });

    newSocket.on("error", e => {
      console.error("Socket Error:", e.message || e);
      alert(`Error: ${e.message || "ERROR"}`);
      quitGame(true);
    });

    return () => newSocket.disconnect();
  }, []);

  useEffect(() => {
    sortTable(leadSort.key, leadSort.direction, pidPlayer, setPidPlayer);
  }, [pidPlayer]);

  useEffect(() => {
    sortTable(lobbySort.key, lobbySort.direction, rooms, setRooms);
  }, [rooms]);

  useEffect(() => {
    sortTable(playerSort.key, playerSort.direction, playerRoomsHist, setPlayerRoomsHist);
  }, [playerRoomsHist]);

  useEffect(() => {
    setPlayerRoomsHist(Object.fromEntries(Object.entries(roomsHist).filter(([k, v]) => Object.keys(v.players).includes(specPlayerId))));
  }, [specPlayerId, roomsHist]);

  useEffect(() => {
    if (tableEndRef.current) {
      tableEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [rounds]);

  useEffect(() => {
    if (!rooms[roomId]?.players) return;
    const rank = Object.keys(rooms[roomId].players).map(p => p.name).indexOf(name);
    setRoomRank(rank !== -1 ? rank : 0);
  }, [rooms, name]);

  useEffect(() => {
    const handleBeforeUnload = () => socket?.disconnect();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      socket?.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const roomFromURL = new URLSearchParams(window.location.search).get('room');
    if (!roomFromURL || !socket) return;
    const handleJoinRoomFromURL = () => {
      setRoomId(roomFromURL);
      changeGameState("lobby");
      socket.emit("join_room", { room: roomFromURL });
      console.log(`Auto-joining room from URL: ${roomFromURL}`);
      window.history.replaceState({}, document.title, window.location.origin);
    };
    if (socket.connected) {
      handleJoinRoomFromURL();
    } else {
      socket.once("connect", handleJoinRoomFromURL);
    }
  }, [socket]);

  const handleWins2win = e => socket && roomId && socket.emit("update_room", { room: roomId, wins2win: e });
  const handleRsize = e => socket && roomId && socket.emit("update_room", { room: roomId, rsize: e });
  const handleAis = e => socket && roomId && socket.emit("manage_ais", { room: roomId, ai_dif: e });
  const tableEndRef = useRef(null);

  const generatePid = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 10 }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
  };

  const startGame = mode => {
    setRounds([]);
    socket?.emit("create_room", { mode });
  };

  const changeGameState = newState => {
    ["lobby", "running"].includes(gameState) && !["lobby", "running"].includes(newState) && quitGame(true);
    setGameState(newState);
  };

  const toggleSettings = () => {
    editingName && setEditingName(false);
    setDisplaySettings(prev => !prev);
  };

  const handleCopyURL = url => {
    navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(url)
        .then(() => alert("URL copied to clipboard!"))
        .catch(() => alert("Failed to copy URL. Please try manually."))
      : fallbackCopyTextToClipboard(url);
  };

  const handleChoice = choice => {
    setSelectedChoice(choice);
    setIsReady(true);
    if (!socket || !roomId) return;
    console.log(`You made a move: ${choice}`);
    socket.emit("make_move", { room: roomId, move: choice });
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

  const quitGame = (left) => {
    left && socket?.emit("quit_game", { room: roomId});
    setRoomId(null);
    setRounds([]);
    setIsReady(false);
    setSelectedChoice(null);
    setGameState("main");
  };

  const joinRoom = rid => {
    if (!socket) {
      return console.error("Socket not ready yet, unable to join room.");
    }
    socket.emit("join_room", { room: rid });
    setRoomId(rid);
    changeGameState("lobby");
    console.log(`Joined room ${rid}`);
  };

  const isNewNameError = Nname => {
    if (Nname.length < 3 || Nname.length > 15) return true;
    if (Nname === name) return true;
    if (Object.values(pidPlayer).some(p => p.n === Nname)) return true;
    if (!/^[a-zA-Z0-9-]+$/.test(Nname)) return true;
    return false;
  };

  const handleEditingName = () => {
    if (!editingName) return setEditingName(true);
    setEditingName(false);
    const trimmedName = newName.trim();
    setName(trimmedName);
    socket.emit("edit_name", { old_name: name, new_name: trimmedName });
    console.log(`Name updated to: ${trimmedName}`);
    setNewName("");
  };

  const fallbackCopyTextToClipboard = text => {
    const textArea = Object.assign(document.createElement("textarea"), { value: text, style: { position: "fixed" } });
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy") ? alert("URL copied!") : alert("Failed to copy.");
    } catch {
      alert("Failed to copy. Please try manually.");
    }
    document.body.removeChild(textArea);
  };

  const handleSort = (newKey, table_name) => {
    const configs = {
      lead: [leadSort, setLeadSort, pidPlayer, setPidPlayer],
      rooms: [lobbySort, setLobbySort, rooms, setRooms],
      player: [playerSort, setPlayerSort, playerRoomsHist, setPlayerRoomsHist],
    };
    const [sort, setSort, table, setTable] = configs[table_name];
    const newDirection = sort.key === newKey && sort.direction === "desc" ? "asc" : "desc";
    setSort({ key: newKey, direction: newDirection });
    sortTable(newKey, newDirection, table, setTable);
  };

  const handleSpecRoomId = rid => {
    !rid && socket.emit("update_spec", { room: specRoomId, new_spec: false });
    rooms[rid]?.status === "running" && socket.emit("update_spec", { room: rid, new_spec: true });
    setSpecRoomId(rid);
  };

  const sortTable = (newKey, newDirection, table, setTable) => {
    const sortedTable = Object.fromEntries(
      Object.entries(table).sort(([, a], [, b]) => {
        const va = a[newKey] ?? '';
        const vb = b[newKey] ?? '';
        if (typeof va === "string" && typeof vb === "string") {
          return newDirection === "desc" ? va.localeCompare(vb) : vb.localeCompare(va);
        } else if (typeof va === "number" && typeof vb === "number") {
          return newDirection === "asc" ? va - vb : vb - va;
        }
        return 0;
      })
    );
    if (JSON.stringify(sortedTable) !== JSON.stringify(table)) {
      setTable(sortedTable)
      console.log(`Table sorted by ${newKey} ${newDirection}.`);
    }
  };

  const renderEditingAvatar = <>
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
  </>

  const renderDisplaySettings = <>
    <div className="main_container">
      <div>
        <div className="text_display">Settings</div>
        <div className="button_container">
          <div className={editingName ? "" : "text_display"}>
            {editingName ? (<input className="text_input" type="text" placeholder="Enter name..."
              onChange={e => setNewName(e.target.value)} />) : (name)}
          </div>
          <button className="button" onClick={handleEditingName}
            disabled={editingName && isNewNameError(newName)}>{editingName ? "✔️" : "✏️"}</button>
        </div>
        <div className="text_display">Name rules:</div>
        {editingName && isNewNameError(newName) && (
          <ul style={{paddingLeft: "3vh", marginTop: "0.5vh"}}>
            <li>Not the actual name</li>
            <li>Not already taken</li>
            <li>3-15 characters long</li>
            <li>Alphanumeric with hyphens (a-zA-Z0-9-)</li>
          </ul>
        )}
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
  </>

  const renderRoomTable = () => {
    const room = roomsHist[specRoomId] || rooms[specRoomId] || rooms[roomId];
    if (!room || !room.players || !room.rounds) return <div className="text_display">Loading...</div>;
    const highestScore = Math.max(...Object.values(room.players).map(p => p.w));
    return <div className="table_container">
      <table className="rounds_table">
        <thead>
          <tr>
            <th>{roomsHist[specRoomId] ? "📺" : "⏳"}</th>
            {Object.entries(room.players).map(([k, v], i) => (
              <th key={i}>
                <div className="circle_wrapper" onClick={() => {setSpecPlayerId(k); handleSpecRoomId(null)}}
                  style={{ margin: "0.4vh 0.2vh 0.4vh 0", border: `2px solid ${colors[i]}` }}>
                  <img src={avatarList[v.a || pidPlayer[k].a]} alt={`${k}'s avatar`} />
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
                  <td className={room.players[r.winner]?.team === room.players[pid]?.team ? "win" : ""}>
                    {j === r.steps.length - 1 ? room.players[r.winner]?.n || pidPlayer[r.winner]?.n : ""}
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr ref={tableEndRef}>
            <td></td>
            {Object.values(room.players).map((p, i) => (
              <td key={i} className={p.w === highestScore ? "win" : ""}>{p.w}</td>
            ))}
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>;
  };

  const renderRoomData = <>
    <div className="main_container">
      <div className="table_menu_container">
        {renderRoomTable()}
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => handleSpecRoomId(null)} style={{ cursor: "pointer" }}>Back</button>
      </div>
    </div>
  </>

  const renderPlayerData = () => {
    if (!specPlayerId || !pidPlayer?.[specPlayerId] || !playerRoomsHist) return <div className="text_display">Loading...</div>;
    const specPlayer = pidPlayer[specPlayerId];
    const maxLen = Math.max(0, ...Object.values(playerRoomsHist).map(g => Object.keys(g.players || {}).length));
    const live = Object.keys(rooms).find(rid => specPlayerId in rooms[rid]?.players);
    return <>
      <div className="main_container">
        {!specPlayer?.a ? (<div className="text_display">Loading...</div>) : (
          <div className="table_menu_container">
            <div className="button_container">
              <div className="circle_wrapper" style={{ border: `2px solid ${colors[0]}` }}>
                <img src={avatarList[specPlayer.a]} alt={`${specPlayer.n}'s Avatar`} />
              </div>
              <div className="text_display">{specPlayer.n}</div>
            </div>
            <div className="button_container">
              <div className="text_display">R: {specPlayer.r}% | W: {specPlayer.w} | L: {specPlayer.l}</div>
            </div>
            <div className="table_container">
              <table className="player_table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort("date", "player")}></th>
                    {[...Array(maxLen)].map((_, i) => (
                      <React.Fragment key={`F${i}`}>
                        <th key={`P${i}`}>{i + 1}</th>
                        <th key={`S${i}`}></th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {live && (<tr>
                    <td onClick={() => handleSpecRoomId(live)} style={{ cursor: "pointer" }}>👁️</td>
                    {Object.entries(rooms[live].players).map(([k, v], i) => {
                      const bestw = Math.max(...Object.values(rooms[live].players).map(v => v.w));
                      return (
                        <React.Fragment key={`${i}`}>
                          <td onClick={() => setSpecPlayerId(k)} style={{ cursor: "pointer", padding: "0" }}>
                            <img className="avatar" src={avatarList[pidPlayer[k].a]} alt={`${pidPlayer[k].n}'s Avatar`} />
                          </td>
                          <td className={ v.w === bestw ? "win" : ""} onClick={() => setSpecPlayerId(k)} style={{ cursor: "pointer" }}>{v.w}</td>
                        </React.Fragment>
                      );
                    })}
                    {Array(maxLen - Object.keys(rooms[live].players).length).fill(0).map((_, idx) => (
                      <React.Fragment key={`empty-${idx}`}>
                        <td key={`p${idx}`} />
                        <td key={`s${idx}`} />
                      </React.Fragment>
                    ))}
                  </tr>)}
                  {Object.entries(playerRoomsHist).map(([key, val], i) => {
                    const players = Object.entries(val.players);
                    const bestw = Math.max(...players.map(([k, v]) => v.w));
                    return (
                      <tr key={i}>
                        <td onClick={() => handleSpecRoomId(key)} style={{ cursor: "pointer" }}>📺</td>
                        {players.map(([k, v], j) => (
                          <React.Fragment key={`${i}-${j}`}>
                            <td onClick={() => setSpecPlayerId(k)} style={{ cursor: "pointer", padding: "0" }}>
                              <img className="avatar" src={avatarList[pidPlayer[k].a]} alt={`${pidPlayer[k].n}'s Avatar`} />
                            </td>
                            <td className={ v.w === bestw ? "win" : ""} onClick={() => setSpecPlayerId(k)} style={{ cursor: "pointer" }}>{v.w}</td>
                          </React.Fragment>
                        ))}
                        {Array(maxLen - players.length).fill(0).map((_, idx) => (
                          <React.Fragment key={`empty-${i}-${idx}`}>
                            <td key={`p${i}-${idx}`} />
                            <td key={`s${i}-${idx}`} />
                          </React.Fragment>
                        ))}
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
          <button className="button" style={{ cursor: "pointer" }}
            onClick={() => { setSpecPlayerId(null); setPlayerRoomsHist({}) }}>Back</button>
        </div>
      </div>
    </>;
  };

  const renderLead = () => {
    const lead = Object.keys(pidPlayer).map(pid => ({ pid: pid, ...pidPlayer[pid] }))
    return <>
      <div className="main_container">
        <div className="table_menu_container">
          <div className="text_display">Lead</div>
          <div className="table_container">
            <table className="lead_table">
              <thead>
                <tr>
                  <th></th>
                  <th onClick={() => handleSort("r", "lead")}>R</th>
                  <th onClick={() => handleSort("w", "lead")}>W</th>
                  <th onClick={() => handleSort("l", "lead")}>L</th>
                  <th>A</th>
                  <th onClick={() => handleSort("n", "lead")}>Name</th>
                </tr>
              </thead>
              <tbody>
                {lead && lead.map((p, i) => (
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
          <button className="button" onClick={() => setDisplayLead(prev => !prev)}>Back</button>
        </div>
      </div>
    </>;
  };

  const renderMain = <>
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
  </>

  const renderMenu = <>
    <div className="main_container">
      <div>
        <div className="text_display">Select Mode</div>
        <div className="button_container">
          <button className="button" onClick={() => startGame("ai")}>Versus AI</button>
          <button className="button" onClick={() => startGame("pvp")}>Versus Player</button>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => changeGameState("main")}>Back</button>
      </div>
    </div>
  </>

  const renderLobby = <>
    <div className="main_container">
      <div className="table_menu_container">
        {displayOthersRooms && (<>
          <div className="text_display">Others Rooms</div>
          <div className="table_container">
            <table className="rooms_table">
              <thead>
                <tr>
                  <th onClick={() => handleSort("wins2win", "rooms")}>R</th>
                  <th onClick={() => handleSort("rsize", "rooms")}>N</th>
                  <th>P</th>
                  <th onClick={() => handleSort("status", "rooms")}>L</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(rooms).filter(rid => rid !== roomId).length ? (
                  Object.entries(rooms).filter(([rid]) => rid !== roomId).map(([rid, r], i) => (<tr key={i}>
                    <td>{r.wins2win}</td>
                    <td className={r.status === "running" ? "win" : Object.keys(r.players).length === r.rsize ? "lose" : ""}>
                      {Object.keys(r.players).length}/{r.rsize}
                    </td>
                    <td>
                      <div className="button_container" style={{padding: "0"}}>
                        {Object.entries(r.players).map(([k, v], j) => (
                          <div key={`${i}-${j}`} className="circle_wrapper" onClick={() => setSpecPlayerId(k)}
                            style={{cursor: "pointer", width:"3.3vh", height:"3.3vh", border: `2px solid ${v.status === "ready" ? "#0F0" : "#F00"}` }}>
                            <img src={avatarList[v.avatar]} alt={`${v.name}'s avatar'`}/>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="button" onClick={() => r.status != "running" ? joinRoom(rid) : handleSpecRoomId(rid)}
                        disabled={r.status != "running" && Object.keys(r.players).length === r.rsize}>
                        {r.status === "running" ? "👁️" : Object.keys(r.players).length === r.rsize ? "🔒" : "Go"}
                      </button>
                    </td>
                  </tr>
                  ))) : (
                  <tr>
                    <td colSpan="4">No available rooms.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>)}
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
          <button className="button" disabled={rooms[roomId]?.rsize <= Object.keys(rooms[roomId]?.players ?? {}).length}
            onClick={() => handleCopyURL(`${window.location.origin}/?room=${roomId}`)}>
            Copy
          </button>
        </div>
        <div className="button_container">
          <div className="text_display">Wins to Win:</div>
          <button className="button" disabled={rooms[roomId]?.wins2win <= 1} onClick={() => handleWins2win(-1)}>-1</button>
          <div className="text_display">{rooms[roomId]?.wins2win}</div>
          <button className="button" disabled={5 <= rooms[roomId]?.wins2win} onClick={() => handleWins2win(1)}>+1</button>
        </div>
        <div className="button_container">
          <div className="text_display">Room Size:</div>
          <button className="button" onClick={() => handleRsize(-1)}
            disabled={rooms[roomId]?.rsize <= Math.max(2, Object.values(rooms[roomId]?.players ?? {}).length)}>-1</button>
          <div className="text_display">{rooms[roomId]?.rsize}</div>
          <button className="button" disabled={5 <= rooms[roomId]?.rsize} onClick={() => handleRsize(1)}>+1</button>
        </div>
        <div className="button_container">
          <div className="text_display">Manage AIs:</div>
          <button className="button" onClick={() => handleAis(-1)}
            disabled={!(rooms[roomId]?.players && Object.values(rooms[roomId].players).some(v => v.is_ai))}>-1</button>
          <div className="text_display">{Object.values(rooms[roomId]?.players ?? {}).filter(v => v.is_ai).length}</div>
          <button className="button" onClick={() => handleAis(1)}
            disabled={rooms[roomId]?.rsize <= Object.keys(rooms[roomId]?.players ?? {}).length}>+1</button>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => quitGame(true)}>Quit</button>
        <ul className="player_list">
          {rooms[roomId]?.players &&
            Object.values(rooms[roomId].players).map((v, i) => (
              <li key={i}>{v.status === "ready" ? "🟢" : "🔴"} {v.name}</li>
            ))}
        </ul>
        <button className="button" onClick={handleReady}>{isReady ? "Wait" : "Ready"}</button>
      </div>
    </div>
  </>

  const renderRunning = <>
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
  </>

  return <div className="app">
    {!pid ? (<div className="text_display" style={{ paddingTop: "2.5vh" }}>Loading...</div>) : (
      <div className="header_container">
        <div className="button_container">
          {gameState != "main" &&
            <button className={displayLead ? "highlighted_button" : "button"} onClick={() => setDisplayLead(prev => !prev)}>🏆</button>
          }
          {avatar && (
            <div className="circle_wrapper" onClick={() => setSpecPlayerId(pid)}
              style={{cursor: "pointer", marginLeft: "0.8vh", border: `2px solid ${colors[roomRank]}` }}>
              <img src={avatarList[avatar]} alt="Your Avatar"/>
            </div>
          )}
          <div className="text_display" style={{ cursor: "pointer"}}
            onClick={() => setSpecPlayerId(pid)}>{name}</div>
          {!["lobby", "running"].includes(gameState) &&
            <button className={displaySettings ? "highlighted_button" : "button"} onClick={toggleSettings}>⚙️</button>
          }
        </div>
      </div>
    )}

    {editingAvatar ? renderEditingAvatar
    : displaySettings ? renderDisplaySettings
    : specRoomId ? renderRoomData
    : specPlayerId ? renderPlayerData()
    : displayLead ? renderLead()
    : <>
      {gameState === "main" && renderMain}
      {gameState === "menu" && renderMenu}
      {gameState === "lobby" && renderLobby}
      {gameState === "running" && renderRunning}
    </>}

  </div>;
}

export default App;