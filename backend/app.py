# backend/app.py

import eventlet
from eventlet.event import Event
eventlet.monkey_patch()

import os, json, uuid, base64, random, logging, threading
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
avatars = [f for f in os.listdir(AVATAR_DIR) if f.endswith(".svg") and f != "ai.svg"]
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

def sort_leaderboard(leaderboard):
    sorted_leaderboard = sorted(leaderboard.items(), key=lambda item: item[1].get("w", 0), reverse=True)
    return [{"n": n, "r": data.get("r", 0.0), "w": data.get("w", 0), "d": data.get("d", 0), "l": data.get("l", 0)} for n, data in sorted_leaderboard]

def determine_result(move1, move2):
    rules = {"Rock": "Scissors", "Paper": "Rock", "Scissors": "Paper"}
    if move1 == move2:
        return ("Draw!", "Draw!")
    elif rules.get(move1) == move2:
        return ("Win!", "Lose!")
    else:
        return ("Lose!", "Win!")

def emit_rooms_update():
    current_rooms = [{
        "room_id": k,
        "status": v["status"],
        "wins2win": v["wins2win"],
        "nb": len(v["players"]),
        "players": v["players"]} for k, v in rooms.items()]
    socketio.emit("rooms_updated", {"d": {"rooms": current_rooms}})
    save_json(ROOMS_FILE, rooms)

def clean_room_from_player(room_id, name):
    if room_id in rooms:
        room = rooms[room_id]
        if name in room["players"]:
            del room["players"][name]
            leave_room(room_id)
            log.info(f"Player {name} left room {room_id}")
            
            # Only delete the room if it's not in "waiting" or "lobby" status and has insufficient players
            if room["status"] != "waiting" and len(room["players"]) < 2:
                del rooms[room_id]
                log.info(f"Deleted room {room_id} due to insufficient players.")
            elif room["status"] == "waiting" and len(room["players"]) == 0:
                # Optionally delete the room if it's in "waiting" and no players are left
                del rooms[room_id]
                log.info(f"Deleted empty room {room_id} in 'waiting' status.")
        else:
            log.warning(f"Player {name} tried to leave room {room_id}, but is not a participant.")
    else:
        log.warning(f"Room {room_id} does not exist.")

def clean_rooms_from_player(name):
    rooms_to_delete = []
    for room_id, room in rooms.items():
        if name in room["players"]:
            del room["players"][name]
            leave_room(room_id)
            log.info(f"Player {name} left room {room_id}")
            if room["status"] != "waiting" and len(room["players"]) < 2:
                rooms_to_delete.append(room_id)
            elif room["status"] == "waiting" and len(room["players"]) == 0:
                rooms_to_delete.append(room_id)
    
    for room_id in rooms_to_delete:
        del rooms[room_id]
        log.info(f"Deleted room {room_id}.")

def get_player_room(sid):
    name = sid_name.get(sid)
    if not name:
        return None
    for room_id, room_info in rooms.items():
        if name in room_info["players"]:
            return room_id
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
    leaderboard = sort_leaderboard(load_json(PLAYERS_FILE))
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard}, room=sid)
    log.info(f"Sent leaderboard to {sid}")

@socketio.on("set_name")
def handle_set_name(data):
    name = data.get("name").strip()
    sid = request.sid
    players = load_json(PLAYERS_FILE)
    avatar = players.get(name, {}).get("avatar", get_random_avatar())
    if name not in players:
        players[name] = {"avatar": avatar, "r": 0.0, "w": 0, "d": 0, "l": 0}
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
    sid = request.sid
    name = sid_name.get(sid)
    clean_rooms_from_player(name)
    avatar = load_json(PLAYERS_FILE).get(name, {}).get("avatar")
    if mode == "ai":
        room_id = str(uuid.uuid4())
        rooms[room_id] = {
            "status": "running",
            "wins2win": wins2win,
            "players": {
                name: {"avatar": avatar, "status": "ready", "team": 1, "played": False, "w": 0, "d": 0, "l": 0},
                "AI": {"avatar": "ai.svg", "status": "ready", "team": 2, "played": True, "w": 0, "d": 0, "l": 0},
            },
            "rounds": [{"round": 1, name: None, "AI": None, "winner": None}]}
        join_room(room_id)
        players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[room_id]["players"].items()]
        emit_data = {"room_id": room_id, "players": players}
        socketio.emit("game_start", {"d": emit_data}, room=room_id)
        log.info(f"Player {name} created new room {room_id}")
        log.info(f"AI joined room {room_id}. Room is now running.")
    else:
        room_id = str(uuid.uuid4())
        rooms[room_id] = {
            "status": "waiting",
            "wins2win": wins2win,
            "players": {
                name: {"avatar": avatar, "status": "waiting", "team": 1, "played": False, "w": 0, "d": 0, "l": 0},
            },
            "rounds": [{"round": 1, name: None, "winner": None}]}
        join_room(room_id)
        players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[room_id]["players"].items()]
        emit_data = {"room_id": room_id, "players": players}
        socketio.emit("room_created", {"d": emit_data}, room=room_id)
        log.info(f"Player {name} created new room {room_id}")
    emit_rooms_update()

