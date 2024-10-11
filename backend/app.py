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
sid_to_name = {}
name_to_sid = {}

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
        return ("You Win!", "You Lose!")
    else:
        return ("You Lose!", "You Win!")

def generate_random_name():
    adjectives = ["Brave", "Clever", "Swift", "Mighty", "Bold"]
    animals = ["Tiger", "Falcon", "Wolf", "Eagle", "Lion"]
    return f"{random.choice(adjectives)}-{random.choice(animals)}-{random.randint(1000, 9999)}"

@app.route("/rooms", methods=["GET"])
def get_rooms():
    with file_lock:
        try:
            current_rooms = []
            for room_id, room_info in rooms.items():
                current_rooms.append({
                    "room_id": room_id,
                    "status": room_info["status"],
                    "num_players": len(room_info["players"])
                })
            return jsonify({"rooms": current_rooms}), 200
        except Exception as e:
            log.error(f"Unable to retrieve rooms: {e}")
            return jsonify({"error": "Unable to retrieve rooms"}), 500

@app.route("/leaderboard", methods=["GET"])
def get_leaderboard():
    leaderboard = sort_leaderboard(load_leaderboard())
    return jsonify(leaderboard), 200

@app.route("/submit", methods=["POST"])
def submit_score():
    leaderboard = sort_leaderboard(load_leaderboard())
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard})
    return jsonify({"message": "Score submitted successfully"}), 200

@socketio.on("connect")
def handle_connect():
    log.info(f"Client connected: {request.sid}")
    leaderboard = sort_leaderboard(load_leaderboard())
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard}, room=request.sid)
    log.info(f"Sent leaderboard to {request.sid}")

@socketio.on('set_name')
def handle_set_name(data):
    name = data.get('name', "").strip()
    if not name:
        name = generate_random_name()
    if name in name_to_sid and name_to_sid[name] != request.sid:
        socketio.emit("name_taken", {"message": "This name is already in use"}, room=request.sid)
        log.info(f"Name {name} is already in use by another player.")
        return
    old_name = sid_to_name.get(request.sid)
    if old_name:
        name_to_sid.pop(old_name, None)
    sid_to_name[request.sid] = name
    name_to_sid[name] = request.sid
    log.info(f"User {request.sid} set name to {name}")
    socketio.emit("name_set", {"success": True, "message": "Name set successfully"}, room=request.sid)

@socketio.on("join_room")
def handle_join_room(data):
    room_id = data.get("room")
    name = sid_to_name.get(request.sid, f"Player-{request.sid}")
    if room_id in rooms:
        room = rooms[room_id]
        if room["status"] == "waiting":
            room["players"].append(name)
            room["status"] = "running"
            room["step"][name] = None
            join_room(room_id)
            socketio.emit("match_found", {"room": room_id}, room=room_id)
            log.info(f"Player {name} joined room {room_id}. Room is now running.")
        else:
            socketio.emit("error", {"message": "Room is not available"}, room=request.sid)
            log.warning(f"Player {name} attempted to join room {room_id}, but it is not available.")
    else:
        socketio.emit("error", {"message": "Room does not exist"}, room=request.sid)
        log.warning(f"Player {name} attempted to join non-existent room {room_id}.")

@socketio.on("find_match")
def handle_find_match(data):
    name = sid_to_name.get(request.sid, f"Player-{request.sid}")
    mode = data.get("mode", "online")
    if mode == "ai":
        room_id = str(uuid.uuid4())
        rooms[room_id] = {
            "status": "running",
            "players": [name, "AI"],
            "step": {name: None, "AI": None, "winner": None}}
        join_room(room_id)
        socketio.emit("match_found", {"room": room_id, "opponent": "AI"}, room=request.sid)
        log.info(f"Created new room {room_id} for player {name} vs AI")
    else:
        for room_id, room_info in rooms.items():
            if room_info["status"] == "waiting" and len(room_info["players"]) == 1:
                opponent_name = room_info["players"][0]
                room_info["players"].append(name)
                room_info["status"] = "running"
                room_info["step"][name] = None
                join_room(room_id)
                socketio.emit("match_found", {"room": room_id}, room=room_id)
                log.info(f"Match found in room {room_id} for players {room_info['players']}")
                return
        room_id = str(uuid.uuid4())
        rooms[room_id] = {
            "status": "waiting",
            "players": [name],
            "step": {name: None, "winner": None}}
        join_room(room_id)
        socketio.emit("lobby", {"room": room_id}, room=request.sid)
        log.info(f"Created new room {room_id} for player {name}")

