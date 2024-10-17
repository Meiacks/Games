# backend/app.py

import eventlet
from eventlet.event import Event
eventlet.monkey_patch()

import os, json, base64, random, string, logging, threading
from flask import Flask, jsonify, request, make_response, send_from_directory
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

def load_json(file_path):
    with file_lock:
        try:
            with open(file_path, "r") as f:
                return json.load(f)
        except Exception as e:
            log.error(f"Unable to read {file_path}: {e}")
            return {}

def save_json(file_path, data):
    with file_lock:
        try:
            with open(file_path, "w") as f:
                json.dump(data, f, indent=4)
            log.info(f"{file_path} updated.")
        except Exception as e:
            log.error(f"Unable to write {file_path}: {e}")

ROOMS_HIST_FILE = "db/rooms_hist.json"
ROOMS_FILE = "db/rooms.json"
PLAYERS_FILE = "db/players.json"
SIDNAME_FILE = "db/sid_name.json"
AVATAR_DIR = "db/avatars"

file_lock = threading.Lock()
rooms = {}
save_json(ROOMS_FILE, rooms)
sid_name = load_json(SIDNAME_FILE)
avatars = [f for f in os.listdir(AVATAR_DIR) if f.endswith(".svg")]
save_json(SIDNAME_FILE, {})

def get_random_avatar():
    return random.choice(avatars)

def save_room(room_data):
    with file_lock:
        try:
            if os.path.exists(ROOMS_HIST_FILE):
                with open(ROOMS_HIST_FILE, "r") as f:
                    history = json.load(f)
            else:
                history = []
            history.append(room_data)
            with open(ROOMS_HIST_FILE, "w") as f:
                json.dump(history, f, indent=4)
            log.info("Room history updated.")
        except Exception as e:
            log.error(f"Unable to write {ROOMS_HIST_FILE}: {e}")

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
    current_rooms = [{
        "rid": k,
        "status": v["status"],
        "wins2win": v["wins2win"],
        "rsize": v["rsize"],
        "nb": len(v["players"]),
        "players": v["players"]} for k, v in rooms.items()]
    socketio.emit("rooms_updated", {"d": {"rooms": current_rooms}})
    save_json(ROOMS_FILE, rooms)

def clean_room_from_player(rid, name):
    if rid in rooms:
        room = rooms[rid]
        if name in room["players"]:
            del room["players"][name]
            leave_room(rid)
            log.info(f"Player {name} left room {rid}")
            if room["status"] != "waiting" and all(v["is_ai"] for v in room["players"].values()):
                del rooms[rid]
                log.info(f"Deleted room {rid} due to insufficient players.")
            elif room["status"] == "waiting" and len(room["players"]) == 0:
                del rooms[rid]
                log.info(f"Deleted empty room {rid}.")
        else:
            log.warning(f"Player {name} tried to leave room {rid}, but is not a participant.")
    else:
        log.warning(f"Room {rid} does not exist.")

def clean_rooms_from_player(name):
    rooms_to_delete = []
    for rid, room in rooms.items():
        if name in room["players"]:
            del room["players"][name]
            leave_room(rid)
            log.info(f"Player {name} left room {rid}")
            if room["status"] != "waiting" and all(v["is_ai"] for v in room["players"].values()):
                rooms_to_delete.append(rid)
            elif room["status"] == "waiting" and len(room["players"]) == 0:
                rooms_to_delete.append(rid)
    
    for rid in rooms_to_delete:
        del rooms[rid]
        log.info(f"Deleted room {rid}.")

def get_player_room(sid):
    name = sid_name.get(sid)
    if not name:
        return None
    for rid, room_info in rooms.items():
        if name in room_info["players"]:
            return rid
    return None

@app.route("/avatars/batch")
def get_all_avatars():
    try:
        avatar_data = {}
        for avatar_name in avatars:
            avatar_path = os.path.join(AVATAR_DIR, avatar_name)
            log.info(avatar_path)
            with open(avatar_path, "r", encoding="utf-8") as f:
                svg_content = f.read()
                encoded_svg = base64.b64encode(svg_content.encode("utf-8")).decode("utf-8")
                avatar_data[avatar_name] = f"data:image/svg+xml;base64,{encoded_svg}"
        response = make_response(jsonify({"avatar_list": avatar_data}), 200)
        # response.headers["Cache-Control"] = "public, max-age=86400"
        response.headers["Cache-Control"] = "no-cache"
        return response
    except Exception as e:
        log.error(f"Error fetching batch avatars: {e}")
        return jsonify({"error": "Unable to fetch avatars"}), 500