@socketio.on("join_room")
def handle_join_room(data):
    room_id = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    clean_rooms_from_player(name)
    avatar = load_json(PLAYERS_FILE).get(name, {}).get("avatar")
    if room_id in rooms:
        room = rooms[room_id]
        if room["status"] == "waiting" and len(room["players"]) < 2:
            team_number = 2 if 1 in [v["team"] for v in room["players"].values()] else 1
            room["players"][name] = {"avatar": avatar, "status": "waiting", "team": team_number, "played": False, "w": 0, "d": 0, "l": 0}
            room["status"] = "waiting"
            join_room(room_id)
            log.info(f"Player {name} joined room {room_id}. Waiting for both players to be ready.")
        else:
            socketio.emit("error", {"message": "Room is not available"}, room=sid)
            log.warning(f"Player {name} attempted to join room {room_id}, but it is not available.")
        players = [{"name": k, "avatar": v["avatar"]} for k, v in room["players"].items()]
        emit_data = {"room_id": room_id, "players": players}
        socketio.emit("room_joined", {"d": emit_data}, room=room_id)
    else:
        socketio.emit("error", {"message": "Room does not exist"}, room=sid)
        log.warning(f"Player {name} attempted to join non-existent room {room_id}.")
    emit_rooms_update()

@socketio.on("player_ready")
def handle_player_ready(data):
    room_id = data.get("room")
    status = data.get("status")
    sid = request.sid
    name = sid_name.get(sid)

    if room_id in rooms and name in rooms[room_id]["players"]:
        rooms[room_id]["players"][name]["status"] = status
        log.info(f"Player {name} in room {room_id} is {status}.")

        all_ready = all(player["status"] == "ready" for player in rooms[room_id]["players"].values())
        if all_ready and len(rooms[room_id]["players"]) == 2:
            rooms[room_id]["status"] = "running"
            players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[room_id]["players"].items()]
            emit_data = {"room_id": room_id, "players": players}
            socketio.emit("game_start", {"d": emit_data}, room=room_id)
            log.info(f"Game started in room {room_id}.")

        emit_rooms_update()
    else:
        socketio.emit("error", {"message": "Invalid room or player"}, room=sid)
        log.warning(f"Player {name} attempted to set ready in invalid room {room_id}.")

@socketio.on("update_wins2win")
def handle_update_wins2win(data):
    room_id = data.get("room")
    wins2win = data.get("wins2win")
    sid = request.sid
    name = sid_name.get(sid)
    if room_id in rooms and name in rooms[room_id]["players"]:
        rooms[room_id]["wins2win"] = wins2win
        log.info(f"Player {name} updated wins2win to {wins2win} in room {room_id}.")
        emit_data = {"wins2win": wins2win}
        socketio.emit("wins2win_updated", {"d": emit_data}, room=room_id)
        emit_rooms_update()
    else:
        socketio.emit("error", {"message": "Invalid room or player"}, room=sid)
        log.warning(f"Player {name} attempted to update wins2win in invalid room {room_id}.")

