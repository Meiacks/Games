# backend/app.py

import eventlet
from eventlet.event import Event
from eventlet.semaphore import Semaphore
eventlet.monkey_patch()

import os, math, json, time, base64, random, string, logging, threading
from flask import Flask, jsonify, request, Response, make_response, send_from_directory
from flask_cors import CORS
from flask_compress import Compress
from flask_socketio import SocketIO, join_room, leave_room

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

app = Flask(__name__)
Compress(app)

CORS(app, resources={r"/*": {"origins": "http://57.129.44.194:3001"}})
socketio = SocketIO(app, cors_allowed_origins=["http://57.129.44.194:3001"], async_mode="eventlet")
file_lock = Semaphore(1)

def load_json(file_path, default):
    with file_lock:
        try:
            with open(file_path, "r") as f:
                log.info(f"{file_path} loaded.")
                return json.load(f)
        except Exception as e:
            log.error(f"Unable to read {file_path}: {e}")
            return default

def save_json(file_path, data):
    with file_lock:
        try:
            with open(file_path, "w") as f:
                json.dump(data, f, indent=4)
            log.info(f"{file_path} saved.")
        except Exception as e:
            log.error(f"Unable to write {file_path}: {e}")

AVATAR_DIR = "db/avatars"
PLAYERS_FILE = "db/players.json"
ROOMS_HIST_FILE = {
    "rps": "db/rps_rooms_hist.json",
    "c4": "db/c4_rooms_hist.json"}
ROOMS_FILE = {
    "rps": "db/rps_rooms.json",
    "c4": "db/c4_rooms.json"}
SIDNAME_FILE = "db/sid_pid.json"

save_json(ROOMS_FILE["rps"], {})
save_json(ROOMS_FILE["c4"], {})
save_json(SIDNAME_FILE, {})

avatars = [f for f in os.listdir(AVATAR_DIR) if f.endswith(".svg")]
pid_player = load_json(PLAYERS_FILE, {})
rooms_hist = {
    "rps": load_json(ROOMS_HIST_FILE["rps"], {}),
    "c4": load_json(ROOMS_HIST_FILE["c4"], {})}
rooms = {"rps": {}, "c4": {}}
sid_pid = {}

def update_db(filename, data):
    key = filename.split("/")[-1].split(".")[0]
    key = next((k for k in ["rooms_hist", "rooms", "players"] if k in key), key)
    socketio.emit("db_updated", {"key": key, "data": data})
    save_json(filename, data)

def clean_room_from_player(gid, rid, pid):
    if rid not in rooms[gid]:
        log.warning(f"Invalid room {rid}.")
        return
    
    room = rooms[gid][rid]
    if pid not in room["players"]:
        log.warning(f"Player with pid: {pid} is not in room {rid}.")
        return

    name = pid_player[pid]["n"]
    del room["players"][pid]
    leave_room(rid)
    log.info(f"Player {name} (pid: {pid}) left room {rid}")
    if room["status"] != "waiting" and all(v["is_ai"] for v in room["players"].values()):
        del rooms[gid][rid]
        log.info(f"Deleted room {rid} due to insufficient players.")
    elif room["status"] == "waiting" and len(room["players"]) == 0:
        del rooms[gid][rid]
        log.info(f"Deleted empty room {rid}.")

def clean_rooms_from_player(pid):
    rooms_to_delete = []
    for gid in rooms:
        for rid, room in rooms[gid].items():
            if pid in room["players"]:
                name = pid_player[pid]["n"]
                del room["players"][pid]
                leave_room(rid)
                log.info(f"Player {name} (pid: {pid}) left room {rid}")
                if room["status"] != "waiting" and all(v["is_ai"] for v in room["players"].values()):
                    rooms_to_delete.append(rid)
                elif room["status"] == "waiting" and len(room["players"]) == 0:
                    rooms_to_delete.append(rid)
    
        for rid in rooms_to_delete:
            del rooms[gid][rid]
            log.info(f"Deleted room {rid}.")

