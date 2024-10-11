# backend/app.py

import eventlet
eventlet.monkey_patch()

import os, json, uuid, random, string, logging, threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": "http://57.129.44.194:3001"}})
socketio = SocketIO(app, cors_allowed_origins="http://57.129.44.194:3001", async_mode="eventlet")

ROOMS_HISTORY_FILE = "db/rooms_history.json"
LEADERBOARD_FILE = "db/leaderboard.json"

file_lock = threading.Lock()
rooms = {}
sid_name = {}
name_sid = {}

def save_room(room_data):
    with file_lock:
        try:
            if os.path.exists(ROOMS_HISTORY_FILE):
                with open(ROOMS_HISTORY_FILE, "r") as f:
                    history = json.load(f)
            else:
                history = []
            history.append(room_data)
            with open(ROOMS_HISTORY_FILE, "w") as f:
                json.dump(history, f, indent=4)
            log.info("Room history updated.")
        except Exception as e:
            log.error(f"Unable to write {ROOMS_HISTORY_FILE}: {e}")

def load_leaderboard():
    with file_lock:
        try:
            with open(LEADERBOARD_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            log.error(f"Unable to read {LEADERBOARD_FILE}: {e}")
            return {}

def save_leaderboard(leaderboard):
    with file_lock:
        try:
            with open(LEADERBOARD_FILE, "w") as f:
                json.dump(leaderboard, f, indent=4)
            log.info(f"{LEADERBOARD_FILE} updated.")
        except Exception as e:
            log.error(f"Unable to write {LEADERBOARD_FILE}: {e}")

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
    current_rooms = []
    for room_id, room_info in rooms.items():
        current_rooms.append({
            "room_id": room_id,
            "status": room_info["status"],
            "num_players": len(room_info["players"]),
            "players": room_info["players"]
        })
    socketio.emit("rooms_updated", {"rooms": current_rooms})

def clean_room_from_player(room_id, name):
    if room_id in rooms:
        room = rooms[room_id]
        if name in room["players"]:
            del room["players"][name]
            leave_room(room_id)
            log.info(f"Player {name} left room {room_id}")
            if len(room["players"]) < 2:
                del rooms[room_id]
                log.info(f"Deleted room {room_id} due to insufficient players.")
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
            if len(room["players"]) < 2:
                rooms_to_delete.append(room_id)
                log.info(f"Marked room {room_id} for deletion")
    for room_id in rooms_to_delete:
        del rooms[room_id]
        log.info(f"Deleted empty room {room_id}")

@app.route("/submit", methods=["POST"])
def submit_score():
    leaderboard = sort_leaderboard(load_leaderboard())
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard})
    return jsonify({"message": "Score submitted successfully"}), 200

@socketio.on("connect")
def handle_connect():
    sid = request.sid
    log.info(f"User connected: {sid}")
    leaderboard = sort_leaderboard(load_leaderboard())
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard}, room=sid)
    log.info(f"Sent leaderboard to {sid}")

@socketio.on("set_name")
def handle_set_name(data):
    name = data.get("name").strip()
    sid = request.sid
    if name in name_sid:
        socketio.emit("name_taken", {"message": f"{name} is already connected"}, room=sid)
        log.info(f"{name} is already connected")
        return
    name_sid[name] = sid
    sid_name[sid] = name
    log.info(f"User {sid} set name {name}")
    socketio.emit("name_set", {"message": "Name set successfully"}, room=sid)

@socketio.on("create_room")
def handle_create_room(data):
    mode = data.get("mode", "online")
    sid = request.sid
    name = sid_name.get(sid)
    clean_rooms_from_player(name)
    if mode == "ai":
        room_id = str(uuid.uuid4())
        rooms[room_id] = {
            "status": "running",
            "players": {
                name: {"status": "waiting", "team": 1},
                "AI": {"status": "waiting", "team": 2}
            },
            "step": {name: None, "AI": None, "winner": None}
        }
        join_room(room_id)
        socketio.emit("match_found", {"room": room_id}, room=sid)
        log.info(f"Player {name} created new room {room_id}")
        log.info(f"AI joined room {room_id}. Room is now running.")
    else:
        room_id = str(uuid.uuid4())
        rooms[room_id] = {
            "status": "waiting",
            "players": {
                name: {"status": "waiting", "team": 1}
            },
            "step": {name: None, "winner": None}
        }
        join_room(room_id)
        socketio.emit("lobby", {"room": room_id}, room=sid)
        log.info(f"Player {name} created new room {room_id}")
    emit_rooms_update()

