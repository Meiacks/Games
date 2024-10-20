# backend/app.py

import eventlet
from eventlet.event import Event
from eventlet.semaphore import Semaphore
eventlet.monkey_patch()

import os, json, base64, random, string, logging, threading
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

ROOMS_HIST_FILE = "db/rooms_hist.json"
ROOMS_FILE = "db/rooms.json"
PLAYERS_FILE = "db/players.json"
SIDNAME_FILE = "db/sid_pid.json"
AVATAR_DIR = "db/avatars"

file_lock = Semaphore(1)
avatars = [f for f in os.listdir(AVATAR_DIR) if f.endswith(".svg")]
rooms = {}
sid_pid = {}
save_json(ROOMS_FILE, rooms)
save_json(SIDNAME_FILE, sid_pid)

def get_random_avatar():
    return random.choice(avatars)

def save_room(rid, room_data):
    players = {key: {k: v[k] for k in ["team", "is_ai", "w", "l"]} for key, v in room_data["players"].items()}
    rounds = [{"index": r["index"], "winner": r["winner"], "steps": r["steps"]} for r in room_data["rounds"]]
    history = load_json(ROOMS_HIST_FILE, {})
    history[rid] = {"players": players, "rounds": rounds}
    save_json(ROOMS_HIST_FILE, history)
    del rooms[rid]
    log.info("Room history updated.")

# blackbox fun
def get_result(player_move):
    rules = {"R": "S", "P": "R", "S": "P"}
    unique_moves = set(player_move.values())
    if len(unique_moves) == 1:
        return list(player_move.keys())
    beaten_by = {move: {m for m, beats in rules.items() if beats == move} for move in unique_moves}
    winning_moves = {move for move in unique_moves if not beaten_by[move] & unique_moves}
    return list(player_move.keys()) if not winning_moves else [
        player for player, move in player_move.items() if move in winning_moves]

def emit_rooms_update():
    socketio.emit("rooms_updated", {"rooms": rooms})
    save_json(ROOMS_FILE, rooms)

def clean_room_from_player(rid, pid):
    if rid not in rooms:
        log.warning(f"Room {rid} does not exist.")
        return
    
    room = rooms[rid]
    if pid not in room["players"]:
        log.warning(f"Player with pid: {pid} is not in room {rid}.")
        return

    name = room["players"][pid]["name"]
    del room["players"][pid]
    leave_room(rid)
    log.info(f"Player {name} (pid: {pid}) left room {rid}")
    if room["status"] != "waiting" and all(v["is_ai"] for v in room["players"].values()):
        del rooms[rid]
        log.info(f"Deleted room {rid} due to insufficient players.")
    elif room["status"] == "waiting" and len(room["players"]) == 0:
        del rooms[rid]
        log.info(f"Deleted empty room {rid}.")

def clean_rooms_from_player(pid):
    rooms_to_delete = []
    for rid, room in rooms.items():
        if pid in room["players"]:
            name = room["players"][pid]["name"]
            del room["players"][pid]
            leave_room(rid)
            log.info(f"Player {name} (pid: {pid}) left room {rid}")
            if room["status"] != "waiting" and all(v["is_ai"] for v in room["players"].values()):
                rooms_to_delete.append(rid)
            elif room["status"] == "waiting" and len(room["players"]) == 0:
                rooms_to_delete.append(rid)
    
    for rid in rooms_to_delete:
        del rooms[rid]
        log.info(f"Deleted room {rid}.")

def get_player_room(sid):
    pid = sid_pid.get(sid)
    if not name:
        return None
    for rid, room_info in rooms.items():
        if name in room_info["players"]:
            return rid
    return None

def generate_random_name():
    adjectives = ["Brave", "Clever", "Swift", "Mighty", "Bold"]
    animals = ["Tiger", "Falcon", "Wolf", "Eagle", "Lion"]
    return f"{random.choice(adjectives)}-{random.choice(animals)}-{random.randint(1000, 9999)}"

def check_pid(sid, pid, ep):
    if pid:
        return True
    socketio.emit("warning", {"message": f"Your pid is not registered. To debug, please try 1)reload page 2)empty cache 3)connect from another device 4)pray 5)call the BOSS"}, room=sid)
    log.warning(f"[Endpoint: {ep}] Player (sid: {sid}) don't have a valid pid.")