@app.route("/avatars/<filename>")
def get_avatar(filename):
    return send_from_directory(AVATAR_DIR, filename)

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
    players = [{"n": k, **v} for k, v in load_json(PLAYERS_FILE).items()]
    socketio.emit("players_updated", {"d": {"players": players}}, room=sid)
    log.info(f"Sent players to {sid}")

@socketio.on("set_name")
def handle_set_name(data):
    name = data.get("name").strip()
    sid = request.sid
    players = load_json(PLAYERS_FILE)
    avatar = players.get(name, {}).get("avatar", get_random_avatar())
    if name not in players:
        players[name] = {"avatar": avatar, "r": 0.0, "w": 0, "l": 0}
        log.info(f"New player {name} added to players database.")
        save_json(PLAYERS_FILE, players)
    sid_name[sid] = name
    save_json(SIDNAME_FILE, sid_name)
    socketio.emit("name_set", {"d": {"avatar": avatar}}, room=sid)

@socketio.on("edit_name")
def handle_edit_name(data):
    new_name = data.get("new_name").strip()
    old_name = sid_name.get(request.sid)
    sid = request.sid
    if new_name in sid_name.values():
        socketio.emit("name_taken", room=sid)
        return
    players = load_json(PLAYERS_FILE)
    players[new_name] = players.pop(old_name)
    save_json(PLAYERS_FILE, players)
    sid_name[sid] = new_name
    save_json(SIDNAME_FILE, sid_name)
    log.info(f"Player {old_name} updated to {new_name} in players database.")

@socketio.on("set_avatar")
def handle_set_avatar(data):
    sid = request.sid
    name = sid_name.get(sid)
    avatar = data.get("avatar")
    players = load_json(PLAYERS_FILE)
    players[name]["avatar"] = avatar
    save_json(PLAYERS_FILE, players)
    if not name:
        log.warning(f"Avatar set attempted without a valid name for SID {sid}.")
        return
    if avatar not in avatars:
        log.warning(f"Invalid avatar selection {avatar} by user {name}.")
        socketio.emit("error", {"message": "Selected avatar does not exist."}, room=sid)
        return
    for room in rooms.values():
        if name in room["players"]:
            room["players"][name]["avatar"] = avatar
            log.info(f"User {name} changed avatar to {avatar} in room {room}.")
            break
    socketio.emit("avatar_set", {"d": {"avatar": avatar}}, room=sid)

@socketio.on("create_room")
def handle_create_room(data):
    mode = data.get("mode", "online")
    wins2win = data.get("wins2win", 2)
    wins2win = max(1, min(5, wins2win))
    rsize = data.get("rsize", 2)
    rsize = max(2, min(5, rsize))
    sid = request.sid
    name = sid_name.get(sid)
    clean_rooms_from_player(name)
    avatar = load_json(PLAYERS_FILE).get(name, {}).get("avatar")
    rid = ''.join(random.choices(string.ascii_letters + string.digits, k=15))
    if mode == "ai":
        rooms[rid] = {"status": "running", "wins2win": wins2win, "rsize": rsize,
            "players": {
                name: {"avatar": avatar, "team": 1, "is_ai": False, "status": "ready", "on": True, "cmove": None, "w": 0, "l": 0},
                "AI1": {"avatar": "ai.svg", "team": 2, "is_ai": True, "status": "ready", "on": True, "cmove": None, "w": 0, "l": 0}},
            "rounds": [{"index": 1, "steps": [], "winner": None}]}
        join_room(rid)
        players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[rid]["players"].items()]
        emit_data = {"rid": rid, "players": players}
        socketio.emit("game_start", {"d": emit_data}, room=rid)
        log.info(f"Player {name} created new room {rid}")
        log.info(f"AI joined room {rid}. Room is now running.")
    else:
        rooms[rid] = {"status": "waiting", "wins2win": wins2win, "rsize": rsize,
            "players": {
                name: {"avatar": avatar, "team": 1, "is_ai": False, "status": "waiting", "on": True, "cmove": None, "w": 0, "l": 0}},
            "rounds": [{"index": 1, "steps": [], "winner": None}]}
        join_room(rid)
        players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[rid]["players"].items()]
        emit_data = {"rid": rid, "players": players}
        socketio.emit("room_created", {"d": emit_data}, room=rid)
        log.info(f"Player {name} created new room {rid}")
    emit_rooms_update()

