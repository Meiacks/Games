// frontend/App.js

import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import { io } from "socket.io-client";

const SERVER_URL = "http://57.129.44.194:5001";

function App() {
  const [editingName, setEditingName] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [displayLead, setDisplayLead] = useState(false);
  const [displayOthersRooms, setDisplayOthersRooms] = useState(true);
  const [displaySettings, setDisplaySettings] = useState(false);
  const [isLinkValid, setIsLinkValid] = useState(false);
  const [isLinkValidated, setIsLinkValidated] = useState(false);

  const [gameState, setGameState] = useState("main");

  const [gid, setGid] = useState(null);
  const [rid, setRid] = useState(null);
  const [pid, setPid] = useState(null);
  const [name, setName] = useState(null);
  const [newName, setNewName] = useState(null);
  const [socket, setSocket] = useState(null);
  const [specPid, setSpecPid] = useState(null);
  const [specRid, setSpecRid] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [avatar, setAvatar] = useState(null);

  const [lead, setLead] = useState([]);

  const [leadSort, setLeadSort] = useState({ key: "w", direction: "desc" });
  const [lobbySort, setLobbySort] = useState({ key: "status", direction: "asc" });
  const [playerSort, setPlayerSort] = useState({ key: "date", direction: "desc" });

  const [avatarList, setAvatarList] = useState({});
  const [pidPlayer, setPidPlayer] = useState({});
  const [roomsHist, setRoomsHist] = useState({});
  const [playerRoomsHist, setPlayerRoomsHist] = useState({});
  const [rooms, setRooms] = useState({});

  const [roomRank, setRoomRank] = useState(0);

  const tableEndRef = useRef(null);

  const colors = ["#0AF", "#F00", "#0C3", "#DD0", "#B0D"]

  useEffect(() => {
    const newSocket = io(SERVER_URL, {
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
      setName(d.n);
      setAvatar(d.a);
      console.log(`pid successfully set to ${d.pid}`);
    });

    newSocket.on("avatar_set", d => {
      setAvatar(d);
      console.log(`Avatar successfully updated from ${avatar} to ${d}`);
    });

    fetch(`${SERVER_URL}/avatars/batch`)
      .then(r => r.json())
      .then(d => { setAvatarList(d) })
      .catch(e => { console.error("Error fetching avatars/batch:", e) });

    fetch(`${SERVER_URL}/players/batch`)
      .then(r => r.json())
      .then(d => { setPidPlayer(d) })
      .catch(e => { console.error("Error fetching players/batch:", e) });

    newSocket.on("room_created", d => {
      setRid(d);
      setGameState("lobby");
      console.log(`New room created: ${d}`);
    });

    newSocket.on("link_checked", d => {
      setRooms(d.rooms);
      setIsLinkValid(d.isLinkValid);
    });

    newSocket.on("room_joined", d => {
      setRid(d);
      setGameState("lobby");
      console.log(`New player in room ${d}`);
    });

    newSocket.on("game_start", d => {
      setRid(d);
      setGameState("running");
      console.log(`Game started in room ${d}`);
    });

    newSocket.on("help_move", d => {
      setHelpMove(d);
      console.log(`Help move: ${d}`);
    });

    newSocket.on("player_left", d =>
      d.pid === pid
        ? console.log(`You left room ${d.rid}.`)
        : console.log(`Player ${d.pid} left room ${d.rid}.`)
    );

    newSocket.on("game_result_rps", d => {
      if (d.game_over) {
        console.log(`Game over in room ${d.rid}`);
        quitRoom(false);
        handleSpecRid(d.rid);
      } else {
        console.log(d.winner ? `Round winner: ${d.winner} in room: ${d.rid}` : `New step in room: ${d.rid}`);
        setSelectedChoice(null);
      }
    });

    newSocket.on("game_result_c4", (d) => {
      if (d.game_over) {
        console.log(`Game over in room ${d.rid}`);
        quitRoom(false);
        handleSpecRid(d.rid);
      } else {
        console.log(d.winner ? `Round winner: ${d.winner} in room: ${d.rid}` : `New move in room: ${d.rid}`);
      }
    });

    newSocket.on("db_updated", d => {
      const setters = { "rooms": setRooms, "rooms_hist": setRoomsHist, "players": setPidPlayer };
      const setter = setters[d.key];
      if (setter) setter(d.data);
    });

    newSocket.on("warning", w => {
      console.warn("Warning:", w.message || w);
      alert(`Warning: ${w.message || "WARNING"}`);
    });

    newSocket.on("error", e => {
      console.error("Socket Error:", e.message || e);
      alert(`Error: ${e.message || "ERROR"}`);
      quitRoom(true);
    });

    return () => newSocket.disconnect();
  }, []);

  // ##     ##  ######  ######## ######## ######## ######## ########  ######  ########
  // ##     ## ##    ## ##       ##       ##       ##       ##       ##    ##    ##
  // ##     ## ##       ##       ##       ##       ##       ##       ##          ##
  // ##     ##  ######  ######   ######   ######   ######   ######   ##          ##
  // ##     ##       ## ##       ##       ##       ##       ##       ##          ##
  // ##     ## ##    ## ##       ##       ##       ##       ##       ##    ##    ##
  //  #######   ######  ######## ######## ##       ##       ########  ######     ##   

  useEffect(() => {
    sortList(leadSort.key, leadSort.direction, getLead(gid), setLead);
  }, [pidPlayer, gid]);

  useEffect(() => {
    sortDict(lobbySort.key, lobbySort.direction, rooms, setRooms);
  }, [rooms]);

  useEffect(() => {
    sortDict(playerSort.key, playerSort.direction, playerRoomsHist, setPlayerRoomsHist);
  }, [playerRoomsHist]);

  useEffect(() => {
    setPlayerRoomsHist(Object.fromEntries(Object.entries(roomsHist).filter(([k, v]) => specPid in v.players)));
  }, [specPid, roomsHist]);

  useEffect(() => {
    if (tableEndRef.current) {
      tableEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [rooms]);

  useEffect(() => {
    if (!rooms[rid]?.players) return;
    const rank = Object.keys(rooms[rid].players).map(p => p.name).indexOf(name);
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
    if (isLinkValidated) return;
    const params = new URLSearchParams(window.location.search);
    const gidFromURL = params.get("gid");
    const ridFromURL = params.get("room");

    gidFromURL && ridFromURL && socket?.emit("check_link", { gid: gidFromURL, rid: ridFromURL });

    console.log(`isLinkValid: ${isLinkValid}`);
    if (!isLinkValid) return;
    const handleJoinRidFromURL = () => {
      if (rooms[ridFromURL]?.status != "waiting" || rooms[ridFromURL]?.rsize <= Object.keys(rooms[ridFromURL]?.players).length) {
        setGameState("main");
        window.history.replaceState({}, document.title, window.location.origin);
        return console.log(`Room ${ridFromURL} is not available.`);
      }
      setGid(gidFromURL);
      setRid(ridFromURL);
      joinGame(gidFromURL, "lobby");
      socket.emit("join_room", { gid: gidFromURL, rid: ridFromURL });
      console.log(`Auto-joining room from URL: ${ridFromURL}`);
      window.history.replaceState({}, document.title, window.location.origin);
      setIsLinkValidated(true);
    };
    if (socket.connected) {
      handleJoinRidFromURL();
    } else {
      socket.once("connect", handleJoinRidFromURL);
    }
  }, [socket, rooms, isLinkValid]);

  // ######## ##     ## ##    ##
  // ##       ##     ## ###   ##
  // ##       ##     ## ####  ##
  // ######   ##     ## ## ## ##
  // ##       ##     ## ##  ####
  // ##       ##     ## ##   ###
  // ##        #######  ##    ##

  const generatePid = () => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 10 }, () => characters[Math.floor(Math.random() * characters.length)]).join("");
  };

  const startGame = (mode, lvl) => {
    socket?.emit("create_room", { gid: gid, mode: mode, lvl: lvl });
  };

  const joinRoom = roomId => {
    if (!socket) {
      return console.error("Socket not ready yet, unable to join room.");
    }
    socket.emit("join_room", { gid: gid, rid: roomId });
    setRid(roomId);
    setIsReady(false);
    setGameState("lobby");
    console.log(`Joined room ${roomId}`);
  };

  const quitRoom = left => {
    left && socket?.emit("quit_game", { gid: gid, rid: rid });
    setRid(null);
    setIsReady(false);
    setSelectedChoice(null);
    setGameState("menu");
  };

  const joinGame = (selected_gid, status) => {
    fetch(`${SERVER_URL}/rooms/batch?gid=${selected_gid}`)
      .then(r => r.json())
      .then(d => { setRoomsHist(d) })
      .catch(e => { console.error("Error fetching rooms/batch:", e) });
    setGid(selected_gid);
    setGameState(status)
    setLead(getLead(selected_gid));
  };

  const quitGame = () => {
    setGid(null);
    setRoomsHist({});
    setGameState("main");
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

  const getLead = gid => {
    return Object.keys(pidPlayer)
      .filter(pid => gid in pidPlayer[pid])
      .map(pid => ({ pid: pid, n: pidPlayer[pid].n, a: pidPlayer[pid].a, ...pidPlayer[pid][gid] }));
  };

  const sortList = (newKey, newDirection, table, setTable) => {
    const sortedTable = [...table].sort((a, b) => {
      const va = a[newKey] ?? "";
      const vb = b[newKey] ?? "";
      if (typeof va === "string" && typeof vb === "string") {
        return newDirection === "desc" ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (typeof va === "number" && typeof vb === "number") {
        return newDirection === "asc" ? va - vb : vb - va;
      }
      return 0;
    });
    if (JSON.stringify(sortedTable) !== JSON.stringify(table)) {
      setTable(sortedTable);
      console.log(`Table sorted by ${newKey} ${newDirection}.`);
    }
  };

  const sortDict = (newKey, newDirection, table, setTable) => {
    const sortedTable = Object.fromEntries(
      Object.entries(table).sort(([, a], [, b]) => {
        const va = a[newKey] ?? "";
        const vb = b[newKey] ?? "";
        if (typeof va === "string" && typeof vb === "string") {
          return newDirection === "desc" ? va.localeCompare(vb) : vb.localeCompare(va);
        } else if (typeof va === "number" && typeof vb === "number") {
          return newDirection === "asc" ? va - vb : vb - va;
        }
        return 0;
      })
    );
    if (JSON.stringify(sortedTable) !== JSON.stringify(table)) {
      setTable(sortedTable);
      console.log(`Table sorted by ${newKey} ${newDirection}.`);
    }
  };

  // ##     ##    ###    ##    ## ########  ##       ########
  // ##     ##   ## ##   ###   ## ##     ## ##       ##      
  // ##     ##  ##   ##  ####  ## ##     ## ##       ##      
  // ######### ##     ## ## ## ## ##     ## ##       ######  
  // ##     ## ######### ##  #### ##     ## ##       ##      
  // ##     ## ##     ## ##   ### ##     ## ##       ##      
  // ##     ## ##     ## ##    ## ########  ######## ########

  const handleSettings = () => {
    editingName && setEditingName(false);
    setDisplaySettings(prev => !prev);
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

  const handleNewNameError = nName =>
    nName.length < 3 || nName.length > 15 || nName === name ||
    Object.values(pidPlayer).some(p => p.n === nName) || !/^[a-zA-Z0-9-]+$/.test(nName);

  const handleEditingAvatar = newAvatar => {
    if (editingAvatar) {
      setAvatar(newAvatar);
      setEditingAvatar(false);
      socket.emit("set_avatar", { avatar: newAvatar });
      console.log(`Avatar changed to: ${newAvatar}`);
    }
  };

  const handleWins2win = e => socket && rid && socket.emit("update_room", { gid: gid, rid: rid, wins2win: e });
  const handleRsize = e => socket && rid && socket.emit("update_room", { gid: gid, rid: rid, rsize: e });
  const handleAis = e => socket && rid && socket.emit("manage_ais", { gid: gid, rid: rid, ai_dif: e });

  const handleCopyURL = url => {
    navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(url)
        .then(() => alert("URL copied to clipboard!"))
        .catch(() => alert("Failed to copy URL. Please try manually."))
      : fallbackCopyTextToClipboard(url);
  };

  const handleReady = () => {
    if (socket && rid) {
      const newStatus = !isReady;
      setIsReady(newStatus);
      socket.emit("player_ready", { gid: gid, rid: rid, status: newStatus ? "ready" : "waiting" });
      console.log(`Player ${name} is ${newStatus ? "ready" : "waiting"} in room ${rid}`);
    }
  };

  const handleSpecPid = playerId => {
    if (gameState != "main" && !playerId) {
      return setSpecPid(playerId);
    }
    if (gameState != "main" && gid in pidPlayer[playerId]) {
      return setSpecPid(playerId);
    }
  };

  const handleSpecRid = roomId => {
    !roomId && socket.emit("update_spec", { gid: gid, rid: specRid, new_spec: false });
    rooms[roomId]?.status === "running" && socket.emit("update_spec", { gid: gid, rid: roomId, new_spec: true });
    setSpecRid(roomId);
  };

  const handleMoveRps = choice => {
    setSelectedChoice(choice);
    setIsReady(true);
    if (!socket || !rid) return;
    console.log(`You made a move: ${choice}`);
    socket.emit("make_move", { gid: gid, rid: rid, move: choice });
  };

  const handleSort = (newKey, table_name) => {
    const configs = {
      lead: [leadSort, setLeadSort, lead, setLead],
      rooms: [lobbySort, setLobbySort, rooms, setRooms],
      player: [playerSort, setPlayerSort, playerRoomsHist, setPlayerRoomsHist],
    };
    const [sort, setSort, table, setTable] = configs[table_name];
    const newDirection = sort.key === newKey && sort.direction === "desc" ? "asc" : "desc";
    setSort({ key: newKey, direction: newDirection });
    if (["lead"].includes(table_name)) {
      sortList(newKey, newDirection, table, setTable);
    } else {
      sortDict(newKey, newDirection, table, setTable);
    }    
  };

  //  ######  ##       
  // ##    ## ##    ## 
  // ##       ##    ## 
  // ##       ##    ## 
  // ##       #########
  // ##    ##       ## 
  //  ######        ## 

  const [grid, setGrid] = useState([]);
  const [moves, setMoves] = useState([]);
  const [movesCrop, setMovesCrop] = useState(0);
  const [navRound, setNavRound] = useState(0);
  const [helpMove, setHelpMove] = useState(null);
  const [winningSequence, setWinningSequence] = useState(null);

  useEffect(() => {
    if (!moves) return;
    setGrid(getGridFromMoves(moves));
  }, [moves]);

  useEffect(() => {
    const room = roomsHist[specRid] || rooms[specRid] || rooms[rid];
    if (!room || !room.rounds || !moves) return;
    const lastRound = room.rounds[room.rounds.length - 1 - navRound].moves;
    const croppedMoves = movesCrop === 0 ? lastRound : lastRound.slice(0, lastRound.length - movesCrop);
    setMoves(croppedMoves);
  }, [roomsHist, specRid, rooms, rid, movesCrop, navRound]);

  useEffect(() => {
    setMovesCrop(0);
  }, [navRound]);

  useEffect(() => {
    if (!specRid) {
      setMovesCrop(0);
      setNavRound(0);
    };
  }, [specRid]);

  useEffect(() => {
    if (gid != "c4" && !(roomsHist[specRid] || rooms[specRid] || rooms[rid])) return
    const win = detectWin(grid, 4); // Adjust the second parameter if you want to handle up to 7 connected pieces
    if (win) {
      setWinningSequence(win);
      console.log("Win detected:", win);
    } else {
      setWinningSequence(null);
    }
  }, [grid, gid, rid]);

  const handleMoveC4 = col => {
    setHelpMove(null);
    socket.emit("make_move", { gid: gid, rid: rid, move: col });
  };

  const getGridFromMoves = m => {
    const newGrid = Array.from({ length: 6 }, () => Array(7).fill(0));
    m.forEach((col, i) => {
      const player = i % 2 === 0 ? 1 : 2;
      for (let row = 5; row >= 0; row--) {
        if (newGrid[row][col] === 0) {
          newGrid[row][col] = player;
          break;
        }
      }
    });
    return newGrid;
  }

  const detectWin = (grid, minConnected = 4) => {
    const numRows = grid.length;
    const numCols = grid[0].length;
    const directions = [
      { dr: 0, dc: 1 },  // ─
      { dr: 1, dc: 0 },  // |
      { dr: 1, dc: 1 },  // \
      { dr: 1, dc: -1 }, // /
    ];

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const player = grid[r][c];
        if (player === 0) continue; // Empty cell

        for (let { dr, dc } of directions) {
          let connected = [{ r, c }];
          let nr = r + dr;
          let nc = c + dc;

          while (
            nr >= 0 &&
            nr < numRows &&
            nc >= 0 &&
            nc < numCols &&
            grid[nr][nc] === player
          ) {
            connected.push({ r: nr, c: nc });
            nr += dr;
            nc += dc;
          }

          if (connected.length >= minConnected) {
            return connected; // Return the winning sequence
          }
        }
      }
    }
  };

  const Connect4Canvas = React.memo(({ amIFirst, lastCol, lastRow, helpRow }) => {
    const canvasRef = useRef(null);
    const UNIT = 35;

    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      // Clear the entire canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the grid and pieces
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          const x = c * UNIT;
          const y = r * UNIT;
          ctx.fillStyle = "#333";
          ctx.fillRect(x, y, UNIT, UNIT);
          ctx.strokeStyle = "#000";
          ctx.strokeRect(x, y, UNIT, UNIT);

          // Highlight the last move
          if (r === lastRow && c === lastCol) {
            ctx.shadowColor = "#FFF";
            ctx.shadowBlur = 20;
          } else {
            ctx.shadowBlur = 0;
          }

          // Determine the color of the piece
          let fillColor = "#333";
          if (gameState === "running" && r === helpRow && c === helpMove && grid[r][c] === 0) {
            fillColor = "#0F0";
          } else if (grid[r][c] === 1) {
            fillColor = "#F00";
          } else if (grid[r][c] === 2) {
            fillColor = "#FD0";
          }

          if (fillColor !== "#333") {
            ctx.beginPath();
            const padding = 4;
            ctx.arc(x + UNIT / 2, y + UNIT / 2, (UNIT / 2) - padding, 0, 2 * Math.PI);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.closePath();
          }

          ctx.shadowBlur = 0;
        }
      }

      // Draw the winning line if there's a winning sequence
      if (winningSequence && winningSequence.length >= 4) {
        ctx.strokeStyle = "#00FF00"; // Green line for the win
        ctx.lineWidth = 3;
        ctx.beginPath();

        // Calculate the center positions of the first and last pieces
        const first = winningSequence[0];
        const last = winningSequence[winningSequence.length - 1];
        const startX = first.c * UNIT + UNIT / 2;
        const startY = first.r * UNIT + UNIT / 2;
        const endX = last.c * UNIT + UNIT / 2;
        const endY = last.r * UNIT + UNIT / 2;

        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.closePath();

        // Optional: Highlight each winning piece
        winningSequence.forEach(piece => {
          const x = piece.c * UNIT + UNIT / 2;
          const y = piece.r * UNIT + UNIT / 2;
          ctx.beginPath();
          ctx.arc(x, y, (UNIT / 2) - 4, 0, 2 * Math.PI);
          ctx.strokeStyle = "#00FF00";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.closePath();
        });
      }

    }, [grid, lastRow, lastCol, helpRow, helpMove, winningSequence]);

    const handleClick = (e) => {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const col = Math.floor(x / UNIT);
      if (col >= 0 && col < 7) {
        const isPlayerTurn = grid.reduce((acc, row) => acc + row.filter(cell => cell !== 0).length, 0) % 2 === (amIFirst ? 0 : 1);
        if (gameState === "running" && !navRound && isPlayerTurn) {
          handleMoveC4(col);
        }
      }
    };

    return (
      <canvas ref={canvasRef} onClick={handleClick} width={7 * UNIT} height={6 * UNIT}
        style={{ border: "2px solid #000", cursor: "pointer" }} />
    );
  });

  // ########  ######## ##    ## ########  ######## ######## 
  // ##     ## ##       ###   ## ##     ## ##       ##     ##
  // ##     ## ##       ####  ## ##     ## ##       ##     ##
  // ########  ######   ## ## ## ##     ## ######   ######## 
  // ##   ##   ##       ##  #### ##     ## ##       ##   ##  
  // ##    ##  ##       ##   ### ##     ## ##       ##    ## 
  // ##     ## ######## ##    ## ########  ######## ##     ##

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
            disabled={editingName && handleNewNameError(newName)}>{editingName ? "✔️" : "✏️"}</button>
        </div>
        <div className="text_display">Name rules:</div>
        {editingName && handleNewNameError(newName) && (
          <ul style={{ paddingLeft: "3vh", marginTop: "0.5vh" }}>
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
        <button className="button" onClick={handleSettings}>Back</button>
      </div>
    </div>
  </>

  const renderPlayerData = () => {
    if (!specPid || !pidPlayer?.[specPid] || !playerRoomsHist) return <div className="text_display">Loading...</div>;
    const specPlayer = pidPlayer[specPid];
    const maxLen = Math.max(0, ...Object.values(playerRoomsHist).map(g => Object.keys(g.players || {}).length));
    const live = Object.keys(rooms).find(roomId => specPid in rooms[roomId]?.players && rooms[roomId].status === "running");
    return <>
      <div className="main_container">
        {!specPlayer?.a ? (<div className="text_display">Loading...</div>) : (
          <div className="table_menu_container">
            <div className="button_container">
              <div className="circle_wrapper" style={{ border: `2px solid ${colors[0]}` }}>
                <img src={avatarList[specPlayer.a]} alt={`${specPlayer.n}'s avatar`} />
              </div>
              <div className="text_display">{specPlayer.n}</div>
            </div>
            <div className="button_container">
              <div className="text_display">R: {specPlayer[gid].r}% | W: {specPlayer[gid].w} | L: {specPlayer[gid].l}</div>
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
                    <td onClick={() => handleSpecRid(live)} style={{ cursor: "pointer" }}>{Object.keys(rooms[live].spec).length || ""}👁️</td>
                    {Object.entries(rooms[live].players).map(([k, v], i) => {
                      const bestw = Math.max(...Object.values(rooms[live].players).map(v => v.w));
                      return (
                        <React.Fragment key={`${i}`}>
                          <td onClick={() => handleSpecPid(k)} style={{ cursor: "pointer", padding: "0" }}>
                            <img className="avatar" src={avatarList[pidPlayer[k].a]} alt={`${pidPlayer[k].n}'s avatar`} />
                          </td>
                          <td className={v.w === bestw ? "win" : ""} onClick={() => handleSpecPid(k)} style={{ cursor: "pointer" }}>{v.w}</td>
                        </React.Fragment>
                      );
                    })}
                    {Array(Math.max(0, maxLen - Object.keys(rooms[live].players).length)).fill(0).map((_, idx) => (
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
                        <td onClick={() => handleSpecRid(key)} style={{ cursor: "pointer" }}>📺</td>
                        {players.map(([k, v], j) => (
                          <React.Fragment key={`${i}-${j}`}>
                            <td onClick={() => handleSpecPid(k)} style={{ cursor: "pointer", padding: "0" }}>
                              <img className="avatar" src={avatarList[pidPlayer[k].a]} alt={`${pidPlayer[k].n}'s avatar`} />
                            </td>
                            <td className={v.w === bestw ? "win" : ""} onClick={() => handleSpecPid(k)} style={{ cursor: "pointer" }}>{v.w}</td>
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
            onClick={() => { handleSpecPid(null); setPlayerRoomsHist({}) }}>Back</button>
        </div>
      </div>
    </>;
  };

  const renderLead = <>
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
                <tr key={i} onClick={() => handleSpecPid(p.pid)} style={{ cursor: "pointer" }}>
                  <td className={p.n === name ? "highlighted_text" : ""}>{i + 1}</td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.r.toFixed(0)}</td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.w}</td>
                  <td className={p.n === name ? "highlighted_text" : ""}>{p.l}</td>
                  <td style={{ padding: "0" }}>
                    <img src={avatarList[p.a]} className="avatar" alt={`${p.n}'s avatar`} />
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
  </>

  // ########   #######   #######  ##     ## ########    ###    ########  ##       ########
  // ##     ## ##     ## ##     ## ###   ###    ##      ## ##   ##     ## ##       ##      
  // ##     ## ##     ## ##     ## #### ####    ##     ##   ##  ##     ## ##       ##      
  // ########  ##     ## ##     ## ## ### ##    ##    ##     ## ########  ##       ######  
  // ##   ##   ##     ## ##     ## ##     ##    ##    ######### ##     ## ##       ##      
  // ##    ##  ##     ## ##     ## ##     ##    ##    ##     ## ##     ## ##       ##      
  // ##     ##  #######   #######  ##     ##    ##    ##     ## ########  ######## ########  

  const renderRoomTableRps = () => {
    const room = roomsHist[specRid] || rooms[specRid] || rooms[rid];
    if (!room || !room.players || !room.rounds) return <div className="text_display">Loading...</div>;
    const highestScore = Math.max(...Object.values(room.players).map(p => p.w));
    return <div className="table_container">
      <table className="rounds_table">
        <thead>
          <tr>
            <th>{roomsHist[specRid] ? "📺" : "⏳"}</th>
            {Object.entries(room.players).map(([k, v], i) => (
              <th key={i}>
                <div className="circle_wrapper" onClick={() => { handleSpecPid(k); handleSpecRid(null) }}
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

  const renderRoomTableC4 = () => {
    const room = roomsHist[specRid] || rooms[specRid] || rooms[rid];
    if (!room || !room.players || !moves) return <div className="text_display">Loading...</div>;
    const allMovesLen = room.rounds[room.rounds.length - 1 - navRound].moves.length;
    const allRoundsLen = room.rounds.length;
    const amIFirst = +(Object.keys(room.players)[0] === pid);
    const lastCol = moves[moves.length - 1];
    const lastRow = grid.findIndex(row => row[lastCol] !== 0);
    const helpRow = helpMove !== null ? grid.length - 1 - grid.slice().reverse().findIndex(row => row[helpMove] === 0) : -1;

    return <div className="table_menu_container">
      <Connect4Canvas amIFirst={amIFirst} lastCol={lastCol} lastRow={lastRow} helpRow={helpRow}/>
      <input type="range" min="0" max={allMovesLen - 1} className="slider"
        value={allMovesLen - 1 - movesCrop}
        onChange={(e) => setMovesCrop(allMovesLen - 1 - Number(e.target.value))}
        style={{ width: "100%", marginTop: "1.2vh", background: "#888"}}/>
      <div className="button_container">
        <button className="button" onClick={() => movesCrop < allMovesLen - 1 && setMovesCrop(movesCrop+1)}>-1</button>
        <div className="text_display">Move {allMovesLen - movesCrop}/{allMovesLen}</div>
        <button className="button" onClick={() => 0 < movesCrop && setMovesCrop(movesCrop-1)}>+1</button>
      </div>
      <div className="button_container">
        <button className="button" onClick={() => navRound < allRoundsLen - 1 && setNavRound(navRound+1)}>-1</button>
        <div className="text_display">Round {allRoundsLen - navRound}/{allRoundsLen}</div>
        <button className="button" onClick={() => 0 < navRound && setNavRound(navRound-1)}>+1</button>
      </div>
      {gameState === "running" &&
        <div className="button_container">
          <button className="button" disabled={navRound || helpMove}
            onClick={() => socket.emit("get_help_move", { gid: gid, rid: rid })}>HELP</button>
        </div>
      }
    </div>
  };

  const renderRoomTable = <>
    {gid === "rps" && renderRoomTableRps()}
    {gid === "c4" && renderRoomTableC4()}
  </>

  const renderRoomData = <>
    <div className="main_container">
      <div className="table_menu_container">
        {renderRoomTable}
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => handleSpecRid(null)} style={{ cursor: "pointer" }}>Back</button>
      </div>
    </div>
  </>

  //  ######      ###    ##     ## ########  ######  ########    ###    ######## ########
  // ##    ##    ## ##   ###   ### ##       ##    ##    ##      ## ##      ##    ##      
  // ##         ##   ##  #### #### ##       ##          ##     ##   ##     ##    ##      
  // ##   #### ##     ## ## ### ## ######    ######     ##    ##     ##    ##    ######  
  // ##    ##  ######### ##     ## ##             ##    ##    #########    ##    ##      
  // ##    ##  ##     ## ##     ## ##       ##    ##    ##    ##     ##    ##    ##      
  //  ######   ##     ## ##     ## ########  ######     ##    ##     ##    ##    ########

  const renderMain = <>
    <div className="main_container">
      {!pid ? (<div className="text_display">Loading...</div>) : (
        <div className="button_container">
          <button className="button" onClick={() => joinGame("rps", "menu")}>✊✋✌️</button>
          <button className="button" onClick={() => joinGame("c4", "menu")}>C4</button>
        </div>
      )}
    </div>
    <div className="footer_container">
      <div className="text_display" style={{ fontSize: "1.7vh", fontStyle: "italic", color: "#999" }}>Hardtech</div>
    </div>
  </>

  const renderMenu = <>
    <div className="main_container">
      <div>
        <div className="text_display">Select Mode</div>
        {gid === "rps" ? (
          <div className="button_container">
            <button className="button" onClick={() => startGame("pve", 1)}>PVE</button>
          </div>
        ) : gid === "c4" && (
          <div className="button_container" style={{paddingTop: "2vh"}}>
            <button className="button" onClick={() => startGame("pve", 1)}>PVE LV1</button>
            <button className="button" onClick={() => startGame("pve", 2)}>PVE LV2</button>
            <button className="button" onClick={() => startGame("pve", 3)}>PVE LV3</button>
          </div>
        )}
        <div className="button_container">
          <button className="button" onClick={() => startGame("pvp", 0)}>PVP</button>
        </div>
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={quitGame}>Back</button>
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
                {Object.keys(rooms).filter(roomId => roomId !== rid).length ? (
                  Object.entries(rooms).filter(([roomId]) => roomId !== rid).map(([roomId, r], i) => (<tr key={i}>
                    <td>{r.wins2win}</td>
                    <td className={r.status === "running" ? "win" : Object.keys(r.players).length === r.rsize ? "lose" : ""}>
                      {Object.keys(r.players).length}/{r.rsize}
                    </td>
                    <td>
                      <div className="button_container" style={{ padding: "0" }}>
                        {Object.entries(r.players).map(([k, v], j) => (
                          <div key={`${i}-${j}`} className="circle_wrapper" onClick={() => handleSpecPid(k)}
                            style={{ cursor: "pointer", width: "3.3vh", height: "3.3vh", border: `2px solid ${v.status === "ready" ? "#0F0" : "#F00"}` }}>
                            <img src={avatarList[pidPlayer[k].a]} alt={`${pidPlayer[k].n}'s avatar`} />
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="button" onClick={() => r.status != "running" ? joinRoom(roomId) : handleSpecRid(roomId)}
                        disabled={r.status != "running" && Object.keys(r.players).length === r.rsize}>
                        {r.status === "running" ? `${Object.keys(r.spec).length || ""}👁️` : Object.keys(r.players).length === r.rsize ? "🔒" : "Go"}
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
            value={rid ? `${window.location.origin}/?gid=${gid}&room=${rid}` : ""}
            onFocus={e => e.target.select()} />
          <button className="button" onClick={() => handleCopyURL(`${window.location.origin}/?gid=${gid}&room=${rid}`)}>Copy</button>
        </div>
        <div className="button_container">
          <div className="text_display">Wins to Win:</div>
          <button className="button" disabled={rooms[rid]?.wins2win <= 1} onClick={() => handleWins2win(-1)}>-1</button>
          <div className="text_display">{rooms[rid]?.wins2win}</div>
          <button className="button" disabled={5 <= rooms[rid]?.wins2win} onClick={() => handleWins2win(1)}>+1</button>
        </div>
        {gid === "rps" &&
          <div className="button_container">
            <div className="text_display">Room Size:</div>
            <button className="button" onClick={() => handleRsize(-1)}
              disabled={rooms[rid]?.rsize <= Math.max(2, Object.values(rooms[rid]?.players ?? {}).length)}>-1</button>
            <div className="text_display">{rooms[rid]?.rsize}</div>
            <button className="button" disabled={5 <= rooms[rid]?.rsize} onClick={() => handleRsize(1)}>+1</button>
          </div>
        }
        {gid === "rps" &&
          <div className="button_container">
            <div className="text_display">Manage AIs:</div>
            <button className="button" onClick={() => handleAis(-1)}
              disabled={!(rooms[rid]?.players && Object.values(rooms[rid].players).some(v => v.is_ai))}>-1</button>
            <div className="text_display">{Object.values(rooms[rid]?.players ?? {}).filter(v => v.is_ai).length}</div>
            <button className="button" onClick={() => handleAis(1)}
              disabled={rooms[rid]?.rsize <= Object.keys(rooms[rid]?.players ?? {}).length}>+1</button>
          </div>
        }
      </div>
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => quitRoom(true)}>Quit</button>
        <ul className="player_list">
          {rooms[rid]?.players &&
            Object.entries(rooms[rid].players).map(([k, v], i) => (
              <li key={i}>{v.status === "ready" ? "🟢" : "🔴"} {pidPlayer[k].n}</li>
            ))}
        </ul>
        <button className="button" onClick={handleReady}>{isReady ? "Wait" : "Ready"}</button>
      </div>
    </div>
  </>

  // ########  ##     ## ##    ## ##    ## #### ##    ##  ######  
  // ##     ## ##     ## ###   ## ###   ##  ##  ###   ## ##    ## 
  // ##     ## ##     ## ####  ## ####  ##  ##  ####  ## ##       
  // ########  ##     ## ## ## ## ## ## ##  ##  ## ## ## ##   ####
  // ##   ##   ##     ## ##  #### ##  ####  ##  ##  #### ##    ## 
  // ##    ##  ##     ## ##   ### ##   ###  ##  ##   ### ##    ## 
  // ##     ##  #######  ##    ## ##    ## #### ##    ##  ######  

  const renderRunningRps = <>
    <div className="table_menu_container">
      <div className="text_display">Game History</div>
      {renderRoomTable}
      <div className="text_display">Choose Your Move</div>
      <div className="button_container">
        {["R", "P", "S"].map((choice) => (
          <button onClick={() => handleMoveRps(choice)}
            key={choice} className={selectedChoice === choice ? "highlighted_button" : "button"}
            disabled={!rooms[rid]?.players[pid]?.on}>
            {choice === "R" ? "✊" : choice === "P" ? "✋" : "✌️"}
          </button>
        ))}
      </div>
    </div>
  </>

  const renderRunningC4 = <>
    {renderRoomTable}
  </>

  const renderRunning = <>
    <div className="main_container">
      {gid === "rps" && renderRunningRps}
      {gid === "c4" && renderRunningC4}
    </div>
    <div className="footer_container">
      <div className="button_container">
        <button className="button" onClick={() => quitRoom(true)}>Quit</button>
        <ul className="player_list">
          {rooms[rid]?.players &&
            Object.entries(rooms[rid].players).map(([k, v], i) => (
              <li key={i}>{v.cmove ? "🟢" : "🔴"} {pidPlayer[k].n}</li>
            ))}
        </ul>
      </div>
    </div>
  </>

  return <div className="app">
    {!pid ? (<div className="text_display" style={{ paddingTop: "2.5vh" }}>Loading...</div>) : (
      <div className="header_container">
        <div className="button_container">
          {0 < rooms[specRid || rid]?.spec?.length && <div className="text_display">{rooms[specRid || rid]?.spec?.length}👁️</div>}
          {gameState != "main" &&
            <button className={displayLead ? "highlighted_button" : "button"} onClick={() => setDisplayLead(prev => !prev)}>🏆</button>
          }
          {avatar && (
            <div className="circle_wrapper" onClick={() => handleSpecPid(pid)}
              style={{ cursor: "pointer", marginLeft: "0.8vh", border: `2px solid ${colors[roomRank]}` }}>
              <img src={avatarList[avatar]} alt="Your Avatar" />
            </div>
          )}
          <div className="text_display" style={{ cursor: "pointer" }}
            onClick={() => handleSpecPid(pid)}>{name}</div>
          {!["lobby", "running"].includes(gameState) &&
            <button className={displaySettings ? "highlighted_button" : "button"} onClick={handleSettings}>⚙️</button>
          }
        </div>
      </div>
    )}

    {editingAvatar ? renderEditingAvatar
    : displaySettings ? renderDisplaySettings
    : specRid ? renderRoomData
    : specPid ? renderPlayerData()
    : displayLead ? renderLead
    : <>
        {gameState === "main" && renderMain}
        {gameState === "menu" && renderMenu}
        {gameState === "lobby" && renderLobby}
        {gameState === "running" && renderRunning}
      </>
    }
  </div>;
}

export default App;