def check_rid(sid, pid, rid, ep):
    if rid in rooms:
        return True
    socketio.emit("warning", {"message": f"Room {rid} not found"}, room=sid)
    log.warning(f"[Endpoint: {ep}] Player (sid: {sid}) (pid: {pid}) tried to interact with invalid room {rid}.")

def check_pid_in_room(sid, pid, rid, ep):
    if pid in rooms[rid]["players"]:
        return True
    socketio.emit("warning", {"message": f"You are not in room {rid}"}, room=sid)
    log.warning(f"[Endpoint: {ep}] Player (sid: {sid}) (pid: {pid}) tried to interact with room {rid} but is not in it.")

@app.route("/avatars/batch")
def get_all_avatars():
    try:
        tot = len([e for e in os.listdir(AVATAR_DIR) if e.endswith(".svg")])
        avatar_data = {}
        for avatar_name in avatars:
            avatar_path = os.path.join(AVATAR_DIR, avatar_name)
            with open(avatar_path, "r", encoding="utf-8") as f:
                svg_content = f.read()
                encoded_svg = base64.b64encode(svg_content.encode("utf-8")).decode("utf-8")
                avatar_data[avatar_name] = f"data:image/svg+xml;base64,{encoded_svg}"

        if len(avatar_data) == tot:
            log.info(f"Batch avatars fetched {len(avatar_data)}/{tot}")
        else:
            log.warning(f"Batch avatars not full, fetched {len(avatar_data)}/{tot}")

        response = make_response(jsonify(avatar_data), 200)
        # response.headers["Cache-Control"] = "public, max-age=86400"
        response.headers["Cache-Control"] = "no-cache"
        return response
    except Exception as e:
        log.error(f"Error fetching batch avatars: {e}")
        return jsonify({"error": "Unable to fetch avatars"}), 500

@app.route("/avatars/<filename>")
def get_avatar(filename):
    if filename not in avatars:
        return jsonify({"error": "Avatar not found"}), 404
    return send_from_directory(AVATAR_DIR, filename), 200

@app.route("/rooms/<string:rid>")
def get_room(rid):
    emit_data = load_json(ROOMS_HIST_FILE, {})  # not jsonifying here to keep original order for players
    return Response(json.dumps(emit_data), status=200, mimetype='application/json')

@app.route("/players/<string:pid>")
def get_player(pid):
    emit_data = load_json(PLAYERS_FILE, {})  # not jsonifying here to keep original order for players
    return Response(json.dumps(emit_data), status=200, mimetype='application/json')

 ######   #######   ######  ##    ## ######## ######## ####  ####### 
##    ## ##     ## ##    ## ##   ##  ##          ##     ##  ##     ##
##       ##     ## ##       ##  ##   ##          ##     ##  ##     ##
 ######  ##     ## ##       #####    ######      ##     ##  ##     ##
      ## ##     ## ##       ##  ##   ##          ##     ##  ##     ##
##    ## ##     ## ##    ## ##   ##  ##          ##     ##  ##     ##
 ######   #######   ######  ##    ## ########    ##    ####  ####### 

@socketio.on("connect")
def handle_connect():
    sid = request.sid
    log.info(f"User connected: {sid}")
    leaderboard = list({k: {**v, "pid": k} for k, v in load_json(PLAYERS_FILE, {}).items()}.values())
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard}, room=sid)
    log.info(f"Sent leaderboard to {sid}")

@socketio.on("set_pid")
def handle_set_pid(data):
    pid = data.get("pid")
    sid = request.sid
    pid_player = load_json(PLAYERS_FILE, {})
    name = pid_player.get(pid, {}).get("n") or generate_random_name()
    avatar = pid_player.get(pid, {}).get("a") or get_random_avatar()
    if pid not in pid_player:
        pid_player[pid] = {"n": name, "a": avatar, "r": 0.0, "w": 0, "l": 0}
        log.info(f"New player {name} (pid: {pid}) added to db/players.json.")
        save_json(PLAYERS_FILE, pid_player)
    sid_pid[sid] = pid
    save_json(SIDNAME_FILE, sid_pid)
    socketio.emit("pid_set", {"pid": pid, "name": name, "avatar": avatar}, room=sid)