@socketio.on("join_room")
def handle_join_room(data):
    room_id = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    clean_rooms_from_player(name)
    if room_id in rooms:
        room = rooms[room_id]
        if room["status"] == "waiting" and len(room["players"]) < 2:
            team_number = 2 if 1 in [player["team"] for player in room["players"].values()] else 1
            room["players"][name] = {"status": "waiting", "team": team_number}
            room["status"] = "waiting"  # Remain waiting until both players are ready
            join_room(room_id)
            log.info(f"Player {name} joined room {room_id}. Waiting for both players to be ready.")
        else:
            socketio.emit("error", {"message": "Room is not available"}, room=sid)
            log.warning(f"Player {name} attempted to join room {room_id}, but it is not available.")
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
            for player in rooms[room_id]["players"].values():
                player["status"] = "waiting"
            rooms[room_id]["status"] = "running"
            socketio.emit("game_start", {"room": room_id}, room=room_id)
            log.info(f"Game started in room {room_id}.")
        
        emit_rooms_update()
    else:
        socketio.emit("error", {"message": "Invalid room or player"}, room=sid)
        log.warning(f"Player {name} attempted to set ready in invalid room {room_id}.")

@socketio.on("make_move")
def handle_make_move(data):
    room_id = data.get("room")
    move = data.get("move")
    sid = request.sid
    name = sid_name.get(sid)
    log.info(f"Player {name} in room {room_id} made move: {move}")

    if room_id in rooms:
        room = rooms[room_id]
        if room["status"] == "running" and name in room["players"]:
            room["step"][name] = move

            if "AI" in room["players"] and room["step"]["AI"] is None:
                ai_move = random.choice(["Rock", "Paper", "Scissors"])
                room["step"]["AI"] = ai_move
                log.info(f"AI move in room {room_id}: {ai_move}")

            if None not in [v for k, v in room["step"].items() if k != "winner"]:
                log.info(f"Game over in room {room_id}. Calculating results.")
                p1, p2 = list(room["players"].keys())
                move1 = room["step"][p1]
                move2 = room["step"][p2]
                result1, result2 = determine_result(move1, move2)
                room["step"]["winner"] = p1 if result1 == "Win!" else p2 if result2 == "Win!" else "Draw"

                leaderboard = load_leaderboard()
                for player in [p1, p2]:
                    if player not in leaderboard and player != "AI":
                        leaderboard[player] = {"r": 0.0, "w": 0, "d": 0, "l": 0}

                if room["step"]["winner"] in [p1, p2]:
                    w, l = (p1, p2) if room["step"]["winner"] == p1 else (p2, p1)
                    if w != "AI":
                        leaderboard[w]["w"] += 1
                    if l != "AI":
                        leaderboard[l]["l"] += 1
                else:
                    for player in [p1, p2]:
                        if player != "AI":
                            leaderboard[player]["d"] += 1

                for player in [p1, p2]:
                    if player != "AI":
                        stats = leaderboard[player]
                        tot = stats["w"] + stats["l"]
                        stats["r"] = (stats["w"] / tot) * 100 if tot > 0 else 0.0

                sorted_leaderboard = sort_leaderboard(leaderboard)
                save_leaderboard(leaderboard)
                socketio.emit("leaderboard_updated", {"leaderboard": sorted_leaderboard})

                for player in [p1, p2]:
                    if player != "AI":
                        player_sid = name_sid.get(player)
                        if player_sid:
                            opponent_move = move2 if player == p1 else move1
                            result_message = result1 if player == p1 else result2
                            socketio.emit("game_result",
                                {"your_move": room["step"][player], "opponent_move": opponent_move, "result": result_message},
                                room=player_sid)
                save_room(room)
                del rooms[room_id]
                log.info(f"Game over in room {room_id}. Room data saved and removed from active rooms.")
        else:
            socketio.emit("error", {"message": "You are not in this room or game hasn't started"}, room=sid)
            log.warning(f"Player {name} tried to make a move in room {room_id}, but is not a participant or game not started.")
    else:
        socketio.emit("error", {"message": "Invalid room ID"}, room=sid)
        log.warning(f"Invalid room {room_id} by {name}")
    emit_rooms_update()

@socketio.on("quit_game")
def handle_quit_game(data):
    room_id = data.get("room")
    sid = request.sid
    name = sid_name.get(sid)
    clean_room_from_player(room_id, name)
    emit_rooms_update()

@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    name = sid_name.get(sid)
    if sid in sid_name:
        del sid_name[sid]
    if name in name_sid:
        del name_sid[name]
    log.info(f"Client disconnected: {sid}, name: {name}")
    clean_rooms_from_player(name)
    emit_rooms_update()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config["DEBUG"])