def generate_random_name():
    adjectives = ["Brave", "Clever", "Swift", "Mighty", "Bold"]
    animals = ["Tiger", "Falcon", "Wolf", "Eagle", "Lion"]
    return f"{random.choice(adjectives)}-{random.choice(animals)}-{random.randint(1000, 9999)}"

def check_pid(sid, pid, ep):
    if pid:
        return True
    socketio.emit("warning", {"message": f"Your pid is not registered. To debug, please try 1)reload page 2)empty cache 3)connect from another device 4)pray 5)call the BOSS"}, room=sid)
    log.warning(f"[Endpoint: {ep}] Player (sid: {sid}) don't have a valid pid.")

def check_rid(gid, rid, pid, sid, ep):
    if rid in rooms[gid]:
        return True
    socketio.emit("warning", {"message": f"Room {rid} not found"}, room=sid)
    log.warning(f"[Endpoint: {ep}] Player (sid: {sid}) (pid: {pid}) tried to interact with invalid room {rid}.")

def check_pid_in_room(gid, rid, pid, sid, ep):
    if pid in rooms[gid][rid]["players"]:
        return True
    socketio.emit("warning", {"message": f"You are not in room {rid}"}, room=sid)
    log.warning(f"[Endpoint: {ep}] Player (sid: {sid}) (pid: {pid}) tried to interact with room {rid} but is not in it.")

# blackbox fun
def get_result(player_move):
    rules = {"R": "S", "P": "R", "S": "P"}
    if len(unique_moves := set(player_move.values())) == 1:
        return list(player_move.keys())
    beaten_by = {move: {m for m, beats in rules.items() if beats == move} for move in unique_moves}
    winning_moves = {move for move in unique_moves if not beaten_by[move] & unique_moves}
    return list(player_move.keys()) if not winning_moves else [
        player for player, move in player_move.items() if move in winning_moves]

def add_room(gid, rid, pid, status):

    if gid == "rps":
        rooms[gid][rid] = {"status": status, "wins2win": 2, "rsize": 2, "max_spec": 0, "spec": [],
            "players": {}, "rounds": [{"index": 1, "winner": None, "steps": []}]}
    elif gid == "c4":
        rooms[gid][rid] = {"status": status, "wins2win": 2, "rsize": 2, "max_spec": 0, "spec": [],
            "players": {}, "rounds": [{"index": 1, "winner": None, "moves": []}],
            "grid": [[0 for _ in range(7)] for _ in range(6)]}

    log.info(f"Player (pid: {pid}) created new room {rid}")

def add_player(gid, rid, pid, is_ai, status):
    room = rooms[gid][rid]
    if pid not in room["players"]:
        name = pid_player[pid]["n"]
        avatar = pid_player[pid]["a"]

        if gid == "rps":
            room["players"][pid] = {"team": len(room["players"]) + 1, "is_ai": is_ai, "status": status, "on": True, "cmove": None, "w": 0, "l": 0}
        elif gid == "c4":
            room["players"][pid] = {"team": len(room["players"]) + 1, "is_ai": is_ai, "status": status, "w": 0, "l": 0}

        update_db(ROOMS_FILE[gid], rooms[gid])
    if len(room["players"]) == 1:
        log.info(f"Player {pid} created room {rid}.")
    else:
        log.info(f"{'AI' if is_ai else 'Player'} {pid} joined room {rid}.")

def add_round(gid, rid, rwinner, cwinner):
    room = rooms[gid][rid]

    if gid == "rps":
        for v in room["players"].values():
            v["on"] = True
        room["rounds"].append({"index": len(room["rounds"]) + 1, "winner": None, "steps": []})
    elif gid == "c4":
        room["rounds"].append({"index": len(room["rounds"]) + 1, "winner": None, "moves": []})
        room["grid"] = [[0 for _ in range(7)] for _ in range(6)]

    emit_data = {"rid": rid, "game_over": False, "winner": rwinner}

    if gid == "rps":
        socketio.emit("game_result_rps", emit_data, room=rid)
    elif gid == "c4":
        socketio.emit("game_result_c4", emit_data, room=rid)

    log.info(f"New round in room {rid}. Current status: {cwinner} wins.")