@socketio.on("join_room")
def handle_join_room(data):
    rid = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    clean_rooms_from_player(name)
    avatar = load_json(PLAYERS_FILE).get(name, {}).get("avatar")
    if rid in rooms:
        room = rooms[rid]
        if room["status"] == "waiting" and len(room["players"]) < room["rsize"]:
            team = len(room["players"]) + 1
            room["players"][name] = {"avatar": avatar, "team": team, "is_ai": False, "status": "waiting", "on": True, "cmove": None, "w": 0, "l": 0}
            room["status"] = "waiting"
            join_room(rid)
            log.info(f"Player {name} joined room {rid}. Waiting for both players to be ready.")
        else:
            socketio.emit("error", {"message": "Room is not available"}, room=sid)
            log.warning(f"Player {name} attempted to join room {rid}, but it is not available.")
        players = [{"name": k, "avatar": v["avatar"]} for k, v in room["players"].items()]
        emit_data = {"rid": rid, "players": players}
        socketio.emit("room_joined", {"d": emit_data}, room=rid)
    else:
        socketio.emit("error", {"message": "Room does not exist"}, room=sid)
        log.warning(f"Player {name} attempted to join non-existent room {rid}.")
    emit_rooms_update()

@socketio.on("update_room")
def handle_update_room(data):
    rid = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    update_label = "wins2win" if "wins2win" in data else "rsize"
    if rid in rooms and name in rooms[rid]["players"]:
        update = data.get(update_label)
        rooms[rid][update_label] = update
        log.info(f"Player {name} updated {update_label} to {update} in room {rid}.")
        emit_data = {update_label: update}
        socketio.emit("room_updated", {"d": emit_data}, room=rid)
        emit_rooms_update()
    else:
        socketio.emit("error", {"message": "Invalid room or player"}, room=sid)
        log.warning(f"Player {name} attempted to update room data in invalid room {rid}.")

@socketio.on("manage_ais")
def handle_manage_ais(data):
    rid = data.get("room")
    ai_dif = data.get("ai_dif")
    sid = request.sid
    name = sid_name.get(sid)
    if rid in rooms and name in rooms[rid]["players"]:
        players = rooms[rid]["players"]
        ais = [k for k, v in players.items() if v["is_ai"]]
        if ai_dif == 1 and len(players) < 5:
            players[f"AI{len(ais) + 1}"] = {"avatar": "ai.svg", "team": len(players) + 1, "is_ai": True, "status": "ready", "on": True, "cmove": None, "w": 0, "l": 0}
            log.info(f"AI added to room {rid}.")
        elif ai_dif == -1 and len(ais):
            del players[ais[-1]]
            log.info(f"AI removed from room {rid}.")
    else:
        socketio.emit("error", {"message": "Invalid room or player"}, room=sid)
        log.warning(f"Player {name} attempted to manage AI in invalid room {rid}.")
    emit_rooms_update()

@socketio.on("player_ready")
def handle_player_ready(data):
    rid = data.get("room")
    status = data.get("status")
    sid = request.sid
    name = sid_name.get(sid)

    if rid in rooms and name in rooms[rid]["players"]:
        rooms[rid]["players"][name]["status"] = status
        log.info(f"Player {name} in room {rid} is {status}.")

        all_ready = all(p["status"] == "ready" for p in rooms[rid]["players"].values())
        if all_ready and len(rooms[rid]["players"]) == rooms[rid]["rsize"]:
            rooms[rid]["status"] = "running"
            players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[rid]["players"].items()]
            emit_data = {"rid": rid, "players": players}
            socketio.emit("game_start", {"d": emit_data}, room=rid)
            log.info(f"Game started in room {rid}.")

        emit_rooms_update()
    else:
        socketio.emit("error", {"message": "Invalid room or player"}, room=sid)
        log.warning(f"Player {name} attempted to set ready in invalid room {rid}.")