@socketio.on("make_move")
def handle_make_move(data):
    room_id = data.get("room")
    move = data.get("move")
    sid = request.sid
    name = sid_name.get(sid)
    log.info(f"Player {name} in room {room_id} made move: {move}")

    if room_id not in rooms:
        socketio.emit("error", {"message": "Invalid room ID"}, room=sid)
        log.warning(f"Invalid room {room_id} by {name}")
        emit_rooms_update()
        return

    room = rooms[room_id]

    if room["status"] != "running" or name not in room["players"]:
        socketio.emit("error", {"message": "You are not in this room or game hasn't started"}, room=sid)
        log.warning(f"Player {name} tried to make a move in room {room_id}, but is not a participant or game not started.")
        emit_rooms_update()
        return

    room["rounds"][-1][name] = move
    room["players"][name]["played"] = True

    # If playing against AI and AI hasn't made a move yet, generate AI's move
    if "AI" in room["players"] and room["rounds"][-1]["AI"] is None:
        ai_move = random.choice(["Rock", "Paper", "Scissors"])
        room["rounds"][-1]["AI"] = ai_move
        room["players"]["AI"]["played"] = True
        log.info(f"AI move in room {room_id}: {ai_move}")

    if all(v["played"] for v in room["players"].values()):
        for player in room["players"]:
            if player != "AI":
                room["players"][player]["played"] = False
        p1, p2 = room["players"]
        move1 = room["rounds"][-1][p1]
        move2 = room["rounds"][-1][p2]
        result1, result2 = determine_result(move1, move2)
        winner = p1 if result1 == "Win!" else p2 if result2 == "Win!" else None
        room["rounds"][-1]["winner"] = winner

        if winner in [p1, p2]:
            room["players"][winner]["w"] += 1
            room["players"][p2 if winner == p1 else p1]["l"] += 1

            # Check if the winner has reached the required wins to win the game
            if room["players"][winner]["w"] != room["wins2win"]:
                # Continue the game with a new round
                room["rounds"].append({"round": len(room["rounds"]) + 1, p1: None, p2: None, "winner": None})
                scores = [room["players"][p1]["w"], room["players"][p2]["w"]]
                emit_data = {"winner": winner, "game_over": False, "moves": [move1, move2], "scores": scores}
                log.info(f"emit_data: {emit_data}")
                socketio.emit("game_result", {"d": emit_data}, room=room_id)
                log.info(f"Added new round for room {room_id}. Current status: {room['players'][winner]['w']} wins.")
            else:
                # Game is over
                room["status"] = "over"
                room["final_winner"] = winner
                log.info(f"Game over in room {room_id}. Winner: {winner}")

                # Update leaderboard
                leaderboard = load_json(PLAYERS_FILE)
                for player in [p1, p2]:
                    if player != "AI":
                        leaderboard[player]["w"] += room["players"][player]["w"]
                        leaderboard[player]["d"] += room["players"][player]["d"]
                        leaderboard[player]["l"] += room["players"][player]["l"]

                for player in [p1, p2]:
                    if player != "AI":
                        stats = leaderboard[player]
                        tot = stats["w"] + stats["l"]
                        stats["r"] = (stats["w"] / tot) * 100 if tot > 0 else 0.0

                sorted_leaderboard = sort_leaderboard(leaderboard)
                save_json(PLAYERS_FILE, leaderboard)
                socketio.emit("leaderboard_updated", {"leaderboard": sorted_leaderboard})

                scores = [room["players"][p1]["w"], room["players"][p2]["w"]]
                emit_data = {"winner": winner, "game_over": True, "moves": [move1, move2], "scores": scores}
                socketio.emit("game_result", {"d": emit_data}, room=room_id)

                # Save room history and remove the active room
                save_room(room)
                del rooms[room_id]
                log.info(f"Room {room_id} data saved and removed from active rooms.")
        else:
            # Handle draw scenario
            room["players"][p1]["d"] += 1
            room["players"][p2]["d"] += 1
            log.info(f"Round resulted in a draw in room {room_id}.")
            # Append a new round for the next round
            room["rounds"].append({
                "round": len(room["rounds"]) + 1, p1: None, p2: None, "winner": None})

            scores = [room["players"][p1]["w"], room["players"][p2]["w"]]
            emit_data = {"winner": "", "game_over": False, "moves": [move1, move2], "scores": scores}
            socketio.emit("game_result", {"d": emit_data}, room=room_id)

    emit_rooms_update()

@socketio.on("quit_game")
def handle_quit_game(data):
    room_id = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    clean_room_from_player(room_id, name)
    players = [{"name": k, "avatar": v["avatar"]} for k, v in rooms[room_id]["players"].items()]
    emit_data = {"player": name, "players": players}
    if room_id in rooms:
        socketio.emit("player_left", {"d": emit_data}, room=room_id)
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