@socketio.on("edit_name")
def handle_edit_name(data):
    ep = "edit_name"
    sid = request.sid
    pid = sid_pid.get(sid)
    if not check_pid(sid, pid, ep):
        return

    old_name = data.get("old_name").strip()
    new_name = data.get("new_name").strip()
    pid_player = load_json(PLAYERS_FILE, {})

    if new_name in [v["n"] for v in pid_player.values()]:
        socketio.emit("name_taken", room=sid)
        log.warning(f"Player {old_name} (pid: {pid}) attempted to change name to {new_name}, but it is already taken.")
        return

    pid_player[pid]["n"] = new_name
    save_json(PLAYERS_FILE, pid_player)
    log.info(f"Player {old_name} (pid: {pid}) updated to {new_name} in db/players.json.")

@socketio.on("set_avatar")
def handle_set_avatar(data):
    ep = "set_avatar"
    sid = request.sid
    pid = sid_pid.get(sid)
    if not check_pid(sid, pid, ep):
        return

    avatar = data.get("avatar")
    pid_player = load_json(PLAYERS_FILE, {})
    name = pid_player.get(pid, {}).get("n")

    if avatar not in avatars:
        socketio.emit("warning", {"message": "Invalid avatar"}, room=sid)
        log.warning(f"Player {name} (pid: {pid}) attempted to set invalid avatar {avatar}.")
        return

    pid_player[pid]["a"] = avatar
    save_json(PLAYERS_FILE, pid_player)

    for room in rooms.values():
        if pid in room["players"]:
            room["players"][pid]["avatar"] = avatar
            log.info(f"Player {name} (pid: {pid}) changed avatar to {avatar} in room {room}.")
            break
    socketio.emit("avatar_set", {"avatar": avatar}, room=sid)

@socketio.on("create_room")
def handle_create_room(data):
    ep = "create_room"
    sid = request.sid
    pid = sid_pid.get(sid)
    if not check_pid(sid, pid, ep):
        return

    mode = data.get("mode", "online")
    wins2win = data.get("wins2win", 2)
    wins2win = max(1, min(5, wins2win))
    rsize = data.get("rsize", 2)
    rsize = max(2, min(5, rsize))
    clean_rooms_from_player(pid)
    pid_player = load_json(PLAYERS_FILE, {})
    name = pid_player.get(pid, {}).get("n")
    avatar = pid_player.get(pid, {}).get("a")
    rid = "".join(random.choices(string.ascii_letters + string.digits, k=15))
    if mode == "ai":
        rooms[rid] = {"status": "running", "wins2win": wins2win, "rsize": rsize,
            "players": {
                pid: {"name": name, "avatar": avatar, "team": 1, "is_ai": False, "status": "ready", "on": True, "cmove": None, "w": 0, "l": 0},
                "AI1": {"name": "AI1", "avatar": "ai.svg", "team": 2, "is_ai": True, "status": "ready", "on": True, "cmove": None, "w": 0, "l": 0}},
            "rounds": [{"index": 1, "steps": [], "winner": None}]}
        join_room(rid)
        socketio.emit("game_start", {"rid": rid}, room=rid)
        log.info(f"Player {name} (pid: {pid}) created new room {rid}")
        log.info(f"AI1 joined room {rid}. Room is now running.")
    else:
        rooms[rid] = {"status": "waiting", "wins2win": wins2win, "rsize": rsize,
            "players": {
                pid: {"name": name, "avatar": avatar, "team": 1, "is_ai": False, "status": "waiting", "on": True, "cmove": None, "w": 0, "l": 0}},
            "rounds": [{"index": 1, "steps": [], "winner": None}]}
        join_room(rid)
        socketio.emit("room_created", {"rid": rid}, room=rid)
        log.info(f"Player {name} (pid: {pid}) created new room {rid}")
    emit_rooms_update()

@socketio.on("join_room")
def handle_join_room(data):
    ep = "join_room"
    sid = request.sid
    pid = sid_pid.get(sid)
    rid = data.get("room")
    if not check_pid(sid, pid, ep) or not check_rid(sid, pid, rid, ep):
        return

    clean_rooms_from_player(pid)
    pid_player = load_json(PLAYERS_FILE, {})
    name = pid_player.get(pid, {}).get("n")
    avatar = pid_player.get(pid, {}).get("a")

    room = rooms[rid]
    if room["status"] != "waiting":
        socketio.emit("warning", {"message": f"Room {rid} is not available"}, room=sid)
        log.warning(f"Player {name} (pid: {pid}) attempted to join room {rid}, but it is not available.")
        return
    
    if room["rsize"] <= len(room["players"]):
        socketio.emit("warning", {"message": f"Room {rid} is full"}, room=sid)
        log.warning(f"Player {name} (pid: {pid}) attempted to join room {rid}, but it is full.")
        return

    team = len(room["players"]) + 1
    room["players"][pid] = {"name": name, "avatar": avatar, "team": team, "is_ai": False, "status": "waiting", "on": True, "cmove": None, "w": 0, "l": 0}
    room["status"] = "waiting"
    join_room(rid)
    log.info(f"Player {name} (pid: {pid}) joined room {rid}. Waiting for both players to be ready.")
    socketio.emit("room_joined", {"rid": rid}, room=rid)
    emit_rooms_update()