def game_over(gid, rid):
    room = rooms[gid][rid]
    winner = max(room["players"], key=lambda x: room["players"][x]["w"])
    room["winner"] = winner
    log.info(f"Game over in room {rid}. Winner: {winner}")

    for k in room["players"]:
        pstats = pid_player[k].setdefault(gid, {})
        for stat in ["w", "l"]:
            pstats.setdefault(stat, 0)
            pstats[stat] += room["players"][k].get(stat, 0)
        tot = pstats["w"] + pstats["l"]
        pstats["r"] = round((pstats["w"] / tot) * 100, 2) if tot > 0 else 0.0
    update_db(PLAYERS_FILE, pid_player)

    emit_data = {"rid": rid, "game_over": True, "winner": winner}

    if gid == "rps":
        socketio.emit("game_result_rps", emit_data, room=rid)
    elif gid == "c4":
        socketio.emit("game_result_c4", emit_data, room=rid)

    saved_room = {
        "date": int(time.time()), "max_spec": room["max_spec"],
        "players": {key: {k: v[k] for k in ["team", "is_ai", "w", "l"]} for key, v in room["players"].items()}}

    if gid == "rps":
        saved_room["rounds"] = [{"index": r["index"], "winner": r["winner"], "steps": r["steps"]} for r in room["rounds"]]
    elif gid == "c4":
        saved_room["rounds"] = [{"index": r["index"], "winner": r["winner"], "moves": r["moves"]} for r in room["rounds"]]

    rooms_hist[gid][rid] = saved_room
    update_db(ROOMS_HIST_FILE[gid], rooms_hist[gid])
    del rooms[gid][rid]
    log.info(f"Room {rid} data saved and removed from active rooms.")

def check_round_and_game_over(gid, rid, room, rwinner):
    if rwinner:
        room["rounds"][-1]["winner"] = rwinner
        room["players"][rwinner]["w"] += 1
        for k in room["players"]:
            if k != rwinner:
                room["players"][k]["l"] += 1

    cwinner = max(room["players"], key=lambda x: room["players"][x]["w"])
    if room["players"][cwinner]["w"] != room["wins2win"]:
        add_round(gid, rid, rwinner, cwinner)
    else:
        game_over(gid, rid)

@app.route("/avatars/batch")
def get_all_avatars():
    avatar_data = {}
    for avatar_name in avatars:
        avatar_path = os.path.join(AVATAR_DIR, avatar_name)
        with open(avatar_path, "r", encoding="utf-8") as f:
            svg_content = f.read()
            encoded_svg = base64.b64encode(svg_content.encode("utf-8")).decode("utf-8")
            avatar_data[avatar_name] = f"data:image/svg+xml;base64,{encoded_svg}"
    tot = len([e for e in os.listdir(AVATAR_DIR) if e.endswith(".svg")])
    if len(avatar_data) == tot:
        log.info(f"Batch avatars fetched {len(avatar_data)}/{tot}")
    else:
        log.warning(f"Batch avatars not full, fetched {len(avatar_data)}/{tot}")

    response = make_response(jsonify(avatar_data), 200)
    # response.headers["Cache-Control"] = "public, max-age=86400"
    response.headers["Cache-Control"] = "no-cache"
    return response

@app.route("/rooms/batch")
def get_rooms_batch():  # not jsonifying here to keep original order for players
    gid = request.args.get("gid")
    return Response(json.dumps(rooms_hist[gid]), status=200, mimetype='application/json')

@app.route("/players/batch")
def get_players_batch():  # not jsonifying here to keep original order for players
    return Response(json.dumps(pid_player), status=200, mimetype='application/json')

 ######   #######   ######  ##    ## ######## ######## ####  ####### 