@socketio.on("make_move")
def handle_make_move(data):
    rid = data.get("room")
    move = data.get("move")
    sid = request.sid
    name = sid_name.get(sid)
    log.info(f"Player {name} in room {rid} made move: {move}")

    if rid not in rooms:
        socketio.emit("error", {"message": "Invalid room ID"}, room=sid)
        log.warning(f"Invalid room {rid} by {name}")
        emit_rooms_update()
        return

    room = rooms[rid]

    if room["status"] != "running" or name not in room["players"]:
        socketio.emit("error", {"message": "You are not in this room or game hasn't started"}, room=sid)
        log.warning(f"Player {name} tried to make a move in room {rid}, but is not a participant or game not started.")
        emit_rooms_update()
        return

    for k, v in room["players"].items():
        if v["is_ai"]:
            ai_move = random.choice(["R", "P", "S"])
            room["players"][k]["cmove"] = ai_move
            log.info(f"{k} made move: {ai_move}")

    room["players"][name]["cmove"] = move

    player_move = {k: v["cmove"] for k, v in room["players"].items() if v["on"]}
    if all(player_move.values()):
        cplayers = get_result(player_move)
        step = [v["cmove"] if v["on"] else "" for v in room["players"].values()]
        room["rounds"][-1]["steps"].append(step)

        for p, v in room["players"].items():
            v["on"] = p in cplayers
            v["cmove"] = None

        # new step
        if 1 < len(cplayers):
            if not all(v["is_ai"] for k, v in room["players"].items() if k in cplayers):
                emit_data = {"game_over": False, "winner": None, "rounds": room["rounds"]}
                socketio.emit("game_result", {"d": emit_data}, room=rid)
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

                    for p, v in room["players"].items():
                        v["on"] = p in cplayers
                        v["cmove"] = None

        cwinner = cplayers[0]
        room["rounds"][-1]["winner"] = cwinner
        room["players"][cwinner]["w"] += 1
        for p in room["players"]:
            if p != cwinner:
                room["players"][p]["l"] += 1

        # new round
        if room["players"][cwinner]["w"] != room["wins2win"]:
            for p, v in room["players"].items():
                v["on"] = True
            room["rounds"].append({"index": len(room["rounds"]) + 1, "steps": [], "winner": None})
            emit_data = {"game_over": False, "winner": None, "rounds": room["rounds"]}
            socketio.emit("game_result", {"d": emit_data}, room=rid)
            log.info(f"New round in room {rid}. Current status: {room['players'][cwinner]['w']} wins.")

        # game over
        else:
            winner = max(room["players"], key=lambda x: room["players"][x]["w"])
            room["status"] = "over"
            room["winner"] = winner
            log.info(f"Game over in room {rid}. Winner: {winner}")

            players = load_json(PLAYERS_FILE)
            for p in (k for k, v in room["players"].items() if not v["is_ai"]):
                players[p]["w"] += room["players"][p]["w"]
                players[p]["l"] += room["players"][p]["l"]
                tot = players[p]["w"] + players[p]["l"]
                players[p]["r"] = (players[p]["w"] / tot) * 100 if tot > 0 else 0.0

            save_json(PLAYERS_FILE, players)
            players = [{"n": k, **v} for k, v in players.items()]
            socketio.emit("players_updated", {"d": {"players": players}})

            emit_data = {"game_over": True, "winner": winner, "rounds": room["rounds"]}
            socketio.emit("game_result", {"d": emit_data}, room=rid)

            save_room(room)
            log.info(f"Room {rid} data saved and removed from active rooms.")

    emit_rooms_update()

@socketio.on("quit_game")
def handle_quit_game(data):
    rid = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    if rid in rooms:
        players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[rid]["players"].items()]
        emit_data = {"player": name, "players": players}
        socketio.emit("player_left", {"d": emit_data}, room=rid)
    clean_room_from_player(rid, name)
    emit_rooms_update()

@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    name = sid_name.pop(sid, None)
    save_json(SIDNAME_FILE, sid_name)

    if name:
        log.info(f"Client disconnected: SID={sid}, Name={name}")
        clean_rooms_from_player(name)
        emit_rooms_update()
    else:
        log.warning(f"SID {sid} disconnected but was not found in sid_name.")

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config["DEBUG"])