@socketio.on("update_room")
def handle_update_room(data):
    ep = "update_room"
    sid = request.sid
    pid = sid_pid.get(sid)
    rid = data.get("room")
    if not check_pid(sid, pid, ep) or not check_rid(sid, pid, rid ,ep) or not check_pid_in_room(sid, pid, rid, ep):
        return

    update_label = "wins2win" if "wins2win" in data else "rsize"
    update = data.get(update_label)

    if update_label == "wins2win" and not 2 <= rooms[rid]["wins2win"] + update <= 5:
        socketio.emit("warning", {"message": "Invalid wins to win"}, room=sid)
        log.warning(f"Player (pid: {pid}) attempted to set invalid wins to win in room {rid}.")
        return
    
    if update_label == "rsize" and not 2 <= rooms[rid]["rsize"] + update <= 5:
        socketio.emit("warning", {"message": "Invalid room size"}, room=sid)
        log.warning(f"Player (pid: {pid}) attempted to set invalid room size in room {rid}.")
        return

    rooms[rid][update_label] += update
    log.info(f"Player (pid: {pid}) updated {update_label} to {rooms[rid][update_label]} in room {rid}.")
    socketio.emit("room_updated", {update_label: rooms[rid][update_label]}, room=rid)
    emit_rooms_update()

@socketio.on("manage_ais")
def handle_manage_ais(data):
    ep = "manage_ais"
    sid = request.sid
    pid = sid_pid.get(sid)
    rid = data.get("room")
    if not check_pid(sid, pid, ep) or not check_rid(sid, pid, rid ,ep) or not check_pid_in_room(sid, pid, rid, ep):
        return

    ai_dif = data.get("ai_dif")
    players = rooms[rid]["players"]
    ais = [k for k, v in players.items() if v["is_ai"]]
    if ai_dif == 1 and len(players) < 5:
        aiid = f"AI{len(ais) + 1}"
        players[aiid] = {"name": aiid, "avatar": "ai.svg", "team": len(players) + 1, "is_ai": True, "status": "ready", "on": True, "cmove": None, "w": 0, "l": 0}
        log.info(f"{aiid} added to room {rid}.")
        emit_rooms_update()
    elif ai_dif == -1 and len(ais):
        aiid = ais[-1]
        del players[ais[-1]]
        log.info(f"{aiid} removed from room {rid}.")
        emit_rooms_update()

@socketio.on("player_ready")
def handle_player_ready(data):
    ep = "player_ready"
    sid = request.sid
    pid = sid_pid.get(sid)
    rid = data.get("room")
    if not check_pid(sid, pid, ep) or not check_rid(sid, pid, rid ,ep) or not check_pid_in_room(sid, pid, rid, ep):
        return

    status = data.get("status")
    rooms[rid]["players"][pid]["status"] = status
    log.info(f"Player (pid: {pid}) in room {rid} is {status}.")

    all_ready = all(p["status"] == "ready" for p in rooms[rid]["players"].values())
    if all_ready and len(rooms[rid]["players"]) == rooms[rid]["rsize"]:
        rooms[rid]["status"] = "running"
        socketio.emit("game_start", {"rid": rid}, room=rid)
        log.info(f"Game started in room {rid}.")
    emit_rooms_update()