##    ## ##     ## ##    ## ##   ##  ##          ##     ##  ##     ##
##       ##     ## ##       ##  ##   ##          ##     ##  ##     ##
 ######  ##     ## ##       #####    ######      ##     ##  ##     ##
      ## ##     ## ##       ##  ##   ##          ##     ##  ##     ##
##    ## ##     ## ##    ## ##   ##  ##          ##     ##  ##     ##
 ######   #######   ######  ##    ## ########    ##    ####  ####### 

@socketio.on("connect")
def handle_connect():
    log.info(f"User connected: {request.sid}")

@socketio.on("set_pid")
def handle_set_pid(data):
    pid = data.get("pid")
    sid = request.sid
    name = pid_player.get(pid, {}).get("n") or generate_random_name()
    avatar = pid_player.get(pid, {}).get("a") or random.choice(avatars)
    if pid not in pid_player:
        pid_player[pid] = {"n": name, "a": avatar}
        log.info(f"New player {name} (pid: {pid}) added to players db.")
        update_db(PLAYERS_FILE, pid_player)
    sid_pid[sid] = pid
    save_json(SIDNAME_FILE, sid_pid)
    socketio.emit("pid_set", {"pid": pid, "n": name, "a": avatar}, room=sid)

@socketio.on("edit_name")
def handle_edit_name(data):
    pid, ep = sid_pid.get(sid := request.sid), "edit_name"
    if not check_pid(sid, pid, ep):
        return

    old_name = data.get("old_name").strip()
    new_name = data.get("new_name").strip()

    if len(new_name) < 3 or len(new_name) > 15 or new_name == old_name or any(v['n'] == new_name for v in pid_player.values()) or not new_name.isalnum() and '-' not in new_name:
        if len(new_name) < 3 or len(new_name) > 15:
            msg = "name must be between 3 and 15 characters"
        elif new_name == old_name:
            msg = "name is the same as before"
        elif any(v['n'] == new_name for v in pid_player.values()):
            msg = "name is already taken"
        elif not new_name.isalnum() and '-' not in new_name:
            msg = "name must be alphanumeric with hyphens"
        log.warning(f"Player {old_name} (pid: {pid}) tried to update his name to {new_name}, but {msg}.")
        return

    pid_player[pid]["n"] = new_name
    update_db(PLAYERS_FILE, pid_player)
    log.info(f"Player {old_name} (pid: {pid}) updated to {new_name} in players db.")

@socketio.on("set_avatar")
def handle_set_avatar(data):
    pid, ep = sid_pid.get(sid := request.sid), "set_avatar"
    if not check_pid(sid, pid, ep):
        return

    avatar = data.get("avatar")
    name = pid_player.get(pid, {}).get("n")

    if avatar not in avatars:
        socketio.emit("warning", {"message": "Invalid avatar"}, room=sid)
        log.warning(f"Player {name} (pid: {pid}) attempted to set invalid avatar {avatar}.")
        return

    pid_player[pid]["a"] = avatar
    update_db(PLAYERS_FILE, pid_player)
    log.info(f"Player {name} (pid: {pid}) changed avatar to {avatar} in room {room}.")
    socketio.emit("avatar_set", avatar, room=sid)

@socketio.on("create_room")
def handle_create_room(data):
    gid, pid, ep = data.get("gid"), sid_pid.get(sid := request.sid), "create_room"
    if not check_pid(sid, pid, ep):
        return

    mode = data.get("mode")
    clean_rooms_from_player(pid)
    rid = "".join(random.choices(string.ascii_letters + string.digits, k=15))
    if mode == "pve":
        add_room(gid, rid, pid, "running")
        add_player(gid, rid, pid, False, "ready")
        add_player(gid, rid, "AI1", True, "ready")
        join_room(rid)
        socketio.emit("game_start", rid, room=rid)
    elif mode == "pvp":
        add_room(gid, rid, pid, "waiting")
        add_player(gid, rid, pid, False, "waiting")
        join_room(rid)
        socketio.emit("room_created", rid, room=rid)
    update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("join_room")