@socketio.on("make_move")
def handle_make_move(data):
    room_id = data.get("room")
    move = data.get("move")
    name = sid_to_name.get(request.sid)
    log.info(f"Player {name} in room {room_id} made move: {move}")

    if room_id in rooms:
        room = rooms[room_id]
        if name in room["players"]:
            room["step"][name] = move
            socketio.emit("move_received", {"player": name, "move": move}, room=room_id, include_self=False)
            log.info(f"Step in room {room_id}: {room['step']}")

            if "AI" in room["players"] and room["step"]["AI"] is None:
                ai_move = random.choice(["Rock", "Paper", "Scissors"])
                room["step"]["AI"] = ai_move
                socketio.emit("move_received", {"player": "AI", "move": ai_move}, room=room_id, include_self=False)
                log.info(f"AI move in room {room_id}: {ai_move}")

            # Check if all players have made their move
            if all(room["step"][player] is not None for player in room["players"]):
                player1_name, player2_name = room["players"]
                move1 = room["step"][player1_name]
                move2 = room["step"][player2_name]
                result1, result2 = determine_result(move1, move2)

                # Determine winner
                if result1 == "You Win!":
                    room["step"]["winner"] = player1_name
                elif result2 == "You Win!":
                    room["step"]["winner"] = player2_name
                else:
                    room["step"]["winner"] = "Draw"

                # Update leaderboard
                leaderboard = load_leaderboard()
                for player_name in [player1_name, player2_name]:
                    if player_name not in leaderboard and player_name != "AI":
                        leaderboard[player_name] = {"r": 0.0, "w": 0, "d": 0, "l": 0}

                if room["step"]["winner"] == player1_name:
                    if player1_name != "AI":
                        leaderboard[player1_name]["w"] += 1
                    if player2_name != "AI":
                        leaderboard[player2_name]["l"] += 1
                elif room["step"]["winner"] == player2_name:
                    if player2_name != "AI":
                        leaderboard[player2_name]["w"] += 1
                    if player1_name != "AI":
                        leaderboard[player1_name]["l"] += 1
                else:
                    for player_name in [player1_name, player2_name]:
                        if player_name != "AI":
                            leaderboard[player_name]["d"] += 1

                # Update ratings
                for player_name in [player1_name, player2_name]:
                    if player_name != "AI":
                        w = leaderboard[player_name]["w"]
                        l = leaderboard[player_name]["l"]
                        total = w + l
                        leaderboard[player_name]["r"] = (w / total) * 100 if total > 0 else 0.0

                save_leaderboard(leaderboard)
                sorted_leaderboard = sort_leaderboard(leaderboard)
                socketio.emit("leaderboard_updated", {"leaderboard": sorted_leaderboard})

                # Send game result to players
                for player_name in [player1_name, player2_name]:
                    if player_name != "AI":
                        player_sid = name_to_sid.get(player_name)
                        if player_sid:
                            opponent_move = move2 if player_name == player1_name else move1
                            result_message = result1 if player_name == player1_name else result2
                            socketio.emit("game_result",
                                {"your_move": room["step"][player_name], "opponent_move": opponent_move, "result": result_message},
                                room=player_sid)
                save_room(room)
                del rooms[room_id]
                log.info(f"Game over in room {room_id}. Room data saved and removed from active rooms.")
        else:
            socketio.emit("error", {"message": "You are not in this room"}, room=request.sid)
            log.warning(f"Player {name} tried to make a move in room {room_id}, but is not a participant.")
    else:
        socketio.emit("error", {"message": "Invalid room ID"}, room=request.sid)
        log.warning(f"Invalid room {room_id} by {name}")

@socketio.on("cancel_find_match")
def handle_cancel_find_match(data):
    room_id = data.get("room")
    player_id = data.get("playerId")

    if room_id in rooms:
        room = rooms[room_id]
        if player_id in room["players"]:
            room["players"].remove(player_id)
            leave_room(room_id)
            log.info(f"Player {player_id} left room {room_id}")

            if not room["players"]:
                del rooms[room_id]
                log.info(f"Deleted empty room {room_id}")
            else:
                remaining_player_id = room["players"][0]
                def delayed_remove(room_id, remaining_player_id):
                    eventlet.sleep(5)
                    if room_id in rooms:
                        del rooms[room_id]
                        log.info(f"Deleted room {room_id} after opponent left.")
                        socketio.emit("opponent_left", room=remaining_player_id, to=remaining_player_id)
                        socketio.emit("return_to_menu", room=remaining_player_id, to=remaining_player_id)
                socketio.start_background_task(delayed_remove, room_id, remaining_player_id)
                log.info(f"Room {room_id} will be deleted in 5 seconds")
        else:
            log.warning(f"Player {player_id} tried to leave room {room_id}, but is not a participant.")
    else:
        log.warning(f"Room {room_id} does not exist.")

@socketio.on("disconnect")
def handle_disconnect():
    name = sid_to_name.pop(request.sid, None)
    if name:
        name_to_sid.pop(name, None)
    log.info(f"Client disconnected: {request.sid}, name: {name}")
    for room_id, room in list(rooms.items()):
        if request.sid in room["players"]:
            room["players"].remove(request.sid)
            leave_room(room_id)
            log.info(f"Removed {request.sid} from room {room_id}")
            if not room["players"] or room["players"] == ["AI"]:
                del rooms[room_id]
                log.info(f"Deleted empty or AI-only room {room_id}")
            else:
                remaining_player_id = room["players"][0]
                def delayed_remove(room_id, remaining_player_id):
                    eventlet.sleep(5)
                    if room_id in rooms:
                        del rooms[room_id]
                        log.info(f"Deleted room {room_id} after opponent left.")
                        socketio.emit("opponent_left", room=remaining_player_id, to=remaining_player_id)
                        socketio.emit("return_to_menu", room=remaining_player_id, to=remaining_player_id)
                socketio.start_background_task(delayed_remove, room_id, remaining_player_id)
                log.info(f"Room {room_id} will be deleted in 5 seconds")
            break

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config["DEBUG"])