@socketio.on("make_move")
def handle_make_move(data):
    ep = "make_move"
    sid = request.sid
    pid = sid_pid.get(sid)
    rid = data.get("room")
    if not check_pid(sid, pid, ep) or not check_rid(sid, pid, rid ,ep) or not check_pid_in_room(sid, pid, rid, ep):
        return

    room = rooms[rid]
    if room["status"] != "running":
        socketio.emit("warning", {"message": "Game is not running"}, room=sid)
        log.warning(f"Player (pid: {pid}) tried to make a move in room {rid}, but game is not running.")
        return
    
    if pid not in room["players"]:
        socketio.emit("warning", {"message": "You are not in this room"}, room=sid)
        log.warning(f"Player (pid: {pid}) tried to make a move in room {rid}, but is not a participant.")
        return

    move = data.get("move")
    log.info(f"Player (pid: {pid}) in room {rid} made move: {move}")
    for aiid in {k for k, v in room["players"].items() if v["is_ai"]}:
        ai_move = random.choice(["R", "P", "S"])
        room["players"][aiid]["cmove"] = ai_move
        log.info(f"{aiid} made move: {ai_move}")

    room["players"][pid]["cmove"] = move

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
                emit_data = {"rid": rid, "game_over": False, "winner": None, "rounds": room["rounds"]}
                socketio.emit("game_result", emit_data, room=rid)
                log.info(f"New step in room {rid}. Remaining players: {cplayers}")
                emit_rooms_update()
                return
            else:
                while 1 < len(cplayers):
                    for k, v in room["players"].items():
                        if v["is_ai"]:
                            ai_move = random.choice(["R", "P", "S"])
                            room["players"][k]["cmove"] = ai_move
                            log.info(f"{k} made move: {ai_move}")
                    player_move = {k: v["cmove"] for k, v in room["players"].items() if v["on"]}
                    cplayers = get_result(player_move)
                    step = [v["cmove"] if v["on"] else "" for v in room["players"].values()]
                    room["rounds"][-1]["steps"].append(step)

                    for k, v in room["players"].items():
                        v["on"] = k in cplayers
                        v["cmove"] = None

        cwinner = cplayers[0]
        room["rounds"][-1]["winner"] = cwinner
        room["players"][cwinner]["w"] += 1
        for k in room["players"]:
            if k != cwinner:
                room["players"][k]["l"] += 1

        # new round
        if room["players"][cwinner]["w"] != room["wins2win"]:
            for v in room["players"].values():
                v["on"] = True
            room["rounds"].append({"index": len(room["rounds"]) + 1, "steps": [], "winner": None})
            emit_data = {"rid": rid, "game_over": False, "winner": cwinner, "rounds": room["rounds"]}
            socketio.emit("game_result", emit_data, room=rid)
            log.info(f"New round in room {rid}. Current status: {room['players'][cwinner]['w']} wins.")

        # game over
        else:
            winner = max(room["players"], key=lambda x: room["players"][x]["w"])
            room["status"] = "over"
            room["winner"] = winner
            log.info(f"Game over in room {rid}. Winner: {winner}")

            pid_player = load_json(PLAYERS_FILE, {})
            for k in room["players"]:
                pid_player[k]["w"] += room["players"][k]["w"]
                pid_player[k]["l"] += room["players"][k]["l"]
                tot = pid_player[k]["w"] + pid_player[k]["l"]
                pid_player[k]["r"] = round((pid_player[k]["w"] / tot) * 100, 2) if tot > 0 else 0.0
            save_json(PLAYERS_FILE, pid_player)
            leaderboard = list({k: {**v, "pid": k} for k, v in pid_player.items()}.values())
            socketio.emit("leaderboard_updated", {"leaderboard": leaderboard})

            emit_data = {"rid": rid, "game_over": True, "winner": winner, "rounds": room["rounds"]}
            socketio.emit("game_result", emit_data, room=rid)
            save_room(rid, room)
            log.info(f"Room {rid} data saved and removed from active rooms.")

    emit_rooms_update()

@socketio.on("quit_game")
def handle_quit_game(data):
    ep = "quit_game"
    sid = request.sid
    pid = sid_pid.get(sid)
    rid = data.get("room")
    if not check_pid(sid, pid, ep) or not check_rid(sid, pid, rid ,ep) or not check_pid_in_room(sid, pid, rid, ep):
        return

    socketio.emit("player_left", {"pid": pid}, room=rid)
    clean_room_from_player(rid, pid)
    emit_rooms_update()

@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    pid = sid_pid.pop(sid, None)
    save_json(SIDNAME_FILE, sid_pid)

    if not pid:
        log.warning(f"Player (sid: {sid}) (pid: {pid}) disconnected but was not found in sid_pid.")
        return

    log.info(f"Client disconnected (sid: {sid}) (pid: {pid})")
    clean_rooms_from_player(pid)
    emit_rooms_update()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config["DEBUG"])