def handle_join_room(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "join_room"
    if not check_pid(sid, pid, ep) or not check_rid(gid, rid, pid, sid, ep):
        return

    clean_rooms_from_player(pid)

    room = rooms[gid][rid]
    if room["status"] != "waiting":
        socketio.emit("warning", {"message": f"Room {rid} is not available"}, room=sid)
        log.warning(f"Player (pid: {pid}) attempted to join room {rid}, but it is not available.")
        return
    
    if room["rsize"] <= len(room["players"]):
        socketio.emit("warning", {"message": f"Room {rid} is full"}, room=sid)
        log.warning(f"Player (pid: {pid}) attempted to join room {rid}, but it is full.")
        return

    add_player(gid, rid, pid, False, "waiting")
    room["status"] = "waiting"
    join_room(rid)
    socketio.emit("room_joined", rid, room=rid)
    update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("update_room")
def handle_update_room(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "update_room"
    if not check_pid(sid, pid, ep) or not check_rid(gid, rid, pid, sid, ep) or not check_pid_in_room(gid, rid, pid, sid, ep):
        return

    update = data.get(update_label := "wins2win" if "wins2win" in data else "rsize")

    if update_label == "wins2win" and not 1 <= rooms[gid][rid]["wins2win"] + update <= 5:
        socketio.emit("warning", {"message": "Invalid wins to win"}, room=sid)
        log.warning(f"Player (pid: {pid}) attempted to set invalid wins to win in room {rid}.")
        return
    
    if update_label == "rsize" and not 2 <= rooms[gid][rid]["rsize"] + update <= 5:
        socketio.emit("warning", {"message": "Invalid room size"}, room=sid)
        log.warning(f"Player (pid: {pid}) attempted to set invalid room size in room {rid}.")
        return

    rooms[gid][rid][update_label] += update
    log.info(f"Player (pid: {pid}) updated {update_label} to {rooms[gid][rid][update_label]} in room {rid}.")
    update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("manage_ais")
def handle_manage_ais(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "manage_ais"
    if not check_pid(sid, pid, ep) or not check_rid(gid, rid, pid, sid, ep) or not check_pid_in_room(gid, rid, pid, sid, ep):
        return

    ai_dif = data.get("ai_dif")
    players = rooms[gid][rid]["players"]
    ais = [k for k, v in players.items() if v["is_ai"]]
    if ai_dif == 1 and len(players) < 5:
        aiid = f"AI{len(ais) + 1}"
        add_player(gid, rid, aiid, True, "ready")
        update_db(ROOMS_FILE[gid], rooms[gid])
    elif ai_dif == -1 and len(ais):
        aiid = ais[-1]
        del players[ais[-1]]
        log.info(f"{aiid} removed from room {rid}.")
        update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("player_ready")
def handle_player_ready(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "player_ready"
    if not check_pid(sid, pid, ep) or not check_rid(gid, rid, pid, sid, ep) or not check_pid_in_room(gid, rid, pid, sid, ep):
        return

    status = data.get("status")
    rooms[gid][rid]["players"][pid]["status"] = status
    log.info(f"Player (pid: {pid}) in room {rid} is {status}.")

    all_ready = all(p["status"] == "ready" for p in rooms[gid][rid]["players"].values())
    if all_ready and len(rooms[gid][rid]["players"]) == rooms[gid][rid]["rsize"]:
        rooms[gid][rid]["status"] = "running"
        socketio.emit("game_start", rid, room=rid)
        log.info(f"Game started in room {rid}.")
    update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("update_spec")
def handle_update_spec(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "update_spec"
    if not check_pid(sid, pid, ep):
        return

    new_spec = data.get("new_spec")
    if new_spec:
        rooms[gid][rid]["spec"].append(pid)
        if rooms[gid][rid]["max_spec"] < len(rooms[gid][rid]["spec"]):
            rooms[gid][rid]["max_spec"] = len(rooms[gid][rid]["spec"])
    else:
        rooms.get(gid, {}).get(rid, {}).get("spec", set()).discard(pid)
    log.info(f"Player (pid: {pid}) in room {rid} {'join' if new_spec else 'quit'} spec.")
    update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("quit_game")
def handle_quit_game(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "quit_game"
    if not check_pid(sid, pid, ep) or not check_rid(gid, rid, pid, sid, ep) or not check_pid_in_room(gid, rid, pid, sid, ep):
        return

    socketio.emit("player_left", {"pid": pid, "rid": rid}, room=rid)
    clean_room_from_player(gid, rid, pid)
    update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("disconnect")
def handle_disconnect():
    pid = sid_pid.pop(sid := request.sid, None)
    save_json(SIDNAME_FILE, sid_pid)

    if not pid:
        log.warning(f"Player (sid: {sid}) (pid: {pid}) disconnected but was not found in sid_pid.")
        return

    log.info(f"Client disconnected (sid: {sid}) (pid: {pid})")
    clean_rooms_from_player(pid)
    for gid in rooms:
        update_db(ROOMS_FILE[gid], rooms[gid])

@socketio.on("make_move")
def handle_make_move(data):
    gid, rid, pid, ep = data.get("gid"), data.get("rid"), sid_pid.get(sid := request.sid), "make_move"
    if not check_pid(sid, pid, ep) or not check_rid(gid, rid, pid, sid, ep) or not check_pid_in_room(gid, rid, pid, sid, ep):
        return
    
    move = data.get("move")
    room = rooms[gid][rid]
    if room["status"] != "running":
        socketio.emit("warning", {"message": "Game is not running"}, room=sid)
        log.warning(f"Player (pid: {pid}) tried to make a move in room {rid}, but game {gid} is not running.")
        return

    if gid == "rps":
        handle_rps_move(gid, rid, pid, room, move)
    elif gid == "c4":
        handle_c4_move(gid, rid, pid, room, move)

########  ########   ###### 
##     ## ##     ## ##    ##
##     ## ##     ## ##      
########  ########   ###### 
##   ##   ##              ##
##    ##  ##        ##    ##
##     ## ##         ###### 

def handle_rps_move(gid, rid, pid, room, move):
    room["players"][pid]["cmove"] = move
    log.info(f"Player (pid: {pid}) in room {rid} made move: {move}")
    for aiid in {k for k, v in room["players"].items() if v["is_ai"]}:
        ai_move = random.choice(["R", "P", "S"])
        room["players"][aiid]["cmove"] = ai_move
        log.info(f"{aiid} made move: {ai_move}")

    player_move = {k: v["cmove"] for k, v in room["players"].items() if v["on"]}
    if all(player_move.values()):
        cplayers = get_result(player_move)
        step = [v["cmove"] if v["on"] else "" for v in room["players"].values()]
        room["rounds"][-1]["steps"].append(step)

        for k, v in room["players"].items():
            v["on"] = k in cplayers
            v["cmove"] = None

        # new step
        if 1 < len(cplayers):
            if not all(v["is_ai"] for k, v in room["players"].items() if k in cplayers):
                emit_data = {"rid": rid, "game_over": False, "winner": None}
                socketio.emit("game_result_rps", emit_data, room=rid)
                log.info(f"New step in room {rid}. Remaining players: {cplayers}")
                update_db(ROOMS_FILE[gid], rooms[gid])
                return
            else:
                while 1 < len(cplayers):
                    for k, v in room["players"].items():
                        if v["is_ai"]:
                            ai_move = random.choice(["R", "P", "S"])
                            room["players"][k]["cmove"] = ai_move
                            log.info(f"{k} made move: {ai_move}")
                    cplayers = get_result({k: v["cmove"] for k, v in room["players"].items() if v["on"]})
                    step = [v["cmove"] if v["on"] else "" for v in room["players"].values()]
                    room["rounds"][-1]["steps"].append(step)

                    for k, v in room["players"].items():
                        v["on"] = k in cplayers
                        v["cmove"] = None

        rwinner = cplayers[0]
        check_round_and_game_over(gid, rid, room, rwinner)

    update_db(ROOMS_FILE[gid], rooms[gid])

   ###    ####     ######  ##       
  ## ##    ##     ##    ## ##    ## 
 ##   ##   ##     ##       ##    ## 
##     ##  ##     ##       ##    ## 
#########  ##     ##       #########
##     ##  ##     ##    ##       ## 
##     ## ####     ######        ## 

def check_win(grid, move_index):
    p = move_index
    g = grid
    r0, r1, r2, r3, r4, r5 = g[0], g[1], g[2], g[3], g[4], g[5]
    for r in [r0, r1, r2, r3, r4, r5]:  # ─
        if (r[0] == p and r[1] == p and r[2] == p and r[3] == p):
            return True
        if (r[1] == p and r[2] == p and r[3] == p and r[4] == p):
            return True
        if (r[2] == p and r[3] == p and r[4] == p and r[5] == p):
            return True
        if (r[3] == p and r[4] == p and r[5] == p and r[6] == p):
            return True
    for c in range(7):  # |
        if (r0[c] == p and r1[c] == p and r2[c] == p and r3[c] == p):
            return True
        if (r1[c] == p and r2[c] == p and r3[c] == p and r4[c] == p):
            return True
        if (r2[c] == p and r3[c] == p and r4[c] == p and r5[c] == p):
            return True
    for c in range(4):  # /
        if (r3[c] == p and r2[c+1] == p and r1[c+2] == p and r0[c+3] == p):
            return True
        if (r4[c] == p and r3[c+1] == p and r2[c+2] == p and r1[c+3] == p):
            return True
        if (r5[c] == p and r4[c+1] == p and r3[c+2] == p and r2[c+3] == p):
            return True
    for c in range(4):  # \
        if (r0[c] == p and r1[c+1] == p and r2[c+2] == p and r3[c+3] == p):
            return True
        if (r1[c] == p and r2[c+1] == p and r3[c+2] == p and r4[c+3] == p):
            return True
        if (r2[c] == p and r3[c+1] == p and r4[c+2] == p and r5[c+3] == p):
            return True

def is_draw(grid):
    return all(cell != 0 for row in grid for cell in row)

def evaluate_window(window, piece):
    score = 0
    opp_piece = 1 if piece == 2 else 2
    if window.count(piece) == 4:
        score += 100
    elif window.count(piece) == 3 and window.count(0) == 1:
        score += 5
    elif window.count(piece) == 2 and window.count(0) == 2:
        score += 2
    if window.count(opp_piece) == 3 and window.count(0) == 1:
        score -= 4
    return score

def score_position(grid, piece):
    score = 0
    center_array = [row[7//2] for row in grid]
    center_count = center_array.count(piece)
    score += center_count * 3 # center column
    for r in range(6):
        row_array = grid[r]
        for c in range(7 - 3):
            window = row_array[c:c+4]
            score += evaluate_window(window, piece)  # ─
    for c in range(7):
        col_array = [grid[r][c] for r in range(6)]
        for r in range(6 - 3):
            window = col_array[r:r+4]
            score += evaluate_window(window, piece)  # |
    for r in range(6 - 3):
        for c in range(7 - 3):
            window = [grid[r+i][c+i] for i in range(4)]
            score += evaluate_window(window, piece)  # /
    for r in range(3, 6):
        for c in range(7 - 3):
            window = [grid[r-i][c+i] for i in range(4)]
            score += evaluate_window(window, piece)  # \
    return score

def is_terminal_node(grid):
    return check_win(grid, 1) or check_win(grid, 2) or is_draw(grid)

def get_valid_locations(grid):
    return [c for c in range(7) if grid[0][c] == 0]

def get_valid_locations_ordered(grid):
    center = 7 // 2
    valid_locations = get_valid_locations(grid)
    ordered = sorted(valid_locations, key=lambda x: abs(x - center))
    return ordered

def add_move_in_place(grid, col, piece):
    for row in reversed(grid):
        if row[col] == 0:
            row[col] = piece
            return True
    return False

def remove_move_in_place(grid, col):
    for row in grid:
        if row[col] != 0:
            row[col] = 0
            return True
    return False

def minimax(transposition_table, grid, depth, alpha, beta, maximizingPlayer, ai_piece, player_piece):
    grid_key = str(grid)
    if grid_key in transposition_table:
        return transposition_table[grid_key]

    valid_locations = get_valid_locations_ordered(grid)
    is_terminal = is_terminal_node(grid)
    if depth == 0 or is_terminal:
        if is_terminal:
            if check_win(grid, ai_piece):
                return (None, 100000000000000)
            elif check_win(grid, player_piece):
                return (None, -10000000000000)
            else:  # Game is over, no more valid moves
                return (None, 0)
        else:  # Depth is zero
            return (None, score_position(grid, ai_piece))

    if maximizingPlayer:
        value = -math.inf
        best_column = random.choice(valid_locations)
        for col in valid_locations:
            if add_move_in_place(grid, col, ai_piece):
                new_score = minimax(transposition_table, grid, depth-1, alpha, beta, False, ai_piece, player_piece)[1]
                remove_move_in_place(grid, col)
                if new_score > value:
                    value = new_score
                    best_column = col
                alpha = max(alpha, value)
                if alpha >= beta:
                    break
        transposition_table[grid_key] = (best_column, value)
        return best_column, value

    else:  # Minimizing player
        value = math.inf
        best_column = random.choice(valid_locations)
        for col in valid_locations:
            if add_move_in_place(grid, col, player_piece):
                new_score = minimax(transposition_table, grid, depth-1, alpha, beta, True, ai_piece, player_piece)[1]
                remove_move_in_place(grid, col)
                if new_score < value:
                    value = new_score
                    best_column = col
                beta = min(beta, value)
                if alpha >= beta:
                    break
        transposition_table[grid_key] = (best_column, value)
        return best_column, value

def add_move_temp(grid, move, move_index):
    for row in reversed(grid):
        if row[move] == 0:
            row[move] = move_index
            return True
    return False

def get_ai_move(grid, ai_piece, depth=5):
    opponent_index = 1 if ai_piece == 2 else 2
    column, minimax_score = minimax({}, grid, depth, -math.inf, math.inf, True, ai_piece, opponent_index)
    if column is None:
        column = random.choice(get_valid_locations(grid))
    return column

 ######  ##       
##    ## ##    ## 
##       ##    ## 
##       ##    ## 
##       #########
##    ##       ## 
 ######        ## 

def add_move(room, pid, grid, move, move_index):
    if len(room["rounds"][-1]["moves"]) % 2 == move_index - 1:
        for row in reversed(grid):
            if row[move] == 0:
                row[move] = move_index
                room["rounds"][-1]["moves"].append(move)
                log.info(f"Player (pid: {pid}) (move_index: {move_index}) made move: {move}")
                return True

def handle_c4_move(gid, rid, pid, room, move):
    rwinner = None
    p1, p2 = list(room["players"])
    move_index = 1 if pid == p1 else 2
    grid = room["grid"]

    if add_move(room, pid, grid, move, move_index) and check_win(grid, move_index):
        rwinner = pid

    if not rwinner and not is_draw(grid) and "AI1" in room["players"]:

        t = time.time()
        ai_index = 1 if "AI1" == p1 else 2
        ai_move = get_ai_move(grid, ai_index, 5)
        log.info(f"AI1 made move: {ai_move} in {round(time.time() - t, 3)}s")

        if add_move(room, "AI1", grid, ai_move, ai_index) and check_win(grid, ai_index):
            rwinner = "AI1"

    if not rwinner and not is_draw(grid):
        emit_data = {"rid": rid, "game_over": False, "winner": None}
        socketio.emit("game_result_c4", emit_data, room=rid)
    
    if rwinner or is_draw(grid):
        check_round_and_game_over(gid, rid, room, rwinner)

    update_db(ROOMS_FILE[gid], rooms[gid])

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config["DEBUG"])